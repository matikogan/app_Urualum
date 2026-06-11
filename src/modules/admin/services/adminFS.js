import { doc, getDoc, updateDoc, setDoc, serverTimestamp, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../firebase";
import { ESTADOS } from "../../pedidos/services/estados";

// ─────────────────────────────────────────────
//  Estado override (el "ctrl+z" del admin)
// ─────────────────────────────────────────────

/**
 * Fuerza el estado de un pedido a cualquier valor válido,
 * saltando la validación de puedeTransicionar().
 * Deja un trail de auditoría en adminOverride.{estadoAnterior, motivo, porUid, at}.
 */
export async function adminForzarEstado(pedidoId, nuevoEstado, motivo, adminUid) {
  if (!nuevoEstado || !Object.values(ESTADOS).includes(nuevoEstado)) {
    throw new Error("Estado inválido: " + nuevoEstado);
  }
  if (!motivo?.trim()) {
    throw new Error("El motivo es obligatorio para registrar el cambio.");
  }

  const ref = doc(db, "pedidos", pedidoId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Pedido no encontrado.");

  const estadoAnterior = snap.data().estado || "PENDIENTE_ASIGNAR";

  const update = {
    estado: nuevoEstado,
    updatedAt: serverTimestamp(),
    [`timestamps.${nuevoEstado}`]: serverTimestamp(),
    adminOverride: {
      estadoAnterior,
      nuevoEstado,
      motivo: motivo.trim(),
      porUid: adminUid,
      at: serverTimestamp(),
    },
  };

  // Limpiar campos de error al salir de CON_ERROR
  if (estadoAnterior === "CON_ERROR" && nuevoEstado !== "CON_ERROR") {
    update.errorDetalle        = null;
    update.errorProductoCod    = null;
    update.errorProductoNombre = null;
    update.errorProductos      = null;
  }

  // Limpiar operario al volver a PENDIENTE_ASIGNAR
  if (nuevoEstado === "PENDIENTE_ASIGNAR") {
    update.operarioId     = null;
    update.operarioNombre = null;
  }

  await updateDoc(ref, update);
  return { estadoAnterior, nuevoEstado };
}

// ─────────────────────────────────────────────
//  Configuración de sync Finnegans
// ─────────────────────────────────────────────

const SYNC_CONFIG_DEFAULT = { diasAtras: 15 };

export async function getSyncConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "sync"));
    if (snap.exists()) return { ...SYNC_CONFIG_DEFAULT, ...snap.data() };
  } catch (e) {
    console.warn("[adminFS] No se pudo leer config/sync:", e.message);
  }
  return { ...SYNC_CONFIG_DEFAULT };
}

export async function saveSyncConfig(config) {
  await setDoc(doc(db, "config", "sync"), config, { merge: true });
}

// ─────────────────────────────────────────────
//  Helpers de consulta para el panel
// ─────────────────────────────────────────────

/** Lista de operarios (para reasignación) */
export async function listarOperarios() {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "operario")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[adminFS] listarOperarios:", e.message);
    return [];
  }
}
