
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

  const isEncargado = (profile?.role || "").toLowerCase() === "encargado";
  const isVentas = (profile?.role || "").toLowerCase() === "ventas";


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
    const role = (profile?.role || "").toLowerCase();
    if (role !== "encargado") return;
    if (syncRunRef.current) return;
    syncRunRef.current = true;

    (async () => {
      try { await syncPendientesDeHoy({ debug: true }); }
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
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        estado: "DESPACHADO",
      }));

      // Detectar si hay nuevos
      setDespsHoy((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        const newOnes = list.filter((p) => !prevIds.has(p.id));

        if (newOnes.length > 0) {
          console.log("🔔 NUEVO DESPACHADO:", newOnes);
          setDespachosHasNew(true);
        }

        return list;
      });
    });

    return () => unsub();
  }, []);




  // listener a Firestore (por depósito y método)
  useEffect(() => {
    // ⛔ si el snapshot anterior ya fue tratado como "altas nuevas", evitamos duplicar
    if (lastChangeWasNewRef.current) {
      prevTotalsRef.current = {
        states: { ...totalsByState },
        buckets: JSON.parse(JSON.stringify(totalsByStateBucket)),
      };
      lastChangeWasNewRef.current = false;
      return; // no sumamos badges ni sonamos acá; ya se hizo en onChange
    }

    if (authLoading) return;
    if (!user || !profile) return;
    if (!depositoActual) return;

    setLoadingPedidos(true);
    const unsub = listenPedidosByDeposito(depositoActual, {
      metodoEntrega: metodoFiltro || undefined,
      onChange: (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
        toast.error("Error cargando pedidos");
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

    // sumemos los deltas en una sola variable:
      let deltaTotal = 0;
      for (const [k, v] of Object.entries(totalsByState)) {
        const prev = prevS[k] || 0;
        const d = v - prev;
        if (d > 0) deltaTotal += d;
      }
      for (const [estado, buckets] of Object.entries(totalsByStateBucket)) {
        const prevBuckets = prevB[estado] || {};
        for (const b of ["hoy", "ayer", "semana", "mes"]) {
          const d = (buckets[b] || 0) - (prevBuckets[b] || 0);
          if (d > 0) deltaTotal += d;
        }
      }

      // si hubo nuevas entradas (pedido nuevo o cambio de estado) → ping
      if (deltaTotal > 0) {
        playNotif();  // 🔔 sonido
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



  return (
    <div className="container">
          {/* Acciones arriba del título */}
      {/* Acciones arriba del título */}
        {(isEncargado || isVentas) && (
          <div
            className="page-actions"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginBottom: 8,
            }}
          >
            {/* Botón Errores (solo encargado) */}
            {isEncargado && (
              <a
                href="/encargado/errores"
                className="btn btn--outline"
                style={{ fontWeight: 600 }}
                title="Ver errores de preparación"
              >
                Errores
              </a>
            )}

            {/* NUEVO → Informe Despachos (Encargado y Ventas) */}
            <a
              href="/despachados/historico"
              className="btn btn--primary"
              style={{ fontWeight: 600 }}
              title="Ver informe histórico de despachos"  
            >
              Informe Despachos
            </a>
          </div>
        )}
      {/* Encabezado */}
      <div className="deck-head">
        <div className="deck-title">Pedidos</div>
        <span className="pill pill--brand">Depósito: {depositoActual || "—"}</span>
      </div>

      <div className="mt-2">
        <SearchBar
          value={q}
          onChange={setQ}
          onClear={() => setQ("")}
          placeholder="Buscar por #PEDVTA, cliente, método o descripción…"
        />
      </div>
      {/* Filtros por método */}
      <div className="filters">
        <div className="filters-row">
          <div className="methods-grid">
            {["AGENCIA", "RETIRA", "CAMION", "GIRA"].map((m) => (
              <button
                key={m}
                className={`btn ${metodoFiltro === m ? "btn--primary" : "btn--outline"}`}
                onClick={() => setMetodoFiltro(metodoFiltro === m ? null : m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loaders / vacío */}
      {loadingPedidos && (
        <div className="card card--compact empty-card">
          <div className="muted">Cargando pedidos…</div>
        </div>
      )}
      {!loadingPedidos && Object.keys(grupos).length === 0 && (
        <div className="card card--compact empty-card">
          <div className="muted">No hay pedidos para mostrar.</div>
        </div>
      )}

            {/* Listado por ESTADO → FECHA */}
      {!loadingPedidos &&
        estadosOrdenados.map(([estado, porFecha, totalEstado]) => {
          const stateClass = `state--${(estado || "").toLowerCase().replaceAll("_", "-")}`;
          const hasNew = !!stateHasNew[estado];
          const stateCollapsed = collapsedStates.has(estado);

          return (
            <section key={estado} className={`section section--state ${stateClass}`}>
              <div
                className="section-title section-title--state"
                onClick={() => {
                  toggleEstado(estado);
                  clearStateBadge(estado);
                }}
                style={{ cursor: "pointer" }}
              >
                <Badge count={badges.states?.[estado] || 0} />

                {/* El label del estado ahora tiene clase para poder darle flex:1 */}
                <span className="state-label">{estado}</span>

                {/* Circulito rojo específico para despachos HOY */}
                {estado === "DESPACHADO" && despachosHasNew && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      backgroundColor: "red",
                      borderRadius: "50%",
                      marginLeft: 6,
                    }}
                  />
                )}


                {/* El contador va al final visual del título (antes del chev) */}
                <span className="state-count">{totalEstado}</span>

                <span
                  className="chev chev--sm"
                  style={{
                    display: "inline-block",
                    transform: stateCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform .15s ease-in-out",
                    marginLeft: 8,
                  }}
                >
                  ⌄
                </span>
              </div>


              {!stateCollapsed && (
                <div className="section-children">
                  {Object.entries(porFecha).map(([bucket, items]) => {
                    const key = `${estado}::${bucket}`;
                    const collapsed = collapsedBuckets.has(key);

                    return (
                      <div key={bucket} className="subsection">
                        <div
                          className="subsection-title"
                          onClick={() => {
                            toggleBucket(estado, bucket);
                            clearBucketBadge(estado, bucket);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <span>{bucket}</span>
                          <span className="muted">{items.length}</span>
                          <span
                            className="chev chev--sm"
                            style={{
                              display: "inline-block",
                              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              transition: "transform .15s ease-in-out",
                            }}
                          >
                            ⌄
                          </span>
                        </div>

                        {!collapsed && (
                          <div className="subsection-body">
                            <div className="orders-grid">
                              {items.map((p) => (
                                <a
                                  key={p.id}
                                  href={`/pedidos/${encodeURIComponent(p.id)}`}
                                  className="card order-card card--selectable"
                                >
                                  <div className="order-head">
                                    <div className="order-number">#{p.numero || p.id}</div>

                                    {getResponsable(p) && (
                                      <span className="pill pill--user" title="Responsable asignado">
                                        {getResponsable(p)}
                                      </span>
                                    )}

                                    <span className="pill pill--info">
                                      {p.metodoEntrega || "—"}
                                    </span>

                                    
                                  </div>
                                  <div className="order-body">
                                    <div className="order-field">
                                      <span className="order-label">Fecha (Finnegans)</span>
                                      <span className="order-value">{p.finFecha || "—"}</span>
                                    </div>
                                    <div className="order-field">
                                      <span className="order-label">Cliente</span>
                                      <span className="order-value">{p.cliente || "—"}</span>
                                    </div>
                                    <div className="order-field">
                                      <span className="order-label">Depósito</span>
                                      <span className="order-value">{p.deposito || "—"}</span>
                                    </div>
                                    {getResponsable(p) && (
                                      <div className="order-field">
                                        <span className="order-label">Responsable</span>
                                        <span className="order-value">{getResponsable(p)}</span>
                                      </div>
                                    )}
                                    <div className="order-field">
                                      <span className="order-label">Ítems</span>
                                      <span className="order-value">
                                        {p.productos?.length ?? 0}
                                      </span>
                                    </div>
                                    {p.bultos != null && (
                                      <div className="order-field">
                                        <span className="order-label">Bultos</span>
                                        <span className="order-value">{p.bultos}</span>
                                      </div>
                                    )}

                                    {p.paquetes != null && (
                                      <div className="order-field">
                                        <span className="order-label">Paquetes</span>
                                        <span className="order-value">{p.paquetes}</span>
                                      </div>
                                    )}
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
