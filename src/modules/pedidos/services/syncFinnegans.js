import { getPedidosPendientes } from "../../../API/finnegans";
import { upsertPedidoDesdeFinnegans, actualizarPedidosControladosADespachado, marcarAnuladosEnRango } from "./pedidosFS";
import { mapFinDocToPedido } from "./mapFinnegans";
import { getAuth, onAuthStateChanged } from "firebase/auth";

function toYMD(d) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 10);
}

// === Esperar a que Firebase tenga un usuario autenticado antes de correr cualquier sync ===
async function waitForAuthUser() {
  const auth = getAuth();
  if (auth.currentUser) return auth.currentUser;

  return await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user);
      }
    });
  });
}


// Helper interno para formatear a YYYY-MM-DD en tu TZ local
function ymdLocal(date = new Date()) {
  const tzFixed = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return tzFixed.toISOString().slice(0, 10);
}

// --- helpers chiquitos ---
function S(x) { return x == null ? "" : String(x).trim(); }
function N(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

// 👉 Nuevo helper: últimos N días en YYYY-MM-DD (local)
function lastNDaysRange(n = 7) {
  const hoy = new Date();
  const desde = new Date(); desde.setDate(hoy.getDate() - n);
  const fmt = (d) => {
    const tzFixed = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return tzFixed.toISOString().slice(0, 10);
  };
  return { fechaDesde: fmt(desde), fechaHasta: fmt(hoy) };
}

/**
 * Sync enfocada: trae pendientes SOLO del día de hoy.
 */
export async function syncPendientesDeHoy({ debug = false } = {}) {
    await waitForAuthUser();

    // --- ÚLTIMOS 5 DÍAS ---
    const hoy = new Date();
    const desde = new Date();
    desde.setDate(hoy.getDate() - 15); // últimos 15 días para detectar anulaciones

    const fechaDesde = toYMD(desde);
    const fechaHasta = toYMD(hoy);


  if (debug) console.log("[SYNC HOY] rango", { fechaDesde, fechaHasta });

  // Reutilizamos el core (ya agrupa por id y upsertea)
  const res = await syncNuevosPedidos({ fechaDesde, fechaHasta, debug });
  if (debug) console.log("[SYNC HOY] resumen", res);
  return res;
}


// 🔧 Mapea una fila (del reporte o de tu agregación) al payload que
// espera upsertPedidoFromSync({ numero, cliente, descripcion, deposito, metodoEntrega, productos })
export function mapRowToPedido(row) {
  // Numero de documento: distintos reportes usan nombres distintos
  const numero =
    row.DOCNROINT ||
    row.NUMERODOCUMENTO ||
    row.NumeroDocumento ||
    row.numero ||
    row.NOMBRE || // a veces viene "PEDVTA - 12739"
    "";

  const cliente =
    row.CLIENTE ||
    row.SOLICITANTE ||
    row.CLiente ||
    row.cliente ||
    "";

  // Algo descriptivo si no está la descripción literal
  const descripcion =
    row.DESCRIPCION ||
    row.TRANSACCIONSUBTIPONOMBRE ||
    row.descripcion ||
    "";

  const deposito =
    row.DEPOSITOORIGEN ||
    row.DEPOSITO ||
    row.Deposito ||
    row.deposito ||
    "";

  // Si no viene explícito, podés derivarlo de la descripción
  let metodoEntrega =
    row.METODOENTREGA ||
    row.metodoEntrega ||
    "";

  if (!metodoEntrega && /RETIRA/i.test(descripcion)) metodoEntrega = "RETIRA";
  if (!metodoEntrega && /AGENCIA/i.test(descripcion)) metodoEntrega = "AGENCIA";

  // Armar items: si el reporte viene desnormalizado (una fila por producto),
  // agregamos uno; si tu código anterior ya agrupó y puso items/Productos, lo usamos.
  const productos = [];

  if (Array.isArray(row.items) || Array.isArray(row.productos)) {
    const src = row.items || row.productos;
    for (const it of src) {
      productos.push({
        cod: S(it.ProductoCodigo || it.PRODUCTO || it.cod),
        cant: N(it.Cantidad || it.CANTIDAD || it.cant),
      });
    }
  } else if (row.PRODUCTO) {
    // fila “cruda” del reporte (una fila = un producto)
    productos.push({
      cod: S(row.PRODUCTO),
      cant: N(row.CANTIDAD),
    });
  }

  return {
    id: S(numero),     
    numero: S(numero),
    cliente: S(cliente),
    descripcion: S(descripcion),
    deposito: S(deposito),
    metodoEntrega: S(metodoEntrega),
    productos,
  };
}

/**
 * Sincroniza SOLO los pedidos de la fecha de hoy (mismo día para desde/hasta).
 * Usa el mismo flujo de syncNuevosPedidos.
 */
export async function syncPedidosDeHoy(pedidosFinnegans) {
  // Asegurar array por las dudas:
  const lista = Array.isArray(pedidosFinnegans)
    ? pedidosFinnegans
    : (Array.isArray(pedidosFinnegans?.data) ? pedidosFinnegans.data : []);

  if (!Array.isArray(lista)) {
    throw new Error("pedidosFinnegans no es array");
  }

  const resumen = { total: 0, created: 0, updated: 0, skipped: 0, permDenied: 0, otherErr: 0 };

  for (const p of lista) {
    try {
      const r = await upsertPedidoDesdeFinnegans(mapFinDocToPedido(p));
      resumen.total++;
      if (r.created) resumen.created++; else if (r.updated) resumen.updated++; else resumen.skipped++;
    } catch (err) {
      console.warn("[SYNC] upsert error", p?.NUMERO || p?.numero, err?.code, err?.message, { p });
      resumen.total++;
      if (err?.code === "permission-denied") resumen.permDenied++; else resumen.otherErr++;
    }
  }

  return resumen;
}

// Helpers para detectar claves de código/cantidad en items de productos
function getCodeKey(item) {
  const keys = ["cod", "codigo", "productCode", "ProductoCodigo", "productoCodigo"];
  return keys.find(k => k in item);
}
function getQtyKey(item) {
  const keys = ["cant", "cantidad", "qty", "Cantidad"];
  return keys.find(k => k in item);
}

/**
 * Trae filas del reporte, mapea, AGRUPA por pedido y upsertea una sola vez por pedido.
 * Mantiene la forma de `productos` que expone mapFinDocToPedido, acumulando cantidad por código.
 */
export async function syncNuevosPedidos({ fechaDesde, fechaHasta, debug = false } = {}) {
  await waitForAuthUser();


  // Defaults (no se usan si pasás fechas): últimos 30 días
  if (!fechaDesde || !fechaHasta) {
    const hoy = new Date();
    const desde = new Date(); desde.setDate(hoy.getDate() - 30);
    fechaDesde = fechaDesde || toYMD(desde);
    fechaHasta = fechaHasta || toYMD(hoy);
  }

  const crudos = await getPedidosPendientes({ fechaDesde, fechaHasta });
  const filas = Array.isArray(crudos) ? crudos : [];

  if (debug) {
    console.log("[SYNC] rango", { fechaDesde, fechaHasta, totalCrudo: filas.length });
  }

  // 1) Mapear y agrupar por pedido (id)
  const pedidosMap = new Map(); // id -> pedido acumulado

  for (const fin of filas) {
    const p = mapFinDocToPedido(fin);
    if (!p?.id) continue;

    // base del pedido (lo clonamos sin productos y acumulamos)
    if (!pedidosMap.has(p.id)) {
      const { productos, ...rest } = p;
      pedidosMap.set(p.id, {
        ...rest,                 // incluye clienteCodigo si el reporte lo trae
        productos: [],
        source: "finnegans",     // asegurar marca para reglas
      });
    }

    const acc = pedidosMap.get(p.id);
    // Cada fila suele traer 1 item
    const item = (p.productos && p.productos[0]) ? { ...p.productos[0] } : null;
    if (!item) continue;

    const codeKey = getCodeKey(item);
    const qtyKey  = getQtyKey(item);
    if (!codeKey || !qtyKey) {
      if (debug) console.warn("[SYNC] item sin code/qty esperados", item);
      continue;
    }

    // Buscar si ya existe en acumulado por el mismo código (misma key y valor)
    const idx = acc.productos.findIndex(x => {
      const k = getCodeKey(x);
      return k && x[k] === item[codeKey];
    });

    if (idx >= 0) {
      // sumamos cantidad respetando la key original de cantidad
      const kQty = getQtyKey(acc.productos[idx]) || qtyKey;
      acc.productos[idx][kQty] = Number(acc.productos[idx][kQty] || 0) + Number(item[qtyKey] || 0);
    } else {
      // empujamos el item con su forma original
      // normalizamos cantidad a número
      item[qtyKey] = Number(item[qtyKey] || 0);
      acc.productos.push(item);
    }
  }

  // 2) Upsert por pedido
  let created = 0, updated = 0, skipped = 0;
  let noId = 0, permDenied = 0, otherErr = 0;

  for (const pedido of pedidosMap.values()) {
    if (!pedido?.id) { noId++; skipped++; continue; }
    try {
      const res = await upsertPedidoDesdeFinnegans(pedido);
      if (res?.created) created++; else updated++;
    } catch (e) {
      const code = e?.code || e?.message || String(e);
      if ((code + "").includes("permission-denied")) permDenied++; else otherErr++;
      console.warn("[SYNC] upsert error", pedido.id, code, e);
      skipped++;
    }
  }

  const resumen = {
    fechaDesde,
    fechaHasta,
    total: pedidosMap.size, // cantidad de PEDIDOS únicos
    created,
    updated,
    skipped,
    breakdown: { noId, permDenied, otherErr },
    totalFilas: filas.length,
  };

  if (debug) console.log("[SYNC] resumen agrupado", resumen);

  function normalizeNumero(x) {
  return String(x)
    .replace(/\u00A0/g, " ")
    .replace(/^PEDVTA\s*-\s*/i, "") // quita prefijo "PEDVTA - "
    .trim();
  }

  const numerosFin = filas
    .map(f => (f.NUMERO || f.numero || f.NumeroDocumento || f.DOCNROINT || ""))
    .map(normalizeNumero)
    .filter(Boolean);

  await actualizarPedidosControladosADespachado(numerosFin);

  // Detectar pedidos PENDIENTE_ASIGNAR que ya no existen en Finnegans → marcar ANULADO
  // Usamos un Set con ambas formas del ID (con y sin prefijo "PEDVTA - ")
  const idsActivos = new Set();
  for (const id of pedidosMap.keys()) {
    idsActivos.add(id);
    idsActivos.add(id.replace(/^PEDVTA\s*-\s*/i, "").trim());
  }
  const fechaDesdeAnulacion = new Date();
  fechaDesdeAnulacion.setDate(fechaDesdeAnulacion.getDate() - 15);
  const anulados = await marcarAnuladosEnRango(idsActivos, fechaDesdeAnulacion);
  if (anulados > 0) console.log(`[SYNC] Pedidos anulados automáticamente: ${anulados}`);

  return { ...resumen, anulados };
}


