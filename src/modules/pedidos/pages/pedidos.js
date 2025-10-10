/*
import { useEffect, useMemo, useState } from "react";
import { listenPedidosByDeposito } from "../services/pedidosFS";
import { agruparPorEstadoYFecha } from "../services/agrupaciones";
import { syncNuevosPedidos } from "../services/syncFinnegans";
import { useApp } from "../../../context/AppContext";

export default function PedidosPage() {
  const { depositoActual, metodoFiltro, setMetodoFiltro, toast } = useApp();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  // ⚠️ Ya no llamamos a sync en mount; el usuario dispara manualmente
  useEffect(() => {
    if (!depositoActual) return;
    setLoading(true);
    const unsub = listenPedidosByDeposito(depositoActual, {
      metodoEntrega: metodoFiltro || undefined,
      onChange: (snap) => {
        setPedidos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      onError: (e) => { console.error(e); toast.error("Error cargando pedidos"); setLoading(false); }
    });
    return () => unsub();
  }, [depositoActual, metodoFiltro]);

  const grupos = useMemo(()=>agruparPorEstadoYFecha(pedidos), [pedidos]);

  async function handleSync() {
    try {
      setSyncing(true);
      const res = await syncNuevosPedidos();
      setLastSync(new Date());
      toast.info(`Sync OK — creados: ${res.created}, actualizados: ${res.updated}, omitidos: ${res.skipped}`);
    } catch (e) {
      toast.error(e.message || "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-3">
      <header className="flex items-center gap-2 overflow-auto">
        {["AGENCIA","RETIRA","CAMION","GIRA"].map(m => (
          <button key={m}
            className={`px-3 py-2 rounded ${metodoFiltro===m?'bg-black text-white':'bg-gray-200'}`}
            onClick={()=>setMetodoFiltro(metodoFiltro===m?null:m)}
          >{m}</button>
        ))}
        <button
          className="ml-auto px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60"
          onClick={handleSync}
          disabled={syncing}
        >{syncing ? "Sincronizando…" : "Sincronizar ahora"}</button>
      </header>

      {lastSync && <p className="text-xs text-gray-500 mt-1">Última sync: {lastSync.toLocaleString()}</p>}

      {loading && <p>Cargando…</p>}
      {!loading && pedidos.length===0 && <p>No hay pedidos para mostrar.</p>}

      {!loading && Object.entries(grupos).map(([estado, porFecha])=>(
        <section key={estado} className="mt-4">
          <h2 className="font-bold">{estado}</h2>
          {Object.entries(porFecha).map(([bucket, items])=>(
            <div key={bucket}>
              <h3 className="text-sm text-gray-500">{bucket}</h3>
              <ul>
                {items.map(p=>(
                  <li key={p.id} className="py-2 border-b">
                    <a href={`/pedidos/${p.id}`} className="block">#{p.numero} — {p.cliente} — {p.metodoEntrega||"—"}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}


import { useEffect, useMemo, useState, useRef } from "react";
import { listenPedidosByDeposito } from "../services/pedidosFS";
import { agruparPorEstadoYFecha } from "../services/agrupaciones";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { syncPendientesUltimaSemana } from "../services/syncFinnegans"; 


export default function PedidosPage() {
  const { depositoActual, metodoFiltro, setMetodoFiltro, toast } = useApp();
  const { user, profile, loading: authLoading } = useAuth();

  const [pedidos, setPedidos] = useState([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);

  const syncRunRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !profile) return;

    // Solo ENCARGADO; Operario NO
    const role = (profile?.role || "").toLowerCase();
    if (role !== "encargado") return;

    // Evitar reintentos múltiples (navegar dentro de la app, etc.)
    if (syncRunRef.current) return;
    syncRunRef.current = true;

    (async () => {
      try {
        const res = await syncPendientesUltimaSemana({ debug: true });
        // opcional: toast con resumen
        // toast.info(`Sync (7d) → creados:${res.created} · actualizados:${res.updated} · omitidos:${res.skipped}`);
        // no toco el listado: el listener en vivo lo va a reflejar
      } catch (e) {
        console.error("[PedidosPage] sync auto error:", e);
        // opcional: toast.error("No se pudo sincronizar pedidos nuevos");
      }
    })();
  }, [authLoading, user, profile]);

  // Suscripción a Firestore (esperando Auth + profile + depósito)
  useEffect(() => {
    if (authLoading) return;
    if (!user || !profile) return;
    if (!depositoActual) return;

    setLoadingPedidos(true);

    const unsub = listenPedidosByDeposito(depositoActual, {
      metodoEntrega: metodoFiltro || undefined,
      onChange: (snap) => {
        setPedidos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingPedidos(false);
      },
      onError: (e) => {
        console.error("[PedidosPage] onError listenPedidosByDeposito:", e);
        toast.error("Error cargando pedidos");
        setLoadingPedidos(false);
      },
    });

    return () => unsub();
  }, [authLoading, user, profile, depositoActual, metodoFiltro, toast]);

  // Agrupación por estado y “bucket” de fecha (usa tu helper actual)
  const grupos = useMemo(() => agruparPorEstadoYFecha(pedidos), [pedidos]);

  return (
  <div className="container">

    {/* Encabezado: título + depósito *//*}
    <div className="deck-head">
      <div className="deck-title">Pedidos</div>
      <span className="pill pill--brand">Depósito: {depositoActual || "—"}</span>
    </div>

    {/* Filtros por método (usa .btn y .methods-grid del CSS) *//*}
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

    {/* Loaders / vacío }
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

    {/* Listado por ESTADO → FECHA }
    {!loadingPedidos &&
      Object.entries(grupos).map(([estado, porFecha]) => {
        const stateClass = `state--${(estado || "").toLowerCase().replaceAll("_", "-")}`;
        return (
          <section key={estado} className={`section section--state ${stateClass}`}>
            {/* Título de ESTADO }
            <div className="section-title section-title--state">
              <span>{estado}</span>
              <span className="muted">{Object.values(porFecha).reduce((a, arr) => a + arr.length, 0)} pedidos</span>
            </div>

            <div className="section-children">
              {Object.entries(porFecha).map(([bucket, items]) => (
                <div key={bucket} className="subsection">
                  {/* Subtítulo de FECHA }
                  <div className="subsection-title">
                    <span>{bucket}</span>
                    <span className="muted">{items.length}</span>
                    <span className="chev chev--sm">⌄</span>
                  </div>

                  {/* Grid de cards }
                  <div className="subsection-body">
                    <div className="orders-grid">
                      {items.map((p) => (
                        <a
                          key={p.id}
                          href={`/pedidos/${encodeURIComponent(p.id)}`}
                          className="card order-card card--selectable"
                        >
                          {/* Head: número + método }
                          <div className="order-head">
                            <div className="order-number">#{p.numero || p.id}</div>
                            <span className="pill pill--info">{p.metodoEntrega || "—"}</span>
                          </div>

                          {/* Body: 3 columnas en desktop }
                          <div className="order-body">
                            <div className="order-field">
                              <span className="order-label">Fecha (Finnegans)</span>
                              <span className="order-value">
                                {p.finFecha || "—"}
                              </span>
                            </div>
                            <div className="order-field">
                              <span className="order-label">Cliente</span>
                              <span className="order-value">{p.cliente || "—"}</span>
                            </div>
                            <div className="order-field">
                              <span className="order-label">Depósito</span>
                              <span className="order-value">{p.deposito || "—"}</span>
                            </div>
                            <div className="order-field">
                              <span className="order-label">Ítems</span>
                              <span className="order-value">{p.productos?.length ?? 0}</span>
                            </div>
                          </div>

                          {/* (Opcional) Acciones rápidas }
                          {/* <div className="order-actions">
                            <button className="btn btn--secondary btn-sm">Ver</button>
                          </div> }
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
  </div>
);

}

*/
import { useEffect, useMemo, useRef, useState } from "react";
import { listenPedidosByDeposito } from "../services/pedidosFS";
import { useApp } from "../../../context/AppContext";
import { useAuth } from "../../../context/AuthContext";
import { syncPendientesUltimaSemana } from "../services/syncFinnegans";

import SearchBar from "../components/SearchBar"; // ajusta el path según tu estructura
import { norm } from "utils/text";       // ajusta el path si lo guardaste en otro lugar


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

/* ---------------- componente ---------------- */

export default function PedidosPage() {
  const { depositoActual, metodoFiltro, setMetodoFiltro, toast } = useApp();
  const { user, profile, loading: authLoading } = useAuth();

  const [pedidos, setPedidos] = useState([]);
  const [loadingPedidos, setLoadingPedidos] = useState(true);

  // UI: secciones colapsables por bucket
  const [collapsedBuckets, setCollapsedBuckets] = useState(() => new Set());

  // Notificaciones por ESTADO (puntito rojo)
  const [stateHasNew, setStateHasNew] = useState({});

  // UI: secciones colapsables por estado
  const [collapsedStates, setCollapsedStates] = useState(() => new Set());

  const [q, setQ] = useState("");      // query de búsqueda
  const [debouncedQ, setDebouncedQ] = useState(""); // para debounce suave


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
      try { await syncPendientesUltimaSemana({ debug: true }); }
      catch (e) { console.error("[PedidosPage] sync auto error:", e); }
    })();
  }, [authLoading, user, profile]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(id);
  }, [q]);


  // listener a Firestore (por depósito y método)
  useEffect(() => {
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


  // agrupación por estado y buckets de fecha
  const grupos = useMemo(() => agruparPorEstadoYBucketFecha(pedidosFiltrados), [pedidosFiltrados]);

  // Estados ordenados y con total pre-calculado; se ocultan los que están vacíos
  const estadosOrdenados = useMemo(() => {
    const out = [];

    // primero los conocidos en el orden fijado
    for (const est of ESTADO_ORDER) {
      const porFecha = grupos[est];
      if (!porFecha) continue;
      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    // luego cualquier estado “extra” que pueda aparecer (al final)
    for (const est of Object.keys(grupos)) {
      if (ESTADO_ORDER.includes(est)) continue;
      const porFecha = grupos[est];
      const total = Object.values(porFecha).reduce((a, arr) => a + arr.length, 0);
      if (total > 0) out.push([est, porFecha, total]);
    }

    return out;
  }, [grupos]);


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
      return next;
    });
    // si lo abrís, lo marcamos como visto
    markEstadoSeen(estado);
  }


  /* --------- estilos inline mínimos para el puntito rojo --------- */
  const Dot = () => (
    <span
      className="notif-dot"
      style={{
        display: "inline-block",
        width: 12, height: 12, borderRadius: 9999,
        background: "#e11d48", marginLeft: 8
      }}
      aria-label="nuevos"
      title="Hay novedades"
    />
  );

  return (
    <div className="container">
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
                onClick={() => toggleEstado(estado)}
                style={{ cursor: "pointer" }}
              >
                <span>{estado}</span>
                <span className="muted">{totalEstado} pedidos</span>
                {hasNew && <Dot />}
                <span
                  className="chev chev--sm"
                  style={{
                    display: "inline-block",
                    transform: stateCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform .15s ease-in-out",
                    marginLeft: 8
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
                          onClick={() => toggleBucket(estado, bucket)}
                          style={{ cursor: "pointer" }}
                        >
                          <span>{bucket}</span>
                          <span className="muted">{items.length}</span>
                          <span
                            className="chev chev--sm"
                            style={{
                              display: "inline-block",
                              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                              transition: "transform .15s ease-in-out"
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
                                    <span className="pill pill--info">{p.metodoEntrega || "—"}</span>
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
                                    <div className="order-field">
                                      <span className="order-label">Ítems</span>
                                      <span className="order-value">{p.productos?.length ?? 0}</span>
                                    </div>
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
