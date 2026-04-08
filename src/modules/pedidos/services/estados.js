import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../../../utils/firebase";
import { ORDEN_ESTADOS } from "./agrupaciones";

export const ESTADOS = {
  PENDIENTE_ASIGNAR: "PENDIENTE_ASIGNAR",
  ASIGNADO: "ASIGNADO",
  EN_PREPARACION: "EN_PREPARACION",
  PREPARADO: "PREPARADO",
  CONTROLADO: "CONTROLADO",
  DESPACHADO: "DESPACHADO",
  ANULADO: "ANULADO",
};

export function puedeTransicionar(de, a) {
  // ANULADO siempre es destino válido (desde cualquier estado)
  if (a === "ANULADO") return true;
  const order = new Map(ORDEN_ESTADOS.map((e,i)=>[e,i]));
  return (order.get(a) ?? 999) >= (order.get(de) ?? -1);
}

export async function cambiarEstado(pedidoId, next, meta = {}) {
  if (!Object.values(ESTADOS).includes(next)) throw new Error("Estado inválido");
  const ref = doc(db, "pedidos", pedidoId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Pedido inexistente");
    const data = snap.data();
    const prev = data.estado || ESTADOS.PENDIENTE_ASIGNAR;
    if (!puedeTransicionar(prev, next)) throw new Error(`Transición inválida ${prev}→${next}`);

    // idempotencia: si ya está en next, no romper (actualiza touch)
    const update = {
      estado: next,
      updatedAt: serverTimestamp(),
      [`timestamps.${next}`]: serverTimestamp(),
      ...meta,
    };
    tx.set(ref, update, { merge: true });
    return { prev, next };
  });
}
