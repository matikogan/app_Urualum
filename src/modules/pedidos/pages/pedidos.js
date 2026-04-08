
import { useEffect, useMemo, useRef, useState } from "react";
import { listenPedidosByDeposito } from "../services/pedidosFS";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { syncPendientesDeHoy } from "../services/syncFinnegans";

import SearchBar from "../components/SearchBar";
import { norm } from "utils/text"
import Badge from "../components/Badge";
import useNotificationSound from "hooks/useNotificationSound"; // ajustá la ruta

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../firebase";




/* ---------------- helper tiempo en estado ---------------- */
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
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

/* ---------------- helpers de fecha (Finnegans) ---------------- */

function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  if (p?.timestamps?.creado?.seconds) return new Date(p.timestamps.creado.seconds * 1000);
  if (p?.updatedAt?.seconds) return new Date(p.updatedAt.seconds * 1000);
  return null;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysDiff(a, b) {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / 86400000);
}

const BUCKET_ORDER = ["HOY", "AYER", "ÚLTIMA SEMANA", "ÚLTIMO MES", "ANTERIORES"];

// Zonas operativas para la vista del encargado
const ESTADOS_ACCION    = ["PENDIENTE_ASIGNAR", "PREPARADO"];
const ESTADOS_EJECUCION = ["ASIGNADO", "EN_PREPARACION"];

// === adaptadores para el bloque de "enriquecidos" ===
const parseToDate = (v) => (v instanceof Date ? v : (v ? new Date(v) : null));

const bucketFecha = (dt) => {
  if (!dt) return "mes";
  const label = bucketLabelByDate(dt); // usa tu helper (HOY/AYER/ÚLTIMA SEMANA/ÚLTIMO MES/ANTERIORES)
  switch (label) {
    case "HOY":             return "hoy";
    case "AYER":            return "ayer";
    case "ÚLTIMA SEMANA":   return "semana";
    case "ÚLTIMO MES":      return "mes";
    default:                return "mes";     // "ANTERIORES" lo mapeamos a mes por simplicidad
  }
};


// Orden fijo de estados en la UI
const ESTADO_ORDER = [
  "PENDIENTE_ASIGNAR",
  "ASIGNADO",
  "EN_PREPARACION",
  "PREPARADO",
  "CONTROLADO",
  "DESPACHADO",
];


function bucketLabelByDate(d) {
  if (!d) return "ANTERIORES";
  const today = new Date();
  const diff = daysDiff(today, d);
  if (diff === 0) return "HOY";
  if (diff === 1) return "AYER";
  if (diff <= 7) return "ÚLTIMA SEMANA";
  if (diff <= 30) return "ÚLTIMO MES";
  return "ANTERIORES";
}

/** Agrupa: { [estado]: { [bucket]: Pedido[] } }  y ordena buckets y pedidos (desc por fecha) */
function agruparPorEstadoYBucketFecha(pedidos) {
  const out = {};
  for (const p of pedidos) {
    const estado = p?.estado || "PENDIENTE_ASIGNAR";
    const d = getPedidoDate(p);
    const bucket = bucketLabelByDate(d);
    if (!out[estado]) out[estado] = {};
    if (!out[estado][bucket]) out[estado][bucket] = [];
    out[estado][bucket].push(p);
  }
  for (const estado of Object.keys(out)) {
    for (const bucket of Object.keys(out[estado])) {
      out[estado][bucket].sort((a, b) => {
        const da = getPedidoDate(a)?.getTime() ?? 0;
        const db = getPedidoDate(b)?.getTime() ?? 0;
        return db - da;
      });
    }
    const ordered = {};
    for (const key of BUCKET_ORDER) if (out[estado][key]) ordered[key] = out[estado][key];
    for (const key of Object.keys(out[estado])) if (!(key in ordered)) ordered[key] = out[estado][key];
    out[estado] = ordered;
  }
  return out;
}

/* Persistencia simple en localStorage */
const LS_SEEN_KEY = (dep) => `pedidos:lastSeenByEstado:${dep || "-"}`;
function loadSeenMap(deposito) {
  try { return JSON.parse(localStorage.getItem(LS_SEEN_KEY(deposito)) || "{}"); }
  catch { return {}; }
}

function saveSeenMap(deposito, map) {
  try { localStorage.setItem(LS_SEEN_KEY(deposito), JSON.stringify(map || {})); } catch {}
}

// Helper robusto: resuelve el nombre del responsable si el pedido está asignado
function getResponsable(p) {
  return (
    p?.asignadoNombre ||
    p?.asignado?.nombre ||
    p?.asignado?.displayName ||
    p?.operarioNombre ||
    p?.responsableNombre ||
    p?.responsable?.nombre ||
    null
  );
}


/* ---------------- componente ---------------- */

export default function PedidosPage() {
  const { depositoActual, metodoFiltro, setMetodoFiltro, toast } = useApp();
  const { user, profile, loading: authLoading } = useAuth();

  const [pedidos, setPedidos] = useState([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);

  // NUEVO: despachos hoy desde pedidos_despachados
  const [despsHoy, setDespsHoy] = useState([]);


  // UI: secciones colapsables por bucket
  const [collapsedBuckets, setCollapsedBuckets] = useState(() => new Set());

  // Notificaciones por ESTADO (puntito rojo)
  const [stateHasNew, setStateHasNew] = useState({});
  const [despachosHasNew, setDespachosHasNew] = useState(false);



  // UI: secciones colapsables por estado
  const [collapsedStates, setCollapsedStates] = useState(() => new Set());

  const [q, setQ] = useState("");      // query de búsqueda
  const [debouncedQ, setDebouncedQ] = useState(""); // para debounce suave

  const isEncargado = (profile?.rol || "").toLowerCase() === "encargado";
  const isVentas = (profile?.rol || "").toLowerCase() === "ventas";


  const { play: playNotif, enabled: soundOn, setEnabled: setSoundOn, unlock } =
  useNotificationSound("/sfx/new-order.mp3", { volume: 0.5 });

  // 👇 ya usás useRef en el archivo, agregá estos dos:
  const prevAllIdsRef = useRef(new Set());     // IDs que ya vimos en el snapshot anterior
  const firstSnapRef   = useRef(true);         // para NO contar la carga inicial como "nuevo"
  const lastChangeWasNewRef = useRef(false);   // flag: este snapshot trajo "altas" nuevas





  const seenRef = useRef({}); // { [estado]: epoch ms }
  useEffect(() => {
    seenRef.current = loadSeenMap(depositoActual);
    setStateHasNew({}); // limpio al cambiar de depósito
  }, [depositoActual]);

  // sync automática solo para ENCARGADO (una vez)
  const syncRunRef = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    if (!user || !profile) return;
    const role = (profile?.rol || "").toLowerCase();
    if (role !== "encargado") return;
    if (syncRunRef.current) return;
    syncRunRef.current = true;

    (async () => {
      try { await syncPendientesDeHoy(); }
      catch (e) { console.error("[PedidosPage] sync auto error:", e); }
    })();
  }, [authLoading, user, profile]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(id);
  }, [q]);

  /* ---------- listener a pedidos_despachados (solo HOY) ---------- */
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = today;
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const col = collection(db, "pedidos_despachados");
    const qy = query(
      col,
      where("despachadoAt", ">=", start),
      where("despachadoAt", "<=", end)
    );

    const unsub = onSnapshot(qy, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data(), estado: "DESPACHADO" }))
        // Filtrar por depósito del usuario (en cliente para evitar índice compuesto)
        .filter((d) => !depositoActual || d.deposito === depositoActual);

      // Detectar si hay nuevos
      setDespsHoy((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        const newOnes = list.filter((p) => !prevIds.has(p.id));

        if (newOnes.length > 0) {
          setDespachosHasNew(true);
        }

        return list;
      });
    });

    return () => unsub();
  }, []);




  // listener a Firestore (por depósito y método)
  useEffect(() => {
    if (authLoading) return;
    if (!user || !profile) return;
    if (!depositoActual) return;

    setLoadingPedidos(true);
    const unsub = listenPedidosByDeposito(depositoActual, {
      metodoEntrega: metodoFiltro || undefined,
      onChange: (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.estado !== "ANULADO"); // excluir anulados de la vista operativa
               setPedidos(list);
              setLoadingPedidos(false);

              // === Detectar "ALTAS NUEVAS" por ID (no solo cambios de estado)
              const currentIds = new Set(list.map(p => p.id));
              const newOnes = [];

              if (!firstSnapRef.current) {
                // sólo contamos nuevas después del primer snapshot
                for (const p of list) {
                  if (!prevAllIdsRef.current.has(p.id)) newOnes.push(p);
                }
              } else {
                firstSnapRef.current = false; // la primera foto NO cuenta como nuevas
              }

              // guardar IDs actuales para la próxima comparación
              prevAllIdsRef.current = currentIds;

              // si entraron pedidos nuevos → sumar a badges y (opcional) sonar
              if (newOnes.length > 0) {
                lastChangeWasNewRef.current = true; // para que el efecto de deltas no duplique
                setBadges(s => {
                  const next = {
                    states: { ...(s.states || {}) },
                    buckets: { ...(s.buckets || {}) },
                  };
                  for (const p of newOnes) {
                    const est = String(p.estado || "PENDIENTE_ASIGNAR").toUpperCase();
                    next.states[est] = (next.states[est] || 0) + 1;

                    // (Opcional) badge por bucket (HOY/AYER/SEMANA/MES)
                    const fechaObj = parseToDate(getPedidoDate(p) || p.fecha || p.emision || p.createdAt);
                    const bKey = bucketFecha(fechaObj); // hoy|ayer|semana|mes
                    next.buckets[est] = next.buckets[est] || { hoy:0, ayer:0, semana:0, mes:0 };
                    if (next.buckets[est][bKey] != null) next.buckets[est][bKey] += 1;
                  }
                  return next;
                });
                if (soundOn) playNotif(); // 🔔 sonar por altas nuevas
              } else {
                lastChangeWasNewRef.current = false;
              }


        // ---- calcular “novedades” por estado respecto del último visto
        const nowByEstado = {};
        for (const p of list) {
          const est = p?.estado || "PENDIENTE_ASIGNAR";
          const upd =
            (p?.updatedAt?.seconds ? p.updatedAt.seconds * 1000 : 0) ||
            (p?.timestamps?.creado?.seconds ? p.timestamps.creado.seconds * 1000 : 0);
          if (!nowByEstado[est] || upd > nowByEstado[est]) nowByEstado[est] = upd;
        }
        const seenMap = seenRef.current || {};
        const flags = {};
        for (const est of Object.keys(nowByEstado)) {
          const lastSeen = Number(seenMap[est] || 0);
          flags[est] = nowByEstado[est] > lastSeen;
        }
        setStateHasNew(flags);
      },
      onError: (e) => {
        console.error("[PedidosPage] onError listenPedidosByDeposito:", e);
        toast.error(e?.code === "permission-denied"
          ? "Sin permisos para ver los pedidos de este depósito."
          : "No se pudieron cargar los pedidos. Verifica tu conexión.");
        setLoadingPedidos(false);
      },
    });
    return () => unsub();
  }, [authLoading, user, profile, depositoActual, metodoFiltro, toast]);

  const pedidosFiltrados = useMemo(() => {
    if (!debouncedQ) return pedidos;

    const nq = norm(debouncedQ);
    return pedidos.filter(p => {
      const numero = norm(p.numero || p.id || "");
      const cliente = norm(p.cliente || "");
      const desc = norm(p.descripcion || "");
      const metodo = norm(p.metodoEntrega || "");
      return (
        numero.includes(nq) ||
        cliente.includes(nq) ||
        desc.includes(nq) ||
        metodo.includes(nq)
      );
    });
  }, [pedidos, debouncedQ]);


  // Normalizamos: estado y fecha por pedido
  const pedidosEnriquecidos = useMemo(() => {
    return (pedidosFiltrados || []).map(p => {
      const estado   = String(p.estado || "PENDIENTE_ASIGNAR").toUpperCase();
      const fechaObj = parseToDate(getPedidoDate(p) || p.fecha || p.emision || p.createdAt);
      return { ...p, estado, fechaObj, _bucket: bucketFecha(fechaObj) };
    });
  }, [pedidosFiltrados]);

  // Totales por estado
  const totalsByState = useMemo(() => {
    const acc = {};
    for (const p of pedidosEnriquecidos) {
      acc[p.estado] = (acc[p.estado] || 0) + 1;
    }
    return acc;
  }, [pedidosEnriquecidos]);

  // Totales por estado -> bucket (hoy/ayer/semana/mes)
  const totalsByStateBucket = useMemo(() => {
    const acc = {}; // { ESTADO: {hoy:n, ayer:n, semana:n, mes:n} }
    for (const p of pedidosEnriquecidos) {
      const e = p.estado;
      const b = p._bucket;
      if (!acc[e]) acc[e] = { hoy:0, ayer:0, semana:0, mes:0 };
      if (acc[e][b] != null) acc[e][b] += 1;
    }
    return acc;
  }, [pedidosEnriquecidos]);


  // Mantiene el "anterior" para calcular incrementos
  const prevTotalsRef = useRef({ states: {}, buckets: {} });

  // Badges visibles
  const [badges, setBadges] = useState({
    states: {},      // { ESTADO: count }
    buckets: {},     // { ESTADO: {hoy:n, ayer:n, ...} }
  });

  // Cada vez que cambian los totales, calculamos deltas (entradas nuevas)
  useEffect(() => {
    const prevS = prevTotalsRef.current.states || {};
    const prevB = prevTotalsRef.current.buckets || {};

    // deltas por estado
    const nextStateBadges = {};
    for (const [k, v] of Object.entries(totalsByState)) {
      const delta = v - (prevS[k] || 0);
      if (delta > 0) nextStateBadges[k] = (badges.states[k] || 0) + delta;
      else nextStateBadges[k] = badges.states[k] || 0;
    }

    // deltas por estado/bucket
    const nextBucketBadges = {};
    for (const [estado, buckets] of Object.entries(totalsByStateBucket)) {
      nextBucketBadges[estado] = nextBucketBadges[estado] || { hoy:0, ayer:0, semana:0, mes:0 };
      const prevBuckets = (prevB[estado] || {});
      for (const b of ["hoy","ayer","semana","mes"]) {
        const v = buckets[b] || 0;
        const delta = v - (prevBuckets[b] || 0);
        nextBucketBadges[estado][b] = (badges.buckets?.[estado]?.[b] || 0) + (delta > 0 ? delta : 0);
      }
    }

    setBadges({ states: nextStateBadges, buckets: nextBucketBadges });

    // Actualizamos "previos" para la próxima comparación
    prevTotalsRef.current = {
      states: { ...totalsByState },
      buckets: JSON.parse(JSON.stringify(totalsByStateBucket)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalsByState, totalsByStateBucket]); // dependemos de los totales


  const clearStateBadge = (estado) => {
    setBadges(s => ({
      ...s,
      states: { ...s.states, [estado]: 0 }
    }));
  };
  const clearBucketBadge = (estado, bucket) => {
    setBadges(s => ({
      ...s,
      buckets: {
        ...s.buckets,
        [estado]: { ...(s.buckets[estado] || {}), [bucket]: 0 }
      }
    }));
  };




  // agrupación por estado y buckets de fecha
  const grupos = useMemo(() => agruparPorEstadoYBucketFecha(pedidosFiltrados), [pedidosFiltrados]);

  // NUEVO: inyectar despachos HOY desde pedidos_despachados
  const gruposConDesp = useMemo(() => {
    const g = { ...grupos };

    if (despsHoy.length > 0) {
      if (!g["DESPACHADO"]) g["DESPACHADO"] = {};
      g["DESPACHADO"]["HOY"] = despsHoy;
    }

    return g;
  }, [grupos, despsHoy]);


  // Estados ordenados y con total pre-calculado; se ocultan los que están vacíos
  const estadosOrdenados = useMemo(() => {
    const out = [];

    for (const est of ESTADO_ORDER) {
      const porFecha = gruposConDesp[est];
      if (!porFecha) continue;

      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    for (const est of Object.keys(gruposConDesp)) {
      if (ESTADO_ORDER.includes(est)) continue;
      const porFecha = gruposConDesp[est];
      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    return out;
  }, [gruposConDesp]);



  // Para encargado: dividir en zonas operativas
  const zonasEncargado = useMemo(() => {
    if (!isEncargado) return null;
    return {
      accion:    estadosOrdenados.filter(([e]) => ESTADOS_ACCION.includes(e)),
      ejecucion: estadosOrdenados.filter(([e]) => ESTADOS_EJECUCION.includes(e)),
      otros:     estadosOrdenados.filter(([e]) => !ESTADOS_ACCION.includes(e) && !ESTADOS_EJECUCION.includes(e)),
    };
  }, [isEncargado, estadosOrdenados]);

  /* --------- handlers UI --------- */
  function toggleBucket(estado, bucket) {
    const key = `${estado}::${bucket}`;
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function markEstadoSeen(estado) {
    const now = Date.now();
    const map = { ...(seenRef.current || {}) };
    map[estado] = now;
    seenRef.current = map;
    saveSeenMap(depositoActual, map);
    setStateHasNew((prev) => ({ ...prev, [estado]: false }));
  }

  function toggleEstado(estado) {
    setCollapsedStates(prev => {
      const next = new Set(prev);
      if (next.has(estado)) next.delete(estado); else next.add(estado);
      if (estado === "DESPACHADO") {
        setDespachosHasNew(false);
      }
      return next;
    });
    // si lo abrís, lo marcamos como visto
    markEstadoSeen(estado);
  }


  // ── Config visual por estado ─────────────────────────────────────────────
  const ESTADO_CONFIG = {
    PENDIENTE_ASIGNAR: { label: "Pendiente de asignar",    icon: "🕐", color: "#f59e0b", bg: "#fef3c7", border: "#fde68a" },
    ASIGNADO:          { label: "Asignado",                icon: "👤", color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
    EN_PREPARACION:    { label: "En preparación",          icon: "⚙️", color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe" },
    PREPARADO:         { label: "Preparado — a controlar", icon: "✅", color: "#16a34a", bg: "#f0fdf4", border: "#86efac" },
    CONTROLADO:        { label: "Controlado — listo",      icon: "📦", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
    DESPACHADO:        { label: "Despachados hoy",         icon: "🚚", color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
  };

  // ── Urgencia según fecha del pedido ──────────────────────────────────────
  function getUrgencia(p) {
    const d = getPedidoDate(p);
    if (!d) return null;
    const diff = daysDiff(new Date(), d);
    if (diff > 0) return "vencido";
    if (diff === 0) return "hoy";
    return null;
  }

  function formatFechaCorta(p) {
    const d = getPedidoDate(p);
    if (!d) return null;
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
  }

  // ── Card de pedido rediseñada ─────────────────────────────────────────────
  function renderCard(p) {
    const urgencia = getUrgencia(p);
    const responsable = getResponsable(p);
    const timeAgo = formatTimeAgo(p.timestamps?.[p.estado]);
    const fechaCorta = formatFechaCorta(p);
    const itemCount = p.productos?.length ?? 0;
    const urgenciaColor = urgencia === "vencido" ? "#ef4444" : urgencia === "hoy" ? "#f59e0b" : null;

    const metodoColors = {
      AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
      RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
      CAMION:  { bg: "#fef3c7", color: "#92400e" },
      GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
    };
    const metodoStyle = metodoColors[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };

    return (
      <a
        key={p.id}
        href={`/pedidos/${encodeURIComponent(p.id)}`}
        style={{
          display: "block",
          textDecoration: "none",
          background: "#fff",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          borderLeft: urgenciaColor ? `4px solid ${urgenciaColor}` : "1px solid #e2e8f0",
          padding: "11px 14px",
          marginBottom: "7px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          WebkitTapHighlightColor: "transparent",
          transition: "box-shadow 0.12s ease",
        }}
      >
        {/* Fila 1: número + método + urgencia o tiempo */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
          <span style={{ fontWeight: 700, fontSize: "0.87rem", color: "#0f172a", letterSpacing: "0.01em" }}>
            #{p.numero || p.id}
          </span>
          {p.metodoEntrega && (
            <span style={{
              fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px",
              borderRadius: "999px", letterSpacing: "0.05em",
              background: metodoStyle.bg, color: metodoStyle.color,
              flexShrink: 0,
            }}>
              {p.metodoEntrega}
            </span>
          )}
          {urgencia ? (
            <span style={{
              marginLeft: "auto", flexShrink: 0,
              fontSize: "0.63rem", fontWeight: 700, padding: "2px 7px",
              borderRadius: "999px", letterSpacing: "0.04em",
              background: urgencia === "vencido" ? "#fef2f2" : "#fefce8",
              color: urgenciaColor,
            }}>
              {urgencia === "vencido" ? "⚠ Vencido" : "⏰ Vence hoy"}
            </span>
          ) : timeAgo ? (
            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#94a3b8", fontWeight: 500, flexShrink: 0 }}>
              ⏱ {timeAgo}
            </span>
          ) : null}
        </div>

        {/* Fila 2: cliente */}
        <p style={{
          margin: "0 0 5px",
          fontSize: "0.93rem", fontWeight: 600, color: "#1e293b",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {p.cliente || "—"}
        </p>

        {/* Fila 3: ítems + fecha + responsable */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.76rem", color: "#64748b" }}>
            {itemCount} ítem{itemCount !== 1 ? "s" : ""}
          </span>
          {fechaCorta && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: "0.76rem", color: urgenciaColor || "#64748b" }}>
                📅 {fechaCorta}
              </span>
            </>
          )}
          {responsable && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
              <span style={{
                fontSize: "0.76rem", color: "#64748b",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "130px",
              }}>
                👤 {responsable}
              </span>
            </>
          )}
          {urgencia && timeAgo && (
            <>
              <span style={{ fontSize: "0.7rem", color: "#cbd5e1" }}>·</span>
              <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>⏱ {timeAgo}</span>
            </>
          )}
        </div>
      </a>
    );
  }

  // ── Sección de estado (sin sub-buckets, lista plana) ─────────────────────
  function renderEstadoSection(estado, porFecha, totalEstado) {
    const stateCollapsed = collapsedStates.has(estado);
    const cfg = ESTADO_CONFIG[estado] || { label: estado, icon: "📋", color: "#64748b", bg: "#f8fafc", border: "#e2e8f0" };
    const newCount = badges.states?.[estado] || 0;
    // Aplanar todos los buckets en una lista única ordenada por fecha desc
    const todosLosItems = BUCKET_ORDER.flatMap(b => porFecha[b] || []);

    return (
      <div key={estado} style={{ marginBottom: "6px" }}>
        {/* Header del estado */}
        <button
          type="button"
          onClick={() => { toggleEstado(estado); clearStateBadge(estado); }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: "10px",
            padding: "13px 16px",
            background: stateCollapsed ? "#fff" : cfg.bg,
            border: `1.5px solid ${stateCollapsed ? "#e2e8f0" : cfg.border}`,
            borderRadius: stateCollapsed ? "14px" : "14px 14px 0 0",
            cursor: "pointer", textAlign: "left",
            transition: "all 0.15s ease",
          }}
        >
          <span style={{ fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>{cfg.icon}</span>
          <span style={{ flex: 1, fontWeight: 700, fontSize: "0.88rem", color: cfg.color }}>
            {cfg.label}
          </span>
          {newCount > 0 && (
            <span style={{
              background: "#ef4444", color: "#fff",
              fontSize: "0.63rem", fontWeight: 700,
              padding: "2px 6px", borderRadius: "999px", flexShrink: 0,
            }}>
              +{newCount}
            </span>
          )}
          <span style={{
            flexShrink: 0,
            background: cfg.color + "22",
            color: cfg.color,
            fontSize: "0.78rem", fontWeight: 700,
            padding: "2px 9px", borderRadius: "999px",
          }}>
            {totalEstado}
          </span>
          <span style={{
            flexShrink: 0, color: cfg.color, fontSize: "0.85rem",
            transform: stateCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            display: "inline-block",
          }}>
            ▾
          </span>
        </button>

        {/* Lista de pedidos */}
        {!stateCollapsed && (
          <div style={{
            background: "#f1f5f9",
            border: `1.5px solid ${cfg.border}`,
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
            padding: "10px 10px 4px",
          }}>
            {todosLosItems.length === 0 ? (
              <p style={{ textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", padding: "12px 0", margin: 0 }}>
                Sin pedidos
              </p>
            ) : (
              todosLosItems.map(p => renderCard(p))
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render principal ──────────────────────────────────────────────────────
  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh" }}>

      {/* ── Header sticky compacto ── */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "12px 16px 10px",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        {/* Fila 1: título + depósito + acciones secundarias */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <a
            href="/inicio"
            title="Volver al inicio"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "34px", height: "34px", flexShrink: 0,
              background: "#f8fafc", border: "1px solid #e2e8f0",
              borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
            }}
          >
            ←
          </a>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0f172a", flex: 1 }}>
            Gestión de pedidos
          </h1>
          <span style={{
            background: "#eff6ff", color: "#1d4ed8",
            fontSize: "0.72rem", fontWeight: 700,
            padding: "3px 10px", borderRadius: "999px", flexShrink: 0,
          }}>
            {depositoActual || "—"}
          </span>
          {(isEncargado || isVentas) && (
            <div style={{ display: "flex", gap: "6px" }}>
              {isEncargado && (
                <a
                  href="/encargado/errores"
                  title="Errores de preparación"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "34px", height: "34px",
                    background: "#f8fafc", border: "1px solid #e2e8f0",
                    borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
                  }}
                >
                  🛑
                </a>
              )}
              <a
                href="/ventas/despachados"
                title="Informe de despachos"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "34px", height: "34px",
                  background: "#f8fafc", border: "1px solid #e2e8f0",
                  borderRadius: "10px", textDecoration: "none", fontSize: "1rem",
                }}
              >
                📋
              </a>
            </div>
          )}
        </div>

        {/* Fila 2: buscador */}
        <SearchBar
          value={q}
          onChange={setQ}
          onClear={() => setQ("")}
          placeholder="Buscar cliente, #pedido, método…"
        />

        {/* Fila 3: filtros por método — chips con scroll horizontal */}
        <div style={{
          display: "flex", gap: "7px",
          overflowX: "auto", paddingBottom: "2px", marginTop: "10px",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}>
          {["AGENCIA", "RETIRA", "CAMION", "GIRA"].map((m) => {
            const active = metodoFiltro === m;
            const colors = { AGENCIA: "#1d4ed8", RETIRA: "#15803d", CAMION: "#b45309", GIRA: "#7e22ce" };
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMetodoFiltro(active ? null : m)}
                style={{
                  flexShrink: 0,
                  padding: "6px 15px",
                  borderRadius: "999px",
                  border: `1.5px solid ${active ? colors[m] : "#e2e8f0"}`,
                  background: active ? colors[m] : "#fff",
                  color: active ? "#fff" : "#64748b",
                  fontSize: "0.78rem", fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.12s ease",
                }}
              >
                {m}
              </button>
            );
          })}
          {metodoFiltro && (
            <button
              type="button"
              onClick={() => setMetodoFiltro(null)}
              style={{
                flexShrink: 0, padding: "6px 12px", borderRadius: "999px",
                border: "1.5px solid #fca5a5", background: "#fef2f2",
                color: "#dc2626", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              ✕ Limpiar
            </button>
          )}
        </div>
      </div>

      {/* ── Contenido ── */}
      <div style={{ padding: "10px 10px 80px" }}>

        {loadingPedidos && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: "0.9rem" }}>
            Cargando pedidos…
          </div>
        )}

        {!loadingPedidos && Object.keys(grupos).length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 16px" }}>
            <p style={{ color: "#94a3b8", fontSize: "0.9rem", margin: 0 }}>No hay pedidos para mostrar.</p>
          </div>
        )}

        {/* Encargado: zonas operativas */}
        {!loadingPedidos && isEncargado && zonasEncargado && (
          <>
            {zonasEncargado.accion.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", marginTop: "4px" }}>
                <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#dc2626", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  ⚡ Requiere tu acción
                </span>
                <span style={{ background: "#fee2e2", color: "#dc2626", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                  {zonasEncargado.accion.reduce((s, [,,t]) => s + t, 0)}
                </span>
              </div>
            )}
            {zonasEncargado.accion.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}

            {zonasEncargado.ejecucion.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", marginTop: "14px" }}>
                <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#7c3aed", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  ⚙️ En ejecución
                </span>
                <span style={{ background: "#ede9fe", color: "#7c3aed", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                  {zonasEncargado.ejecucion.reduce((s, [,,t]) => s + t, 0)}
                </span>
              </div>
            )}
            {zonasEncargado.ejecucion.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}

            {zonasEncargado.otros.length > 0 && (
              <div style={{ marginTop: "14px" }}>
                {zonasEncargado.otros.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}
              </div>
            )}
          </>
        )}

        {/* Otros roles: lista plana */}
        {!loadingPedidos && !isEncargado &&
          estadosOrdenados.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}
      </div>
    </div>
  );
}
