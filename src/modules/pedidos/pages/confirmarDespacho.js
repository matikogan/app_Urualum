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

  const [pedido, setPedido]       = useState(null);
  const [agencia, setAgencia]     = useState(null);  // agencia elegida por el vendedor
  const [loading, setLoading]     = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  // Cargar datos del pedido para saber si es AGENCIA
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db, "pedidos", String(pedidoId)));
        if (!cancelled && snap.exists()) {
          const data = snap.data();
          setPedido(data);
          // Pre-rellenar con la agencia detectada automáticamente
          if (data.agencia) setAgencia(data.agencia);
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

      // 1) Guardar en colección de históricos
      await setDoc(doc(db, "pedidos_despachados", String(pedidoId)), {
        ...data,
        estado: "DESPACHADO",
        // Si es agencia, confirmar cuál (puede diferir del auto-detectado)
        ...(data.metodoEntrega === "AGENCIA" && agencia ? { agencia } : {}),
        despachadoAt: serverTimestamp(),
        despachadoPor: user?.uid || null,
        movedAt: serverTimestamp(),
        source: "app-despacho",
      });

      // 2) Borrar de la colección activa
      await deleteDoc(ref);

      haptics?.success?.();
      toast.success("Pedido marcado como DESPACHADO");

      if (onDone) onDone();
      else navigate("/pedidos");
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
      <button className="btn btn--primary" disabled style={{ width: "100%", opacity: 0.6 }}>
        Cargando…
      </button>
    );
  }

  const esAgencia = pedido?.metodoEntrega === "AGENCIA";
  const puedeDespachar = !esAgencia || agencia;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

      {/* Selector de agencia — solo para pedidos de tipo AGENCIA */}
      {esAgencia && (
        <div style={{
          background: "#f8fafc",
          border: "1.5px solid #e2e8f0",
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <div style={{
            fontSize: "11px", fontWeight: 700, color: "#64748b",
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px",
          }}>
            🚌 Confirmar agencia de envío
          </div>

          {/* Grilla de agencias */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "6px",
          }}>
            {AGENCIAS.map(ag => (
              <button
                key={ag.nombre}
                onClick={() => setAgencia(ag.nombre)}
                style={{
                  padding: "7px 4px",
                  fontSize: "11px",
                  fontWeight: agencia === ag.nombre ? 700 : 500,
                  border: "1.5px solid",
                  borderColor: agencia === ag.nombre ? "#2563eb" : "#e2e8f0",
                  borderRadius: "7px",
                  background: agencia === ag.nombre ? "#eff6ff" : "#fff",
                  color: agencia === ag.nombre ? "#1d4ed8" : "#475569",
                  cursor: "pointer",
                  transition: "all 0.12s",
                  lineHeight: 1.2,
                }}
              >
                {ag.nombre}
              </button>
            ))}
          </div>

          {agencia && (
            <p style={{
              margin: "10px 0 0",
              fontSize: "12px",
              fontWeight: 600,
              color: "#166534",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "6px",
              padding: "6px 10px",
            }}>
              ✓ Agencia seleccionada: <strong>{agencia}</strong>
            </p>
          )}

          {!agencia && (
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#b45309" }}>
              ⚠️ Seleccioná la agencia para poder despachar.
            </p>
          )}
        </div>
      )}

      {/* Botón despachar */}
      <button
        onClick={onDespachar}
        disabled={loading || !puedeDespachar}
        style={{
          width: "100%",
          padding: "14px",
          fontSize: "15px",
          fontWeight: 700,
          borderRadius: "10px",
          border: "none",
          background: puedeDespachar ? "#0f172a" : "#cbd5e1",
          color: "#fff",
          cursor: puedeDespachar ? "pointer" : "not-allowed",
          transition: "background 0.15s",
        }}
      >
        {loading
          ? "Despachando…"
          : esAgencia && agencia
            ? `Despachar vía ${agencia}`
            : "Despachar"}
      </button>
    </div>
  );
}
