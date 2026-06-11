
/*
// src/API/finnegans.js
// === NUEVO: helpers genéricos para Finnegans ===
const API_BASE = "https://api.finneg.com/api";

// === OAuth: obtener token de Finnegans ===
export async function getFinnegansToken() {
  const url = process.env.REACT_APP_FINN_TOKEN_URL;
  const client_id = process.env.REACT_APP_FINN_CLIENT_ID;
  const client_secret = process.env.REACT_APP_FINN_CLIENT_SECRET;

  const fullUrl =
    `${url}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(client_id)}` +
    `&client_secret=${encodeURIComponent(client_secret)}`;

  const r = await fetch(fullUrl, { method: "GET" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Error al obtener token: ${r.status} ${txt}`);
  }
  return r.text(); // Finnegans devuelve el token en texto plano
}


// === BUSCAR PEDIDO CRUDO EN FINNEGANS POR NUMERO ===
// Usa el token que ya gestiona tu archivo (postDespacho/getToken/etc.)

export async function getPedidoFinByNumero({ numeroDocumento, fechaDesde, fechaHasta }) {
  // 1) intento directo (si tu tenant expone endpoint de cabeceras por número)
  try {
    const direct = await _get(`/ventas/documentos?NumeroDocumento=${encodeURIComponent(numeroDocumento)}`);
    if (Array.isArray(direct) && direct.length) return direct[0]; // cabecera
    if (direct && direct.Id) return direct; // objeto único
  } catch (_) {}

  // 2) fallback: usar tu listado existente (el mismo que usás para “pendientes”)
  // ajustá el helper/endpoint que tengas para listar cabeceras
  const desde = fechaDesde || "2024-01-01";
  const hasta = fechaHasta || new Date().toISOString().slice(0, 10);

  const list = await _get(`/ventas/pedidos?desde=${desde}&hasta=${hasta}`); // <-- ajustá a tu lista real
  const n = (numeroDocumento.match(/(\d{3,})$/) || [null, numeroDocumento])[1];
  const row = (list || []).find(r => {
    const txt = String(
      r.NumeroDocumento || r.NOMBRE || r.Documento || r.Pedido || r.NumeroPedido || ""
    );
    return new RegExp(`\\b${n}\\b`).test(txt);
  });
  if (!row) return null;

  // si la cabecera trae OrganizacionCodigo ya sirve;
  // si no, intentá traer el detalle por Id
  if (row.OrganizacionCodigo || row.ClienteCodigo) return row;

  if (row.Id) {
    const det = await getPedidoDetalleById(row.Id);
    return det || row;
  }
  return row;
}

export async function getPedidoDetalleById(id) {
  if (!id) return null;
  try {
    // endpoint típico de detalle por Id
    const det = await _get(`/ventas/documentos/${encodeURIComponent(id)}`);
    return det || null;
  } catch (e) {
    console.error("[FIN] detalle por Id falló", e);
    return null;
  }
}

/** _get: wrapper simple reutilizando tu manejo de token/baseURL  
async function _get(path) {
  const token = await getToken(); // ya lo tenés en este archivo
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!r.ok) throw new Error(data?.Message || data?.message || txt || `HTTP ${r.status}`);
  return data;
}


// === Reporte de compras pendientes (para listar facturas) ===
export async function getFacturasImportacionPendientes() {
  try {
    const token = await getFinnegansToken();

    // 👉 Fechas dinámicas: últimos 12 meses hasta HOY
    const hoy = new Date();
    const hace12m = new Date();
    hace12m.setMonth(hoy.getMonth() - 12);
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fechaDesde = fmt(hace12m);
    const fechaHasta = fmt(hoy);

    const EMPRESA_PARAM = process.env.REACT_APP_FINN_EMPRESA_PARAM || "prueba";

    const url =
      `https://api.finneg.com/api/reports/ANALISISPENDIENTESCOMPRAS` +
      `?PARAMWEBREPORT_FechaDesde=${fechaDesde}` +
      `&PARAMWEBREPORT_FechaHasta=${fechaHasta}` +
      `&PARAMWEBREPORT_Documento=FC%20Importacion` +
      `&PARAMWEBREPORT_verPendientes=2` +
      `&PARAMWEBREPORT_Empresa=${encodeURIComponent(EMPRESA_PARAM)}` +
      `&ACCESS_TOKEN=${token}`;

    console.log("[FINN] URL pendientes:", url);
    console.log("📡 Solicitando facturas con URL:", url);
    console.log("🔑 Usando empresaParam:", EMPRESA_PARAM);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error en reporte: ${response.status}`);
    }
    const data = await response.json();

    const facturasAgrupadas = data.reduce((acc, item) => {
      const nroFactura = item.DOCNROINT || "SIN_NUMERO";
      if (!acc[nroFactura]) {
        acc[nroFactura] = {
          nroFactura,
          comprobante: item.COMPROBANTE,
          proveedor: item.CLIENTE || "Desconocido",
          fecha: item.FECHA || "Sin fecha",
          productos: [],
        };
      }
      acc[nroFactura].productos.push({
        codigo: item.PRODUCTO || "DESCONOCIDO",
        descripcion: item.DESCRIPCION || "",
        cantidad: item.CANTIDAD || 0,
        customerNo: item.CUSTOMERNO || null,
      });
      return acc;
    }, {});
    return Object.values(facturasAgrupadas);
  } catch (error) {
    console.error("❌ Error obteniendo facturas:", error);
    return [];
  }
}

// === Utilidad interna para parsear respuesta segura ===
async function safeJson(resp) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// === POST Recepción de Compra a Finnegans ===
export async function postRecepcionCompra(token, payload) {
  const BASE = process.env.REACT_APP_FINNEGANS_RECEPCION_URL || "https://api.finneg.com/api/recepcionCompra";
  const url = `${BASE}?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const EMPRESA_CODIGO = process.env.REACT_APP_FINN_EMPRESA_CODIGO || "1";
  const body = { ...payload, EmpresaCodigo: String(EMPRESA_CODIGO) };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await safeJson(resp);
  if (!resp.ok) {
    const err = new Error(`Finnegans respondió ${resp.status}`);
    err.response = data;
    throw err;
  }
  return data;
}



// Cache simple del token (evita pedirlo en cada request)
let __finnegToken = { value: null, fetchedAt: 0, ttlMs: 45 * 60 * 1000 };

async function getAccessTokenCached(force = false) {
  const now = Date.now();
  const stillValid = __finnegToken.value && (now - __finnegToken.fetchedAt) < __finnegToken.ttlMs;
  if (!force && stillValid) return __finnegToken.value;

  const token = (await getFinnegansToken()).trim();
  if (!token) throw new Error("Token vacío");
  __finnegToken = { value: token, fetchedAt: Date.now(), ttlMs: __finnegToken.ttlMs };
  return token;
}

async function finnegGet(path, params = {}) {
  const token = await getAccessTokenCached();
  const qs = new URLSearchParams({ ...params, ACCESS_TOKEN: token }).toString();
  const url = `${API_BASE}${path}?${qs}`;
  const res = await fetch(url, { method: "GET" });

  // Reintento si expiró
  if (res.status === 401) {
    const newTok = await getAccessTokenCached(true);
    const retryQs = new URLSearchParams({ ...params, ACCESS_TOKEN: newTok }).toString();
    const retryUrl = `${API_BASE}${path}?${retryQs}`;
    const retry = await fetch(retryUrl, { method: "GET" });
    const txtR = await _decodeResponse(retry);
    try { return JSON.parse(txtR); } catch { return txtR; }
  }

  const txt = await _decodeResponse(res);
  try { return JSON.parse(txt); } catch { return txt; }
}

// === ENDPOINTS: Pedidos, Despachos y Resumen de Stock ===

// 1) Pedidos de Venta pendientes de despachar (reporte analisisPedidoVenta)
//    ⚠️ Firma defensiva: acepta siempre un objeto y pone defaults.
export async function getPedidosPendientes({ fechaDesde = null, fechaHasta = null } = {}) {
  const cliente = "";
  const verPendientes = 2;
  const empresa = process.env.REACT_APP_FINN_EMPRESA_PARAM || "EMPRE01";

  const raw = await finnegGet("/reports/analisisPedidoVenta", {
    PARAMWEBREPORT_FechaDesde: fechaDesde,
    PARAMWEBREPORT_FechaHasta: fechaHasta,
    PARAMWEBREPORT_Cliente: cliente,
    PARAMWEBREPORT_verPendientes: verPendientes,
    PARAMWEBREPORT_Empresa: empresa,
  });

  // 👇 Normalizamos: si viene { data:[...] }, devolvemos ese array;
  // si ya es array, lo dejamos tal cual; si no, devolvemos [].
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  return rows;
}


// 2) Obtener un Despacho por documento (GET /despachoVenta/{DOC})
//    ⚠️ Firma defensiva: acepta objeto; si falta doc, tira error claro.
export async function getDespacho({ doc = null } = {}) {
  if (!doc) throw new Error("Falta parámetro { doc } para getDespacho");
  const encoded = encodeURIComponent(doc);
  return finnegGet(`/despachoVenta/${encoded}`);
}

// 3) Crear Despacho (POST /despachoVenta)
export async function postDespacho(payload /* JSON con Items[], Cliente, etc. ) {
  const token = await getAccessTokenCached();
  const url = `${API_BASE}/despachoVenta?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

// 4) Resumen de Stock por Depósito (reporte resumenStockPorDeposito)
export async function getResumenStock({
  fecha = null,        // "YYYY-MM-DD"
  producto = "",       // opcional
  deposito = "",       // opcional (código Finnegans)
  soloNoCero = true,
  monedaId = "UYU",
} = {}) {
  return finnegGet("/reports/resumenStockPorDeposito", {
    PARAMWEBREPORT_fecha: fecha,
    PARAMWEBREPORT_producto: producto,
    PARAMWEBREPORT_deposito: deposito,
    PARAMWEBREPORT_soloStockNoCero: !!soloNoCero,
    PARAMWEBREPORT_MonedaID: monedaId,
  });
}
 
*/

// src/API/finnegans.js
// === Base ===

// Decodifica la respuesta detectando el encoding real.
// Finnegans puede declarar charset=utf-8 pero enviar bytes Windows-1252.
// Intentamos UTF-8 estricto; si falla, redecodificamos como windows-1252.
async function _decodeResponse(response) {
  const buf = await response.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    return new TextDecoder("windows-1252", { fatal: false }).decode(buf);
  }
}
// Deriva la base de la URL del token para que apunten al mismo entorno (test o prod).
// Si REACT_APP_FINN_API_BASE está definida, la usa directamente.
// Si no, la infiere desde REACT_APP_FINN_TOKEN_URL quitando el path "/oauth/token".
// Fallback final: producción finneg.com
function resolveApiBase() {
  if (process.env.REACT_APP_FINN_API_BASE) {
    return process.env.REACT_APP_FINN_API_BASE.replace(/\/$/, "");
  }
  const tokenUrl = process.env.REACT_APP_FINN_TOKEN_URL || "";
  if (tokenUrl) {
    // "https://api.teamplace.finneg.com/api/oauth/token" → "https://api.teamplace.finneg.com/api"
    const match = tokenUrl.match(/^(https?:\/\/[^/]+\/api)/);
    if (match) return match[1];
  }
  return "https://api.finneg.com/api";
}
const API_BASE = resolveApiBase();

// === OAuth: obtener token de Finnegans ===
export async function getFinnegansToken() {
  const url = process.env.REACT_APP_FINN_TOKEN_URL;
  const client_id = process.env.REACT_APP_FINN_CLIENT_ID;
  const client_secret = process.env.REACT_APP_FINN_CLIENT_SECRET;

  const fullUrl =
    `${url}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(client_id)}` +
    `&client_secret=${encodeURIComponent(client_secret)}`;

  const r = await fetch(fullUrl, { method: "GET" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Error al obtener token: ${r.status} ${txt}`);
  }
  return r.text(); // Finnegans devuelve el token en texto plano
}

// Cache simple del token (evita pedirlo en cada request)
let __finnegToken = { value: null, fetchedAt: 0, ttlMs: 45 * 60 * 1000 };

async function getAccessTokenCached(force = false) {
  const now = Date.now();
  const stillValid = __finnegToken.value && (now - __finnegToken.fetchedAt) < __finnegToken.ttlMs;
  if (!force && stillValid) return __finnegToken.value;

  const token = (await getFinnegansToken()).trim();
  if (!token) throw new Error("Token vacío");
  __finnegToken = { value: token, fetchedAt: Date.now(), ttlMs: __finnegToken.ttlMs };
  return token;
}

async function finnegGet(path, params = {}) {
  const token = await getAccessTokenCached();
  const qs = new URLSearchParams({ ...params, ACCESS_TOKEN: token }).toString();
  const url = `${API_BASE}${path}?${qs}`;
  const res = await fetch(url, { method: "GET" });

  // Reintento si expiró
  if (res.status === 401) {
    const newTok = await getAccessTokenCached(true);
    const retryQs = new URLSearchParams({ ...params, ACCESS_TOKEN: newTok }).toString();
    const retryUrl = `${API_BASE}${path}?${retryQs}`;
    const retry = await fetch(retryUrl, { method: "GET" });
    const txtR = await _decodeResponse(retry);
    try { return JSON.parse(txtR); } catch { return txtR; }
  }

  const txt = await _decodeResponse(res);
  try { return JSON.parse(txt); } catch { return txt; }
}

/** _get: wrapper para rutas “internas” de este archivo */
async function _get(path) {
  const token = await getAccessTokenCached();
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = txt; }
  if (!r.ok) throw new Error(data?.Message || data?.message || txt || `HTTP ${r.status}`);
  return data;
}

// === Reporte de Pedidos de Venta pendientes (analisisPedidoVenta) ===
export async function getPedidosPendientes({ fechaDesde = null, fechaHasta = null } = {}) {
  const cliente = "";
  const verPendientes = 2;
  const empresa = process.env.REACT_APP_FINN_EMPRESA_PARAM || "EMPRE01";

  const raw = await finnegGet("/reports/analisisPedidoVenta", {
    PARAMWEBREPORT_FechaDesde: fechaDesde,
    PARAMWEBREPORT_FechaHasta: fechaHasta,
    PARAMWEBREPORT_Cliente: cliente,
    PARAMWEBREPORT_verPendientes: verPendientes,
    PARAMWEBREPORT_Empresa: empresa,
  });

  // Normalizamos salida
  const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  return rows;
}

// (estos endpoints “directos” en tu tenant hoy dan 501; los dejamos por si los habilitan)
export async function getPedidoFinByNumero({ numeroDocumento, fechaDesde, fechaHasta }) {
  try {
    const direct = await _get(`/ventas/documentos?NumeroDocumento=${encodeURIComponent(numeroDocumento)}`);
    if (Array.isArray(direct) && direct.length) return direct[0];
    if (direct && direct.Id) return direct;
  } catch (_) {}

  // fallback genérico (si más adelante habilitan otra lista)
  const desde = fechaDesde || "2024-01-01";
  const hasta = fechaHasta || new Date().toISOString().slice(0, 10);

  const list = await _get(`/ventas/pedidos?desde=${desde}&hasta=${hasta}`);
  const n = (numeroDocumento.match(/(\d{3,})$/) || [null, numeroDocumento])[1];
  const row = (list || []).find(r => {
    const txt = String(
      r.NumeroDocumento || r.NOMBRE || r.Documento || r.Pedido || r.NumeroPedido || ""
    );
    return new RegExp(`\\b${n}\\b`).test(txt);
  });
  if (!row) return null;

  if (row.OrganizacionCodigo || row.ClienteCodigo) return row;
  if (row.Id) {
    const det = await getPedidoDetalleById(row.Id);
    return det || row;
  }
  return row;
}

export async function getPedidoDetalleById(id) {
  if (!id) return null;
  try {
    const det = await _get(`/ventas/documentos/${encodeURIComponent(id)}`);
    return det || null;
  } catch (e) {
    console.error("[FIN] detalle por Id falló", e);
    return null;
  }
}

// === Despacho Venta ===
export async function getDespacho({ doc = null } = {}) {
  if (!doc) throw new Error("Falta parámetro { doc } para getDespacho");
  const encoded = encodeURIComponent(doc);
  return finnegGet(`/despachoVenta/${encoded}`);
}

export async function postDespacho(payload) {
  const token = await getAccessTokenCached();
  const url = `${API_BASE}/despachoVenta?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

// === Otros (ejemplo: resumen de stock) ===
export async function getResumenStock({
  fecha = null,
  producto = "",
  deposito = "",
  soloNoCero = true,
  monedaId = "UYU",
} = {}) {
  return finnegGet("/reports/resumenStockPorDeposito", {
    PARAMWEBREPORT_fecha: fecha,
    PARAMWEBREPORT_producto: producto,
    PARAMWEBREPORT_deposito: deposito,
    PARAMWEBREPORT_soloStockNoCero: !!soloNoCero,
    PARAMWEBREPORT_MonedaID: monedaId,
  });
}


// ================== COMPAT: Recepciones ==================

// POST /recepcionCompra  (wrapper compatible con recepciones/pages/*)
// Usa el mismo esquema que postDespacho: body JSON + ACCESS_TOKEN en query
export async function postRecepcionCompra(payload) {
  const token = await getAccessTokenCached();
  const url = `${API_BASE}/recepcionCompra?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

// GET reporte de facturas de importación pendientes (nombre heredado)
// Si tu reporte tiene otro path o nombres de parámetros, ajustá aquí:
export async function getFacturasImportacionPendientes({
  fechaDesde = null,
  fechaHasta = null,
  proveedor = "",
  empresa = process.env.REACT_APP_FINN_EMPRESA_PARAM || "EMPRE01",
} = {}) {
  const params = {
    PARAMWEBREPORT_FechaDesde: fechaDesde,
    PARAMWEBREPORT_FechaHasta: fechaHasta,
    PARAMWEBREPORT_Proveedor: proveedor,
    PARAMWEBREPORT_Empresa: empresa,
  };
  // Ajustá el path del reporte al que uses en esa pantalla:
  return finnegGet("/reports/facturasImportacionPendientes", params);
}
