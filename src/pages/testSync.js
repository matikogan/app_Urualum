import { useState } from "react";
import { useApp } from "../context/AppContext";
import { getPedidosPendientes } from "../API/finnegans";
import { mapFinDocToPedido } from "../modules/pedidos/services/mapFinnegans";
import { upsertPedidoDesdeFinnegans } from "../modules/pedidos/services/pedidosFS";
import { syncPendientesDeHoy} from "../modules/pedidos/services/syncFinnegans";

// helpers
function toYMD(d = new Date()) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString();
  return iso.slice(0,10);
}
function last7Days() {
  const hoy = new Date();
  const desde = new Date(); desde.setDate(hoy.getDate() - 7);
  return { fechaDesde: toYMD(desde), fechaHasta: toYMD(hoy) };
}

// === FECHAS ===
export function rangeHoy() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  // Finnegans usa "DD-MM-YYYY" (vimos "30-09-2025" en consola)
  const fecha = `${d}-${m}-${y}`;
  return { desde: fecha, hasta: fecha };
}


export default function TestSyncPage() {
  const { toast } = useApp();
  const [rawRows, setRawRows] = useState([]);
  const [mapped, setMapped] = useState([]);
  const [grouped, setGrouped] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  async function step1_fetchRaw() {
  setLoading(true);
  try {
    const range = last7Days();
    const rows = await getPedidosPendientes(range);

    // 👇 DIAGNÓSTICO: inspección de fechas (usa *rows* ya declarado)
    ;(function inspectDates(rowsLocal) {
      const sample = (rowsLocal || []).slice(0, 5);
      console.group("[TEST-SYNC] inspección de fechas (primeras 5 filas)");

      // 1) listar todas las claves que aparecen
      const keySet = new Set();
      sample.forEach(r => Object.keys(r || {}).forEach(k => keySet.add(k)));
      console.log("Claves encontradas:", Array.from(keySet).sort());

      // 2) candidatos a fecha por fila (por nombre o por formato del valor)
      const dateLike = (v) => {
        if (typeof v === "string") {
          return (
            /^\d{4}-\d{2}-\d{2}/.test(v) ||        // yyyy-mm-dd
            /^\d{2}\/\d{2}\/\d{4}/.test(v) ||      // dd/mm/yyyy
            /^\/Date\(\d+\)\/$/.test(v) ||         // /Date(…)/ .NET
            /^\d{8}$/.test(v) ||                   // yyyymmdd
            /^\d{4}-\d{2}-\d{2}T/.test(v)          // ISO con T
          );
        }
        if (typeof v === "number") {
          // epoch razonable (2001–2100)
          return v > 978307200000 && v < 4102444800000;
        }
        return false;
      };

      sample.forEach((row, i) => {
        const candidates = Object.entries(row || {})
          .filter(([k, v]) => dateLike(v) || /fecha/i.test(k))
          .map(([k, v]) => [k, v]);
        console.log(`Fila #${i + 1} candidatos:`, candidates);
      });

      console.groupEnd();
    })(rows);
    // ☝️ fin diagnóstico

    setRawRows(Array.isArray(rows) ? rows : []);
    setMapped([]);
    setGrouped([]);
    setSummary(null);

    toast.info(`Finnegans OK — filas: ${rows.length}`);
    console.log("[TEST-SYNC] raw sample", rows[0]);
  } catch (e) {
    console.error(e);
    toast.error(e.message || "Error traer Finnegans");
  } finally {
    setLoading(false);
  }
}


function step2_map() {
  // 1) mapear primero
  const mappedRows = rawRows.map(mapFinDocToPedido).filter(Boolean);

  // 2) diagnósticos (opcionales)
  // si querés comparar contra tu depósito actual, guardalo en window.__DEP__ desde AppContext,
  // o reemplazá (window.__DEP__ || "") por el valor que quieras.
  const sinDeposito  = mappedRows.filter(p => !p.deposito).length;
  const depDistinto  = mappedRows.filter(
    p => p.deposito && p.deposito !== (window.__DEP__ || "")
  ).length;
  console.log("[TEST-SYNC] sinDeposito:", sinDeposito, "dep distinto:", depDistinto);

  // 3) setear estados
  setMapped(mappedRows);
  setGrouped([]);
  setSummary(null);

  // 4) feedback
  const noId = mappedRows.filter(x => !x.id).length;
  toast.info(`Mapeados: ${mappedRows.length} (sin id: ${noId})`);
  console.log("[TEST-SYNC] mapped sample", mappedRows[0]);
}

  



  function step3_group() {
    const acc = new Map();
    for (const p of mapped) {
      if (!p?.id) continue;
      if (!acc.has(p.id)) {
        const { productos, ...rest } = p;
        acc.set(p.id, { ...rest, productos: [] });
      }
      const it = (p.productos && p.productos[0]) || null;
      if (!it) continue;
      const idx = acc.get(p.id).productos.findIndex(x => x.cod === it.cod);
      if (idx >= 0) {
        acc.get(p.id).productos[idx].cant = Number(acc.get(p.id).productos[idx].cant || 0) + Number(it.cant || 0);
      } else {
        acc.get(p.id).productos.push({ cod: it.cod, cant: Number(it.cant || 0) });
      }
    }
    const list = Array.from(acc.values());
    setGrouped(list);
    setSummary({ pedidosUnicos: list.length, filas: mapped.length });
    toast.success(`Agrupados: ${list.length} pedidos únicos (desde ${mapped.length} filas)`);
    console.log("[TEST-SYNC] grouped sample", list[0]);
  }

  async function step4_commit() {
    if (!grouped.length) return toast.error("Nada para sincronizar");
    setLoading(true);
    let created = 0, updated = 0, skipped = 0, permDenied = 0, otherErr = 0;
    for (const p of grouped) {
      try {
        const res = await upsertPedidoDesdeFinnegans(p);
        if (res?.created) created++; else updated++;
      } catch (e) {
        const code = (e?.code || e?.message || "").toString().toLowerCase();
        if (code.includes("permission")) permDenied++; else otherErr++;
        skipped++;
        console.warn("[TEST-SYNC] upsert error", p.id, code);
      }
    }
    setSummary(s => ({ ...(s||{}), created, updated, skipped, permDenied, otherErr }));
    setLoading(false);
    toast.success(`Sync OK — creados:${created} · actualizados:${updated} · omitidos:${skipped}`);
  }

  async function stepAll_oneClick() {
    setLoading(true);
    try {
      const res = await syncPendientesDeHoy({ debug: true });
      setSummary(res);
      toast.success(
        `7 días → total:${res.total} · creados:${res.created} · actualizados:${res.updated} · omitidos:${res.skipped}`
      );
    } catch (e) {
      console.error(e); toast.error(e?.message || "Error sync 7d");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <h1 className="text-xl font-bold">Test Sync — Finnegans → Firestore</h1>

      <div className="flex gap-2 flex-wrap">
        <button className="border px-3 py-1 rounded" onClick={step1_fetchRaw} disabled={loading}>
          1) Traer Finnegans (7d)
        </button>
        <button className="border px-3 py-1 rounded" onClick={step2_map} disabled={loading || !rawRows.length}>
          2) Mapear a pedido
        </button>
        <button className="border px-3 py-1 rounded" onClick={step3_group} disabled={loading || !mapped.length}>
          3) Agrupar por pedido
        </button>
        <button className="border px-3 py-1 rounded bg-blue-600 text-white"
          onClick={step4_commit} disabled={loading || !grouped.length}>
          4) Upsert (conservar estado)
        </button>

        <button className="border px-3 py-1 rounded bg-emerald-600 text-white"
          onClick={stepAll_oneClick} disabled={loading}>
          🔁 Todo en 1 (7d)
        </button>
      </div>

      {summary && (
        <pre className="p-3 bg-black text-green-400 rounded overflow-auto text-xs">
{JSON.stringify(summary, null, 2)}
        </pre>
      )}

      {!!rawRows.length && (
        <details>
          <summary className="cursor-pointer">Raw (first 2)</summary>
          <pre className="p-3 bg-gray-900 text-gray-100 rounded overflow-auto text-xs">
{JSON.stringify(rawRows.slice(0,2), null, 2)}
          </pre>
        </details>
      )}
      {!!mapped.length && (
        <details>
          <summary className="cursor-pointer">Mapped (first 2)</summary>
          <pre className="p-3 bg-gray-900 text-gray-100 rounded overflow-auto text-xs">
{JSON.stringify(mapped.slice(0,2), null, 2)}
          </pre>
        </details>
      )}
      {!!grouped.length && (
        <details>
          <summary className="cursor-pointer">Grouped (first 2)</summary>
          <pre className="p-3 bg-gray-900 text-gray-100 rounded overflow-auto text-xs">
{JSON.stringify(grouped.slice(0,2), null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
