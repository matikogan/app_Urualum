import { useState, useEffect } from "react";
import { getDoc, setDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { db } from "../../../firebase";
import { useNavigate } from "react-router-dom";
import { AGENCIAS } from "../services/parseDescripcionPedido";

// TODO: RUT del cliente — en standby hasta integración con Finnegans
// const [clienteRUT, setClienteRUT] = useState("");

export default function ConfirmarDespacho({ pedidoId, onDone, compact = false }) {
  const { toast, haptics } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [pedido, setPedido]             = useState(null);
  const [agencia, setAgencia]           = useState(null);
  const [showSelector, setShowSelector] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [loadingData, setLoadingData]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db, "pedidos", String(pedidoId)));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          setPedido(data);
          setAgencia(data.agencia || null);
          // RUT standby: setClienteRUT(data.clienteRUT || "");
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pedidoId]);

  async function onDespachar() {
    try {
      setLoading(true);
      const ref = doc(db, "pedidos", String(pedidoId));
      const snap = await getDoc(ref);
      if (!snap.exists()) { toast.error("El pedido no existe"); return; }
      const data = snap.data();

      // Si ya existe en pedidos_despachados (ej: sync re-creó el pedido en 'pedidos'
      // pero el despacho original sigue en pedidos_despachados), saltear el setDoc
      // para no pisar datos de control ya registrados y evitar el error de permisos.
      const despRef = doc(db, "pedidos_despachados", String(pedidoId));
      const despSnap = await getDoc(despRef);
      if (!despSnap.exists()) {
        await setDoc(despRef, {
          ...data,
          estado: "DESPACHADO",
          // clienteRUT standby — se agrega cuando se integre Finnegans
          ...(data.metodoEntrega === "AGENCIA" && agencia ? { agencia } : {}),
          necesitaControl: true, // ambos depósitos (ISABELA y R8) requieren control de entrega
          despachadoAt: serverTimestamp(),
          despachadoPor: user?.uid || null,
          movedAt: serverTimestamp(),
          source: "app-despacho",
        });
      }

      await deleteDoc(ref);
      haptics?.success?.();
      toast.success("Pedido marcado como DESPACHADO");
      if (onDone) onDone(); else navigate("/pedidos");
    } catch (e) {
      console.error(e);
      haptics?.error?.();
      toast.error(e?.message || "No se pudo despachar");
    } finally {
      setLoading(false);
    }
  }

  if (loadingData) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "16px 0" }}>
        <div style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2.5px solid #e2e8f0", borderTopColor: "#64748b", animation: "spin 0.7s linear infinite" }} />
        <span style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Cargando pedido…</span>
      </div>
    );
  }

  const esAgencia = pedido?.metodoEntrega === "AGENCIA";
  const puedeDespachar = !esAgencia || agencia;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── Resumen del pedido (oculto en modo compact) ── */}
      {!compact && <div style={{
        background: "#f8fafc", border: "1.5px solid #e2e8f0",
        borderRadius: "12px", padding: "16px 18px",
      }}>
        <p style={{ margin: "0 0 2px", fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Pedido listo para despachar
        </p>
        <p style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0f172a" }}>
          #{pedido?.numero || pedidoId}
        </p>
        {pedido?.cliente && (
          <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "#475569" }}>{pedido.cliente}</p>
        )}
        <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {pedido?.metodoEntrega && (
            <span style={{
              fontSize: "0.75rem", fontWeight: 600, padding: "3px 10px",
              borderRadius: "999px", background: "#eff6ff", color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}>
              🚚 {pedido.metodoEntrega}
            </span>
          )}
          {pedido?.deposito && (
            <span style={{
              fontSize: "0.75rem", fontWeight: 600, padding: "3px 10px",
              borderRadius: "999px", background: "#f0fdf4", color: "#15803d",
              border: "1px solid #bbf7d0",
            }}>
              🏭 {pedido.deposito}
            </span>
          )}
        </div>
      </div>}

      {/* ── Confirmación de agencia ── */}
      {esAgencia && (
        <div style={{
          background: agencia ? "#eff6ff" : "#fffbeb",
          border: `1.5px solid ${agencia ? "#bfdbfe" : "#fde68a"}`,
          borderRadius: "12px", padding: "14px 18px",
        }}>
          <p style={{ margin: "0 0 8px", fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            🚌 Agencia de envío
          </p>
          {agencia ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <span style={{ fontSize: "1rem", fontWeight: 700, color: "#1d4ed8" }}>{agencia}</span>
              <button
                onClick={() => setShowSelector(true)}
                style={{ fontSize: "0.8rem", color: "#64748b", background: "none", border: "1px solid #e2e8f0", borderRadius: "6px", cursor: "pointer", padding: "4px 10px" }}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div>
              <p style={{ margin: "0 0 10px", fontSize: "0.85rem", color: "#b45309" }}>
                ⚠️ No se detectó la agencia. Seleccioná una para continuar.
              </p>
              <button
                onClick={() => setShowSelector(true)}
                style={{
                  width: "100%", padding: "10px 16px", fontSize: "0.88rem", fontWeight: 600,
                  background: "#fff", border: "1.5px solid #fbbf24", borderRadius: "8px",
                  color: "#b45309", cursor: "pointer",
                }}
              >
                Seleccionar agencia →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Botón despachar ── */}
      <button
        onClick={onDespachar}
        disabled={loading || !puedeDespachar}
        style={{
          padding: "15px 32px",
          fontSize: "0.95rem", fontWeight: 700,
          borderRadius: "10px", border: "none",
          background: (loading || !puedeDespachar) ? "#e2e8f0" : "#0f172a",
          color: (loading || !puedeDespachar) ? "#94a3b8" : "#fff",
          cursor: (loading || !puedeDespachar) ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          alignSelf: compact ? "stretch" : "flex-end",
          width: compact ? "100%" : undefined,
          minWidth: compact ? undefined : "180px",
          boxShadow: (loading || !puedeDespachar) ? "none" : "0 2px 8px rgba(15,23,42,0.18)",
          transition: "all 0.15s ease",
        }}
      >
        {loading ? (
          <>
            <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid #94a3b8", borderTopColor: "#fff", display: "inline-block" }} />
            Despachando…
          </>
        ) : (
          <>
            🚚 {esAgencia && agencia ? `Despachar vía ${agencia}` : "Confirmar despacho"}
          </>
        )}
      </button>

      {/* ── Modal selector de agencia ── */}
      {showSelector && (
        <div
          onClick={() => setShowSelector(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "16px",
              padding: "24px", width: "100%", maxWidth: "480px",
              maxHeight: "70vh", overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>Seleccionar agencia</h3>
              <button onClick={() => setShowSelector(false)} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {AGENCIAS.map(ag => (
                <button
                  key={ag.nombre}
                  onClick={() => { setAgencia(ag.nombre); setShowSelector(false); }}
                  style={{
                    padding: "12px 10px", fontSize: "0.85rem",
                    fontWeight: agencia === ag.nombre ? 700 : 500,
                    border: "1.5px solid",
                    borderColor: agencia === ag.nombre ? "#2563eb" : "#e2e8f0",
                    borderRadius: "8px",
                    background: agencia === ag.nombre ? "#eff6ff" : "#fff",
                    color: agencia === ag.nombre ? "#1d4ed8" : "#334155",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "0.68rem", color: "#94a3b8", display: "block", marginBottom: "2px" }}>{ag.orden}.</span>
                  {ag.nombre}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
