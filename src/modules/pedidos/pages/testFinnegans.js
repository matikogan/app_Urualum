import { useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../../../firebase";
import { getPedidosPendientes, getDespacho, getResumenStock } from "../../../API/finnegans";
import { useApp } from "../../../context/AppContext";
import { mapFinDocToPedido } from "../services/mapFinnegans";
import { syncNuevosPedidos } from "../services/syncFinnegans";
import { last30DaysRange, today } from "../../../utils/dates";

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
  const [data, setData]             = useState(null);
  const [camposData, setCamposData]  = useState(null);
  const [despachoData, setDespachoData] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [pedidoTestId, setPedidoTestId] = useState("PEDVTA - 18685");
  const [clienteRUTOverride, setClienteRUTOverride] = useState("");

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

  // ── Inspeccionar TODOS los campos de las primeras filas del reporte ──────
  async function inspectCamposDespacho() {
    setLoading(true);
    try {
      const { fechaDesde, fechaHasta } = last30DaysRange();
      const res = await getPedidosPendientes({ fechaDesde, fechaHasta });
      const filas = Array.isArray(res) ? res : [];
      if (filas.length === 0) { toast.error("No hay filas"); return; }

      // Todos los campos presentes en el reporte (unión de todas las claves de las primeras 10 filas)
      const todosCampos = [...new Set(filas.slice(0, 10).flatMap(f => Object.keys(f)))].sort();

      // Tomamos las primeras 2 filas para ver valores reales
      const muestra = filas.slice(0, 2).map((fila, i) => {
        const mapeado = mapFinDocToPedido(fila);
        // Todos los campos del reporte con sus valores
        const todosValores = {};
        todosCampos.forEach(k => { todosValores[k] = fila[k] ?? null; });
        return {
          fila: i + 1,
          pedidoId: mapeado?.id || "(sin id)",
          cliente: mapeado?.cliente,
          // Lo que guardamos en Firestore
          mapeado: {
            clienteCodigo:    mapeado?.clienteCodigo,
            clienteRUT:       mapeado?.clienteRUT,
            condicionPago:    mapeado?.condicionPago,
            condicionPagoCod: mapeado?.condicionPagoCod,
            cotizacion:       mapeado?.cotizacion,
            moneda:           mapeado?.moneda,
          },
          // TODOS los campos crudos del reporte
          todosCamposDisponibles: todosCampos,
          crudo: todosValores,
        };
      });

      setCamposData(muestra);
      setData(null);
      toast.success(`${todosCampos.length} campos disponibles en el reporte`);
    } catch (e) { toast.error(e.message || "Error"); }
    finally { setLoading(false); }
  }

  // Busca en Firestore un pedido que tenga clienteRUT y condicionPago completos
  async function autoSeleccionarPedido() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "pedidos"),
          where("clienteRUT", "!=", null),
          limit(20)
        )
      );
      const docs = snap.docs.map(d => d.data()).filter(d =>
        d.clienteRUT && d.productos?.length > 0 && d.deposito
      );
      if (docs.length === 0) {
        toast.error("No hay pedidos con datos completos. Hacé el sync primero.");
        return;
      }
      const elegido = docs[0];
      setPedidoTestId(elegido.id);
      toast.success(`Pedido seleccionado: ${elegido.id} | Cliente: ${elegido.cliente} | RUT: ${elegido.clienteRUT}`);
    } catch (e) {
      toast.error(e.message || "Error buscando pedido");
    } finally {
      setLoading(false);
    }
  }

  async function syncAFirestore(dias = 7) {
    setLoading(true);
    try {
      const hoy = new Date();
      const desde = new Date(); desde.setDate(hoy.getDate() - dias);
      const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const fechaDesde = fmt(desde);
      const fechaHasta = fmt(hoy);
      toast.info(`Sincronizando últimos ${dias} días (${fechaDesde} → ${fechaHasta})…`);
      const res = await syncNuevosPedidos({ fechaDesde, fechaHasta, debug: true });
      toast.success(
        `Sync OK — ${res.total} pedidos | +${res.created} creados | ↺${res.updated} actualizados | ⊘${res.skipped} omitidos`
      );
    } catch (e) {
      console.error("[SYNC] error:", e);
      toast.error(e.message || "Error sincronizando");
    } finally {
      setLoading(false);
    }
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

  // ── NUEVO: probar Cloud Function despacharEnFinnegans (modoTest=true) ──
  async function testDespacharCF() {
    setLoading(true);
    try {
      const functions = getFunctions(undefined, "us-central1");
      const despachar = httpsCallable(functions, "despacharEnFinnegans");
      const payload = { pedidoId: pedidoTestId.trim(), modoTest: true };
      if (clienteRUTOverride.trim()) payload.clienteRUTOverride = clienteRUTOverride.trim();
      const result = await despachar(payload);
      setDespachoData(result.data);
      setCamposData(null);
      setData(null);
      toast.success("Payload generado (modoTest) — revisá el resultado");
    } catch (e) {
      console.error(e);
      toast.error(e.message || "Error llamando Cloud Function");
      setDespachoData({ error: e.message });
    } finally {
      setLoading(false);
    }
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

      {/* ── Test Cloud Function despacho ── */}
      <div className="border-2 border-orange-400 rounded p-3 space-y-2">
        <p className="font-bold text-orange-700">🚀 Test Cloud Function — despacharEnFinnegans (modoTest)</p>
        <p className="text-xs text-gray-500">Genera el payload completo sin enviarlo a Finnegans. Verificá que los datos sean correctos.</p>
        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-2 py-1 text-sm flex-1"
            value={pedidoTestId}
            onChange={e => setPedidoTestId(e.target.value)}
            placeholder="ID pedido (ej: PEDVTA - 18672)"
          />
          <button
            className="border px-2 py-1 rounded bg-gray-500 text-white text-xs"
            onClick={autoSeleccionarPedido}
            disabled={loading}
            title="Busca en Firestore un pedido con datos completos"
          >
            🎯 Auto
          </button>
          <button
            className="border px-3 py-1 rounded bg-orange-500 text-white font-bold"
            onClick={testDespacharCF}
            disabled={loading}
          >
            {loading ? "Llamando…" : "▶ Generar payload (modoTest)"}
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-gray-500">RUT override (opcional):</span>
          <input
            className="border rounded px-2 py-1 text-sm w-40"
            value={clienteRUTOverride}
            onChange={e => setClienteRUTOverride(e.target.value)}
            placeholder="ej: 41893519"
          />
          <span className="text-xs text-gray-400">Si el pedido no tiene RUT en Firestore, ingresalo acá para el test</span>
        </div>
        {despachoData && (
          <pre className="p-3 bg-gray-900 text-green-400 rounded overflow-auto text-xs">
{JSON.stringify(despachoData, null, 2)}
          </pre>
        )}
      </div>

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
        <button className="border px-3 py-1 rounded bg-blue-500 text-white" onClick={() => syncAFirestore(7)} disabled={loading}>
          {loading ? "Sincronizando…" : "⚡ Sync 7 días → Firestore"}
        </button>
        <button className="border px-3 py-1 rounded bg-blue-700 text-white" onClick={() => syncAFirestore(30)} disabled={loading}>
          {loading ? "Sincronizando…" : "Sync 30 días → Firestore"}
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
