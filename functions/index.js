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
      .where("role", "in", ["ventas", "encargado"])
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
      .where("role", "==", "encargado")
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

    const usersSnap = await db
      .collection("users")
      .where("role", "==", "encargado")
      .where("deposito", "==", deposito)
      .get();

    const tokens = [];
    usersSnap.forEach((doc) => {
      const t = doc.data().fcmToken;
      if (t) tokens.push(t);
    });

    await sendPushNotification(tokens, {
      title: "Error en preparación",
      body: `${numero}: ${detalle}`,
      click_action: "https://app.urualum.uy/encargado/errores",
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
        .where("role", "==", "ventas")
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