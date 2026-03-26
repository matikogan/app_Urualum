const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { finRequest } = require("./http");

const FINN_SECRETS = [
  "FINN_TOKEN_URL",
  "FINN_CLIENT_ID",
  "FINN_CLIENT_SECRET",
  "FINN_API_BASE_URL",
];

// ==========================================
// 1. LISTAR PRODUCTOS (Catálogo rápido)
// ==========================================
const finnegansListarProductos = onCall({ secrets: FINN_SECRETS }, async (req) => {
  try {
    const result = await finRequest({ method: "GET", path: "/producto/list" });

    if (!result.ok) {
        // A veces Finnegans falla, no rompamos todo, devolvemos array vacío
        logger.error("Error listing products", result);
        return { ok: false, count: 0, productos: [] };
    }

    const productos = Array.isArray(result.data) ? result.data : [];
    
    const mapeados = productos.map(p => ({
        Codigo: p.codigo || p.Codigo || p.PRODUCTOCODIGO || p.ID,
        Nombre: p.nombre || p.Nombre || p.descripcion || p.DESCRIPCION || "Sin Nombre",
        // En listado el precio suele ser 0, no importa, lo buscamos en detalle después
        _raw: p 
    }));

    return { ok: true, count: mapeados.length, productos: mapeados.filter(p => p.Codigo) };
  } catch (err) {
    logger.error("ListarProductos Error:", err);
    throw new HttpsError("internal", err.message);
  }
});

// ==========================================
// 2. OBTENER DETALLE PRODUCTO (Aquí está el precio real)
// ==========================================
const finnegansGetProductoDetalle = onCall({ secrets: FINN_SECRETS }, async (req) => {
  try {
    const codigo = String(req.data.codigo || "").trim();
    if (!codigo) throw new HttpsError("invalid-argument", "Falta código de producto");

    // Llamamos al endpoint específico /producto/{id} [cite: 246]
    const path = `/producto/${encodeURIComponent(codigo)}`;
    const result = await finRequest({ method: "GET", path });

    if (!result.ok) {
        throw new HttpsError("not-found", "Producto no encontrado o error en Finnegans", { data: result.data });
    }

    const p = result.data;
    
    // Extraemos el PrecioBaseVenta que figura en tu documentación 
    const precioBase = Number(p.PrecioBaseVenta || p.precioBaseVenta || p.Precio || 0);

    return { 
        ok: true, 
        producto: {
            Codigo: p.Codigo,
            Nombre: p.Nombre,
            PrecioBase: precioBase, // <--- ESTE ES EL DATO QUE BUSCAMOS
            Moneda: p.MonedaCodigo,
            Peso: p.Peso
        }
    };

  } catch (err) {
    logger.error("GetProductoDetalle Error:", err);
    throw new HttpsError("internal", err.message);
  }
});

// ==========================================
// CONSULTAR STOCK (Reporte)
// ==========================================
const finnegansConsultarStock = onCall({ secrets: FINN_SECRETS }, async (req) => {
  try {
    const data = req.data || {};
    const deposito = String(data.deposito || "RUTA8").trim(); 
    const soloStockNoCero = data.soloStockNoCero !== false; 
    const productoCodigo = data.productoCodigo ? String(data.productoCodigo).trim() : null;

    const params = new URLSearchParams();
    params.append("PARAMWEBREPORT_deposito", deposito);
    params.append("PARAMWEBREPORT_soloStockNoCero", soloStockNoCero ? "true" : "false");
    params.append("PARAMWEBREPORT_MonedaID", "UYU"); 
    
    const fecha = new Date().toISOString().split('T')[0]; 
    params.append("PARAMWEBREPORT_fecha", fecha);

    // 🔥 LOS PARÁMETROS HACKEADOS DE FINNEGANS 🔥
    params.append("PARAMWEBREPORT_Empresa", "EMPRE01"); 
    params.append("PARAMWEBREPORT_tipoStock", "0");

    if (productoCodigo) {
      params.append("PARAMWEBREPORT_producto", productoCodigo);
    }

    const path = `/reports/resumenStockPorDeposito?${params.toString()}`;

    logger.info(`🕵️‍♂️ URL ENVIADA A FINNEGANS (${deposito}):`, path);

    const result = await finRequest({ method: "GET", path });

    if (!result.ok) {
      throw new HttpsError("internal", "Error consultando Stock", { data: result.data });
    }

    const stockItems = Array.isArray(result.data) ? result.data : [];

    const stockLimpio = stockItems.map(item => ({
        ProductoCodigo: item.PRODUCTOCODIGO || item.productoCodigo,
        ProductoNombre: item.PRODUCTO || item.producto,
        Deposito: item.DEPOSITO || item.deposito,
        Cantidad: Number(item.STOCKDISPONIBLE || item.stockDisponible || 0),
        Unidad: item.UNIDAD1 || item.unidad1,
        _raw: item
    }));

    return { ok: true, count: stockLimpio.length, stock: stockLimpio };

  } catch (err) {
    logger.error("finnegansConsultarStock Error:", err);
    throw new HttpsError("internal", err.message);
  }
});

module.exports = { 
    finnegansListarProductos, 
    finnegansGetProductoDetalle,
    finnegansConsultarStock 
};