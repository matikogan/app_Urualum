// src/modules/pedidos/services/finDespachoMapper.js
// Mapper: Firestore Pedido -> Payload válido para POST /despachoVenta (Finnegans)

// --- util fecha local a YYYY-MM-DD (sin problemas de TZ)
function toYMD(d = new Date()) {
  const tzFixed = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tzFixed.toISOString().slice(0, 10);
}

// Equivalencias Firestore -> Código Finnegans (BSDeposito.Codigo)
const DEPOSITO_EQUIV = {
  // RUTA 8
  "RUTA8": "RUTA8",
  "RUTA 8": "RUTA8",
  "R8": "RUTA8",          // alias internos de la app
  "RUTA-8": "RUTA8",

  // Isabela General
  "ISABELA": "DEP2",
  "ISABELA GENERAL": "DEP2",
  "ISABELA_GENERAL": "DEP2",
  "DEP2": "DEP2",         // por si ya viene el código correcto
};

function resolveDepositoCodigo(src) {
  if (!src) return null;
  const key = String(src).trim().toUpperCase();
  return DEPOSITO_EQUIV[key] || null;
}

// Devuelve el primer token “limpio” para Finnegans (PRODUCTO)
function firstProductToken(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const token = s.split(/\s+/)[0] || "";
  return token.replace(/[^\w.-]/g, "");
}

// Arma el NumeroDocumento “PEDVTA - NNNNN” si no viene ya con prefijo
function buildNumeroDocumento(numOrId) {
  const s = String(numOrId || "").trim();
  if (!s) return "";
  if (/^PEDVTA\s*-\s*/i.test(s)) return s;
  return `PEDVTA - ${s}`;
}

// Determina la fecha del despacho (prioriza finFecha, luego updatedAt, luego hoy)
function resolveFechaYMD(pedido) {
  if (pedido?.finFecha) {
    const s = String(pedido.finFecha).trim();
    const mm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) return s;
    const ddmm = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmm) return `${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`;
  }
  if (pedido?.updatedAt?.toDate) return toYMD(pedido.updatedAt.toDate());
  return toYMD(new Date());
}

/**
 * mapPedidoToDespachoPayload(pedido)
 */
export function mapPedidoToDespachoPayload(pedido = {}) {
  if (!pedido) throw new Error("Pedido vacío");
  const numeroDoc = buildNumeroDocumento(pedido.numero || pedido.id);
  if (!numeroDoc) throw new Error("Pedido sin numero/id para NumeroDocumento");

  const fecha = resolveFechaYMD(pedido);

  // Cliente / Organización — solo por CÓDIGO (si existe)
  let clienteCodigo = null;
  if (pedido.clienteCodigo) clienteCodigo = String(pedido.clienteCodigo).trim();
  else if (pedido.organizacionCodigo) clienteCodigo = String(pedido.organizacionCodigo).trim();
  else if (pedido.clienteId) clienteCodigo = String(pedido.clienteId).trim(); // solo si es el código real

  // Depósito
  const depositoOrigen = resolveDepositoCodigo(pedido.deposito);
  if (!depositoOrigen) {
    throw new Error(`Depósito "${pedido.deposito}" no mapeado a código Finnegans. Ajustá DEPOSITO_EQUIV.`);
  }

  // Items
  const itemsSrc = Array.isArray(pedido.productos) ? pedido.productos : [];
  const Items = itemsSrc
    .map((it) => {
      const rawCode = it.cod || it.codigo || it.codigoURU || it.ProductoCodigo || it.productoCodigo || it.desc || it.descripcion || it.nombre;
      const code = firstProductToken(rawCode);
      const qtyRaw = it.cant ?? it.cantidad ?? it.qty ?? it.Cantidad ?? 0;
      const Cantidad = Number(qtyRaw || 0);
      if (!code || !Cantidad) return null;

      return {
        ProductoCodigo: code,
        Cantidad,
        DepositoOrigenCodigo: depositoOrigen || undefined,
      };
    })
    .filter(Boolean);

  if (!Items.length) {
    throw new Error("El pedido no tiene ítems despachables (códigos/cantidades inválidas).");
  }

  const EmpresaCodigo = String(process.env.REACT_APP_FINN_EMPRESA_CODIGO || "1");

  const payload = {
    TransaccionTipoCodigo: "OPER",
    TransaccionSubtipoCodigo: "REMVTA",
    WorkflowCodigo: "VENTAS",
    NumeroDocumento: numeroDoc,
    Fecha: fecha,
    EmpresaCodigo,
    Items,
  };

  // Enviar SOLO claves en raíz (strings) si tenemos el código
  if (clienteCodigo) {
    payload.OrganizacionCodigo = clienteCodigo;
    payload.ClienteCodigo = clienteCodigo;
  }

  if (pedido.metodoEntrega) payload.Observaciones = `Entrega: ${pedido.metodoEntrega}`;
  if (pedido.descripcion) payload.Descripcion = String(pedido.descripcion).slice(0, 200);

  return payload;
}

