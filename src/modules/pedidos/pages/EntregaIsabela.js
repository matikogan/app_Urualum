import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getDoc, doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";

/**
 * Control previo a la entrega — ISABELA
 *
 * Busca el pedido en dos colecciones:
 *  1. pedidos_despachados/{id}  → flujo normal (necesitaControl: true)
 *  2. pedidos/{id}              → fallback (estado: "DESPACHADO" en colección principal)
 *
 * Al confirmar la entrega:
 *  - Escribe el pedido completo en pedidos_entregados (registro permanente)
 *  - Elimina el doc de la colección de origen (pedidos_despachados o pedidos)
 */
export default function EntregaIsabela() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast, haptics } = useApp();

  const [pedido, setPedido]     = useState(null);
  const [source, setSource]     = useState(null); // "despachados" | "pedidos"
  const [loading, setLoading]   = useState(true);
  const [checks, setChecks]     = useState({});
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // 1. Buscar en pedidos_despachados
        const snapDesp = await getDoc(doc(db, "pedidos_despachados", String(id)));
        if (!cancelled && snapDesp.exists()) {
          setPedido({ id: snapDesp.id, ...snapDesp.data() });
          setSource("despachados");
          return;
        }
        // 2. Fallback: buscar en pedidos
        const snapPed = await getDoc(doc(db, "pedidos", String(id)));
        if (!cancelled && snapPed.exists()) {
          setPedido({ id: snapPed.id, ...snapPed.data() });
          setSource("pedidos");
          return;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  const productos = pedido?.items || pedido?.productos || [];
  const allChecked = productos.length > 0 && productos.every((_, i) => checks[i]);

  function toggleCheck(i) {
    setChecks(prev => ({ ...prev, [i]: !prev[i] }));
  }

  function marcarTodo() {
    const next = {};
    productos.forEach((_, i) => { next[i] = true; });
    setChecks(next);
  }

  async function handleEntregar() {
    try {
      setSaving(true);
      const sourceCollection = source === "despachados" ? "pedidos_despachados" : "pedidos";
      const sourceRef = doc(db, sourceCollection, String(id));

      // Grab latest snapshot to ensure we have full data
      const snap = await getDoc(sourceRef);
      if (!snap.exists()) {
        toast.error("No se encontró el pedido en la base de datos");
        return;
      }
      const data = snap.data();

      // Write permanent record
      await setDoc(doc(db, "pedidos_entregados", String(id)), {
        ...data,
        estado: "ENTREGADO",
        entregadoAt: serverTimestamp(),
        entregadoPor: user?.uid || null,
        source: "app-entrega",
      });

      // Remove from source collection
      await deleteDoc(sourceRef);

      haptics?.success?.();
      toast.success("Pedido entregado ✓");
      navigate("/pedidos");
    } catch (e) {
      console.error(e);
      haptics?.error?.();
      toast.error(e?.message || "No se pudo registrar la entrega");
    } finally {
      setSaving(false);
    }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Cargando pedido…</p>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div style={{ background: "#f8fafc", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
        <p style={{ color: "#dc2626", fontSize: "0.95rem", margin: 0 }}>No se encontró el pedido.</p>
        <button onClick={() => navigate("/pedidos")} style={{ border: "none", background: "none", color: "#2563eb", fontSize: "0.9rem", cursor: "pointer", textDecoration: "underline" }}>
          Volver a pedidos
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", paddingBottom: "100px" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px 14px" }}>
        <button
          onClick={() => navigate("/pedidos")}
          style={{ background: "none", border: "none", color: "#64748b", fontSize: "0.85rem", cursor: "pointer", padding: 0, marginBottom: "10px", display: "flex", alignItems: "center", gap: "4px" }}
        >
          ← Volver
        </button>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", letterSpacing: "0.07em", textTransform: "uppercase" }}>
              Control de entrega · #{pedido.numero || id}
            </p>
            <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>
              {pedido.cliente || "—"}
            </h1>
          </div>
          <span style={{ flexShrink: 0, background: "#fef3c7", color: "#92400e", fontSize: "0.68rem", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", letterSpacing: "0.05em", marginTop: "4px" }}>
            PENDIENTE DE ENTREGA
          </span>
        </div>
        {(pedido.metodoEntrega || pedido.finFecha) && (
          <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {pedido.finFecha && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                📅 {pedido.finFecha}
              </span>
            )}
            {pedido.metodoEntrega && (
              <span style={{ fontSize: "0.75rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "2px 8px" }}>
                🚚 {pedido.metodoEntrega}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Instrucción ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: "12px", padding: "12px 14px" }}>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e", lineHeight: 1.5 }}>
            ⚠️ <strong>Controlá cada ítem antes de entregar.</strong> Tildá los productos verificados y confirmá la entrega.
          </p>
        </div>
      </div>

      {/* ── Lista de productos ── */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 700, color: "#64748b", letterSpacing: "0.07em", textTransform: "uppercase" }}>
            Productos · {productos.length} ítem{productos.length !== 1 ? "s" : ""}
          </p>
          {!allChecked && productos.length > 0 && (
            <button
              onClick={marcarTodo}
              style={{ background: "none", border: "none", color: "#2563eb", fontSize: "0.8rem", cursor: "pointer", fontWeight: 600, padding: 0 }}
            >
              Marcar todos
            </button>
          )}
        </div>

        {productos.length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: "0.9rem", textAlign: "center", padding: "24px 0" }}>Sin productos registrados.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {productos.map((it, i) => {
              const nombre = it.descripcion || it.desc || it.nombre || it.cod || it.codigo || "—";
              const qty    = it.cant ?? it.cantidad ?? it.qty ?? 0;
              const checked = !!checks[i];
              return (
                <button
                  key={i}
                  onClick={() => toggleCheck(i)}
                  style={{
                    width: "100%", textAlign: "left", cursor: "pointer",
                    background: checked ? "#f0fdf4" : "#fff",
                    border: `1.5px solid ${checked ? "#86efac" : "#e2e8f0"}`,
                    borderRadius: "12px", padding: "12px 14px",
                    display: "flex", alignItems: "center", gap: "12px",
                    transition: "all 0.15s",
                  }}
                >
                  {/* Checkbox visual */}
                  <div style={{
                    flexShrink: 0, width: "22px", height: "22px", borderRadius: "6px",
                    border: `2px solid ${checked ? "#16a34a" : "#cbd5e1"}`,
                    background: checked ? "#16a34a" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {checked && <span style={{ color: "#fff", fontSize: "13px", lineHeight: 1 }}>✓</span>}
                  </div>

                  {/* Nombre + qty */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      margin: 0, fontSize: "0.9rem", fontWeight: 600,
                      color: checked ? "#15803d" : "#1e293b",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {nombre}
                    </p>
                    {it.color && (
                      <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>{it.color}</p>
                    )}
                  </div>

                  {/* Cantidad */}
                  <span style={{
                    flexShrink: 0,
                    background: checked ? "#dcfce7" : "#f1f5f9",
                    color: checked ? "#15803d" : "#475569",
                    fontWeight: 700, fontSize: "0.82rem",
                    padding: "3px 10px", borderRadius: "8px",
                  }}>
                    ×{qty}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Botón fijo ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        padding: "12px 16px 20px",
        background: "#fff", borderTop: "1px solid #e2e8f0",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.06)",
      }}>
        {!allChecked && productos.length > 0 && (
          <p style={{ margin: "0 0 8px", fontSize: "0.78rem", color: "#b45309", textAlign: "center" }}>
            ⚠️ Verificá todos los productos antes de confirmar
          </p>
        )}
        <button
          onClick={handleEntregar}
          disabled={saving || (!allChecked && productos.length > 0)}
          style={{
            width: "100%", padding: "16px", borderRadius: "14px", border: "none",
            fontWeight: 700, fontSize: "1.05rem",
            background: (saving || (!allChecked && productos.length > 0)) ? "#e2e8f0" : "#0f172a",
            color: (saving || (!allChecked && productos.length > 0)) ? "#94a3b8" : "#fff",
            cursor: (saving || (!allChecked && productos.length > 0)) ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Registrando…" : "✅ Confirmar Control"}
        </button>
      </div>
    </div>
  );
}
