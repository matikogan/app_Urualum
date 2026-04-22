import { getPedidosPendientes } from "../../../API/finnegans";
import { upsertPedidoDesdeFinnegans } from "./pedidosFS";
import { mapFinDocToPedido } from "./mapFinnegans";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where, getDoc, doc } from "firebase/firestore";
import { db } from "../../../firebase";

/** Lee el número de días hacia atrás configurado por el admin (default 15). */
async function getSyncDiasAtras() {
  try {
    const snap = await getDoc(doc(db, "config", "sync"));
    if (snap.exists()) return snap.data().diasAtras ?? 15;
  } catch { /* usa default */ }
  return 15;
}

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

    // Lee la cantidad de días configurada por el admin (o usa 15 como default)
    const diasAtras = await getSyncDiasAtras();

    const hoy = new Date();
    const desde = new Date();
    desde.setDate(hoy.getDate() - diasAtras);

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

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-ASIGNACIÓN DE CAMIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dado un pedido con { camionDestino, camionFechaStr, deposito } y la lista
 * de camiones disponibles para ese depósito, intenta encontrar el camión
 * más adecuado.
 *
 * Estrategia (por orden de prioridad):
 *  1. Coincidencia exacta de fecha (camionFechaStr == fechaSalida del camión)
 *  2. Coincidencia de destino/descripción (camionDestino ⊂ descripcion del camión)
 *  3. Si solo hay un camión futuro para ese depósito → lo asigna
 *
 * Solo considera camiones cuya fechaSalida sea >= ayer (1 día de tolerancia).
 */
function resolverCamionId(pedido, camiones) {
  if (!camiones.length) return null;

  const normalize = s =>
    String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().trim();

  // Filtrar candidatos: fechaSalida >= ayer
  const ayer = Date.now() - 24 * 60 * 60 * 1000;
  const candidatos = camiones.filter(c => {
    const ms = c.fechaSalida?.seconds ? c.fechaSalida.seconds * 1000 : 0;
    return ms >= ayer;
  });
  if (!candidatos.length) return null;

  // Ordenar por fecha más próxima primero
  candidatos.sort((a, b) => (a.fechaSalida?.seconds || 0) - (b.fechaSalida?.seconds || 0));

  // 1) Match por fecha exacta
  if (pedido.camionFechaStr) {
    const porFecha = candidatos.find(c => {
      if (!c.fechaSalida?.seconds) return false;
      const d = new Date(c.fechaSalida.seconds * 1000);
      const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      return ymd === pedido.camionFechaStr;
    });
    if (porFecha) return porFecha.id;
  }

  // 2) Match por destino (texto en descripcion del camión)
  if (pedido.camionDestino) {
    const destNorm = normalize(pedido.camionDestino);
    const porDest = candidatos.find(c => {
      const cDesc = normalize(c.descripcion);
      return cDesc.includes(destNorm) || destNorm.includes(cDesc);
    });
    if (porDest) return porDest.id;
  }

  // 3) Si hay un único camión futuro → asignarlo directamente
  if (candidatos.length === 1) return candidatos[0].id;

  return null;
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

    // Campos de nivel pedido: tomamos de la primera fila que los tenga
    if (!acc.clienteRUT      && p.clienteRUT)      acc.clienteRUT      = p.clienteRUT;
    if (!acc.condicionPago   && p.condicionPago)   acc.condicionPago   = p.condicionPago;
    if (!acc.condicionPagoCod && p.condicionPagoCod) acc.condicionPagoCod = p.condicionPagoCod;
    if (!acc.cotizacion      && p.cotizacion)      acc.cotizacion      = p.cotizacion;
    if (!acc.moneda          && p.moneda)          acc.moneda          = p.moneda;

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
      // actualizamos precios si no los teníamos
      if (!acc.productos[idx].precioUSD && item.precioUSD) acc.productos[idx].precioUSD = item.precioUSD;
      if (!acc.productos[idx].precioUYU && item.precioUYU) acc.productos[idx].precioUYU = item.precioUYU;
    } else {
      // empujamos el item con su forma original
      // normalizamos cantidad a número
      item[qtyKey] = Number(item[qtyKey] || 0);
      acc.productos.push(item);
    }
  }

  // 2) Auto-asignación de camión para pedidos CAMION sin camionId
  try {
    // Detectar depósitos únicos presentes en el batch
    const depositos = [...new Set(
      [...pedidosMap.values()]
        .filter(p => p.metodoEntrega === "CAMION")
        .map(p => p.deposito)
        .filter(Boolean)
    )];

    if (depositos.length > 0) {
      // Cargar camiones activos por depósito (una query por depósito)
      const camionesPorDeposito = {};
      for (const dep of depositos) {
        const snapCam = await getDocs(
          query(collection(db, "camiones"), where("deposito", "==", dep))
        );
        camionesPorDeposito[dep] = snapCam.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      // Intentar resolver camionId para cada pedido CAMION sin asignación
      let autoAsignados = 0;
      for (const pedido of pedidosMap.values()) {
        if (pedido.metodoEntrega !== "CAMION" || pedido.camionId) continue;
        const camiones = camionesPorDeposito[pedido.deposito] || [];
        const camionId = resolverCamionId(pedido, camiones);
        if (camionId) {
          pedido.camionId = camionId;
          autoAsignados++;
        }
      }
      if (debug && autoAsignados > 0) {
        console.log(`[SYNC] Auto-asignados a camión: ${autoAsignados} pedido(s)`);
      }
    }
  } catch (e) {
    // No bloquear el sync si falla la auto-asignación de camiones
    console.warn("[SYNC] Error en auto-asignación de camiones:", e?.message || e);
  }

  // 3) Upsert por pedido
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

  // NOTA: el sync NO modifica estados automáticamente.
  // Ningún pedido pasa a DESPACHADO ni ANULADO por desaparecer del informe.
  // Los cambios de estado solo ocurren de forma manual (ventas / admin)
  // o si Finnegans modifica los productos del pedido (ver upsertPedidoDesdeFinnegans).

  return resumen;
}


