/**
 * AsignarDepositoModal
 *
 * Modal reutilizable para:
 *   · Clasificar pedidos sin depósito (PedidosSinDeposito)
 *   · Reasignar depósito/método en pedidos ya existentes (PipelineVentas)
 *
 * Props:
 *   pedido       — objeto pedido (id, numero, cliente, deposito, metodoEntrega, agencia)
 *   onClose()    — cierra sin guardar
 *   onSaved()    — se llamó después de guardar en Firestore exitosamente
 *   titulo       — string opcional (default "Clasificar pedido")
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { AGENCIAS, METODOS } from "../services/parseDescripcionPedido";

const DEPOSITOS = ["R8", "ISABELA"];

export default function AsignarDepositoModal({ pedido, onClose, onSaved, titulo }) {
  const { user } = useAuth();
  const { toast } = useApp();

  const [deposito,      setDeposito]      = useState(pedido?.deposito      || "");
  const [metodoEntrega, setMetodoEntrega] = useState(pedido?.metodoEntrega || "");
  const [agencia,       setAgencia]       = useState(pedido?.agencia       || "");
  const [saving,        setSaving]        = useState(false);

  const esAgencia = metodoEntrega === "AGENCIA";

  // Validación mínima
  const canSave = deposito && metodoEntrega && (!esAgencia || agencia);

  async function handleSave() {
    if (!canSave || saving) return;
    try {
      setSaving(true);
      const fields = {
        deposito,
        metodoEntrega,
        agencia:       esAgencia ? agencia : null,
        updatedAt:     serverTimestamp(),
        reasignadoPor: user?.uid  || null,
        reasignadoAt:  serverTimestamp(),
      };
      await updateDoc(doc(db, "pedidos", String(pedido.id)), fields);
      toast.success(`Pedido #${pedido.numero || pedido.id} → ${deposito} · ${metodoEntrega}${esAgencia ? ` (${agencia})` : ""}`);
      onSaved?.();
    } catch (e) {
      console.error("[AsignarDepositoModal] Error:", e);
      toast.error(e?.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  // ─── Estilos ────────────────────────────────────────────────────────────────

  const chip = (active, color = "#2563eb") => ({
    padding: "8px 14px",
    borderRadius: "8px",
    border: active ? `2px solid ${color}` : "1.5px solid #e2e8f0",
    background: active ? color + "15" : "#fff",
    color: active ? color : "#475569",
    fontWeight: active ? 700 : 500,
    fontSize: "0.88rem",
    cursor: "pointer",
    transition: "all 0.12s",
  });

  const metodoColors = {
    AGENCIA: "#1d4ed8",
    RETIRA:  "#15803d",
    CAMION:  "#92400e",
    GIRA:    "#7e22ce",
  };

  // ─── Modal ──────────────────────────────────────────────────────────────────

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "18px 20px 16px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: "0.68rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              {titulo || "Clasificar pedido"}
            </p>
            <p style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0f172a" }}>
              #{pedido?.numero || pedido?.id}
            </p>
            {pedido?.cliente && (
              <p style={{ margin: "2px 0 0", fontSize: "0.85rem", color: "#475569" }}>
                {pedido.cliente}
              </p>
            )}
            {pedido?.descripcion && (
              <p style={{
                margin: "6px 0 0",
                fontSize: "0.72rem", color: "#94a3b8",
                background: "#f8fafc", borderRadius: "6px",
                padding: "5px 8px", fontStyle: "italic",
                maxWidth: "360px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                "{pedido.descripcion}"
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8", lineHeight: 1, padding: "0 0 0 8px" }}
          >×</button>
        </div>

        {/* Body scrolleable */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px" }}>

          {/* ── Depósito ── */}
          <section style={{ marginBottom: "22px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              🏭 Depósito de destino
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              {DEPOSITOS.map(dep => (
                <button
                  key={dep}
                  onClick={() => setDeposito(dep)}
                  style={{
                    ...chip(deposito === dep, "#0f172a"),
                    flex: 1,
                    textAlign: "center",
                  }}
                >
                  {dep === "ISABELA" ? "🏙️ ISABELA" : "🏭 R8"}
                </button>
              ))}
            </div>
          </section>

          {/* ── Método de entrega ── */}
          <section style={{ marginBottom: esAgencia ? "22px" : 0 }}>
            <p style={{ margin: "0 0 10px", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              🚚 Método de entrega
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {METODOS.map(m => (
                <button
                  key={m}
                  onClick={() => { setMetodoEntrega(m); if (m !== "AGENCIA") setAgencia(""); }}
                  style={chip(metodoEntrega === m, metodoColors[m] || "#475569")}
                >
                  {m === "AGENCIA" ? "🚌 Agencia" :
                   m === "RETIRA"  ? "🏪 Retira"  :
                   m === "CAMION"  ? "🚛 Camión"  :
                   m === "GIRA"    ? "🗺️ Gira"    : m}
                </button>
              ))}
            </div>
          </section>

          {/* ── Selector de agencia ── */}
          {esAgencia && (
            <section style={{ marginTop: "20px" }}>
              <p style={{ margin: "0 0 10px", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                🚌 Agencia de envío
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                {AGENCIAS.map(ag => (
                  <button
                    key={ag.nombre}
                    onClick={() => setAgencia(ag.nombre)}
                    style={{
                      ...chip(agencia === ag.nombre, "#1d4ed8"),
                      padding: "8px 10px",
                      textAlign: "left",
                      fontSize: "0.82rem",
                    }}
                  >
                    <span style={{ fontSize: "0.62rem", color: "#94a3b8", display: "block", marginBottom: "1px" }}>
                      {ag.orden}.
                    </span>
                    {ag.nombre}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid #f1f5f9",
          display: "flex", gap: "10px",
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "11px",
              border: "1.5px solid #e2e8f0",
              borderRadius: "8px",
              background: "#fff", color: "#64748b",
              fontSize: "0.88rem", fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              flex: 2, padding: "11px",
              border: "none",
              borderRadius: "8px",
              background: (!canSave || saving) ? "#e2e8f0" : "#0f172a",
              color: (!canSave || saving) ? "#94a3b8" : "#fff",
              fontSize: "0.88rem", fontWeight: 700,
              cursor: (!canSave || saving) ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }}
          >
            {saving ? (
              <>
                <span style={{ width: "13px", height: "13px", borderRadius: "50%", border: "2px solid #94a3b8", borderTopColor: "#fff", display: "inline-block" }} />
                Guardando…
              </>
            ) : (
              canSave
                ? `✓ Asignar → ${deposito} · ${metodoEntrega}${esAgencia && agencia ? ` · ${agencia}` : ""}`
                : "Seleccionar depósito y método"
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
