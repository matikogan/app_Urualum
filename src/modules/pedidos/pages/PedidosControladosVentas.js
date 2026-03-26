import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { norm } from "utils/text";
import SearchBar from "../components/SearchBar";

/* ===================== helpers de fecha ===================== */

function getPedidoDate(p) {
  if (p?.finFechaTS?.seconds) return new Date(p.finFechaTS.seconds * 1000);
  if (p?.finFecha) return new Date(`${p.finFecha}T00:00:00`);
  if (p?.timestamps?.creado?.seconds)
    return new Date(p.timestamps.creado.seconds * 1000);
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

const BUCKET_ORDER = ["HOY", "AYER", "ÚLTIMA SEMANA", "ÚLTIMO MES"];

function bucketLabelByDate(d) {
  if (!d) return "ÚLTIMO MES";
  const today = new Date();
  const diff = daysDiff(today, d);
  if (diff === 0) return "HOY";
  if (diff === 1) return "AYER";
  if (diff <= 7) return "ÚLTIMA SEMANA";
  return "ÚLTIMO MES";
}

/** { [estado]: { [bucket]: Pedido[] } } */
function agruparPorEstadoYBucketFecha(pedidos) {
  const out = {};
  for (const p of pedidos) {
    const estado = p?.estado || "CONTROLADO";
    const d = getPedidoDate(p);
    const bucket = bucketLabelByDate(d);

    if (!out[estado]) out[estado] = {};
    if (!out[estado][bucket]) out[estado][bucket] = [];
    out[estado][bucket].push(p);
  }

  // ordenamos buckets por BUCKET_ORDER y pedidos por fecha desc
  for (const estado of Object.keys(out)) {
    for (const bucket of Object.keys(out[estado])) {
      out[estado][bucket].sort((a, b) => {
        const da = getPedidoDate(a)?.getTime() ?? 0;
        const db = getPedidoDate(b)?.getTime() ?? 0;
        return db - da;
      });
    }
    const ordered = {};
    for (const key of BUCKET_ORDER) {
      if (out[estado][key]) ordered[key] = out[estado][key];
    }
    out[estado] = ordered;
  }

  return out;
}

/* ===================== helpers de pedidos ===================== */

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

const ESTADOS_VENTAS = ["CONTROLADO", "DESPACHADO"];

const LABEL_BUCKET = {
  HOY: "Hoy",
  "AYER": "Ayer",
  "ÚLTIMA SEMANA": "Última semana",
  "ÚLTIMO MES": "Último mes",
};

const LABEL_ESTADO = {
  CONTROLADO: "CONTROLADOS",
  DESPACHADO: "DESPACHADOS",
};

/* ===================== componente principal ===================== */

export default function PedidosControladosVentas() {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);

  // NUEVO: pedidos despachados HOY desde la colección pedidos_despachados
  const [despsHoy, setDespsHoy] = useState([]);


  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // colapsables
  const [collapsedStates, setCollapsedStates] = useState(() => new Set());
  const [collapsedBuckets, setCollapsedBuckets] = useState(() => new Set());

  /* ---------- listener Firestore ---------- */
  useEffect(() => {
    const ref = collection(db, "pedidos");
    // SOLO traer CONTROLADOS desde la colección pedidos
    const qy = query(ref, where("estado", "==", "CONTROLADO"));


    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        console.log("📦 CONTROLADOS desde colección pedidos:", list);
        setPedidos(list);
        setLoading(false);
      },
      (err) => {
        console.error("[Ventas] error escuchando pedidos:", err);
        setLoading(false);
      }
    );



    return () => unsub();
  }, []);

  /* ---------- listener a pedidos_despachados (solo HOY) ---------- */
  useEffect(() => {
    // inicio del día
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

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data(), estado: "DESPACHADO" }));
        console.log("🚚 DESPACHADOS HOY desde pedidos_despachados:", list);
        setDespsHoy(list);
      },
      (err) => {
        console.error("[Ventas] error escuchando pedidos_despachados:", err);
      }
    );



    return () => unsub();
  }, []);



  /* ---------- debounce de búsqueda ---------- */
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(id);
  }, [q]);

  /* ---------- filtro por búsqueda ---------- */
  const pedidosFiltrados = useMemo(() => {
    if (!debouncedQ) return pedidos;
    const nq = norm(debouncedQ);

    return pedidos.filter((p) => {
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

  /* ---------- normalize estado + agrupar ---------- */
  const pedidosEnriquecidos = useMemo(
    () =>
      (pedidosFiltrados || []).map((p) => {
        const estado = String(p.estado || "").toUpperCase();
        return { ...p, estado };
      }),
    [pedidosFiltrados]
  );

  const grupos = useMemo(
    () => agruparPorEstadoYBucketFecha(pedidosEnriquecidos),
    [pedidosEnriquecidos]
  );

  // → Inyectar DESPACHADOS HOY en los grupos
  const gruposConDesp = useMemo(() => {
    const g = { ...grupos };

    if (despsHoy.length > 0) {
      if (!g["DESPACHADO"]) g["DESPACHADO"] = {};
      g["DESPACHADO"]["HOY"] = despsHoy;
    }

    return g;
  }, [grupos, despsHoy]);


  const estadosOrdenados = useMemo(() => {
    const out = [];

    for (const est of ESTADOS_VENTAS) {
      const porFecha = gruposConDesp[est];
      if (!porFecha) continue;
      const total = Object.values(porFecha).reduce(
        (acc, arr) => acc + arr.length,
        0
      );
      if (total > 0) out.push([est, porFecha, total]);
    }

    return out;
  }, [gruposConDesp]);

  /* ===================== handlers UI ===================== */

  function toggleEstado(estado) {
    setCollapsedStates((prev) => {
      const next = new Set(prev);
      if (next.has(estado)) next.delete(estado);
      else next.add(estado);
      return next;
    });
  }

  function toggleBucket(estado, bucket) {
    const key = `${estado}::${bucket}`;
    setCollapsedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* ===================== render helpers ===================== */

  function renderCard(p) {
    return (
      <a
        key={p.id}
        href={`/ventas/para-despachar/${encodeURIComponent(p.id)}`}
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
    );
  }

  /* ===================== render ===================== */

  console.log("🔵 gruposConDesp:", gruposConDesp);
  console.log("🟢 estadosOrdenados:", estadosOrdenados);


  return (
    <div className="container">
      {/* encabezado simple para PC */}
      <div className="deck-head" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="deck-title">Listos para despachar</div>

        <a
          href="/ventas/despachados"
          className="btn btn--small"
          style={{ padding: "6px 12px", fontSize: 14 }}
        >
          Ver históricos
        </a>
      </div>


      {/* buscador igual al de pedidos.js */}
      <div className="mt-2" style={{ marginBottom: 16 }}>
        <SearchBar
          value={q}
          onChange={setQ}
          onClear={() => setQ("")}
          placeholder="Buscar por #PEDVTA, cliente, método o descripción…"
        />
      </div>

      {loading && (
        <div className="card card--compact empty-card">
          <div className="muted">Cargando pedidos…</div>
        </div>
      )}

      {!loading && estadosOrdenados.length === 0 && (
        <div className="card card--compact empty-card">
          <div className="muted">No hay pedidos para mostrar.</div>
        </div>
      )}

      {!loading &&
        estadosOrdenados.map(([estado, porFecha, totalEstado]) => {
          const stateClass = `state--${estado
            .toLowerCase()
            .replaceAll("_", "-")}`;
          const collapsedState = collapsedStates.has(estado);
          const labelEstado = LABEL_ESTADO[estado] || estado;
          
          return (
            <section
              key={estado}
              className={`section section--state ${stateClass}`}
            >
              {/* Título del estado, clickeable para colapsar */}
              <div
                className="section-title section-title--state"
                onClick={() => toggleEstado(estado)}
                style={{ cursor: "pointer" }}
              >
                <span className="state-label">{labelEstado}</span>
                <span className="state-count">{totalEstado}</span>
                <span
                  className="chev chev--sm"
                  style={{
                    display: "inline-block",
                    transform: collapsedState ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform .15s ease-in-out",
                    marginLeft: 8,
                  }}
                >
                  ⌄
                </span>
              </div>

              {/* Buckets por fecha */}
              {!collapsedState && (
                <div className="section-children">
                  {Object.entries(porFecha).map(([bucket, items]) => {
                    const key = `${estado}::${bucket}`;
                    const collapsedBucket = collapsedBuckets.has(key);
                    const labelBucket = LABEL_BUCKET[bucket] || bucket;

                    if (!items || items.length === 0) return null;

                    return (
                      <div key={bucket} className="subsection">
                        <div
                          className="subsection-title"
                          onClick={() => toggleBucket(estado, bucket)}
                          style={{ cursor: "pointer" }}
                        >
                          <span>{labelBucket}</span>
                          <span className="muted">{items.length}</span>
                          <span
                            className="chev chev--sm"
                            style={{
                              display: "inline-block",
                              transform: collapsedBucket
                                ? "rotate(-90deg)"
                                : "rotate(0deg)",
                              transition: "transform .15s ease-in-out",
                            }}
                          >
                            ⌄
                          </span>
                        </div>

                        {!collapsedBucket && (
                          <div className="subsection-body">
                            <div className="orders-grid">
                              {items.map((p) => renderCard(p))}
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
