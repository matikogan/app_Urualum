import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useApp } from "../../../context/AppContext";
import { fetchErroresPreparacion } from "../services/erroresFS";

// util formateos breves
const fmtDateTime = (ts) => {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    return d.toLocaleString();
  } catch { return "—"; }
};

export default function ErroresPreparacionPage() {
  const { toast } = useApp();
  const { profile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);

  // Filtros
  const [deposito, setDeposito] = useState(profile?.deposito || "");
  const [operarioUid, setOperarioUid] = useState("");
  const [desde, setDesde] = useState(() => {
    // viernes review: por defecto últimos 7 días
    const t = new Date(); t.setDate(t.getDate() - 7); t.setHours(0,0,0,0);
    return t.toISOString().slice(0,16); // <input type="datetime-local">
  });
  const [hasta, setHasta] = useState(() => {
    const t = new Date(); t.setHours(23,59,59,999);
    return t.toISOString().slice(0,16);
  });

  async function load(reset = true) {
    try {
      setLoading(true);
      const params = {
        deposito: deposito || undefined,
        operarioUid: operarioUid || undefined,
        desde: desde ? new Date(desde) : undefined,
        hasta: hasta ? new Date(hasta) : undefined,
        pageSize: 25,
        cursor: reset ? null : nextCursor
      };
      const { items: page, nextCursor: nc } = await fetchErroresPreparacion(params);
      setItems(prev => reset ? page : [...prev, ...page]);
      setNextCursor(nc);
    } catch (e) {
      console.error(e);
      toast.error("No se pudieron cargar los errores. Verifica tu conexión.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(true); /* auto load 1ra vez */ }, []); // eslint-disable-line

  const kpis = useMemo(() => {
    const total = items.length;
    const porOperario = {};
    for (const it of items) {
      const k = it.responsableNombre || it.responsableUid || "—";
      porOperario[k] = (porOperario[k] || 0) + 1;
    }
    // top 3
    const top = Object.entries(porOperario)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(([k,v]) => ({ nombre:k, count:v }));
    return { total, top };
  }, [items]);

  function exportCSV() {
    const header = [
      "fechaReporte","deposito","responsableNombre","responsableUid",
      "pedidoId","numero","cliente","metodoEntrega","estadoPedido","detalle"
    ];
    const rows = items.map(it => ([
      fmtDateTime(it.fechaReporte), it.deposito || "", it.responsableNombre || "",
      it.responsableUid || "", it.pedidoId || "", it.numero || "", it.cliente || "",
      it.metodoEntrega || "", it.estadoPedido || "", (it.detalle || "").replace(/\n/g," ")
    ]));
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `errores_preparacion_${Date.now()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div className="p-3 space-y-4">
      <h1 className="font-bold text-xl">Errores de preparación</h1>

      {/* Filtros */}
      <div className="card">
        <div className="subsection-title"><span>Filtros</span></div>
        <div className="subsection-body grid gap-3 md:grid-cols-2">
          <div className="order-field">
            <span className="order-label">Depósito</span>
            <input className="w-full border rounded px-3 py-2"
              placeholder="R8 / Isabela / …"
              value={deposito} onChange={e=>setDeposito(e.target.value)} />
          </div>
          <div className="order-field">
            <span className="order-label">Operario (UID)</span>
            <input className="w-full border rounded px-3 py-2"
              placeholder="uid del operario (opcional)"
              value={operarioUid} onChange={e=>setOperarioUid(e.target.value)} />
          </div>
          <div className="order-field">
            <span className="order-label">Desde</span>
            <input type="datetime-local" className="w-full border rounded px-3 py-2"
              value={desde} onChange={e=>setDesde(e.target.value)} />
          </div>
          <div className="order-field">
            <span className="order-label">Hasta</span>
            <input type="datetime-local" className="w-full border rounded px-3 py-2"
              value={hasta} onChange={e=>setHasta(e.target.value)} />
          </div>

          <div className="md:col-span-2 flex gap-2">
            <button className="btn btn--outline flex-1" onClick={()=>load(true)} disabled={loading}>Aplicar</button>
            <button className="btn flex-1 bg-black text-white" onClick={exportCSV}>Exportar CSV</button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card"><div className="order-body"><div className="order-label">Total errores</div><div className="text-2xl font-bold">{kpis.total}</div></div></div>
        <div className="card"><div className="order-body"><div className="order-label">Top operarios (por cantidad)</div>
          <ul className="text-sm mt-1">{kpis.top.map(t => <li key={t.nombre}>{t.nombre}: <b>{t.count}</b></li>)}</ul>
        </div></div>
      </div>

      {/* Tabla / lista */}
      <div className="card">
        <div className="subsection-title"><span>Registros</span><span className="muted">{items.length}</span></div>
        <div className="subsection-body space-y-2">
          {items.length === 0 && <div className="muted">Sin resultados</div>}

          {items.map(it => (
            <div key={it.id} className="card">
              <div className="order-body">
                <div className="flex items-center gap-2">
                  <span className="pill">{it.deposito || "—"}</span>
                  <span className="pill">{it.responsableNombre || "—"}</span>
                  <span className="muted ml-auto">{fmtDateTime(it.fechaReporte)}</span>
                </div>
                <div className="mt-1 text-sm">
                  <div><b>Pedido:</b> {it.numero || it.pedidoId || "—"} — <b>Cliente:</b> {it.cliente || "—"}</div>
                  <div><b>Método:</b> {it.metodoEntrega || "—"} — <b>Estado al reportar:</b> {it.estadoPedido || "—"}</div>
                </div>
                <div className="mt-2 whitespace-pre-wrap">{it.detalle || "—"}</div>
              </div>
            </div>
          ))}

          {nextCursor && (
            <button className="btn w-full" disabled={loading} onClick={()=>load(false)}>
              {loading ? "Cargando…" : "Cargar más"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
