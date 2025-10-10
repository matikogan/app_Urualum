import { useState } from "react";
import { getPedidosPendientes, getDespacho, getResumenStock } from "../API/finnegans";
import { useApp } from "../context/AppContext";
import { upsertPedidoDesdeFinnegans } from "../modules/pedidos/services/pedidosFS";
import { mapFinDocToPedido } from "../modules/pedidos/services/mapFinnegans";
import { last30DaysRange, today } from "../utils/dates";

export default function TestFinnegans() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadPendientesUltMes() {
    setLoading(true);
    try {
      const { fechaDesde, fechaHasta } = last30DaysRange();
      const res = await getPedidosPendientes({ fechaDesde, fechaHasta });
      setData({ fechaDesde, fechaHasta, data: res });
      toast.info(`Pendientes: ${fechaDesde} → ${fechaHasta}`);
    } catch (e) { toast.error(e.message || "Error obteniendo pendientes"); }
    finally { setLoading(false); }
  }

  async function syncAFirestoreUltMes() {
    setLoading(true);
    try {
      const { fechaDesde, fechaHasta } = last30DaysRange();
      const crudos = await getPedidosPendientes({ fechaDesde, fechaHasta });
      const lista = Array.isArray(crudos) ? crudos : [];
      let created = 0, updated = 0, skipped = 0;
      for (const fin of lista) {
        const p = mapFinDocToPedido(fin);
        if (!p?.id) { skipped++; continue; }
        const res = await upsertPedidoDesdeFinnegans(p);
        if (res?.created) created++; else updated++;
      }
      toast.success(`Sync último mes OK (${fechaDesde}→${fechaHasta}) — creados:${created} · actualizados:${updated} · omitidos:${skipped}`);
    } catch (e) { toast.error(e.message || "Error sincronizando"); }
    finally { setLoading(false); }
  }

  async function loadResumenStockHoy() {
    setLoading(true);
    try {
      const fecha = today();
      const res = await getResumenStock({ fecha });
      setData({ fecha, data: res });
      toast.info(`Stock de hoy: ${fecha}`);
    } catch (e) { toast.error(e.message || "Error Resumen Stock"); }
    finally { setLoading(false); }
  }

  async function loadDespacho() {
    setLoading(true);
    try {
      const res = await getDespacho({});
      setData(res);
    } catch (e) { toast.error(e.message || "Error GET Despacho"); }
    finally { setLoading(false); }
  }

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-2xl font-bold">Test Finnegans</h1>

      <div className="flex gap-2 flex-wrap">
        <button className="border px-3 py-1 rounded" onClick={loadPendientesUltMes} disabled={loading}>
          Pedidos (últ. 30 días)
        </button>
        <button className="border px-3 py-1 rounded" onClick={loadResumenStockHoy} disabled={loading}>
          Stock de hoy
        </button>
        <button className="border px-3 py-1 rounded" onClick={loadDespacho} disabled={loading}>
          GET Despacho
        </button>
        <button className="border px-3 py-1 rounded bg-blue-600 text-white" onClick={syncAFirestoreUltMes} disabled={loading}>
          {loading ? "Sincronizando…" : "Sincronizar último mes → Firestore"}
        </button>
      </div>

      {data && (
        <pre className="p-3 bg-black text-green-400 rounded overflow-auto text-xs">
{JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
