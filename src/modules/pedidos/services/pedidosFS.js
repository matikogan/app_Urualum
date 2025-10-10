// src/modules/pedidos/services/pedidosFS.js
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { ESTADOS } from "./estados";
import { getAuth } from "firebase/auth";

// DEBUG: verificar que Auth y Firestore usen la MISMA app/proyecto
console.log(
  "[pedidosFS] Firestore projectId:",
  db.app?.options?.projectId,
  "app:",
  db.app?.name
);
console.log("[pedidosFS] Auth app name:", getAuth().app?.name);
console.log("[pedidosFS] Current uid:", getAuth().currentUser?.uid ?? null);

// -------------------------------------------------------------
// LISTEN por depósito (encargado/ventas)
// -------------------------------------------------------------
export function listenPedidosByDeposito(deposito, filtros = {}) {
  console.log(
    "[listenPedidosByDeposito] deposito:",
    deposito,
    "metodo:",
    filtros?.metodoEntrega
  );
  console.log(
    "[listenPedidosByDeposito] uid al suscribir:",
    getAuth().currentUser?.uid ?? null
  );

  const col = collection(db, "pedidos");
  let qy = query(col, where("deposito", "==", deposito));
  if (filtros?.metodoEntrega) {
    qy = query(qy, where("metodoEntrega", "==", filtros.metodoEntrega));
  }

  return onSnapshot(
    qy,
    filtros?.onChange ??
      ((snapshot) => {
        console.log("[listenPedidosByDeposito] docs:", snapshot.size);
      }),
    filtros?.onError ??
      ((err) => {
        console.error("[listenPedidosByDeposito] onError:", err);
      })
  );
}

// One-shot por depósito (útil para pruebas/manual)
export async function getPedidosByDepositoOnce(deposito, metodoEntrega) {
  const col = collection(db, "pedidos");
  let qy = query(col, where("deposito", "==", deposito));
  if (metodoEntrega) qy = query(qy, where("metodoEntrega", "==", metodoEntrega));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// -------------------------------------------------------------
// Utils
// -------------------------------------------------------------
export function normalizePedidoId(n) {
  return `PEDVTA - ${String(n).trim()}`
    .replace(/\u00A0/g, " ") // NBSP -> espacio normal
    .replace(/\s+/g, " ") // colapsar espacios
    .normalize("NFC");
}

// -------------------------------------------------------------
// Upserts desde sync (no tocar reglas acá)
// -------------------------------------------------------------
export async function upsertPedidoFromSync(p) {
  const id = normalizePedidoId(p.numero);
  const ref = doc(db, "pedidos", id);
  const snap = await getDoc(ref);

  console.log("[SYNC] intento", {
    id,
    codes: [...id].map((c) => c.charCodeAt(0)),
  });

  const payload = {
    id,
    numero: p.numero,
    cliente: p.cliente,
    descripcion: p.descripcion,
    deposito: p.deposito,
    metodoEntrega: p.metodoEntrega,
    productos: p.productos,
    source: "finnegans",
  };

  if (!snap.exists()) {
    console.log("[SYNC] CREATE", id, payload);
    await setDoc(ref, {
      ...payload,
      estado: "PENDIENTE",
      timestamps: { creado: serverTimestamp() },
      updatedAt: serverTimestamp(),
    });
    return { created: true };
  } else {
    console.log("[SYNC] UPDATE (ya existía)", id);
    await setDoc(ref, { ...payload }, { merge: true });
    return { updated: true };
  }
}

export async function getPedido(id) {
  const ref = doc(db, "pedidos", id);
  const s = await getDoc(ref);
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/**
 * Asignar operario (firma simple: id + uid + nombre).
 * La regla de seguridad valida que el usuario tenga permisos y/o mismo depósito.
 */
export async function asignarOperario(pedidoId, operarioUid, operarioNombre) {
  if (!pedidoId) throw new Error("Pedido inválido");
  if (!operarioUid) throw new Error("Operario inválido");

  await updateDoc(doc(db, "pedidos", pedidoId), {
    operarioId: operarioUid,
    operarioNombre: operarioNombre || "",
    updatedAt: serverTimestamp(),
  });
}

const OP_KEYS = ["estado", "operarioId", "operarioNombre", "timestamps"];

/**
 * Upsert de sync: nunca lee. Update primero; si not-found -> create.
 * Quita siempre los campos operativos para cumplir reglas de sync.
 */
export async function upsertPedidoDesdeFinnegans(pedido) {
  if (!pedido?.id) throw new Error("pedido.id faltante");
  const ref = doc(db, "pedidos", pedido.id);

  // Base común
  const base = {
    ...pedido,
    source: "finnegans",
    updatedAt: serverTimestamp(),
  };

  // UPDATE: payload saneado (sin campos operativos)
  const updateData = { ...base };
  for (const k of OP_KEYS) delete updateData[k];

  // si viene finFecha, guardamos también su Timestamp para ordenar/filtrar bien
  if (pedido.finFecha) {
    updateData.finFecha = pedido.finFecha;
    try {
      updateData.finFechaTS = Timestamp.fromDate(
        new Date(`${pedido.finFecha}T00:00:00`)
      );
    } catch (_) {
      // si por algún motivo no parsea, dejamos solo finFecha string
    }
  }

  try {
    if (process.env.NODE_ENV !== "production") {
      console.log("[UPSYNC] update", pedido.id, updateData);
    }
    await updateDoc(ref, updateData);
    return { created: false, id: pedido.id };
  } catch (e) {
    const code = (e?.code || e?.message || "").toString().toLowerCase();
    const isNotFound =
      code.includes("not-found") || code.includes("no document to update");
    if (!isNotFound) throw e; // no es not-found → re-lanzamos (permiso u otro)
  }

  // CREATE: defaults operativos + marca de tiempo
  const createData = {
    ...updateData,
    estado: "PENDIENTE_ASIGNAR",
    timestamps: { creado: serverTimestamp() },
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, createData, { merge: false });
  return { created: true, id: pedido.id };
}

/**
 * Cambiar estado (operacional)
 * - Actualiza estado
 * - updatedAt
 * - timestamps.<ESTADO>
 */
export async function updateEstado(pedidoId, nuevoEstado) {
  if (!pedidoId) throw new Error("Pedido inválido");
  if (!nuevoEstado) throw new Error("Estado inválido");
  const ref = doc(db, "pedidos", pedidoId);
  await updateDoc(ref, {
    estado: nuevoEstado,
    updatedAt: serverTimestamp(),
    [`timestamps.${nuevoEstado}`]: serverTimestamp(),
  });
}

// -------------------------------------------------------------
// LISTEN por operario (vista operario)
// -------------------------------------------------------------
export function listenPedidosAsignadosOperario(operarioId, opts = {}) {
  const col = collection(db, "pedidos");
  let qy = query(col, where("operarioId", "==", operarioId));
  return onSnapshot(
    qy,
    opts.onChange ??
      ((snapshot) => {
        console.log("[listenPedidosAsignadosOperario] docs:", snapshot.size);
      }),
    opts.onError ??
      ((err) => {
        console.error("[listenPedidosAsignadosOperario] onError:", err);
      })
  );
}
