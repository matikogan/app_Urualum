// src/API/finnegans.js

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



// === Reporte de compras pendientes (para listar facturas) ===
export async function getFacturasImportacionPendientes() {
  try {
    const token = await getFinnegansToken();

    // 👉 Fechas dinámicas: últimos 18 meses hasta HOY
  const hoy = new Date();
  const hace12m = new Date();
  hace12m.setMonth(hoy.getMonth() - 12);

  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const fechaDesde = fmt(hace12m);
  const fechaHasta = fmt(hoy);


    const EMPRESA_PARAM = process.env.REACT_APP_FINN_EMPRESA_PARAM || "prueba";

    // ⚠️ Ajustá fechas / empresa / reporte si hace falta
    const url =
  `https://api.finneg.com/api/reports/ANALISISPENDIENTESCOMPRAS` +
  `?PARAMWEBREPORT_FechaDesde=${fechaDesde}` +
  `&PARAMWEBREPORT_FechaHasta=${fechaHasta}` +
  `&PARAMWEBREPORT_Documento=FC%20Importacion` +
  `&PARAMWEBREPORT_verPendientes=2` +
  `&PARAMWEBREPORT_Empresa=${encodeURIComponent(EMPRESA_PARAM)}` + // 👈 usa PRUEBA
  `&ACCESS_TOKEN=${token}`;


  console.log("[FINN] URL pendientes:", url);
  console.log("📡 Solicitando facturas con URL:", url); // <--- LOG CLAVE
  console.log("🔑 Usando empresaParam:", EMPRESA_PARAM);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error en reporte: ${response.status}`);
    }
    const data = await response.json();

    // Agrupar por N° de factura (DOCNROINT)
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
        cantidad: item.CANTIDAD || 0, // en Finnegans es la cantidad del reporte
        // si el reporte trae customer no, lo dejamos; si no, lo cruzamos desde packing_list
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
// token: string (Bearer token)
// payload: objeto con la recepción (lo arma confirmar.js)
export async function postRecepcionCompra(token, payload) {
  // Base del endpoint sacado de tu .env (y de la doc)
  const BASE = process.env.REACT_APP_FINNEGANS_RECEPCION_URL || "https://api.finneg.com/api/recepcionCompra";
  const url = `${BASE}?ACCESS_TOKEN=${encodeURIComponent(token)}`;

  // Forzar EmpresaCodigo según .env (para PRUEBA = "1")
  const EMPRESA_CODIGO = process.env.REACT_APP_FINN_EMPRESA_CODIGO || "1";
  const body = { ...payload, EmpresaCodigo: String(EMPRESA_CODIGO) };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // (Opcional) podrías enviar también Authorization, pero la doc usa ACCESS_TOKEN por query
      // "Authorization": `Bearer ${token}`,
    },
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
