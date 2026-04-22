/**
 * Import function triggers from their respective submodules:
 */
const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

setGlobalOptions({ maxInstances: 10 });

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();

// ======================================================================
// HELPER: enviar notificaciones y limpiar tokens inválidos
// ======================================================================

async function sendPushNotification(tokens, notification) {
  if (!tokens || tokens.length === 0) {
    logger.info("No hay tokens para notificar.");
    return;
  }

  const payload = {
    notification: {
      title: notification.title,
      body: notification.body,
      icon: notification.icon || "/logo-urualum.png",
      click_action: notification.click_action || "https://app.urualum.uy",
    },
  };

  const response = await admin.messaging().sendToDevice(tokens, payload);

  const tokensToDelete = [];
  response.results.forEach((result, index) => {
    if (result.error) {
      logger.warn("Error enviando token:", tokens[index], result.error);
      if (
        result.error.code === "messaging/invalid-registration-token" ||
        result.error.code === "messaging/registration-token-not-registered"
      ) {
        tokensToDelete.push(tokens[index]);
      }
    }
  });

  if (tokensToDelete.length > 0) {
    const usersSnap = await db
      .collection("users")
      .where("fcmToken", "in", tokensToDelete)
      .get();

    usersSnap.forEach((doc) => {
      doc.ref.update({ fcmToken: null });
    });
  }
}

// ======================================================================
//  FUNCIONES ORIGINALES URUALUM
// ======================================================================

exports.notificarPedidoDespachado = onDocumentCreated(
  "pedidos_despachados/{id}",
  async (event) => {
    // V2 requiere acceder a event.data.data()
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const numero = data.numero || event.params.id;
    const deposito = data.deposito;

    logger.info("Nuevo pedido despachado:", numero);

    const usersSnap = await db
      .collection("users")
      .where("rol", "in", ["ventas", "encargado"])
      .get();

    const tokens = [];
    usersSnap.forEach((doc) => {
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: "Pedido despachado",
      body: `${numero} fue DESPACHADO (${deposito})`,
      click_action: "https://app.urualum.uy/ventas/despachados",
    });
  }
);

exports.notificarPedidoPreparado = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after = snap.after.data();

    if (before.estado === after.estado) return;
    if (after.estado !== "PREPARADO") return;

    const numero = after.numero || event.params.id;
    const deposito = after.deposito;

    logger.info("Pedido PREPARADO:", numero);

    const usersSnap = await db
      .collection("users")
      .where("rol", "==", "encargado")
      .where("deposito", "==", deposito)
      .get();

    const tokens = [];
    usersSnap.forEach((doc) => {
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: "Pedido preparado",
      body: `${numero} está listo para control`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
  }
);

exports.notificarPedidoAsignado = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after = snap.after.data();

    if (before.estado === after.estado) return;
    if (after.estado !== "ASIGNADO") return;

    const operarioId = after.operarioId;
    const numero = after.numero || event.params.id;

    if (!operarioId) {
      logger.warn("Pedido ASIGNADO sin operarioId");
      return;
    }

    const operSnap = await db.collection("users").doc(operarioId).get();
    const token = operSnap.data()?.fcmToken;

    if (!token) {
      logger.warn("Operario no tiene token");
      return;
    }

    await sendPushNotification([token], {
      title: "Nuevo pedido asignado",
      body: `Tenés un nuevo pedido: ${numero}`,
      click_action: `https://app.urualum.uy/pedidos-operario/${event.params.id}`,
    });
  }
);

exports.notificarErrorPreparacion = onDocumentCreated(
  "errores_preparacion/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();

    const numero = data.numero;
    const deposito = data.deposito;
    const detalle = data.detalle || "Error en preparación";

    logger.info("Error preparación:", numero);

    // Notificar a ventas Y encargado del mismo depósito
    const [ventasSnap, encargadoSnap] = await Promise.all([
      db.collection("users").where("rol", "==", "ventas").where("deposito", "==", deposito).get(),
      db.collection("users").where("rol", "==", "encargado").where("deposito", "==", deposito).get(),
    ]);

    const tokens = [];
    [...ventasSnap.docs, ...encargadoSnap.docs].forEach((doc) => {
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: "⚠️ Error en preparación",
      body: `${numero}: ${detalle}`,
      click_action: "https://app.urualum.uy/ventas/para-despachar",
    });
  }
);


// ======================================================================
// NOTIFICACIONES: PROBLEMA EN PREPARACIÓN
// ======================================================================

exports.notificarProblemaPreparacion = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after = snap.after.data();

    const problemaBefore = before.problema;
    const problemaAfter = after.problema;
    if (!problemaAfter) return;
    if (problemaAfter.estado !== "PENDIENTE") return;
    if (problemaBefore?.estado === "PENDIENTE") return; // ya fue notificado

    const numero = after.numero || event.params.id;
    const deposito = after.deposito;
    const tipo = problemaAfter.tipo === "FALTA_STOCK" ? "falta de stock" : "otro problema";
    const producto = problemaAfter.productoNombre || "un producto";

    logger.info("Problema en preparación:", numero, tipo, producto);

    const usersSnap = await db
      .collection("users")
      .where("rol", "==", "encargado")
      .where("deposito", "==", deposito)
      .get();

    const tokens = [];
    usersSnap.forEach((doc) => {
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: "⚠️ Problema en preparación",
      body: `Pedido ${numero}: ${tipo} en "${producto}"`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
  }
);

exports.notificarProblemaElevado = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after = snap.after.data();

    const problemaBefore = before.problema;
    const problemaAfter = after.problema;
    if (!problemaAfter) return;
    if (problemaAfter.estado !== "ELEVADO") return;
    if (problemaBefore?.estado === "ELEVADO") return;

    const numero = after.numero || event.params.id;
    const tipo = problemaAfter.tipo === "FALTA_STOCK" ? "falta de stock" : "otro problema";
    const producto = problemaAfter.productoNombre || "un producto";
    const nota = problemaAfter.notaEncargado ? ` — ${problemaAfter.notaEncargado}` : "";

    logger.info("Problema elevado a ventas:", numero);

    // Notificar a todos los usuarios de ventas (rol o role)
    const [snapRol, snapRole] = await Promise.all([
      db.collection("users").where("rol", "==", "ventas").get(),
      db.collection("users").where("role", "==", "ventas").get(),
    ]);

    const seen = new Set();
    const tokens = [];
    [...snapRol.docs, ...snapRole.docs].forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: `🚨 Problema escalado — Pedido ${numero}`,
      body: `${tipo} en "${producto}"${nota}. Requiere atención.`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
  }
);


// ======================================================================
// FINNEGANS MODULE
// ======================================================================

const { finnegansPing } = require("./finnegans/endpoints");
exports.finnegansPing = finnegansPing;

const { finnegansGetCliente, finnegansCrearPedidoVenta } = require("./finnegans/orders");
exports.finnegansGetCliente = finnegansGetCliente;
exports.finnegansCrearPedidoVenta = finnegansCrearPedidoVenta;

exports.finnegansListarClientes = require('./finnegans/orders').finnegansListarClientes;

const { finnegansListarProductos, finnegansConsultarStock, finnegansGetProductoDetalle } = require("./finnegans/products");
exports.finnegansListarProductos = finnegansListarProductos;
exports.finnegansGetProductoDetalle = finnegansGetProductoDetalle;
exports.finnegansConsultarStock = finnegansConsultarStock;


// ============================================================================
// 🔥 NOTIFICACIÓN PARA VENTAS (CUANDO ENTRA UN PEDIDO NUEVO WEB)
// ============================================================================
exports.notificarVendedorNuevoPedido = onDocumentCreated(
  "pedidos_web/{pedidoId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const pedido = snap.data();
    const deposito = pedido.depositoAsignado; // "R8" o "ISABELA"
    const idFinnegans = pedido.finnegansId || event.params.pedidoId;

    if (!deposito) return;

    try {
      const usersSnap = await db.collection("users")
        .where("rol", "==", "ventas")
        .where("deposito", "==", deposito)
        .get();

      const tokens = [];
      usersSnap.forEach(doc => {
        if (doc.data().fcmToken) tokens.push(doc.data().fcmToken);
      });

      if (tokens.length === 0) return;

      await sendPushNotification(tokens, {
        title: "📦 ¡Nuevo Pedido Web!",
        body: `El cliente ${pedido.clienteNombre} armó el pedido #${idFinnegans} para retirar en ${deposito}.`,
        click_action: "https://app.urualum.uy/" 
      });
    } catch (error) {
      logger.error("Error enviando notificación al vendedor:", error);
    }
  }
);

// ============================================================================
// 🔥 NOTIFICACIÓN PARA EL CLIENTE (CUANDO EL VENDEDOR CAMBIA EL ESTADO)
// ============================================================================
// ============================================================================
// 🔗 INTEGRACIÓN P1+P2: vendedor marca EN PREPARACION → crea pedido interno
// ============================================================================
exports.crearPedidoInternoDesdeWeb = onDocumentUpdated(
  "pedidos_web/{pedidoId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after  = snap.after.data();

    // Solo actuar cuando cambia de otro estado a "EN PREPARACION"
    if (before.estado === "EN PREPARACION") return;
    if (after.estado  !== "EN PREPARACION") return;
    // Evitar re-procesamiento si ya tiene link al pedido interno
    if (after.webPedidoId) return;

    const pedidoWebId    = event.params.pedidoId;
    const finnegansId    = after.finnegansId;
    const pedidoInternoId = `PEDVTA - ${String(finnegansId).trim()}`;

    try {
      const productos = (after.items || []).map(item => ({
        codigo:      item.codigo,
        descripcion: item.descripcion || "",
        cantidad:    item.cantidad    || 0,
      }));

      const existente = await db.collection("pedidos").doc(pedidoInternoId).get();

      if (existente.exists) {
        // El pedido ya fue synced desde Finnegans → solo agregar el link
        await db.collection("pedidos").doc(pedidoInternoId).update({
          webPedidoId: pedidoWebId,
          esDesdeWeb:  true,
          updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Pedido ${pedidoInternoId} vinculado con pedidos_web/${pedidoWebId}`);
      } else {
        // Crear pedido interno nuevo
        await db.collection("pedidos").doc(pedidoInternoId).set({
          id:            pedidoInternoId,
          numero:        String(finnegansId),
          cliente:       after.clienteNombre    || "",
          deposito:      after.depositoAsignado || "",
          metodoEntrega: after.metodoEntrega    || "",
          productos,
          estado:      "PENDIENTE_ASIGNAR",
          source:      "web",
          webPedidoId: pedidoWebId,
          esDesdeWeb:  true,
          timestamps: { creado: admin.firestore.FieldValue.serverTimestamp() },
          updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`Pedido interno creado: ${pedidoInternoId}`);
      }

      // Guardar el link en pedidos_web para que el frontend lo muestre
      await db.collection("pedidos_web").doc(pedidoWebId).update({
        webPedidoId: pedidoInternoId,
      });

      // Notificar al encargado del depósito
      const encargadoSnap = await db.collection("users")
        .where("rol",      "==", "encargado")
        .where("deposito", "==", after.depositoAsignado)
        .get();

      const tokens = [];
      encargadoSnap.forEach(d => { if (d.data().fcmToken) tokens.push(d.data().fcmToken); });
      if (tokens.length > 0) {
        await sendPushNotification(tokens, {
          title: "📦 Nuevo pedido para preparar",
          body:  `Pedido #${finnegansId} de ${after.clienteNombre} está listo para asignar.`,
          click_action: "https://app.urualum.uy/pedidos",
        });
      }
    } catch (error) {
      logger.error("Error en crearPedidoInternoDesdeWeb:", error);
    }
  }
);

exports.notificarClienteCambioEstado = onDocumentUpdated(
  "pedidos_web/{pedidoId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const dataAntes = snap.before.data();
    const dataDespues = snap.after.data();

    // Si no cambió el estado, no hacemos nada
    if (dataAntes.estado === dataDespues.estado) return;

    const clienteId = dataDespues.clienteId;
    const nuevoEstado = dataDespues.estado;
    const idFinnegans = dataDespues.finnegansId || event.params.pedidoId;

    try {
      const userDoc = await db.collection("users").doc(clienteId).get();
      if (!userDoc.exists) return;

      const tokenCliente = userDoc.data().fcmToken;
      if (!tokenCliente) return;

      let titulo = "Actualización de tu pedido";
      let cuerpo = `Tu pedido #${idFinnegans} cambió a estado: ${nuevoEstado}.`;

      if (nuevoEstado === "PREPARADO") {
        titulo = "🟢 ¡Tu pedido está listo!";
        cuerpo = `El pedido #${idFinnegans} ya está listo para retirar en ${dataDespues.metodoEntrega}.`;
      } else if (nuevoEstado === "EN PREPARACION") {
        titulo = "🟡 Pedido en preparación";
        cuerpo = `Comenzamos a preparar tu pedido #${idFinnegans}.`;
      } else if (nuevoEstado === "ERROR_STOCK") {
        titulo = "🔴 Atención con tu pedido";
        cuerpo = `Hubo una diferencia de stock con el pedido #${idFinnegans}. Un asesor se contactará contigo.`;
      }

      await sendPushNotification([tokenCliente], {
        title: titulo,
        body: cuerpo,
        click_action: "https://app.urualum.uy/"
      });
    } catch (error) {
      logger.error("Error enviando notificación al cliente:", error);
    }
  }
);

// ============================================================================
// 🔗 INTEGRACIÓN P1+P2: depósito marca PREPARADO → actualiza pedido_web
// ============================================================================
exports.sincronizarEstadoDeposito = onDocumentUpdated(
  "pedidos/{pedidoId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after  = snap.after.data();

    if (before.estado === after.estado) return;
    if (!after.esDesdeWeb || !after.webPedidoId) return;

    const webPedidoId = after.webPedidoId;

    try {
      // PREPARADO en depósito → pedido_web pasa a EN PREPARACION (en proceso)
      if (after.estado === "PREPARADO") {
        await db.collection("pedidos_web").doc(webPedidoId).update({
          estado:            "EN PREPARACION",
          fechaUltimaAccion: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`pedidos_web/${webPedidoId} → EN PREPARACION (depósito en PREPARADO)`);
      }

      // CONTROLADO en depósito → pedido_web pasa a PREPARADO automáticamente
      // El encargado ya verificó el pedido: el vendedor no necesita intervenir
      if (after.estado === "CONTROLADO") {
        await db.collection("pedidos_web").doc(webPedidoId).update({
          estado:            "PREPARADO",
          controladoAt:      admin.firestore.FieldValue.serverTimestamp(),
          fechaUltimaAccion: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`pedidos_web/${webPedidoId} → PREPARADO automático (depósito CONTROLADO)`);
      }

      // DESPACHADO en depósito → pedido_web pasa a ENTREGADO automáticamente
      if (after.estado === "DESPACHADO") {
        await db.collection("pedidos_web").doc(webPedidoId).update({
          estado:            "ENTREGADO",
          fechaUltimaAccion: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info(`pedidos_web/${webPedidoId} → ENTREGADO automático (depósito DESPACHADO)`);
      }
    } catch (error) {
      logger.error("Error en sincronizarEstadoDeposito:", error);
    }
  }
);
// ============================================================================
// NOTIFICACIONES ENCARGADO: Nuevo pedido, cambio de estado, modificación datos
// ============================================================================

// Helper: obtener tokens de todos los encargados de un depósito
async function getTokensEncargados(deposito) {
  const snap = await db.collection("users")
    .where("rol", "==", "encargado")
    .where("deposito", "==", deposito)
    .get();
  const tokens = [];
  snap.forEach(d => { if (d.data().fcmToken) tokens.push(d.data().fcmToken); });
  return tokens;
}

// 1) Nuevo pedido creado → notificar encargados del depósito
exports.notificarNuevoPedido = onDocumentCreated(
  "pedidos/{id}",
  async (event) => {
    const data = event.data?.data();
    if (!data) return;
    if (data.esCotizacion || data.deposito === "COTIZACION") return;
    if (!data.deposito) return;

    const tokens = await getTokensEncargados(data.deposito);
    if (!tokens.length) return;

    const numero = data.numero || event.params.id;
    await sendPushNotification(tokens, {
      title: "📦 Nuevo pedido",
      body: `${numero} — ${data.cliente || "Sin cliente"} (${data.metodoEntrega || "—"})`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
    logger.info(`Notificado nuevo pedido ${numero} a encargados de ${data.deposito}`);
  }
);

// 2) Cambio de estado → notificar encargados (excepto PREPARADO y ASIGNADO, ya cubiertos)
exports.notificarCambioEstado = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after  = snap.after.data();

    if (before.estado === after.estado) return;
    // PREPARADO y ASIGNADO ya tienen su propia CF
    if (["PREPARADO", "ASIGNADO"].includes(after.estado)) return;
    if (!after.deposito) return;

    const tokens = await getTokensEncargados(after.deposito);
    if (!tokens.length) return;

    const numero = after.numero || event.params.id;
    const estadoLabel = {
      PENDIENTE_ASIGNAR: "Pendiente de asignar",
      EN_PREPARACION:    "En preparación",
      CONTROLADO:        "Controlado",
      DESPACHADO:        "Despachado",
      ANULADO:           "Anulado",
    }[after.estado] || after.estado;

    await sendPushNotification(tokens, {
      title: `📋 ${estadoLabel}`,
      body: `Pedido ${numero} pasó a ${estadoLabel}`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
  }
);

// 3) Modificación de datos relevantes → notificar encargados
exports.notificarModificacionPedido = onDocumentUpdated(
  "pedidos/{id}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const before = snap.before.data();
    const after  = snap.after.data();

    if (!after.deposito) return;

    // Detectar cambios en campos relevantes
    const clienteCambio      = before.cliente      !== after.cliente;
    const metodoCambio       = before.metodoEntrega !== after.metodoEntrega;
    const productosCambio    = JSON.stringify(before.productos || []) !== JSON.stringify(after.productos || []);

    if (!clienteCambio && !metodoCambio && !productosCambio) return;

    const tokens = await getTokensEncargados(after.deposito);
    if (!tokens.length) return;

    const numero = after.numero || event.params.id;
    const cambios = [
      clienteCambio   && "cliente",
      metodoCambio    && "método de entrega",
      productosCambio && "productos/cantidades",
    ].filter(Boolean).join(", ");

    await sendPushNotification(tokens, {
      title: "✏️ Pedido modificado",
      body: `${numero}: cambió ${cambios}`,
      click_action: `https://app.urualum.uy/pedidos/${event.params.id}`,
    });
    logger.info(`Notificada modificación en pedido ${numero}: ${cambios}`);
  }
);

// ======================================================================
// CLOUD FUNCTION: despacharEnFinnegans
// Recibe { pedidoId, depositoCodigo } y crea el remito en Finnegans
// ======================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");

const FINN_TOKEN_URL    = "https://api.teamplace.finneg.com/api/oauth/token";
const FINN_CLIENT_ID    = "9a149172296f240d211a150e149fee06";
const FINN_CLIENT_SECRET= "c8d871207c686405d1b8dc6ac0e9f80a";
const FINN_API_BASE     = "https://api.finneg.com/api";
const FINN_EMPRESA_COD  = "1";

// Mapa depósito app → código Finnegans
const DEPOSITO_CODIGOS = {
  "R8":      "RUTA8",
  "ISABELA": "ISABELA",
};

// Mapa nombre condición de pago → código Finnegans
const CONDICION_PAGO_MAP = {
  "10 dias":               "10",
  "15 dias":               "15",
  "3 cuotas":              "3 CUOTAS",
  "30 dias":               "30",
  "30, 60 y 90 días":      "306090",
  "30, 60 y 90 dias":      "306090",
  "60 dias":               "60",
  "7 dias":                "7 dias",
  "90 dias":               "90",
  "contado efectivo":      "CE",
  "crédito":               "CREDITO",
  "credito":               "CREDITO",
  "débito automático":     "DEBAUT",
  "debito automatico":     "DEBAUT",
  "fecha del documento":   "CPG_FECHADOC",
  "tarjeta de debito":     "TARJDEB",
  "tarjeta de débito":     "TARJDEB",
  "transferencia bancaria":"Transferencia",
  "transferencia":         "Transferencia",
};

function resolverCondicionPagoCod(nombre) {
  if (!nombre) return null;
  return CONDICION_PAGO_MAP[nombre.toLowerCase().trim()] || null;
}

function extraerCodigoProd(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  // Intento 1: prefijo numérico  "512523 Descripcion" → "512523"
  const numMatch = s.match(/^(\d+)\s/);
  if (numMatch) return numMatch[1];
  // Intento 2: token alfanumérico sin espacios al inicio "PERFAB Descripcion" → "PERFAB"
  const alphaMatch = s.match(/^([A-Z0-9_-]+)\s/i);
  if (alphaMatch) return alphaMatch[1];
  // Fallback: devolver tal cual (puede ser solo descripción, se valida después)
  return s;
}

function esCodValido(cod) {
  // Un código válido no tiene espacios y no es una oración en español
  if (!cod) return false;
  if (cod.includes(" ")) return false;   // "Perfiles Abollados" → false
  if (cod.length > 30) return false;
  return true;
}

// Busca el código Finnegans de un producto por su descripción usando GET /producto/list
async function resolverCodigoProducto(desc, token) {
  if (!desc) return null;
  try {
    const url = `${FINN_API_BASE}/producto/list?ACCESS_TOKEN=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const txt = await res.text();
    let lista;
    try { lista = JSON.parse(txt); } catch { return null; }
    if (!Array.isArray(lista)) return null;

    const descNorm = desc.toLowerCase().trim();
    // Buscar coincidencia exacta o parcial en nombre/descripción
    const encontrado = lista.find(p => {
      const nombre = String(p.Nombre || p.nombre || p.DESCRIPCION || p.descripcion || "").toLowerCase();
      return nombre === descNorm || nombre.includes(descNorm) || descNorm.includes(nombre);
    });
    const cod = encontrado?.Codigo || encontrado?.codigo || encontrado?.PRODUCTOCODIGO || null;
    if (cod) logger.info(`[resolverCodigoProducto] "${desc}" → "${cod}"`);
    return cod ? String(cod) : null;
  } catch (e) {
    logger.warn(`[resolverCodigoProducto] error buscando "${desc}":`, e.message);
    return null;
  }
}

async function getFinnToken() {
  const url = `${FINN_TOKEN_URL}?grant_type=client_credentials&client_id=${FINN_CLIENT_ID}&client_secret=${FINN_CLIENT_SECRET}`;
  const res = await fetch(url);
  const txt = await res.text();
  const token = txt.replace(/"/g, "").trim();
  if (!token) throw new Error("No se pudo obtener token de Finnegans");
  return token;
}

/**
 * Llama a GET /cliente/{codigo} y devuelve { rut, condicionPagoCod }
 * Un solo request resuelve tanto el RUT como la condición de pago default del cliente.
 */
async function getClienteInfo(clienteCodigo, token) {
  if (!clienteCodigo) return {};
  try {
    const url = `${FINN_API_BASE}/cliente/${encodeURIComponent(clienteCodigo)}?ACCESS_TOKEN=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn(`[despacharEnFinnegans] GET /cliente/${clienteCodigo} → ${res.status}`);
      return {};
    }
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { return {}; }

    // Según la documentación oficial: el RUT está en IdentificacionTributariaNumero
    const rut = String(
      data?.IdentificacionTributariaNumero || data?.IdentificacionTributaria?.Numero ||
      data?.NroDeIdentificacion || data?.NRODEIDENTIFICACION ||
      data?.Rut || data?.RUT || data?.rut || ""
    ).trim() || null;

    // Condición de pago del cliente: puede venir como código o como nombre
    const cpNombre = String(
      data?.CondicionPago || data?.CONDICIONPAGO ||
      data?.CondicionPagoNombre || data?.condicionPago || ""
    ).trim() || null;
    const cpCod = String(
      data?.CondicionPagoCodigo || data?.CONDICIONPAGOCODIGO ||
      data?.condicionPagoCodigo || ""
    ).trim() || resolverCondicionPagoCod(cpNombre) || null;

    logger.info(`[despacharEnFinnegans] Cliente ${clienteCodigo} → RUT=${rut} | condicionPago=${cpCod || cpNombre}`);
    return { rut, condicionPagoCod: cpCod, condicionPagoNombre: cpNombre };
  } catch (e) {
    logger.warn(`[despacharEnFinnegans] No se pudo obtener info del cliente ${clienteCodigo}:`, e.message);
    return {};
  }
}

exports.despacharEnFinnegans = onCall({ region: "us-central1" }, async (request) => {
  // Solo usuarios autenticados
  if (!request.auth) throw new HttpsError("unauthenticated", "No autenticado");

  const { pedidoId, modoTest = true, clienteRUTOverride = null } = request.data;
  if (!pedidoId) throw new HttpsError("invalid-argument", "Falta pedidoId");

  // 1. Leer pedido de Firestore
  const pedidoSnap = await db.collection("pedidos").doc(pedidoId).get();
  if (!pedidoSnap.exists) throw new HttpsError("not-found", `Pedido ${pedidoId} no encontrado`);
  const pedido = pedidoSnap.data();

  // 2. Resolver campos necesarios
  const depositoApp = pedido.deposito;
  const depositoCod = DEPOSITO_CODIGOS[depositoApp];
  const productos   = Array.isArray(pedido.productos) ? pedido.productos : [];
  const fecha       = new Date().toISOString().slice(0, 10);

  if (!depositoCod)       throw new HttpsError("failed-precondition", `Depósito desconocido: "${depositoApp}"`);
  if (productos.length === 0) throw new HttpsError("failed-precondition", "El pedido no tiene productos");

  // 2b. Resolver clienteRUT y condicionPagoCod
  //     Primero usamos lo que hay en Firestore (o el override de test).
  //     Si falta alguno y hay clienteCodigo, hacemos UN solo GET /cliente para enriquecer.
  let clienteRUT     = clienteRUTOverride || pedido.clienteRUT || null;
  let condicionPagoCod2 = pedido.condicionPagoCod || resolverCondicionPagoCod(pedido.condicionPago) || null;

  const necesitaLookup = (!clienteRUT || !condicionPagoCod2) && pedido.clienteCodigo;
  if (necesitaLookup) {
    logger.info(`[despacharEnFinnegans] Enriqueciendo desde /cliente/${pedido.clienteCodigo}…`);
    const tokenTemp  = await getFinnToken();
    const info       = await getClienteInfo(pedido.clienteCodigo, tokenTemp);
    if (!clienteRUT        && info.rut)            clienteRUT        = info.rut;
    if (!condicionPagoCod2 && info.condicionPagoCod) condicionPagoCod2 = info.condicionPagoCod;

    // Persistir lo que encontramos para la próxima vez
    const patch = {};
    if (info.rut)            patch.clienteRUT        = info.rut;
    if (info.condicionPagoCod) patch.condicionPagoCod = info.condicionPagoCod;
    if (Object.keys(patch).length > 0) {
      await db.collection("pedidos").doc(pedidoId).update(patch);
    }
  }

  if (!clienteRUT)        throw new HttpsError("failed-precondition", `No se pudo obtener el RUT del cliente. clienteCodigo="${pedido.clienteCodigo || "ausente"}"`);
  if (!condicionPagoCod2) throw new HttpsError("failed-precondition", `No se pudo resolver condición de pago. Valor en pedido: "${pedido.condicionPago || "ausente"}"`);


  // 3. Resolver códigos de productos (y buscar en Finnegans los que no tienen código válido)
  // Hacemos un token temprano solo si hay productos sin código válido
  const hayCodigosInvalidos = productos.some(it => !esCodValido(extraerCodigoProd(it.cod)));
  const tokenItems = hayCodigosInvalidos ? await getFinnToken() : null;

  const itemsResueltos = await Promise.all(productos.map(async it => {
    let cod = extraerCodigoProd(it.cod);
    if (!esCodValido(cod)) {
      // El cod es una descripción — buscar el código real en Finnegans
      const codResuelto = await resolverCodigoProducto(it.desc || it.cod, tokenItems);
      if (codResuelto) {
        cod = codResuelto;
      } else {
        throw new HttpsError("failed-precondition",
          `No se encontró el código de producto para "${it.desc || it.cod}". Verificá que el producto exista en Finnegans.`
        );
      }
    }
    return { ...it, _codResuelto: cod };
  }));

  // 3b. Armar items con los códigos resueltos
  const tokenFinal = modoTest ? null : (tokenItems || await getFinnToken());
  const items = itemsResueltos.map(it => ({
    ProductoCodigo:       it._codResuelto,
    Cantidad:             it.cant ?? it.cantidad ?? 0,
    Precio:               it.precioUSD ?? 0,
    Importe:              0,                          // Finnegans lo recalcula
    IdentificacionExterna: "",
    PrecioBase:           it.precioUSD ?? 0,
    PrecioTipo:           0,
    DepositoOrigenCodigo: depositoCod,
    vinculacionOrigen:    pedidoId,                   // ej: "PEDVTA - 18672"
    PartidaNumero:        null,
    PartidaFechaVto:      null,
    NumeroSerie:          "",
    DimensionDistribucion: [{
      dimensionCodigo:    "DIMCTC",
      distribucionCodigo: "",
      tipoCalculo:        "0",
      distribucionItems:  [{ codigo: "CC03", porcentaje: 100, importe: 0 }]
    }]
  }));

  // 4. Armar payload completo
  const payload = {
    IdentificacionExterna:    pedidoId,
    Fecha:                    fecha,
    Cliente:                  clienteRUT,
    CondicionPagoCodigo:      condicionPagoCod2,
    NumeroDocumento:          "",               // Finnegans lo genera solo
    TransaccionTipoCodigo:    "OPER",
    TransaccionSubtipoCodigo: "REMVTA",
    WorkflowCodigo:           "VENTAS",
    Descripcion:              "",
    EmpresaCodigo:            FINN_EMPRESA_COD,
    Nombre:                   "",
    Items:                    items,
  };

  logger.info(`[despacharEnFinnegans] pedido=${pedidoId} deposito=${depositoCod} items=${items.length} modoTest=${modoTest}`);

  // 5. Si es modo test, devolver el payload sin llamar a Finnegans
  if (modoTest) {
    return {
      modoTest: true,
      mensaje: "Payload listo — NO se envió a Finnegans (modoTest=true)",
      payload,
    };
  }

  // 6. Llamar a Finnegans
  const token = tokenFinal || await getFinnToken();
  const url   = `${FINN_API_BASE}/despachoVenta?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const res   = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  const txt = await res.text();
  let respuesta;
  try { respuesta = JSON.parse(txt); } catch { respuesta = txt; }

  if (!res.ok || respuesta?.status !== 200) {
    logger.error("[despacharEnFinnegans] Error Finnegans:", respuesta);
    throw new HttpsError("internal", `Finnegans rechazó el despacho: ${JSON.stringify(respuesta)}`);
  }

  // 7. Guardar el número de remito generado en Firestore
  await db.collection("pedidos").doc(pedidoId).update({
    remitoCodigo:   respuesta.documento,
    remitoId:       respuesta.id,
    despachado_finnegans_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info(`[despacharEnFinnegans] Remito creado: ${respuesta.documento}`);
  return {
    modoTest:  false,
    remito:    respuesta.documento,
    remitoId:  respuesta.id,
    mensaje:   `Despacho creado en Finnegans: ${respuesta.documento}`,
  };
});
