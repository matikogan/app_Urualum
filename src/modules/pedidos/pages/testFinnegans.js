import { useState } from "react";
import { getPedidosPendientes, getDespacho, getResumenStock } from "../API/finnegans";
import { useApp } from "../context/AppContext";
import { upsertPedidoDesdeFinnegans } from "../modules/pedidos/services/pedidosFS";
import { mapFinDocToPedido } from "../modules/pedidos/services/mapFinnegans";
import { last30DaysRange, today } from "../utils/dates";

// Campos relevantes para el despacho — queremos verificar que llegan
const CAMPOS_DESPACHO = [
  "DOCNROINT", "IDENTIFICACIONEXTERNA",
  "CLIENTE", "NRODEIDENTIFICACION",
  "CONDICIONPAGO", "CONDICIONPAGOCODIGO",
  "PRODUCTO", "CANTIDAD",
  "PRECIO", "PRECIOMONSECUNDARIA", "PRECIOMONPRINCIPAL",
  "IMPORTEMONSECUNDARIA", "IMPORTEMONPRINCIPAL",
  "COTIZACION", "MONEDA",
  "DEPOSITOORIGEN", "DEPOSITODESTINO",
];

export default function TestFinnegans() {
  const { toast } = useApp();
  const [data, setData]           = useState(null);
  const [camposData, setCamposData] = useState(null);
  const [loading, setLoading]     = useState(false);

  async function loadPendientesUltMes() {
    setLoading(true);
    try {
      const { fechaDesde, fechaHasta } = last30DaysRange();
      const res = await getPedidosPendientes({ fechaDesde, fechaHasta });
      setData({ fechaDesde, fechaHasta, data: res });
      setCamposData(null);
      toast.info(`Pendientes: ${fechaDesde} → ${fechaHasta}`);
    } catch (e) { toast.error(e.message || "Error obteniendo pendientes"); }
    finally { setLoading(false); }
  }

  // ── NUEVO: inspeccionar campos de despacho en la primera fila real ──────
  async function inspectCamposDespacho() {
    setLoading(true);
    try {
      const { fechaDesde, fechaHasta } = last30DaysRange();
      const res = await getPedidosPendientes({ fechaDesde, fechaHasta });
      const filas = Array.isArray(res) ? res : [];
      if (filas.length === 0) { toast.error("No hay filas"); return; }

      // Tomamos las primeras 3 filas distintas para comparar
      const muestra = filas.slice(0, 3).map((fila, i) => {
        const mapeado = mapFinDocToPedido(fila);
        const camposRaw = {};
        CAMPOS_DESPACHO.forEach(k => {
          camposRaw[k] = fila[k] ?? "(ausente)";
        });
        return {
          fila: i + 1,
          pedidoId: mapeado?.id || "(sin id)",
          cliente: mapeado?.cliente,
          // Campos mapeados (lo que guardamos en Firestore)
          mapeado: {
            clienteRUT:       mapeado?.clienteRUT,
            condicionPago:    mapeado?.condicionPago,
            condicionPagoCod: mapeado?.condicionPagoCod,
            cotizacion:       mapeado?.cotizacion,
            moneda:           mapeado?.moneda,
            productos:        mapeado?.productos,
          },
          // Campos crudos de Finnegans
          crudo: camposRaw,
        };
      });

      setCamposData(muestra);
      setData(null);
      toast.success(`Muestra de ${muestra.length} filas lista`);
    } catch (e) { toast.error(e.message || "Error"); }
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
      toast.success(`Sync OK (${fechaDesde}→${fechaHasta}) — creados:${created} · actualizados:${updated} · omitidos:${skipped}`);
    } catch (e) { toast.error(e.message || "Error sincronizando"); }
    finally { setLoading(false); }
  }

  async function loadResumenStockHoy() {
    setLoading(true);
    try {
      const fecha = today();
      const res = await getResumenStock({ fecha });
      setData({ fecha, data: res });
      setCamposData(null);
    } catch (e) { toast.error(e.message || "Error Resumen Stock"); }
    finally { setLoading(false); }
  }

  async function loadDespacho() {
    setLoading(true);
    try {
      const res = await getDespacho({});
      setData(res);
      setCamposData(null);
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
        <button
          className="border px-3 py-1 rounded bg-yellow-500 text-white font-bold"
          onClick={inspectCamposDespacho}
          disabled={loading}
        >
          🔍 Inspeccionar campos despacho
        </button>
        <button className="border px-3 py-1 rounded bg-blue-600 text-white" onClick={syncAFirestoreUltMes} disabled={loading}>
          {loading ? "Sincronizando…" : "Sincronizar último mes → Firestore"}
        </button>
      </div>

      {/* ── Vista especial campos despacho ── */}
      {camposData && (
        <div className="space-y-4">
          <h2 className="font-bold text-lg">Campos relevantes para despacho (primeras 3 filas)</h2>
          {camposData.map((f) => (
            <div key={f.fila} className="border rounded p-3 space-y-2">
              <p className="font-bold text-sm">Fila {f.fila} — {f.pedidoId} — {f.cliente}</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1">CAMPOS CRUDOS (Finnegans)</p>
                  <table className="text-xs w-full">
                    <tbody>
                      {Object.entries(f.crudo).map(([k, v]) => (
                        <tr key={k} className={v === "(ausente)" ? "text-red-400" : "text-green-700"}>
                          <td className="pr-2 font-mono font-bold">{k}</td>
                          <td>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-1">MAPEADO → FIRESTORE</p>
                  <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto">
                    {JSON.stringify(f.mapeado, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <pre className="p-3 bg-black text-green-400 rounded overflow-auto text-xs">
{JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
