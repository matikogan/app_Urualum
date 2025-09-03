// src/api/sheets.js

/**
 * Envía el pedido preparado a Google Sheets vía Webhook de Apps Script.
 * @param {object} params
 * @param {string} params.pedidoId   ID del pedido
 * @param {string} params.cliente    Código o nombre del cliente
 * @param {Array}  params.productos  Array de { codigo, paquete, cantidad }
 */
export async function markOrderPrepared({ pedidoId, cliente, productos }) {
  const url      = "/api/sheets";                  // proxy a tu Apps Script
  const operador = process.env.REACT_APP_OPERADOR; // el nombre/ID del operario

  // Separamos paquetes y tiras en dos arrays
  const productos_paquetes = productos.filter(p => p.paquete != null);
  const productos_tiras    = productos.filter(p => p.paquete == null);

  // Payload EXACTO que espera tu doPost
  const payload = {
    accion:            "agregarPedido",      // ← muy importante
    id_pedido:         pedidoId,
    cliente:           cliente,
    operario:          operador,
    productos_paquetes,
    productos_tiras
  };

  console.log("🌐 Proxy va a:", process.env.REACT_APP_SHEET_WEBHOOK_URL)

  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  // Intenta parsear JSON; si la respuesta no es JSON puro, fallará aquí
  const data = await resp.json();
  if (!resp.ok || data.status === "error") {
    throw new Error(data.message || `HTTP ${resp.status}`);
  }
  return data;
}
