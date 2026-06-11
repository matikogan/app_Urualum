/**
 * PedidosOperarioIsabela — pipeline del operario ISABELA (Cristian).
 *
 * Muestra todos los pedidos asignados al operario, en orden de flujo:
 *   ASIGNADO → EN_PREPARACION → CON_ERROR → CONTROLADO → DESP_PENDIENTE → DESP_ENTREGADO
 *
 * Solo escucha pedidos donde operarioId == user.uid, así Cristian solo ve los suyos.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import useNotificationSound from "hooks/useNotificationSound";

// ─── Config visual por estado (orden del flujo) ─────────────────────────────

const FLUJO = [
  {
    id: "ASIGNADO",
    label: "Para iniciar",
    icon: "👤",
    color: "#5b21b6",
    bg: "#f5f3ff",
    border: "#c4b5fd",
    cta: "Iniciar →",
    accion: true,   // requiere acción del operario
  },
  {
    id: "EN_PREPARACION",
    label: "En preparación",
    icon: "⚙️",
    color: "#0369a1",
    bg: "#f0f9ff",
    border: "#bae6fd",
    cta: "Continuar →",
    accion: true,
  },
  {
    id: "CON_ERROR",
    label: "Con error",
    icon: "🔴",
    color: "#b91c1c",
    bg: "#fff1f2",
    border: "#fca5a5",
    cta: "Ver detalle →",
    accion: true,
  },
  {
    id: "CONTROLADO",
    label: "Listo — esperando despacho",
    icon: "✅",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    cta: "Ver →",
    accion: false,  // solo lectura, ventas despacha
  },
  {
    id: "DESP_PENDIENTE",
    label: "Despachado — entregar",
    icon: "🚚",
    color: "#b45309",
    bg: "#fffbeb",
    border: "#fde68a",
    cta: "Registrar entrega →",
    accion: true,
  },
  {
    id: "DESP_ENTREGADO",
    label: "Entregado hoy",
    icon: "☑️",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    cta: null,
    accion: false,
  },
];

const ESTADOS_ACTIVOS  = new Set(["ASIGNADO", "EN_PREPARACION", "CON_ERROR", "CONTROLADO"]);
const METODO_COLORS = {
  AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
  RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
  CAMION:  { bg: "#fef3c7", color: "#92400e" },
  GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(ts) {
  if (!ts) return null;
  const date = ts?.seconds ? new Date(ts.seconds * 1000) : (ts instanceof Date ? ts : new Date(ts));
  if (isNaN(date.getTime())) return null;
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1)  return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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

// ─── Componente ──────────────────────────────────────────────────────────────

export default function PedidosOperarioIsabela() {
  const { user, profile } = useAuth();
  const { toast } = useApp();

  const [pedidos,     setPedidos]     = useState([]);  // estados activos en colección pedidos
  const [despachados, setDespachados] = useState([]);  // DESP_PENDIENTE
  const [entregados,  setEntregados]  = useState([]);  // DESP_ENTREGADO (solo hoy)
  const [loading,     setLoading]     = useState(true);
  const [badges,      setBadges]      = useState({});

  const prevIdsRef   = useRef(new Set());
  const firstSnapRef = useRef(true);
  const { play: playNotif } = useNotificationSound("/sfx/new-order.mp3", { volume: 0.5 });

  // ── Pedidos activos: ASIGNADO / EN_PREPARACION / CON_ERROR / CONTROLADO ────
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "pedidos"), where("operarioId", "==", user.uid));
    const unsub = onSnapshot(q,
      snap => {
        const arr = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          // Solo pedidos de ISABELA en estados activos del flujo operario
          .filter(p =>
            ESTADOS_ACTIVOS.has(p.estado) &&
            String(p.deposito || "").trim().toUpperCase() === "ISABELA"
          );

        setPedidos(arr);
        setLoading(false);

        // Badges y sonido para pedidos nuevos
        const currentIds = new Set(arr.map(p => p.id));
        if (!firstSnapRef.current) {
          const nuevos = arr.filter(p => !prevIdsRef.current.has(p.id));
          if (nuevos.length > 0) {
            setBadges(prev => {
              const next = { ...prev };
              for (const p of nuevos) next[p.estado] = (next[p.estado] || 0) + 1;
              return next;
            });
            playNotif();
          }
        } else {
          firstSnapRef.current = false;
        }
        prevIdsRef.current = currentIds;
      },
      err => {
        console.error("[PedidosOperarioIsabela] pedidos:", err);
        toast.error(err?.code === "permission-denied"
          ? "Sin permisos para ver tus pedidos."
          : "No se pudieron cargar tus pedidos.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [user?.uid, toast, playNotif]);

  // ── Despachados pendientes de entrega ────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "pedidos_despachados"), where("operarioId", "==", user.uid));
    const unsub = onSnapshot(q,
      snap => {
        setDespachados(
          snap.docs
            .map(d => ({ id: d.id, ...d.data(), _desp: true }))
            .filter(p =>
              // Solo ISABELA + con control pendiente (estricto: no acepta undefined de docs viejos)
              String(p.deposito || "").trim().toUpperCase() === "ISABELA" &&
              p.necesitaControl === true
            )
        );
      },
      err => console.error("[PedidosOperarioIsabela] despachados:", err)
    );
    return () => unsub();
  }, [user?.uid]);

  // ── Entregados HOY (filtro de fecha en cliente para evitar índice compuesto) ──
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "pedidos_entregados"), where("operarioId", "==", user.uid));
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const unsub = onSnapshot(q,
      snap => {
        const arr = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(p => {
            // Solo ISABELA + entregado hoy
            if (String(p.deposito || "").trim().toUpperCase() !== "ISABELA") return false;
            const ts = p.entregadoAt?.seconds
              ? new Date(p.entregadoAt.seconds * 1000)
              : (p.entregadoAt instanceof Date ? p.entregadoAt : null);
            return ts && ts >= hoy;
          });
        setEntregados(arr);
      },
      err => console.error("[PedidosOperarioIsabela] entregados:", err)
    );
    return () => unsub();
  }, [user?.uid]);

  // ── Mapa de items por estado ─────────────────────────────────────────────
  const byEstado = {
    ASIGNADO:       pedidos.filter(p => p.estado === "ASIGNADO"),
    EN_PREPARACION: pedidos.filter(p => p.estado === "EN_PREPARACION"),
    CON_ERROR:      pedidos.filter(p => p.estado === "CON_ERROR"),
    CONTROLADO:     pedidos.filter(p => p.estado === "CONTROLADO"),
    DESP_PENDIENTE: despachados,
    DESP_ENTREGADO: entregados,
  };

  const nombre = profile?.nombre || user?.displayName || "Operario";

  // Contadores para el resumen del header
  const totalPendientes = byEstado.ASIGNADO.length + byEstado.EN_PREPARACION.length + byEstado.CON_ERROR.length;
  const totalEntregar   = byEstado.DESP_PENDIENTE.length;
  const hayAlgo = Object.values(byEstado).some(a => a.length > 0);

  // ── Render ───────────────────────────────────────────────────────────────
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

        {/* Chips de resumen — solo los que importan */}
        {!loading && hayAlgo && (
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
            {totalPendientes > 0 && (
              <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "10px", padding: "8px 16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#0369a1", lineHeight: 1 }}>{totalPendientes}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.65rem", fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.04em" }}>En proceso</p>
              </div>
            )}
            {byEstado.CONTROLADO.length > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", padding: "8px 16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#15803d", lineHeight: 1 }}>{byEstado.CONTROLADO.length}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.65rem", fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.04em" }}>Listos</p>
              </div>
            )}
            {totalEntregar > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "8px 16px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#b45309", lineHeight: 1 }}>{totalEntregar}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.65rem", fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.04em" }}>Entregar</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Contenido ── */}
      <div style={{ padding: "12px 12px 60px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: "0.9rem" }}>
            Cargando tus pedidos…
          </div>
        )}

        {!loading && !hayAlgo && (
          <div style={{ textAlign: "center", padding: "60px 24px" }}>
            <div style={{ fontSize: "3rem", marginBottom: "12px" }}>✅</div>
            <p style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a", margin: "0 0 6px" }}>Todo al día</p>
            <p style={{ color: "#94a3b8", fontSize: "0.85rem", margin: 0 }}>No tenés pedidos pendientes.</p>
          </div>
        )}

        {!loading && FLUJO.map(cfg => {
          const items = byEstado[cfg.id] || [];
          if (items.length === 0) return null;
          const newCount = badges[cfg.id] || 0;

          return (
            <div key={cfg.id} style={{ marginBottom: "22px" }}>

              {/* Encabezado de sección */}
              <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "9px" }}>
                <span style={{ fontSize: "0.9rem" }}>{cfg.icon}</span>
                <span style={{ fontWeight: 700, fontSize: "0.8rem", color: cfg.color, flex: 1, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {cfg.label}
                </span>
                {newCount > 0 && (
                  <span
                    onClick={() => setBadges(b => ({ ...b, [cfg.id]: 0 }))}
                    style={{ background: "#ef4444", color: "#fff", fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", cursor: "pointer" }}
                  >
                    +{newCount}
                  </span>
                )}
                <span style={{ background: cfg.color + "22", color: cfg.color, fontSize: "0.75rem", fontWeight: 700, padding: "2px 9px", borderRadius: "999px" }}>
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              {items.map(p => {
                const timeAgo     = formatTimeAgo(p.timestamps?.[p.estado] || p.despachadoAt || p.entregadoAt || p.updatedAt);
                const fechaCorta  = formatFechaCorta(p);
                const itemCount   = Array.isArray(p.productos) ? p.productos.length : (Array.isArray(p.items) ? p.items.length : 0);
                const metodoStyle = METODO_COLORS[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };

                // Destino del link según estado
                const href = cfg.id === "DESP_PENDIENTE"
                  ? `/encargado/entrega/${encodeURIComponent(p.id)}`
                  : cfg.id === "DESP_ENTREGADO"
                    ? null   // solo informativo
                    : `/pedidos-operario/${encodeURIComponent(p.id)}`;

                const cardStyle = {
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
                  // Cards sin acción: opacidad levemente reducida para distinguirlas
                  opacity: cfg.accion ? 1 : 0.85,
                };

                const inner = (
                  <>
                    {/* Fila 1: número + método + tiempo */}
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.87rem", color: "#0f172a" }}>
                        #{p.numero || p.id}
                      </span>
                      {p.metodoEntrega && (
                        <span style={{ fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px", borderRadius: "999px", letterSpacing: "0.05em", flexShrink: 0, background: metodoStyle.bg, color: metodoStyle.color }}>
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
                    <p style={{ margin: "0 0 7px", fontSize: "1rem", fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
                      {cfg.cta && (
                        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: "0.8rem", fontWeight: 700, color: cfg.color }}>
                          {cfg.cta}
                        </span>
                      )}
                    </div>
                  </>
                );

                // DESP_ENTREGADO: solo div (no navegable)
                if (!href) {
                  return (
                    <div key={p.id} style={cardStyle}>
                      {inner}
                    </div>
                  );
                }

                return (
                  <Link key={p.id} to={href} style={cardStyle}>
                    {inner}
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
