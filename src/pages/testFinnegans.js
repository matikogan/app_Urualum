import { useState } from "react";
import { useApp } from "../context/AppContext";
import {
  getPedidosPendientesSafe,
  getResumenStockSafe,
  getDespachoSafe
} from "../API/fin-safe";
import { upsertPedidoDesdeFinnegans } from "../modules/pedidos/services/pedidosFS";
import { mapFinDocToPedido } from "../modules/pedidos/services/mapFinnegans";
// 1) Arriba de todo, junto al resto de imports:
import { getAuth } from "firebase/auth";
import { syncNuevosPedidos, syncPedidosDeHoy } from "../modules/pedidos/services/syncFinnegans";

// helpers visuales
function toYMD(d = new Date()) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString();
  return iso.slice(0,10);
}
function last30Days() {
  const hoy = new Date();
  const desde = new Date(); desde.setDate(hoy.getDate() - 30);
  const fmt = (x)=>toYMD(x);
  return { fechaDesde: fmt(desde), fechaHasta: fmt(hoy) };
}

export default function TestFinnegans() {
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function showError(e, fallbackMsg) {
    const message = e?.message || e?.response?.data || JSON.stringify(e, null, 2) || fallbackMsg;
    console.error("[Finnegans ERROR]", e);
    setError(String(message));
    toast?.error?.(String(message));
  }

  async function loadPendientesUltMes() {
    setLoading(true); setError(null);
    try {
      const range = last30Days();
      const res = await getPedidosPendientesSafe(range);
      setData({ range, data: res });
    } catch (e) { showError(e, "Error obteniendo pendientes"); }
    finally { setLoading(false); }
  }

  async function syncAFirestoreUltMes() {
  setLoading(true); setError(null);
  try {
    const res = await syncNuevosPedidos({ debug: true });
    const { created, updated, skipped, total, breakdown } = res;
    alert(
      `Sync OK (${res.fechaDesde}→${res.fechaHasta})\n` +
      `total:${total} — creados:${created} · actualizados:${updated} · omitidos:${skipped}\n` +
      `causas: sinId=${breakdown.noId} · permiso=${breakdown.permDenied} · otros=${breakdown.otherErr}\n` +
      `Revisá consola para ver ejemplos (samples).`
    );
    // Deja el resultado visible abajo también
    setData(res);
  } catch (e) {
    console.error("[SYNC] ERROR", e);
    alert("Error: " + (e?.message || "desconocido"));
  } finally {
    setLoading(false);
  }
}

async function syncSoloHoy() {
  setLoading(true); setError(null);
  try {
    const res = await syncPedidosDeHoy();
    const { created, updated, skipped, total, breakdown } = res;
    alert(
      `Sync HOY — total:${total} · creados:${created} · actualizados:${updated} · omitidos:${skipped}\n` +
      `causas → sinId:${breakdown.noId} · permiso:${breakdown.permDenied} · otros:${breakdown.otherErr}\n` +
      `Mirá consola para samples.`
    );
    setData(res);
  } catch (e) {
    console.error("[SYNC HOY] ERROR", e);
    alert("Error: " + (e?.message || "desconocido"));
  } finally {
    setLoading(false);
  }
}

  async function loadResumenStockHoy() {
    setLoading(true); setError(null);
    try {
      const fecha = toYMD(new Date());
      const res = await getResumenStockSafe({ fecha });
      setData({ fecha, data: res });
    } catch (e) { showError(e, "Error Resumen Stock"); }
    finally { setLoading(false); }
  }

  async function loadDespacho() {
    setLoading(true); setError(null);
    try {
      const res = await getDespachoSafe({});
      setData(res);
    } catch (e) { showError(e, "Error GET Despacho"); }
    finally { setLoading(false); }
  }

  

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-2xl font-bold">Test Finnegans</h1>

      <div className="flex gap-2 flex-wrap">
        <button
          className="border px-3 py-1 rounded bg-emerald-600 text-white"
          onClick={() => {
            const uid = getAuth().currentUser?.uid || "(sin sesión)";
            console.log("[DEBUG UID]", uid);
            alert("UID actual: " + uid);
          }}
        >
          Ver UID actual
        </button>
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
        <button
          className="border px-3 py-1 rounded bg-blue-700 text-white"
          onClick={syncSoloHoy}
          disabled={loading}
        >
          Sincronizar HOY → Firestore
        </button>
      </div>

      {error && (
        <pre className="p-3 bg-red-900 text-red-100 rounded overflow-auto text-xs">
{String(error)}
        </pre>
      )}

      {data && (
        <pre className="p-3 bg-black text-green-400 rounded overflow-auto text-xs">
{JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
