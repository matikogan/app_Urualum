import { useEffect, useMemo, useRef, useState } from "react";
import { listenPedidosAsignadosOperario, listenPedidosDespachadosOperario } from "../services/pedidosFS";
import { agruparPorEstadoYFecha, ordenarEstados } from "../services/agrupaciones";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { Link } from "react-router-dom";
import useNotificationSound from "hooks/useNotificationSound";

// Estados visibles para operario (de la colección "pedidos")
const ESTADOS_VISIBLES = new Set(["ASIGNADO", "EN_PREPARACION", "CON_ERROR"]);

// Pseudo-estado para pedidos despachados (colección "pedidos_despachados")
// pendientes de control/entrega por este operario
const ESTADO_DESPACHADO = "DESP_PENDIENTE";

function formatTimeAgo(ts) {
  if (!ts) return null;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}

function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  return null;
}

function formatFechaCorta(p) {
  const d = getPedidoDate(p);
  if (!d || isNaN(d)) return null;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

const ESTADO_CONFIG = {
  ASIGNADO:        { label: "Para iniciar",       icon: "🕐", color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
  EN_PREPARACION:  { label: "En preparación",     icon: "⚙️", color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
  CON_ERROR:       { label: "Con error",          icon: "🔴", color: "#dc2626", bg: "#fef2f2", border: "#fca5a5" },
  [ESTADO_DESPACHADO]: { label: "Despachado · controlar", icon: "🚚", color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
};

const METODO_COLORS = {
  AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
  RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
  CAMION:  { bg: "#fef3c7", color: "#92400e" },
  GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
};

export default function PedidosAsignadosOperario() {
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const [pedidosActivos, setPedidosActivos] = useState([]);
  const [pedidosDespacho, setPedidosDespacho] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDespacho, setLoadingDespacho] = useState(true);
  const [badges, setBadges] = useState({});
  const prevAllIdsRef = useRef(new Set());
  const firstSnapRef = useRef(true);
  const prevDespIdsRef = useRef(new Set());
  const firstDespSnapRef = useRef(true);

  const { soundOn, playNotif } = useNotificationSound("/sfx/new-order.mp3");

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    const unsub = listenPedidosAsignadosOperario(user.uid, {
      onChange: (snap) => {
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const filtrados = arr.filter(p => ESTADOS_VISIBLES.has(String(p.estado || "").toUpperCase()));
        // EN_PREPARACION primero, luego ASIGNADO, luego CON_ERROR
        filtrados.sort((a, b) => {
          const order = { EN_PREPARACION: 0, ASIGNADO: 1, CON_ERROR: 2 };
          return (order[a.estado] ?? 9) - (order[b.estado] ?? 9);
        });
        setPedidosActivos(filtrados);
        setLoading(false);

        const currentIds = new Set(filtrados.map(p => p.id));
        const newOnes = [];
        if (!firstSnapRef.current) {
          for (const p of filtrados) {
            if (!prevAllIdsRef.current.has(p.id)) newOnes.push(p);
          }
        } else {
          firstSnapRef.current = false;
        }
        prevAllIdsRef.current = currentIds;
        if (newOnes.length > 0) {
          setBadges(prev => {
            const next = { ...prev };
            for (const p of newOnes) {
              const est = String(p.estado || "").toUpperCase();
              next[est] = (next[est] || 0) + 1;
            }
            return next;
          });
          if (soundOn) playNotif();
        }
      },
      onError: (e) => {
        console.error(e);
        toast.error(e?.code === "permission-denied"
          ? "Sin permisos para ver estos pedidos."
          : "No se pudieron cargar tus pedidos.");
        setLoading(false);
      }
    });
    return () => unsub();
  }, [user?.uid, toast]);

  // Pedidos despachados (pendientes de control/entrega) asignados a este operario
  useEffect(() => {
    if (!user?.uid) return;
    setLoadingDespacho(true);
    const unsub = listenPedidosDespachadosOperario(user.uid, {
      onChange: (snap) => {
        const arr = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => p.necesitaControl !== false)
          .map(p => ({ ...p, estado: ESTADO_DESPACHADO, _isDespacho: true }));
        setPedidosDespacho(arr);
        setLoadingDespacho(false);

        const currentIds = new Set(arr.map(p => p.id));
        const newOnes = [];
        if (!firstDespSnapRef.current) {
          for (const p of arr) {
            if (!prevDespIdsRef.current.has(p.id)) newOnes.push(p);
          }
        } else {
          firstDespSnapRef.current = false;
        }
        prevDespIdsRef.current = currentIds;
        if (newOnes.length > 0) {
          setBadges(prev => ({ ...prev, [ESTADO_DESPACHADO]: (prev[ESTADO_DESPACHADO] || 0) + newOnes.length }));
          if (soundOn) playNotif();
        }
      },
      onError: (e) => {
        console.error(e);
        setLoadingDespacho(false);
      }
    });
    return () => unsub();
  }, [user?.uid, soundOn, playNotif]);

  const pedidos = useMemo(() => [...pedidosActivos, ...pedidosDespacho], [pedidosActivos, pedidosDespacho]);

  const grupos = useMemo(() => agruparPorEstadoYFecha(pedidos), [pedidos]);
  const estadosOrdenados = useMemo(() => ordenarEstados(Object.keys(grupos)), [grupos]);

  const nombre = profile?.nombre || user?.displayName || "Operario";
  const enPreparacion = pedidos.filter(p => p.estado === "EN_PREPARACION");
  const asignados = pedidos.filter(p => p.estado === "ASIGNADO");
  const loadingTotal = loading || loadingDespacho;

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 16px 14px" }}>
        <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Hola, {nombre.split(" ")[0]}
        </p>
        <h1 style={{ margin: "3px 0 0", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a" }}>
          Mis pedidos
        </h1>

        {/* Resumen numérico */}
        {!loadingTotal && pedidos.length > 0 && (
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            {enPreparacion.length > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "8px 16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>{enPreparacion.length}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.65rem", fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Preparando
                </p>
              </div>
            )}
            {asignados.length > 0 && (
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "8px 16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#3b82f6", lineHeight: 1 }}>{asignados.length}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.65rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Para iniciar
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Contenido ── */}
      <div style={{ padding: "12px 12px 60px" }}>

        {loadingTotal && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: "0.9rem" }}>
            Cargando tus pedidos…
          </div>
        )}

        {!loadingTotal && pedidos.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 24px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px" }}>✅</div>
            <p style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a", margin: "0 0 6px" }}>
              Todo al día
            </p>
            <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: 0 }}>
              No tenés pedidos pendientes.
            </p>
          </div>
        )}

        {/* Grupos por estado (EN_PREPARACION primero) */}
        {!loadingTotal && estadosOrdenados.map((estado) => {
          const porFecha = grupos[estado];
          const cfg = ESTADO_CONFIG[estado] || { label: estado, icon: "📋", color: "#64748b", bg: "#f8fafc", border: "#e2e8f0" };
          const allItems = Object.values(porFecha).flat();
          const newCount = badges?.[estado] || 0;
          const isEnPrep = estado === "EN_PREPARACION";

          return (
            <div key={estado} style={{ marginBottom: "20px" }}>

              {/* Label de grupo */}
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "9px" }}>
                <span style={{ fontSize: "0.9rem" }}>{cfg.icon}</span>
                <span style={{ fontWeight: 700, fontSize: "0.8rem", color: cfg.color, flex: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {cfg.label}
                </span>
                {newCount > 0 && (
                  <span
                    onClick={() => setBadges(b => ({ ...b, [estado]: 0 }))}
                    style={{
                      background: "#ef4444", color: "#fff",
                      fontSize: "0.63rem", fontWeight: 700,
                      padding: "2px 7px", borderRadius: "999px", cursor: "pointer",
                    }}
                  >
                    +{newCount}
                  </span>
                )}
                <span style={{
                  background: cfg.color + "22", color: cfg.color,
                  fontSize: "0.75rem", fontWeight: 700,
                  padding: "2px 9px", borderRadius: "999px",
                }}>
                  {allItems.length}
                </span>
              </div>

              {/* Cards */}
              {allItems.map((p) => {
                const timeAgo = p._isDespacho
                  ? formatTimeAgo(p.despachadoAt || p.timestamps?.DESPACHADO)
                  : formatTimeAgo(p.timestamps?.[p.estado]);
                const fechaCorta = formatFechaCorta(p);
                const itemCount = Array.isArray(p.productos) ? p.productos.length : 0;
                const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };
                const href = p._isDespacho
                  ? `/encargado/entrega/${encodeURIComponent(p.id)}`
                  : `/pedidos-operario/${encodeURIComponent(p.id)}`;

                return (
                  <Link
                    key={p.id}
                    to={href}
                    style={{
                      display: "block",
                      textDecoration: "none",
                      background: "#fff",
                      borderRadius: "14px",
                      border: `1.5px solid ${cfg.border}`,
                      borderLeft: `4px solid ${cfg.color}`,
                      padding: "13px 14px",
                      marginBottom: "8px",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {/* Fila 1: número + método + badge estado */}
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.87rem", color: "#0f172a" }}>
                        #{p.numero || p.id}
                      </span>
                      {p.metodoEntrega && (
                        <span style={{
                          fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px",
                          borderRadius: "999px", letterSpacing: "0.05em", flexShrink: 0,
                          background: metodoStyle.bg, color: metodoStyle.color,
                        }}>
                          {p.metodoEntrega}
                        </span>
                      )}
                      {timeAgo && (
                        <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>
                          ⏱ {timeAgo}
                        </span>
                      )}
                    </div>

                    {/* Fila 2: cliente */}
                    <p style={{
                      margin: "0 0 7px",
                      fontSize: "1rem", fontWeight: 700, color: "#0f172a",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {p.cliente || "—"}
                    </p>

                    {/* Fila 3: ítems + fecha + CTA */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                        {itemCount} ítem{itemCount !== 1 ? "s" : ""}
                      </span>
                      {fechaCorta && (
                        <>
                          <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
                          <span style={{ fontSize: "0.78rem", color: "#64748b" }}>📅 {fechaCorta}</span>
                        </>
                      )}
                      <span style={{
                        marginLeft: "auto", flexShrink: 0,
                        fontSize: "0.8rem", fontWeight: 700, color: cfg.color,
                      }}>
                        {p._isDespacho ? "Controlar →" : (isEnPrep ? "Continuar →" : "Iniciar →")}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
