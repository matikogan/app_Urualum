/**
 * PagoModal — registrar o editar el pago de un pedido.
 *
 * Props:
 *   pedidoId    {string}   ID del documento en Firestore
 *   coleccion   {string}   "pedidos_entregados" | "pedidos_despachados"
 *   pagoActual  {object|null}   Datos del pago existente (edición) o null (nuevo)
 *   historial   {array}    pagoHistorial actual del pedido
 *   onClose     {fn}
 *   onSaved     {fn(nuevoPago)}  Llamado tras guardar con éxito
 */

import { useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";

// ── Constantes ─────────────────────────────────────────────────────────────

export const METODOS_PAGO = [
  { id: "EFECTIVO",        label: "Efectivo",           icon: "💵" },
  { id: "DEBITO",          label: "Débito",              icon: "💳" },
  { id: "TRANSFERENCIA",   label: "Transferencia",       icon: "🏦" },
  { id: "CHEQUE",          label: "Cheque",              icon: "📝" },
  { id: "TARJETA_CREDITO", label: "Tarjeta de crédito",  icon: "💳" },
  { id: "PAGO_CREDITO",    label: "Pago a crédito",      icon: "📋" },
];

const BANCOS_TRANSF  = ["BROU", "SANTANDER", "ITAÚ"];
const BANCOS_CHEQUE  = ["BROU", "SANTANDER", "ITAÚ", "SCOTIA", "BBVA"];

// Qué campos extra necesita cada método
const NEED_MONEDA  = new Set(["EFECTIVO", "DEBITO", "TRANSFERENCIA", "TARJETA_CREDITO"]);
const NEED_BANCO   = new Set(["TRANSFERENCIA", "CHEQUE"]);
const NEED_TICKET  = new Set(["DEBITO", "TARJETA_CREDITO"]);

// ── Helper: resumen legible ─────────────────────────────────────────────────

export function resumenPago(pago) {
  if (!pago?.metodo) return null;
  const meta  = METODOS_PAGO.find(m => m.id === pago.metodo);
  const label = meta?.label || pago.metodo;
  const sym   = pago.moneda === "DOLAR" ? "U$S" : pago.moneda === "PESO" ? "$" : "";
  const total = pago.total != null
    ? `${sym} ${Number(pago.total).toLocaleString("es-AR")}`
    : "";
  const parts = [label];
  if (pago.banco)    parts.push(pago.banco);
  if (sym)           parts.push(sym);
  if (pago.ticket)   parts.push(`Ticket #${pago.ticket}`);
  if (pago.chequeNro) parts.push(`Cheque #${pago.chequeNro}`);
  if (total)         parts.push(total);
  return parts.join(" · ");
}

// ── Componente ─────────────────────────────────────────────────────────────

export default function PagoModal({
  pedidoId,
  coleccion = "pedidos_entregados",
  pagoActual = null,
  historial  = [],
  onClose,
  onSaved,
}) {
  const { user, profile } = useAuth();
  const esEdicion = !!pagoActual;

  // Estado del formulario — si es edición, precargamos los valores
  const [metodo,   setMetodo]   = useState(pagoActual?.metodo   || "");
  const [moneda,   setMoneda]   = useState(pagoActual?.moneda   || "");
  const [banco,    setBanco]    = useState(pagoActual?.banco    || "");
  const [ticket,   setTicket]   = useState(pagoActual?.ticket   || "");
  const [chequeNro,setChequeNro]= useState(pagoActual?.chequeNro|| "");
  const [total,    setTotal]    = useState(
    pagoActual?.total != null ? String(pagoActual.total) : ""
  );
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  // Bancos disponibles según método
  const bancos = metodo === "CHEQUE" ? BANCOS_CHEQUE : BANCOS_TRANSF;

  // Reset campos dependientes cuando cambia el método
  function handleMetodo(m) {
    setMetodo(m);
    setMoneda("");
    setBanco("");
    setTicket("");
    setChequeNro("");
    setError("");
  }

  // Validación
  function validate() {
    if (!metodo)                              return "Seleccioná un método de pago.";
    if (NEED_MONEDA.has(metodo) && !moneda)  return "Seleccioná la moneda.";
    if (NEED_BANCO.has(metodo)  && !banco)   return "Seleccioná el banco.";
    if (NEED_TICKET.has(metodo) && !ticket.trim()) return "Ingresá el número de ticket.";
    const num = parseFloat(String(total).replace(",", "."));
    if (!total || isNaN(num) || num <= 0)    return "Ingresá un total válido.";
    return null;
  }

  async function handleGuardar() {
    const err = validate();
    if (err) { setError(err); return; }

    setSaving(true);
    setError("");

    const num = parseFloat(String(total).replace(",", "."));
    const nuevoPago = {
      metodo,
      moneda:    NEED_MONEDA.has(metodo) ? moneda : null,
      banco:     NEED_BANCO.has(metodo)  ? banco  : null,
      ticket:    NEED_TICKET.has(metodo) ? ticket.trim() : null,
      chequeNro: metodo === "CHEQUE" && chequeNro.trim() ? chequeNro.trim() : null,
      total:     num,
      registradoAt:       serverTimestamp(),
      registradoPor:      user?.uid || null,
      registradoPorNombre: profile?.nombre || user?.displayName || user?.email || null,
    };

    // Si es edición, guardamos el pago anterior en el historial
    const nuevoHistorial = esEdicion
      ? [
          ...historial,
          {
            editadoAt:       serverTimestamp(),
            editadoPor:      user?.uid || null,
            editadoPorNombre: profile?.nombre || user?.displayName || user?.email || null,
            datosPrevios:    pagoActual,
          },
        ]
      : historial;

    try {
      await updateDoc(doc(db, coleccion, pedidoId), {
        pago:         nuevoPago,
        pagoHistorial: nuevoHistorial,
      });
      onSaved?.(nuevoPago);
      onClose?.();
    } catch (e) {
      console.error("[PagoModal] error guardando pago:", e);
      setError("No se pudo guardar el pago. Verificá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers de estilo ──────────────────────────────────────────────────────

  function chipBtn(label, selected, onClick, color = "#0f172a") {
    const active = selected;
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        style={{
          padding: "7px 15px",
          borderRadius: "999px",
          border: `2px solid ${active ? color : "#e2e8f0"}`,
          background: active ? color : "#fff",
          color: active ? "#fff" : "#475569",
          fontSize: "0.82rem",
          fontWeight: active ? 700 : 500,
          cursor: "pointer",
          transition: "all 0.12s ease",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
    );
  }

  function sectionLabel(text) {
    return (
      <p style={{
        margin: "14px 0 6px",
        fontSize: "0.67rem", fontWeight: 700,
        color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em",
      }}>
        {text}
      </p>
    );
  }

  // ── Resumen para el pie del modal ──────────────────────────────────────────

  const previewPago = metodo ? {
    metodo,
    moneda:    NEED_MONEDA.has(metodo) ? moneda : null,
    banco:     NEED_BANCO.has(metodo)  ? banco  : null,
    ticket:    NEED_TICKET.has(metodo) && ticket ? ticket : null,
    chequeNro: metodo === "CHEQUE" && chequeNro ? chequeNro : null,
    total:     total ? parseFloat(String(total).replace(",", ".")) || null : null,
  } : null;
  const preview = resumenPago(previewPago);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // Overlay
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: "#fff",
        borderRadius: "18px",
        width: "100%",
        maxWidth: "460px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}>

        {/* Header */}
        <div style={{
          padding: "18px 20px 16px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
              {esEdicion ? "Editar pago" : "Registrar pago"}
            </h2>
            {esEdicion && (
              <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#f59e0b", fontWeight: 600 }}>
                ✏️ Se guardará registro de la modificación
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "30px", height: "30px",
              borderRadius: "8px", border: "none",
              background: "#f1f5f9", cursor: "pointer",
              fontSize: "0.85rem", color: "#64748b",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Cuerpo scrolleable */}
        <div style={{ padding: "4px 20px 0", overflowY: "auto", maxHeight: "70vh" }}>

          {/* Método */}
          {sectionLabel("Método de pago")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
            {METODOS_PAGO.map(m =>
              chipBtn(
                `${m.icon} ${m.label}`,
                metodo === m.id,
                () => handleMetodo(m.id),
                "#0f172a"
              )
            )}
          </div>

          {/* Moneda (para: efectivo, débito, transferencia, tarjeta crédito) */}
          {metodo && NEED_MONEDA.has(metodo) && (
            <>
              {sectionLabel("Moneda")}
              <div style={{ display: "flex", gap: "7px" }}>
                {chipBtn("$ Peso",     moneda === "PESO",  () => setMoneda("PESO"),  "#15803d")}
                {chipBtn("U$S Dólar",  moneda === "DOLAR", () => setMoneda("DOLAR"), "#1d4ed8")}
              </div>
            </>
          )}

          {/* Banco (para: transferencia, cheque) */}
          {metodo && NEED_BANCO.has(metodo) && (
            <>
              {sectionLabel("Banco")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {bancos.map(b =>
                  chipBtn(b, banco === b, () => setBanco(b), "#7c3aed")
                )}
              </div>
            </>
          )}

          {/* Nº Ticket (para: débito, tarjeta crédito) */}
          {metodo && NEED_TICKET.has(metodo) && (
            <>
              {sectionLabel("Nº de ticket")}
              <input
                type="text"
                inputMode="numeric"
                placeholder="Ej: 4821"
                value={ticket}
                onChange={e => setTicket(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1.5px solid #e2e8f0",
                  fontSize: "0.93rem",
                  background: "#f8fafc",
                  outline: "none",
                }}
              />
            </>
          )}

          {/* Nº Cheque (opcional, solo para cheque) */}
          {metodo === "CHEQUE" && (
            <>
              {sectionLabel("Nº de cheque (opcional)")}
              <input
                type="text"
                inputMode="numeric"
                placeholder="Número de cheque"
                value={chequeNro}
                onChange={e => setChequeNro(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1.5px solid #e2e8f0",
                  fontSize: "0.93rem",
                  background: "#f8fafc",
                  outline: "none",
                }}
              />
            </>
          )}

          {/* Total (siempre, pero solo aparece cuando hay método seleccionado) */}
          {metodo && (
            <>
              {sectionLabel("Total")}
              <div style={{ position: "relative" }}>
                <span style={{
                  position: "absolute", left: "14px", top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: "1rem", fontWeight: 700,
                  color: moneda === "DOLAR" ? "#1d4ed8" : moneda === "PESO" ? "#15803d" : "#94a3b8",
                  pointerEvents: "none",
                }}>
                  {moneda === "DOLAR" ? "U$S" : moneda === "PESO" ? "$" : "#"}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={total}
                  onChange={e => setTotal(e.target.value.replace(/[^0-9.,]/g, ""))}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 14px 12px 44px",
                    borderRadius: "10px",
                    border: "2px solid #e2e8f0",
                    fontSize: "1.3rem",
                    fontWeight: 700,
                    background: "#f8fafc",
                    outline: "none",
                    letterSpacing: "0.02em",
                  }}
                  onFocus={e => e.target.style.borderColor = "#0f172a"}
                  onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                />
              </div>
            </>
          )}

          {/* Separador */}
          <div style={{ height: "16px" }} />
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px 18px",
          borderTop: "1px solid #f1f5f9",
        }}>
          {/* Preview del resumen */}
          {preview && (
            <div style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "9px 13px",
              marginBottom: "12px",
              fontSize: "0.82rem",
              color: "#475569",
              fontWeight: 500,
            }}>
              📋 {preview}
            </div>
          )}

          {/* Error */}
          {error && (
            <p style={{
              margin: "0 0 10px",
              background: "#fef2f2", border: "1px solid #fecaca",
              borderRadius: "8px", padding: "8px 12px",
              fontSize: "0.82rem", color: "#dc2626", fontWeight: 600,
            }}>
              ⚠ {error}
            </p>
          )}

          {/* Botones */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                flex: 1, padding: "11px",
                borderRadius: "10px",
                border: "1.5px solid #e2e8f0",
                background: "#fff",
                color: "#64748b",
                fontSize: "0.88rem", fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGuardar}
              disabled={saving || !metodo}
              style={{
                flex: 2, padding: "11px",
                borderRadius: "10px",
                border: "none",
                background: saving || !metodo ? "#e2e8f0" : "#0f172a",
                color: saving || !metodo ? "#94a3b8" : "#fff",
                fontSize: "0.88rem", fontWeight: 700,
                cursor: saving || !metodo ? "not-allowed" : "pointer",
                transition: "all 0.12s ease",
              }}
            >
              {saving ? "Guardando…" : esEdicion ? "✓ Guardar cambios" : "✓ Registrar pago"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
