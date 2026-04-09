import { useState, useEffect } from "react";
import { getDoc, setDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { db } from "../../../firebase";
import { useNavigate } from "react-router-dom";
import { AGENCIAS } from "../services/parseDescripcionPedido";

export default function ConfirmarDespacho({ pedidoId, onDone }) {
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

      await setDoc(doc(db, "pedidos_despachados", String(pedidoId)), {
        ...data,
        estado: "DESPACHADO",
        ...(data.metodoEntrega === "AGENCIA" && agencia ? { agencia } : {}),
        // ISABELA: marcar para control físico antes de la entrega al cliente
        ...(data.deposito === "ISABELA" ? { necesitaControl: true } : {}),
        despachadoAt: serverTimestamp(),
        despachadoPor: user?.uid || null,
        movedAt: serverTimestamp(),
        source: "app-despacho",
      });

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
    return <button className="btn btn--primary" disabled style={{ width: "100%", opacity: 0.6 }}>Cargando…</button>;
  }

  const esAgencia = pedido?.metodoEntrega === "AGENCIA";
  const puedeDespachar = !esAgencia || agencia;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* ── Confirmación de agencia ── */}
      {esAgencia && (
        <div style={{
          background: "#f8fafc", border: "1.5px solid #e2e8f0",
          borderRadius: "10px", padding: "12px 14px",
        }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            🚌 Agencia de envío
          </div>

          {agencia ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{
                fontSize: "15px", fontWeight: 700, color: "#1d4ed8",
                background: "#eff6ff", border: "1.5px solid #bfdbfe",
                borderRadius: "8px", padding: "8px 16px",
              }}>
                {agencia}
              </span>
              <button
                onClick={() => setShowSelector(true)}
                style={{ fontSize: "12px", color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: "4px 8px" }}
              >
                Cambiar
              </button>
            </div>
          ) : (
            <div>
              <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#b45309" }}>
                ⚠️ No se detectó la agencia automáticamente. Seleccioná una para continuar.
              </p>
              <button onClick={() => setShowSelector(true)} className="btn btn--ghost" style={{ width: "100%" }}>
                Seleccionar agencia
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
          width: "100%", padding: "14px", fontSize: "15px", fontWeight: 700,
          borderRadius: "10px", border: "none",
          background: puedeDespachar ? "#0f172a" : "#cbd5e1",
          color: "#fff", cursor: puedeDespachar ? "pointer" : "not-allowed",
        }}
      >
        {loading ? "Despachando…" : esAgencia && agencia ? `Despachar vía ${agencia}` : "Despachar"}
      </button>

      {/* ── Modal selector de agencia (bottom-sheet) ── */}
      {showSelector && (
        <div
          onClick={() => setShowSelector(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "flex-end" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", width: "100%", borderRadius: "16px 16px 0 0",
              padding: "20px", maxHeight: "70vh", overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Seleccionar agencia</h3>
              <button onClick={() => setShowSelector(false)} style={{ background: "none", border: "none", fontSize: "22px", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {AGENCIAS.map(ag => (
                <button
                  key={ag.nombre}
                  onClick={() => { setAgencia(ag.nombre); setShowSelector(false); }}
                  style={{
                    padding: "12px 8px", fontSize: "13px",
                    fontWeight: agencia === ag.nombre ? 700 : 500,
                    border: "1.5px solid",
                    borderColor: agencia === ag.nombre ? "#2563eb" : "#e2e8f0",
                    borderRadius: "8px",
                    background: agencia === ag.nombre ? "#eff6ff" : "#fff",
                    color: agencia === ag.nombre ? "#1d4ed8" : "#334155",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>{ag.orden}.</span>
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
