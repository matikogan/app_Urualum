const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { finRequest } = require("./http");

const FINN_SECRETS = [
  "FINN_TOKEN_URL",
  "FINN_CLIENT_ID",
  "FINN_CLIENT_SECRET",
  "FINN_API_BASE_URL",
];

// =============================
// GET CLIENTE (por código)
// =============================
const finnegansGetCliente = onCall({ secrets: FINN_SECRETS }, async (request) => {
  try {
    const codigo = String(
      request?.data?.codigo ?? request?.data?.clienteCodigo ?? ""
    ).trim();

    if (!codigo) {
      throw new HttpsError("invalid-argument", "Falta 'codigo' del cliente");
    }

    const path = `/cliente/${encodeURIComponent(codigo)}`;
    const result = await finRequest({ method: "GET", path });

    if (!result.ok) {
      const status = result.status || 500;
      if (status === 404) {
        throw new HttpsError("not-found", "Cliente no encontrado en Finnegans", { status, finnegansData: result.data });
      }
      throw new HttpsError("internal", "Error al obtener cliente", { status, finnegansData: result.data });
    }

    return { ok: true, cliente: result.data };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("finnegansGetCliente error:", err);
    throw new HttpsError("internal", err.message);
  }
});

// =============================
// CREAR PEDIDO VENTA
// =============================
const finnegansCrearPedidoVenta = onCall({ secrets: FINN_SECRETS }, async (req) => {
  try {
    const body = req.data || {};

    const clienteCodigoRaw = body.ClienteCodigo ?? body.clienteCodigo ?? body.Cliente ?? body.cliente;
    const itemsRaw = body.Items ?? body.items ?? [];
    const descripcion = String(body.Descripcion ?? body.descripcion ?? "").trim();

    if (!clienteCodigoRaw) throw new HttpsError("invalid-argument", "Falta ClienteCodigo");
    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) throw new HttpsError("invalid-argument", "Falta Items");

    // 1. Normalización de Items (CON PRECIO Y DIMENSIONES)
    const items = itemsRaw
      .map((it) => {
        const prodCod = String(it.ProductoCodigo ?? it.productoCodigo ?? "").trim();
        const cant = Number(it.Cantidad ?? it.cantidad ?? 0);
        const precio = Number(it.Precio ?? it.precio ?? 0);
        
        // Calculamos el importe total de la línea para la dimensión
        const importeTotal = cant * precio;

        return { 
          ProductoCodigo: prodCod, 
          Cantidad: cant, 
          Precio: precio,
          ImporteTotal: importeTotal // auxiliar para uso interno abajo
        };
      })
      .filter((it) => it.ProductoCodigo && it.Cantidad > 0);

    if (items.length === 0) throw new HttpsError("invalid-argument", "Items inválidos");

    const clienteCodigo = String(clienteCodigoRaw).trim();

    // 2. Fecha (Timezone Montevideo)
    const getFechaMontevideo = () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Montevideo",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(new Date());
      const y = parts.find((p) => p.type === "year")?.value;
      const m = parts.find((p) => p.type === "month")?.value;
      const d = parts.find((p) => p.type === "day")?.value;
      return `${y}-${m}-${d}`;
    };

    const fecha = String(body.Fecha ?? body.fecha ?? getFechaMontevideo()).trim();
    const identificacionExterna = String(body.IdentificacionExterna ?? body.identificacionExterna ?? `APP_${Date.now()}`).trim();

    // 3. Pre-fetch del Cliente (para defaults)
    const clienteResp = await finRequest({
      method: "GET",
      path: `/cliente/${encodeURIComponent(clienteCodigo)}`,
    });

    if(!clienteResp.ok) throw new HttpsError("failed-precondition", `Cliente ${clienteCodigo} inválido.`);

    const clienteData = clienteResp.data || {};
    // Usamos defaults del cliente o fallbacks genéricos
    const listaPrecioCodigo = String(body.ListaPrecioCodigo ?? clienteData.ListaPrecioDefaultCodigo ?? "").trim();
    const vendedorCodigo = String(body.VendedorCodigo ?? clienteData.VendedorCodigo ?? "").trim();

    if (!listaPrecioCodigo) throw new HttpsError("failed-precondition", "Falta ListaPrecioCodigo (Cliente sin default)");
    if (!vendedorCodigo) throw new HttpsError("failed-precondition", "Falta VendedorCodigo (Cliente sin default)");

    // 4. Payload Final
    const payload = {
      IdentificacionExterna: identificacionExterna,
      Fecha: fecha,
      Cliente: clienteCodigo,
      CondicionPagoCodigo: String(body.CondicionPagoCodigo ?? "CE"),
      TransaccionTipoCodigo: "OPER",
      TransaccionSubtipoCodigo: "PEDVTA",
      WorkflowCodigo: "VENTAS",
      Descripcion: descripcion,
      MonedaCodigo: String(body.MonedaCodigo ?? "DOL"),
      EmpresaCodigo: "EMPRE01",
      ListaPrecioCodigo: listaPrecioCodigo,
      VendedorCodigo: vendedorCodigo,
      Items: items.map((it) => ({
        ProductoCodigo: it.ProductoCodigo,
        Cantidad: it.Cantidad,
        Precio: it.Precio,
        PrecioBase: it.Precio, // A veces requerido por validaciones
        
        // --- AQUÍ ESTÁ LA SOLUCIÓN AL ERROR DE DIMENSIONES ---
        //[cite_start]// Basado en tu documentación (Apis V3 [cite: 454])
        DimensionDistribucion: [
          {
            dimensionCodigo: "DIMCTC", // Dimensión Centro de Costos
            distribucionCodigo: "",
            tipoCalculo: "0",
            distribucionItems: [
              {
                codigo: "CCO5", // <--- CÓDIGO DE CENTRO DE COSTO (Ajustar si tu empresa usa otro)
                porcentaje: 100.0,
                importe: it.ImporteTotal
              }
            ]
          }
        ]
        // -----------------------------------------------------
      })),
      ProvinciaOrigenCodigo: String(body.ProvinciaOrigenCodigo ?? "DEPTOUR1"),
    };

    logger.info(`Enviando Pedido Finnegans (con dimensiones). Cliente: ${clienteCodigo}`);

    const result = await finRequest({
      method: "POST",
      path: `/pedidoVenta`,
      body: payload,
    });

    if (!result.ok) {
      logger.error("Error Finnegans Response:", JSON.stringify(result.data));
      throw new HttpsError("aborted", "Finnegans rechazó el pedido", {
        status: result.status,
        finnegansResponse: result.data
      });
    }

    return { ok: true, pedidoGenerado: result.data };

  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("finnegansCrearPedidoVenta Fatal:", err);
    throw new HttpsError("internal", err.message);
  }
});

// =============================
// LISTAR TODOS LOS CLIENTES
// =============================
const finnegansListarClientes = onCall({ secrets: FINN_SECRETS }, async (request) => {
  try {
    const result = await finRequest({ method: "GET", path: "/cliente/list" });

    if (!result.ok) {
      throw new HttpsError("internal", "Error al listar clientes", result.data);
    }

    return { ok: true, clientes: result.data };
  } catch (err) {
    logger.error("finnegansListarClientes error:", err);
    throw new HttpsError("internal", err.message);
  }
});

module.exports = { finnegansGetCliente, finnegansCrearPedidoVenta, finnegansListarClientes };