// functions/finnegans/endpoints.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { finRequest } = require("./http");

const finnegansPing = onCall(
  {
    region: "us-central1",
    secrets: [
      "FINN_TOKEN_URL",
      "FINN_CLIENT_ID",
      "FINN_CLIENT_SECRET",
      "FINN_API_BASE_URL",
    ],
  },
  async () => {
    const result = await finRequest({
      method: "GET",
      path: "/cliente/list",
    });

    console.log("[finnegansPing] result.status:", result.status);
    console.log("[finnegansPing] result.ok:", result.ok);
    console.log("[finnegansPing] result.data:", JSON.stringify(result.data).slice(0, 2000));


    if (!result.ok) {
      throw new HttpsError(
        "internal",
        "Finnegans ping failed",
        { status: result.status, data: result.data }
      );
    }

    return {
      ok: true,
      count: Array.isArray(result.data) ? result.data.length : null,
    };
  }
);


// -----------------------------------------------------------------------------
// GET CLIENTE (V3) - por codigo
// -----------------------------------------------------------------------------
const finnegansGetCliente = onCall(
  {
    region: "us-central1",
    secrets: [
      "FINN_TOKEN_URL",
      "FINN_CLIENT_ID",
      "FINN_CLIENT_SECRET",
      "FINN_API_BASE_URL",
    ],
  },
  async (request) => {
    const clienteCodigo = String(request?.data?.clienteCodigo ?? "").trim();

    if (!clienteCodigo) {
      throw new HttpsError("invalid-argument", "clienteCodigo es requerido");
    }

    // OJO: si Finnegans usa ceros a la izquierda, mandalo desde el front ya formateado (ej: 000513)
    const result = await finRequest({
      method: "GET",
      path: `/cliente/${encodeURIComponent(clienteCodigo)}`,
    });

    console.log("[finnegansGetCliente] codigo:", clienteCodigo);
    console.log("[finnegansGetCliente] result.status:", result.status);
    console.log("[finnegansGetCliente] result.ok:", result.ok);

    if (!result.ok) {
      throw new HttpsError("internal", "Finnegans getCliente failed", {
        status: result.status,
        data: result.data,
        clienteCodigo,
      });
    }

    return { ok: true, data: result.data };
  }
);

// -----------------------------------------------------------------------------
// CREAR PEDIDO VENTA (V3) - body completo desde el front (por ahora test)
// -----------------------------------------------------------------------------
const finnegansCrearPedidoVenta = onCall(
  {
    region: "us-central1",
    secrets: [
      "FINN_TOKEN_URL",
      "FINN_CLIENT_ID",
      "FINN_CLIENT_SECRET",
      "FINN_API_BASE_URL",
    ],
  },
  async (request) => {
    const body = request?.data?.body;

    if (!body || typeof body !== "object") {
      throw new HttpsError("invalid-argument", "body (JSON) es requerido");
    }

    const result = await finRequest({
      method: "POST",
      path: "/pedidoVenta",
      body,
    });

    console.log("[finnegansCrearPedidoVenta] result.status:", result.status);
    console.log("[finnegansCrearPedidoVenta] result.ok:", result.ok);
    console.log(
      "[finnegansCrearPedidoVenta] result.data:",
      JSON.stringify(result.data).slice(0, 2000)
    );

    if (!result.ok) {
      throw new HttpsError("internal", "Finnegans crearPedidoVenta failed", {
        status: result.status,
        data: result.data,
      });
    }

    return { ok: true, data: result.data };
  }
);


module.exports = { finnegansPing, finnegansGetCliente, finnegansCrearPedidoVenta };
