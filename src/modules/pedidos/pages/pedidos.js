
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { listenPedidosByDeposito, asignarPedidoIsabela } from "../services/pedidosFS";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { syncPendientesDeHoy } from "../services/syncFinnegans";
import { FLUJO_ISABELA, FLUJO_R8, flujoToConfigMap } from "../services/estadosConfig";

import SearchBar from "../components/SearchBar";
import { norm } from "utils/text"
import Badge from "../components/Badge";
import useNotificationSound from "hooks/useNotificationSound"; // ajustá la ruta

import { collection, onSnapshot, query, where, doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp } from "firebase/firestore";
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

function getEstadoDate(p) {
  const estado = p?.estado || "PENDIENTE_ASIGNAR";
  // Para el primer estado, usar la fecha de creación de Finnegans
  if (estado === "PENDIENTE_ASIGNAR") return getPedidoDate(p);
  // Para el resto, usar el timestamp de cuando entró al estado
  const ts = p?.timestamps?.[estado];
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  // fallback: updatedAt, luego fecha de creación
  if (p?.updatedAt?.seconds) return new Date(p.updatedAt.seconds * 1000);
  return getPedidoDate(p);
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
    const d = getEstadoDate(p);
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
  const navigate = useNavigate();

  // Guardia: visor y ventas no deben ver esta vista — los mandamos al pipeline
  // Se hace con useEffect para no romper las Rules of Hooks (hay hooks después)

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
  const [syncing, setSyncing] = useState(false);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  const isEncargado = (profile?.rol || "").toLowerCase() === "encargado";
  const isVentas = (profile?.rol || "").toLowerCase() === "ventas";
  const _depositoNorm = (profile?.deposito || "").trim().toUpperCase();
  const isEncargadoIsabela = isEncargado && _depositoNorm === "ISABELA";
  const isEncargadoR8      = isEncargado && _depositoNorm === "R8";

  // ISABELA: lista de operarios del depósito para el panel de asignación
  const [operariosIsabela, setOperariosIsabela] = useState([]);
  const [asignando, setAsignando] = useState(null); // pedidoId en proceso de asignación
  useEffect(() => {
    if (!isEncargadoIsabela) return;
    // Consultamos todos los usuarios de ISABELA y filtramos operarios en JS,
    // soportando tanto "role" (campo viejo) como "rol" (campo nuevo).
    const q = query(
      collection(db, "users"),
      where("deposito", "==", "ISABELA")
    );
    const unsub = onSnapshot(q, snap => {
      const ops = snap.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => {
          const r = ((u.role || u.rol || "")).toLowerCase();
          return r === "operario";
        });
      setOperariosIsabela(ops);
    });
    return () => unsub();
  }, [isEncargadoIsabela]);

  // ISABELA + R8: pedidos despachados pendientes de entrega
  const [porControlar, setPorControlar]         = useState([]);  // ISABELA
  const [porControlarR8, setPorControlarR8]     = useState([]);  // R8
  const [yaEntregadosIds, setYaEntregadosIds]   = useState(new Set()); // ISABELA
  const [yaEntregados, setYaEntregados] = useState([]); // ISABELA — objetos entregados HOY
  const [yaEntregadosIdsR8, setYaEntregadosIdsR8] = useState(new Set()); // R8
  const [collapsedEntrega, setCollapsedEntrega] = useState(false);


  const { play: playNotif, enabled: soundOn, setEnabled: setSoundOn, unlock } =
  useNotificationSound("/sfx/new-order.mp3", { volume: 0.5 });

  // 👇 ya usás useRef en el archivo, agregá estos dos:
  const prevAllIdsRef = useRef(new Set());     // IDs que ya vimos en el snapshot anterior
  const firstSnapRef   = useRef(true);         // para NO contar la carga inicial como "nuevo"
  const lastChangeWasNewRef = useRef(false);   // flag: este snapshot trajo "altas" nuevas





  // Guardia de rol: visor y ventas van al pipeline, no a esta vista.
  // Chequeamos ambos campos (role y rol) para cubrir perfiles con campos mixtos.
  useEffect(() => {
    if (!profile) return;
    const rf = (profile.role || "").toLowerCase();
    const rl = (profile.rol  || "").toLowerCase();
    const isVisorUser  = rf === "visor"  || rl === "visor";
    const isVentasUser = rf === "ventas" || rl === "ventas";
    if (isVisorUser || isVentasUser) navigate("/pedidos", { replace: true });
  }, [profile, navigate]);

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

  /* ---------- listener: pendientes de control físico (solo ISABELA) ---------- */
  useEffect(() => {
    if (!isEncargadoIsabela) return;
    const q = query(
      collection(db, "pedidos_despachados"),
      where("necesitaControl", "==", true),
      where("deposito", "==", "ISABELA")
    );
    const unsub = onSnapshot(q, snap => {
      setPorControlar(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("[porControlar]", err));
    return () => unsub();
  }, [isEncargadoIsabela]);

  /* ---------- listener: ya entregados ISABELA ---------- */
  useEffect(() => {
    if (!isEncargadoIsabela) return;
    const q = query(
      collection(db, "pedidos_entregados"),
      where("deposito", "==", "ISABELA")
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setYaEntregadosIds(new Set(docs.map(d => d.id)));
      // Solo HOY para el pipeline del encargado
      const hoyMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
      setYaEntregados(docs.filter(d => {
        const ts = d.entregadoAt?.seconds ? d.entregadoAt.seconds * 1000 : null;
        return ts !== null && ts >= hoyMs;
      }));
    }, err => console.error("[yaEntregados ISABELA]", err));
    return () => unsub();
  }, [isEncargadoIsabela]);

  /* ---------- listener: pedidos despachados pendientes de entrega (R8) ---------- */
  useEffect(() => {
    if (!isEncargadoR8) return;
    const q = query(
      collection(db, "pedidos_despachados"),
      where("necesitaControl", "==", true),
      where("deposito", "==", "R8")
    );
    const unsub = onSnapshot(q, snap => {
      setPorControlarR8(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error("[porControlar R8]", err));
    return () => unsub();
  }, [isEncargadoR8]);

  /* ---------- listener: ya entregados R8 ---------- */
  useEffect(() => {
    if (!isEncargadoR8) return;
    const q = query(
      collection(db, "pedidos_entregados"),
      where("deposito", "==", "R8")
    );
    const unsub = onSnapshot(q, snap => {
      setYaEntregadosIdsR8(new Set(snap.docs.map(d => d.id)));
    }, err => console.error("[yaEntregados R8]", err));
    return () => unsub();
  }, [isEncargadoR8]);

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
          .filter((p) => p.estado !== "ANULADO" && p.estado !== "CANCELADO"); // excluir de la vista operativa
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
      const estado = String(p.estado || "PENDIENTE_ASIGNAR").toUpperCase();
      const fechaCreacion = parseToDate(getPedidoDate(p) || p.fecha || p.emision || p.createdAt); // fecha Finnegans — para display
      const fechaEstado   = parseToDate(getEstadoDate({ ...p, estado })); // fecha del estado — para bucket
      return { ...p, estado, fechaObj: fechaCreacion, fechaEstado, _bucket: bucketFecha(fechaEstado) };
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




  // ISABELA: pendientes de entrega (porControlar + fallback desde colección pedidos)
  const pendientesEntrega = useMemo(() => {
    if (!isEncargadoIsabela) return [];
    const despachados = pedidosFiltrados.filter(
      p => p.estado === "DESPACHADO" && !yaEntregadosIds.has(p.id)
    );
    const ids = new Set(porControlar.map(p => p.id));
    return [...porControlar, ...despachados.filter(p => !ids.has(p.id))];
  }, [isEncargadoIsabela, porControlar, pedidosFiltrados, yaEntregadosIds]);

  // R8: pendientes de entrega (porControlarR8 + fallback desde colección pedidos)
  const pendientesEntregaR8 = useMemo(() => {
    if (!isEncargadoR8) return [];
    const despachados = pedidosFiltrados.filter(
      p => p.estado === "DESPACHADO" && !yaEntregadosIdsR8.has(p.id)
    );
    const ids = new Set(porControlarR8.map(p => p.id));
    return [...porControlarR8, ...despachados.filter(p => !ids.has(p.id))];
  }, [isEncargadoR8, porControlarR8, pedidosFiltrados, yaEntregadosIdsR8]);

  // ISABELA y R8: excluir DESPACHADO del listado principal (aparece en sección dedicada)
  const pedidosFiltradosParaGrupos = useMemo(() => {
    if (isEncargadoIsabela || isEncargadoR8) {
      return pedidosFiltrados.filter(p => p.estado !== "DESPACHADO");
    }
    return pedidosFiltrados;
  }, [isEncargadoIsabela, isEncargadoR8, pedidosFiltrados]);

  // agrupación por estado y buckets de fecha
  const grupos = useMemo(() => agruparPorEstadoYBucketFecha(pedidosFiltradosParaGrupos), [pedidosFiltradosParaGrupos]);

  // Inyectar despachos HOY desde pedidos_despachados.
  // Para encargados ISABELA y R8 NO inyectamos: aparece en sección dedicada "Pendiente de entrega"
  const gruposConDesp = useMemo(() => {
    const g = { ...grupos };
    const esEncargadoConSeccionEntrega = isEncargadoIsabela || isEncargadoR8;
    if (!esEncargadoConSeccionEntrega && despsHoy.length > 0) {
      if (!g["DESPACHADO"]) g["DESPACHADO"] = {};
      g["DESPACHADO"]["HOY"] = despsHoy;
    }
    return g;
  }, [grupos, despsHoy, isEncargadoIsabela, isEncargadoR8]);


  // Estados ordenados y con total pre-calculado; se ocultan los que están vacíos
  const activeEstadoOrder = isEncargadoIsabela
    ? ["PENDIENTE_ASIGNAR", "ASIGNADO", "EN_PREPARACION", "CON_ERROR", "CONTROLADO"]
    : ESTADO_ORDER;

  const estadosOrdenados = useMemo(() => {
    const out = [];

    for (const est of activeEstadoOrder) {
      const porFecha = gruposConDesp[est];
      if (!porFecha) continue;

      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    for (const est of Object.keys(gruposConDesp)) {
      if (activeEstadoOrder.includes(est)) continue;
      const porFecha = gruposConDesp[est];
      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    return out;
  }, [gruposConDesp, activeEstadoOrder]);



  // Para encargado: dividir en zonas operativas
  const zonasEncargado = useMemo(() => {
    if (!isEncargado) return null;

    let accionStates, ejecucionStates;

    if (isEncargadoIsabela) {
      // ISABELA: DESPACHADO ya se muestra en sección propia
      accionStates    = ["PENDIENTE_ASIGNAR", "CON_ERROR"];
      ejecucionStates = ["ASIGNADO", "EN_PREPARACION"];
      // CONTROLADO → "otros" (aparece abajo sin zona, listo para despachar)
    } else if (isEncargadoR8) {
      // R8: encargado actúa en: asignar operarios, revisar errores, controlar pedidos preparados
      accionStates    = ["PENDIENTE_ASIGNAR", "CON_ERROR", "PREPARADO"];
      ejecucionStates = ["ASIGNADO", "EN_PREPARACION"];
    } else {
      accionStates    = ESTADOS_ACCION;
      ejecucionStates = ESTADOS_EJECUCION;
    }

    return {
      accion:    estadosOrdenados.filter(([e]) => accionStates.includes(e)),
      ejecucion: estadosOrdenados.filter(([e]) => ejecucionStates.includes(e)),
      otros:     estadosOrdenados.filter(([e]) => !accionStates.includes(e) && !ejecucionStates.includes(e)),
    };
  }, [isEncargado, isEncargadoIsabela, isEncargadoR8, estadosOrdenados]);

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

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncPendientesDeHoy();
      toast.success("Pedidos actualizados ✓");
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron sincronizar los pedidos");
    } finally {
      setSyncing(false);
    }
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
  // Config visual derivada del archivo compartido — mismos labels que el pipeline
  const ESTADO_CONFIG_ISABELA = flujoToConfigMap(FLUJO_ISABELA);
  const ESTADO_CONFIG_DEFAULT = flujoToConfigMap(FLUJO_R8);
  const ESTADO_CONFIG = isEncargadoIsabela ? ESTADO_CONFIG_ISABELA : ESTADO_CONFIG_DEFAULT;

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
    const responsable = getResponsable(p);
    const timeAgo = formatTimeAgo(getEstadoDate(p));
    const itemCount = p.productos?.length ?? 0;

    const metodoColors = {
      AGENCIA: { bg: "#eff6ff", color: "#1d4ed8" },
      RETIRA:  { bg: "#f0fdf4", color: "#15803d" },
      CAMION:  { bg: "#fef3c7", color: "#92400e" },
      GIRA:    { bg: "#fdf4ff", color: "#7e22ce" },
    };
    const metodoStyle = metodoColors[p.metodoEntrega] || { bg: "#f8fafc", color: "#475569" };

    // ISABELA: pedidos DESPACHADOS van al control de entrega, no al detalle normal
    const cardHref = (isEncargadoIsabela && p.estado === "DESPACHADO")
      ? `/encargado/entrega/${encodeURIComponent(p.id)}`
      : `/pedidos/${encodeURIComponent(p.id)}`;

    return (
      <a
        key={p.id}
        href={cardHref}
        style={{
          display: "block",
          textDecoration: "none",
          background: "#fff",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
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
          {timeAgo ? (
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
          {/* Fecha de creación del pedido — siempre visible como referencia */}
          {p.estado !== "PENDIENTE_ASIGNAR" && formatFechaCorta(p) && (
            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>
              📅 {formatFechaCorta(p)}
            </span>
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
        </div>
      </a>
    );
  }

  // ── Panel de asignación ISABELA ───────────────────────────────────────────
  // Solo visible para el encargado de ISABELA en tarjetas PENDIENTE_ASIGNAR y ASIGNADO.
  function renderAsignarPanel(p) {
    const esPendiente = p.estado === "PENDIENTE_ASIGNAR";
    const esAsignado  = p.estado === "ASIGNADO";
    if (!isEncargadoIsabela || (!esPendiente && !esAsignado)) return null;

    const loading = asignando === p.id;

    async function handleAsignar(operario) {
      setAsignando(p.id);
      try {
        await asignarPedidoIsabela(p.id, operario.uid, operario.nombre || operario.displayName || "Operario", false);
        toast.success(`Asignado a ${operario.nombre || "operario"} ✓`);
      } catch (e) {
        toast.error("No se pudo asignar: " + (e?.message || "error"));
      } finally {
        setAsignando(null);
      }
    }

    async function handleSelfAssign() {
      setAsignando(p.id);
      try {
        await asignarPedidoIsabela(p.id, user.uid, profile?.nombre || profile?.displayName || "Encargado", true);
        toast.success("Pedido tomado, comenzando preparación ✓");
      } catch (e) {
        toast.error("No se pudo asignar: " + (e?.message || "error"));
      } finally {
        setAsignando(null);
      }
    }

    async function handleReasignar() {
      // Volver a PENDIENTE_ASIGNAR para re-seleccionar
      setAsignando(p.id);
      try {
        await updateDoc(doc(db, "pedidos", p.id), {
          estado: "PENDIENTE_ASIGNAR",
          operarioId: null,
          operarioNombre: null,
          updatedAt: serverTimestamp(),
          "timestamps.PENDIENTE_ASIGNAR": serverTimestamp(),
        });
        toast.success("Asignación liberada");
      } catch (e) {
        toast.error("Error: " + (e?.message || "error"));
      } finally {
        setAsignando(null);
      }
    }

    if (esAsignado) {
      return (
        <div style={{ marginTop: "6px", padding: "7px 10px", background: "#f5f3ff", borderRadius: "8px", border: "1px solid #c4b5fd" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.78rem", color: "#5b21b6", flex: 1, fontWeight: 600 }}>
              👤 {p.operarioNombre || "Operario"}
            </span>
            <button
              onClick={e => { e.stopPropagation(); e.preventDefault(); handleReasignar(); }}
              disabled={loading}
              style={{ fontSize: "0.68rem", padding: "3px 9px", borderRadius: "6px", border: "1px solid #c4b5fd", background: "#fff", color: "#7c3aed", cursor: "pointer", fontWeight: 600 }}
            >
              {loading ? "…" : "Reasignar"}
            </button>
          </div>
        </div>
      );
    }

    // PENDIENTE_ASIGNAR
    return (
      <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "5px" }} onClick={e => { e.stopPropagation(); e.preventDefault(); }}>
        {operariosIsabela.map(op => (
          <button
            key={op.uid}
            onClick={() => handleAsignar(op)}
            disabled={loading}
            style={{
              padding: "7px 10px", borderRadius: "8px",
              border: "1.5px solid #c4b5fd", background: "#f5f3ff",
              color: "#5b21b6", fontSize: "0.78rem", fontWeight: 700,
              cursor: "pointer", textAlign: "left",
            }}
          >
            {loading ? "…" : `👤 Asignar a ${op.nombre || op.displayName || "Operario"}`}
          </button>
        ))}
        <button
          onClick={handleSelfAssign}
          disabled={loading}
          style={{
            padding: "7px 10px", borderRadius: "8px",
            border: "1.5px solid #bae6fd", background: "#f0f9ff",
            color: "#0369a1", fontSize: "0.78rem", fontWeight: 700,
            cursor: "pointer", textAlign: "left",
          }}
        >
          {loading ? "…" : "🙋 Preparar yo mismo"}
        </button>
      </div>
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
            padding: "6px 10px 4px",
          }}>
            {BUCKET_ORDER.filter(b => (porFecha[b] || []).length > 0).length === 0 ? (
              <p style={{ textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", padding: "12px 0", margin: 0 }}>
                Sin pedidos
              </p>
            ) : (
              BUCKET_ORDER.filter(b => (porFecha[b] || []).length > 0).map(bucket => (
                <div key={bucket} style={{ marginBottom: "4px" }}>
                  {/* Sub-header de bucket */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 4px 4px",
                  }}>
                    <span style={{
                      fontSize: "0.68rem", fontWeight: 700,
                      color: cfg.color, textTransform: "uppercase", letterSpacing: "0.07em",
                      opacity: 0.8,
                    }}>
                      {bucket}
                    </span>
                    <div style={{ flex: 1, height: "1px", background: cfg.border }} />
                    <span style={{
                      fontSize: "0.65rem", fontWeight: 600, color: cfg.color, opacity: 0.7,
                    }}>
                      {(porFecha[bucket] || []).length}
                    </span>
                  </div>
                  {/* Cards del bucket */}
                  {(porFecha[bucket] || []).map(p => renderCard(p))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Control físico ISABELA ────────────────────────────────────────────────
  async function marcarControlado(pedidoId) {
    try {
      // Buscar el pedido: primero en pedidos_despachados, luego en pedidos (flujo legacy)
      const despRef = doc(db, "pedidos_despachados", pedidoId);
      const despSnap = await getDoc(despRef);
      let data, sourceRef;

      if (despSnap.exists()) {
        data = despSnap.data();
        sourceRef = despRef;
      } else {
        const pedRef = doc(db, "pedidos", pedidoId);
        const pedSnap = await getDoc(pedRef);
        if (!pedSnap.exists()) { toast.error("Pedido no encontrado"); return; }
        data = pedSnap.data();
        sourceRef = pedRef;
      }

      // Escribir en la colección permanente de entregados
      await setDoc(doc(db, "pedidos_entregados", pedidoId), {
        ...data,
        entregadoAt: serverTimestamp(),
        entregadoPor: user?.uid || null,
        source: "app-entrega",
      });

      // Borrar de la colección de origen
      await deleteDoc(sourceRef);

      toast.success("Pedido entregado ✓");
    } catch (e) {
      console.error(e);
      toast.error("No se pudo registrar el control");
    }
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
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  title="Actualizar pedidos desde Finnegans"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "34px", height: "34px",
                    background: syncing ? "#eff6ff" : "#f8fafc",
                    border: `1px solid ${syncing ? "#93c5fd" : "#e2e8f0"}`,
                    borderRadius: "10px", fontSize: "1rem",
                    cursor: syncing ? "not-allowed" : "pointer",
                    opacity: syncing ? 0.7 : 1,
                  }}
                >
                  {syncing ? "⏳" : "🔄"}
                </button>
              )}
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
      {isEncargadoIsabela && !isMobile ? (
        /* ── ISABELA Desktop: Kanban horizontal ── */
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7, minmax(200px, 1fr))", gap: "10px", padding: "14px 16px 24px", overflowX: "auto", alignItems: "start", boxSizing: "border-box" }}>
          {FLUJO_ISABELA.map(cfg => {
            // Get items for this state
            let items = [];
            if (cfg.id === "DESP_PENDIENTE") {
              items = pendientesEntrega;
            } else if (cfg.id === "DESP_ENTREGADO") {
              items = yaEntregados;
            } else {
              const porFecha = gruposConDesp[cfg.id];
              if (porFecha) {
                items = ["HOY","AYER","ÚLTIMA SEMANA","ÚLTIMO MES","ANTERIORES"].flatMap(b => porFecha[b] || []);
              }
            }

            return (
              <div key={cfg.id} style={{ display: "flex", flexDirection: "column", background: cfg.bg, borderRadius: "12px", border: `1.5px solid ${cfg.border}`, minHeight: "120px", overflow: "hidden" }}>
                {/* Column header */}
                <div style={{ padding: "10px 13px 8px", borderBottom: `1px solid ${cfg.border}`, background: cfg.headerBg }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "0.9rem" }}>{cfg.icon}</span>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: "0.78rem", color: cfg.color }}>{cfg.label}</span>
                    <span style={{ background: items.length > 0 ? cfg.color + "22" : "#f1f5f9", color: items.length > 0 ? cfg.color : "#94a3b8", fontSize: "0.7rem", fontWeight: 700, padding: "1px 7px", borderRadius: "999px" }}>
                      {items.length}
                    </span>
                  </div>
                </div>
                {/* Cards */}
                <div style={{ padding: "8px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                  {items.length === 0 ? (
                    <p style={{ textAlign: "center", color: "#d1d5db", fontSize: "0.75rem", padding: "14px 0", margin: 0 }}>Sin pedidos</p>
                  ) : (cfg.id === "DESP_PENDIENTE" ? (
                    items.map(p => (
                      <div key={p.id} onClick={() => navigate(`/encargado/entrega/${p.id}`)} style={{ background: "#fff", border: "1.5px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "10px", padding: "10px 12px", cursor: "pointer" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0f172a" }}>#{p.numero || p.id}</div>
                        <div style={{ fontSize: "0.78rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || "—"}</div>
                        <div style={{ fontSize: "0.7rem", color: "#dc2626", fontWeight: 700, marginTop: "4px" }}>Controlar →</div>
                      </div>
                    ))
                  ) : cfg.id === "DESP_ENTREGADO" ? (
                    items.map(p => (
                      <div key={p.id} style={{ background: "#fff", border: "1.5px solid #86efac", borderRadius: "10px", padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0f172a" }}>#{p.numero || p.id}</div>
                        <div style={{ fontSize: "0.78rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || "—"}</div>
                        <div style={{ fontSize: "0.7rem", color: "#15803d", fontWeight: 600, marginTop: "4px" }}>✓ Entregado</div>
                      </div>
                    ))
                  ) : (
                    items.map(p => renderCard(p))
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      /* ── Mobile / R8: secciones verticales ── */
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

        {/* ── ISABELA encargado: orden lineal del flujo ── */}
        {!loadingPedidos && isEncargadoIsabela && (
          <>
            {estadosOrdenados.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}

            {/* DESP_PENDIENTE al final (último paso del flujo) */}
            {pendientesEntrega.length > 0 && (
              <div style={{ marginBottom: "10px", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setCollapsedEntrega(c => !c)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "10px",
                    padding: "13px 16px",
                    background: collapsedEntrega ? "#fff" : "#fef2f2",
                    border: `1.5px solid ${collapsedEntrega ? "#e2e8f0" : "#fca5a5"}`,
                    borderRadius: collapsedEntrega ? "14px" : "14px 14px 0 0",
                    cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>🚚</span>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: "0.88rem", color: "#dc2626" }}>
                    Despachado · entregar
                  </span>
                  <span style={{ flexShrink: 0, background: "#dc262622", color: "#dc2626", fontSize: "0.78rem", fontWeight: 700, padding: "2px 9px", borderRadius: "999px" }}>
                    {pendientesEntrega.length}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#dc2626", flexShrink: 0, marginLeft: "2px" }}>
                    {collapsedEntrega ? "▶" : "▼"}
                  </span>
                </button>
                {!collapsedEntrega && (
                  <div style={{ border: "1.5px solid #fca5a5", borderTop: "none", borderRadius: "0 0 14px 14px", background: "#fef2f2", padding: "8px 10px 10px" }}>
                    {pendientesEntrega.map(p => {
                      const ago = formatTimeAgo(p.despachadoAt || p.timestamps?.DESPACHADO || p.updatedAt);
                      return (
                        <div key={p.id} onClick={() => navigate(`/encargado/entrega/${p.id}`)}
                          style={{ background: "#fff", border: "1.5px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: "10px", padding: "11px 14px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>#{p.numero || p.id}</p>
                            {ago && <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>⏱ {ago}</span>}
                            <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || "—"}</p>
                          </div>
                          <span style={{ flexShrink: 0, color: "#dc2626", fontSize: "0.8rem", fontWeight: 700 }}>Controlar →</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* DESP_ENTREGADO al final */}
            <div style={{ marginBottom: "10px" }}>
              <div style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "13px 16px", background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: yaEntregados.length > 0 ? "14px 14px 0 0" : "14px" }}>
                <span style={{ fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>✅</span>
                <span style={{ flex: 1, fontWeight: 700, fontSize: "0.88rem", color: "#15803d" }}>Entregado hoy</span>
                <span style={{ flexShrink: 0, background: "#15803d22", color: "#15803d", fontSize: "0.78rem", fontWeight: 700, padding: "2px 9px", borderRadius: "999px" }}>{yaEntregados.length}</span>
              </div>
              {yaEntregados.length > 0 && (
                <div style={{ border: "1.5px solid #86efac", borderTop: "none", borderRadius: "0 0 14px 14px", background: "#f0fdf4", padding: "8px 10px 10px" }}>
                  {yaEntregados.map(p => (
                    <div key={p.id} style={{ background: "#fff", border: "1.5px solid #86efac", borderRadius: "10px", padding: "11px 14px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>#{p.numero || p.id}</p>
                        <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || "—"}</p>
                      </div>
                      <span style={{ flexShrink: 0, color: "#15803d", fontSize: "0.8rem", fontWeight: 700 }}>✓ Entregado</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* R8 encargado: zonas operativas */}
        {!loadingPedidos && isEncargadoR8 && zonasEncargado && (
          <>
            {zonasEncargado.accion.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", marginTop: "4px" }}>
                <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#dc2626", letterSpacing: "0.07em", textTransform: "uppercase" }}>⚡ Requiere tu acción</span>
                <span style={{ background: "#fee2e2", color: "#dc2626", fontSize: "0.68rem", fontWeight: 700, padding: "1px 8px", borderRadius: "999px" }}>
                  {zonasEncargado.accion.reduce((s, [,,t]) => s + t, 0)}
                </span>
              </div>
            )}
            {zonasEncargado.accion.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}

            {zonasEncargado.ejecucion.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", marginTop: "14px" }}>
                <span style={{ fontSize: "0.67rem", fontWeight: 700, color: "#7c3aed", letterSpacing: "0.07em", textTransform: "uppercase" }}>⚙️ En ejecución</span>
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

            {/* R8: pendientes de entrega */}
            {pendientesEntregaR8.length > 0 && (
              <div style={{ marginBottom: "10px", marginTop: "6px" }}>
                <button type="button" onClick={() => setCollapsedEntrega(c => !c)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "13px 16px", background: collapsedEntrega ? "#fff" : "#fff7ed", border: `1.5px solid ${collapsedEntrega ? "#e2e8f0" : "#fdba74"}`, borderRadius: collapsedEntrega ? "14px" : "14px 14px 0 0", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>🚚</span>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: "0.88rem", color: "#b45309" }}>Despachado · entregar</span>
                  <span style={{ flexShrink: 0, background: "#b4530922", color: "#b45309", fontSize: "0.78rem", fontWeight: 700, padding: "2px 9px", borderRadius: "999px" }}>{pendientesEntregaR8.length}</span>
                  <span style={{ fontSize: "0.75rem", color: "#b45309", flexShrink: 0, marginLeft: "2px" }}>{collapsedEntrega ? "▶" : "▼"}</span>
                </button>
                {!collapsedEntrega && (
                  <div style={{ border: "1.5px solid #fdba74", borderTop: "none", borderRadius: "0 0 14px 14px", background: "#fff7ed", padding: "8px 10px 10px" }}>
                    {pendientesEntregaR8.map(p => {
                      const ago = formatTimeAgo(p.despachadoAt || p.timestamps?.DESPACHADO || p.updatedAt);
                      return (
                        <div key={p.id} onClick={() => navigate(`/encargado/entrega/${p.id}`)}
                          style={{ background: "#fff", border: "1.5px solid #fed7aa", borderLeft: "4px solid #b45309", borderRadius: "10px", padding: "11px 14px", marginBottom: "6px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: "0.9rem", color: "#0f172a" }}>#{p.numero || p.id}</p>
                            {ago && <span style={{ fontSize: "0.7rem", color: "#94a3b8" }}>⏱ {ago}</span>}
                            <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.cliente || "—"}</p>
                          </div>
                          <span style={{ flexShrink: 0, color: "#b45309", fontSize: "0.8rem", fontWeight: 700 }}>Controlar →</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Otros roles (no encargado): lista plana */}
        {!loadingPedidos && !isEncargado &&
          estadosOrdenados.map(([e, pf, t]) => renderEstadoSection(e, pf, t))}
      </div>
      )}
    </div>
  );
}
