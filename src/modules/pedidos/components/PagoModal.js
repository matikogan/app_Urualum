/**
 * PagoModal — registrar o editar el pago de un pedido.
 *
 * Soporta múltiples tramos de pago (pagos mixtos).
 * Escribe en la colección `pagos` usando el pedidoId como ID de documento.
 *
 * Props:
 *   pedidoId      {string}        ID del pedido (= ID del doc en `pagos`)
 *   pedidoInfo    {object|null}   Snapshot del pedido
 *   pagosActuales {array}         Tramos de pago existentes (edición) o [] (nuevo)
 *   historial     {array}         pagoHistorial actual
 *   mandatory     {boolean}       Sin botón cerrar/cancelar (flujo de despacho)
 *   onClose       {fn}
 *   onSaved       {fn(tramos)}
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
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

const BANCOS_TRANSF = ["BROU", "SANTANDER", "ITAÚ"];
const BANCOS_CHEQUE = ["BROU", "SANTANDER", "ITAÚ", "SCOTIA", "BBVA"];

const NEED_MONEDA = new Set(["EFECTIVO", "DEBITO", "TRANSFERENCIA", "TARJETA_CREDITO"]);
const NEED_BANCO  = new Set(["TRANSFERENCIA", "CHEQUE"]);
const NEED_TICKET = new Set(["DEBITO", "TARJETA_CREDITO"]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyTramo() {
  return { metodo: "", moneda: "", banco: "", ticket: "", chequeNro: "", total: "" };
}

function parsedTotal(str) {
  return parseFloat(String(str).replace(",", ".")) || 0;
}

/** Resumen legible de un único tramo */
export function resumenPago(pago) {
  if (!pago?.metodo) return null;
  const meta  = METODOS_PAGO.find(m => m.id === pago.metodo);
  const label = meta?.label || pago.metodo;
  const sym   = pago.moneda === "DOLAR" ? "U$S" : pago.moneda === "PESO" ? "$" : "";
  const parts = [label];
  if (pago.banco)     parts.push(pago.banco);
  if (sym)            parts.push(sym);
  if (pago.ticket)    parts.push(`Ticket #${pago.ticket}`);
  if (pago.chequeNro) parts.push(`Cheque #${pago.chequeNro}`);
  if (pago.total != null) parts.push(`${sym} ${Number(pago.total).toLocaleString("es-AR")}`);
  return parts.join(" · ");
}

/** Resumen legible de todos los tramos */
export function resumenTramos(tramos) {
  if (!Array.isArray(tramos) || tramos.length === 0) return null;
  return tramos.map(resumenPago).filter(Boolean).join("  +  ");
}

// ── Componente ─────────────────────────────────────────────────────────────

export default function PagoModal({
  pedidoId,
  pedidoInfo    = null,
  pagosActuales = [],
  historial     = [],
  mandatory     = false,
  onClose,
  onSaved,
}) {
  const { user, profile } = useAuth();
  const esNuevo   = pagosActuales.length === 0;
  const esIsabela = pedidoInfo?.deposito === "ISABELA";

  const [tramos, setTramos] = useState(() =>
    pagosActuales.length > 0
      ? pagosActuales.map(p => ({
          metodo:    p.metodo    || "",
          moneda:    p.moneda    || "",
          banco:     p.banco     || "",
          ticket:    p.ticket    || "",
          chequeNro: p.chequeNro || "",
          total:     p.total != null ? String(p.total) : "",
        }))
      : [emptyTramo()]
  );

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  // ── Helpers de estado de tramos ────────────────────────────────────────────

  function updateTramo(i, field, value) {
    setTramos(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
    setError("");
  }

  function handleMetodo(i, m) {
    setTramos(prev => prev.map((t, idx) =>
      idx === i ? { ...emptyTramo(), metodo: m } : t
    ));
    setError("");
  }

  function addTramo() {
    setTramos(prev => [...prev, emptyTramo()]);
  }

  function removeTramo(i) {
    setTramos(prev => prev.filter((_, idx) => idx !== i));
  }

  // ── Validación ─────────────────────────────────────────────────────────────

  function validateAll() {
    for (let i = 0; i < tramos.length; i++) {
      const t      = tramos[i];
      const prefix = tramos.length > 1 ? `Tramo ${i + 1}: ` : "";
      if (!t.metodo)                                return `${prefix}Seleccioná un método de pago.`;
      if (NEED_MONEDA.has(t.metodo) && !t.moneda)   return `${prefix}Seleccioná la moneda.`;
      if (NEED_BANCO.has(t.metodo)  && !t.banco)    return `${prefix}Seleccioná el banco.`;
      if (NEED_TICKET.has(t.metodo) && !t.ticket.trim()) return `${prefix}Ingresá el número de ticket.`;
      const num = parsedTotal(t.total);
      if (!t.total || num <= 0) return `${prefix}Ingresá un total válido.`;
    }
    return null;
  }

  // ── Guardar ────────────────────────────────────────────────────────────────

  async function handleGuardar() {
    const err = validateAll();
    if (err) { setError(err); return; }

    setSaving(true);
    setError("");

    const nombreUsuario = profile?.nombre || user?.displayName || user?.email || null;

    const parsedTramos = tramos.map(t => ({
      metodo:    t.metodo,
      moneda:    NEED_MONEDA.has(t.metodo) ? t.moneda    : null,
      banco:     NEED_BANCO.has(t.metodo)  ? t.banco     : null,
      ticket:    NEED_TICKET.has(t.metodo) ? t.ticket.trim() : null,
      chequeNro: t.metodo === "CHEQUE" && t.chequeNro.trim() ? t.chequeNro.trim() : null,
      total:     parsedTotal(t.total),
    }));

    try {
      const ref = doc(db, "pagos", pedidoId);

      if (esNuevo) {
        await setDoc(ref, {
          pedidoId,
          numero:        pedidoInfo?.numero || pedidoInfo?.id || pedidoId,
          cliente:       pedidoInfo?.cliente       || null,
          deposito:      pedidoInfo?.deposito      || null,
          metodoEntrega: pedidoInfo?.metodoEntrega || null,
          finFecha:      pedidoInfo?.finFecha      || null,
          pagos:                  parsedTramos,
          pagoOrigen:             null,
          pagoEstado:             "PENDIENTE",
          pagoRegistradoAt:       null,
          pagoRegistradoPor:      null,
          pagoRegistradoPorNombre: null,
          pagoHistorial:          [],
          creadoAt:        serverTimestamp(),
          creadoPor:       user?.uid    || null,
          creadoPorNombre: nombreUsuario,
        });
      } else {
        await updateDoc(ref, {
          pagos: parsedTramos,
          pagoHistorial: [
            ...historial,
            {
              editadoAt:         serverTimestamp(),
              editadoPor:        user?.uid || null,
              editadoPorNombre:  nombreUsuario,
              tramosAnteriores:  pagosActuales,
            },
          ],
          editadoAt:        serverTimestamp(),
          editadoPor:       user?.uid    || null,
          editadoPorNombre: nombreUsuario,
        });
      }

      onSaved?.(parsedTramos);
      onClose?.();
    } catch (e) {
      console.error("[PagoModal] error guardando pago:", e);
      setError("No se pudo guardar el pago. Verificá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  // ── Pago gestionado en R8 (ISABELA) ────────────────────────────────────────

  async function handlePagoEnR8() {
    setSaving(true);
    setError("");
    const nombreUsuario = profile?.nombre || user?.displayName || user?.email || null;
    try {
      const ref = doc(db, "pagos", pedidoId);
      await setDoc(ref, {
        pedidoId,
        numero:        pedidoInfo?.numero || pedidoInfo?.id || pedidoId,
        cliente:       pedidoInfo?.cliente       || null,
        deposito:      pedidoInfo?.deposito      || null,
        metodoEntrega: pedidoInfo?.metodoEntrega || null,
        finFecha:      pedidoInfo?.finFecha      || null,
        pagos:                  [],
        pagoOrigen:             "R8",
        pagoEstado:             "PENDIENTE",
        pagoRegistradoAt:       null,
        pagoRegistradoPor:      null,
        pagoRegistradoPorNombre: null,
        pagoHistorial:          [],
        creadoAt:        serverTimestamp(),
        creadoPor:       user?.uid    || null,
        creadoPorNombre: nombreUsuario,
      });
      onSaved?.([]);
      onClose?.();
    } catch (e) {
      console.error("[PagoModal] error pago R8:", e);
      setError("No se pudo guardar. Verificá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  // ── Helpers de estilo ──────────────────────────────────────────────────────

  function chip(label, selected, onClick, color = "#0f172a") {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        style={{
          padding: "7px 14px", borderRadius: "999px",
          border: `2px solid ${selected ? color : "#e2e8f0"}`,
          background: selected ? color : "#fff",
          color: selected ? "#fff" : "#475569",
          fontSize: "0.82rem", fontWeight: selected ? 700 : 500,
          cursor: "pointer", transition: "all 0.12s ease",
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
        margin: "12px 0 6px",
        fontSize: "0.67rem", fontWeight: 700,
        color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em",
      }}>
        {text}
      </p>
    );
  }

  // ── Preview footer ─────────────────────────────────────────────────────────

  const totalGeneral = tramos.reduce((sum, t) => sum + parsedTotal(t.total), 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
      }}
      onClick={(e) => { if (!mandatory && e.target === e.currentTarget) onClose?.(); }}
    >
      <div style={{
        background: "#fff", borderRadius: "18px",
        width: "100%", maxWidth: "480px",
        maxHeight: "calc(100vh - 32px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>

        {/* Header */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
              {esNuevo ? "💰 Registrar pago" : "✏️ Editar pago"}
            </h2>
            {pedidoInfo && (
              <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                #{pedidoInfo.numero || pedidoId} · {pedidoInfo.cliente || ""}
              </p>
            )}
            {!esNuevo && (
              <p style={{ margin: "3px 0 0", fontSize: "0.72rem", color: "#f59e0b", fontWeight: 600 }}>
                Se guardará registro de la modificación
              </p>
            )}
            {mandatory && (
              <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "#dc2626", fontWeight: 600 }}>
                ✅ Pedido despachado — completá los datos del pago para continuar
              </p>
            )}
          </div>
          {!mandatory && (
            <button
              type="button" onClick={onClose}
              style={{
                width: "30px", height: "30px", borderRadius: "8px", border: "none",
                background: "#f1f5f9", cursor: "pointer",
                fontSize: "0.85rem", color: "#64748b",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Cuerpo scrolleable */}
        <div style={{ padding: "4px 20px 0", overflowY: "auto", flex: 1, minHeight: 0 }}>

          {/* Tramos */}
          {tramos.map((t, i) => {
            const bancos = t.metodo === "CHEQUE" ? BANCOS_CHEQUE : BANCOS_TRANSF;
            return (
              <div
                key={i}
                style={{
                  borderTop: i > 0 ? "2px dashed #e2e8f0" : "none",
                  paddingTop: i > 0 ? "14px" : "4px",
                  marginTop: i > 0 ? "14px" : 0,
                }}
              >
                {/* Encabezado del tramo */}
                {tramos.length > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <span style={{
                      fontSize: "0.68rem", fontWeight: 800,
                      color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em",
                    }}>
                      Tramo {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeTramo(i)}
                      style={{
                        background: "#fef2f2", border: "1px solid #fecaca",
                        borderRadius: "6px", padding: "2px 8px",
                        fontSize: "0.72rem", color: "#dc2626",
                        cursor: "pointer", fontWeight: 700,
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                )}

                {/* Método */}
                {sectionLabel("Método de pago")}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                  {METODOS_PAGO.map(m =>
                    chip(`${m.icon} ${m.label}`, t.metodo === m.id, () => handleMetodo(i, m.id))
                  )}
                </div>

                {/* Moneda */}
                {t.metodo && NEED_MONEDA.has(t.metodo) && (
                  <>
                    {sectionLabel("Moneda")}
                    <div style={{ display: "flex", gap: "7px" }}>
                      {chip("$ Peso",    t.moneda === "PESO",  () => updateTramo(i, "moneda", "PESO"),  "#15803d")}
                      {chip("U$S Dólar", t.moneda === "DOLAR", () => updateTramo(i, "moneda", "DOLAR"), "#1d4ed8")}
                    </div>
                  </>
                )}

                {/* Banco */}
                {t.metodo && NEED_BANCO.has(t.metodo) && (
                  <>
                    {sectionLabel("Banco")}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                      {bancos.map(b => chip(b, t.banco === b, () => updateTramo(i, "banco", b), "#7c3aed"))}
                    </div>
                  </>
                )}

                {/* Nº Ticket */}
                {t.metodo && NEED_TICKET.has(t.metodo) && (
                  <>
                    {sectionLabel("Nº de ticket")}
                    <input
                      type="text" inputMode="numeric" placeholder="Ej: 4821"
                      value={t.ticket}
                      onChange={e => updateTramo(i, "ticket", e.target.value)}
                      style={{
                        width: "100%", boxSizing: "border-box", padding: "10px 14px",
                        borderRadius: "10px", border: "1.5px solid #e2e8f0",
                        fontSize: "0.93rem", background: "#f8fafc", outline: "none",
                      }}
                    />
                  </>
                )}

                {/* Nº Cheque */}
                {t.metodo === "CHEQUE" && (
                  <>
                    {sectionLabel("Nº de cheque (opcional)")}
                    <input
                      type="text" inputMode="numeric" placeholder="Número de cheque"
                      value={t.chequeNro}
                      onChange={e => updateTramo(i, "chequeNro", e.target.value)}
                      style={{
                        width: "100%", boxSizing: "border-box", padding: "10px 14px",
                        borderRadius: "10px", border: "1.5px solid #e2e8f0",
                        fontSize: "0.93rem", background: "#f8fafc", outline: "none",
                      }}
                    />
                  </>
                )}

                {/* Total del tramo */}
                {t.metodo && (
                  <>
                    {sectionLabel(tramos.length > 1 ? `Total — tramo ${i + 1}` : "Total")}
                    <div style={{ position: "relative" }}>
                      <span style={{
                        position: "absolute", left: "14px", top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: "1rem", fontWeight: 700, pointerEvents: "none",
                        color: t.moneda === "DOLAR" ? "#1d4ed8" : t.moneda === "PESO" ? "#15803d" : "#94a3b8",
                      }}>
                        {t.moneda === "DOLAR" ? "U$S" : t.moneda === "PESO" ? "$" : "#"}
                      </span>
                      <input
                        type="text" inputMode="decimal" placeholder="0"
                        value={t.total}
                        onChange={e => updateTramo(i, "total", e.target.value.replace(/[^0-9.,]/g, ""))}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          padding: "12px 14px 12px 48px",
                          borderRadius: "10px", border: "2px solid #e2e8f0",
                          fontSize: "1.25rem", fontWeight: 700,
                          background: "#f8fafc", outline: "none",
                        }}
                        onFocus={e => e.target.style.borderColor = "#7c3aed"}
                        onBlur={e => e.target.style.borderColor = "#e2e8f0"}
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* Botón agregar tramo */}
          <button
            type="button"
            onClick={addTramo}
            style={{
              width: "100%", marginTop: "16px", padding: "10px",
              borderRadius: "10px", border: "2px dashed #e2e8f0",
              background: "#f8fafc", color: "#7c3aed",
              fontSize: "0.84rem", fontWeight: 700,
              cursor: "pointer", transition: "all 0.12s ease",
            }}
            onMouseEnter={e => { e.target.style.borderColor = "#7c3aed"; e.target.style.background = "#faf5ff"; }}
            onMouseLeave={e => { e.target.style.borderColor = "#e2e8f0"; e.target.style.background = "#f8fafc"; }}
          >
            ➕ Agregar otro método de pago
          </button>

          <div style={{ height: "16px" }} />
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px 18px", borderTop: "1px solid #f1f5f9", flexShrink: 0 }}>

          {/* Preview de tramos */}
          {tramos.some(t => t.metodo) && (
            <div style={{
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", padding: "9px 13px", marginBottom: "12px",
            }}>
              {tramos.map((t, i) => {
                const preview = resumenPago({
                  metodo:    t.metodo,
                  moneda:    NEED_MONEDA.has(t.metodo) ? t.moneda : null,
                  banco:     NEED_BANCO.has(t.metodo)  ? t.banco  : null,
                  ticket:    NEED_TICKET.has(t.metodo) && t.ticket ? t.ticket : null,
                  chequeNro: t.metodo === "CHEQUE" && t.chequeNro ? t.chequeNro : null,
                  total:     parsedTotal(t.total) || null,
                });
                if (!preview) return null;
                return (
                  <div key={i} style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 500, marginBottom: i < tramos.length - 1 ? "4px" : 0 }}>
                    {tramos.length > 1 && <span style={{ color: "#7c3aed", fontWeight: 700 }}>T{i + 1} · </span>}
                    📋 {preview}
                  </div>
                );
              })}
              {tramos.length > 1 && totalGeneral > 0 && (
                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0f172a", marginTop: "6px", borderTop: "1px solid #e2e8f0", paddingTop: "6px" }}>
                  Total: $ {totalGeneral.toLocaleString("es-AR")}
                </div>
              )}
            </div>
          )}

          {error && (
            <p style={{
              margin: "0 0 10px", padding: "8px 12px",
              background: "#fef2f2", border: "1px solid #fecaca",
              borderRadius: "8px", fontSize: "0.82rem", color: "#dc2626", fontWeight: 600,
            }}>
              ⚠ {error}
            </p>
          )}

          {/* Botón "Pago en R8" — solo para ISABELA en flujo mandatory */}
          {mandatory && esIsabela && esNuevo && (
            <button
              type="button"
              onClick={handlePagoEnR8}
              disabled={saving}
              style={{
                width: "100%", padding: "10px", marginBottom: "8px",
                borderRadius: "10px", border: "1.5px solid #e2e8f0",
                background: "#fff", color: "#64748b",
                fontSize: "0.84rem", fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              💼 Pago gestionado en R8 — completar después
            </button>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            {!mandatory && (
              <button
                type="button" onClick={onClose} disabled={saving}
                style={{
                  flex: 1, padding: "11px", borderRadius: "10px",
                  border: "1.5px solid #e2e8f0", background: "#fff",
                  color: "#64748b", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={handleGuardar}
              disabled={saving || tramos.every(t => !t.metodo)}
              style={{
                flex: mandatory ? 1 : 2, padding: "11px",
                borderRadius: "10px", border: "none",
                background: saving || tramos.every(t => !t.metodo) ? "#e2e8f0" : "#0f172a",
                color: saving || tramos.every(t => !t.metodo) ? "#94a3b8" : "#fff",
                fontSize: "0.88rem", fontWeight: 700,
                cursor: saving || tramos.every(t => !t.metodo) ? "not-allowed" : "pointer",
                transition: "all 0.12s ease",
              }}
            >
              {saving ? "Guardando…" : esNuevo ? "✓ Guardar pago" : "✓ Guardar cambios"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
