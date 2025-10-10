// src/modules/pedidos/services/stockTiras.js
import { db } from "../../../firebase";
import {
  doc,
  getDoc,
  runTransaction,
  collection,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

/**
 * Estructura asumida:
 *  - stock_tiras/{codUru}: { piezas: number }
 *  - stock_tiras_mov/{autoId}: { ts, codUru, tipo, delta, pedidoId, usuarioId, detalle? }
 *  - (opcional) también registramos un evento de "paquete_abierto" en la misma colección
 */

export async function getStockTiras(codUru) {
  const ref = doc(db, "stock_tiras", String(codUru));
  const snap = await getDoc(ref);
  return snap.exists() ? Number(snap.data()?.piezas || 0) : 0;
}

/**
 * Confirma la preparación de UN producto:
 * - descuenta tiras sueltas usadas
 * - si abrió paquete: agrega remanente a stock_tiras
 * - registra movimientos y el evento de "paquete_abierto" (sin id único)
 *
 * Parámetros:
 *  - codUru: string
 *  - usadasSueltas: number
 *  - paquete: { packSize: number } | null
 *  - usadasDePaquete: number
 *  - pedidoId: string
 *  - usuarioId: string
 */
export async function confirmarProductoConStock({
  codUru,
  usadasSueltas = 0,
  paquete = null,           // { packSize }
  usadasDePaquete = 0,
  pedidoId,
  usuarioId,
}) {
  if (!codUru) throw new Error("codUru requerido");

  const refStock = doc(db, "stock_tiras", String(codUru));
  const movCol   = collection(db, "stock_tiras_mov");

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(refStock);
    const stockActual = snap.exists() ? Number(snap.data()?.piezas || 0) : 0;

    // 1) Descontar tiras sueltas
    if (usadasSueltas > 0) {
      if (stockActual < usadasSueltas) throw new Error("Stock de tiras insuficiente");
      tx.set(refStock, { piezas: stockActual - usadasSueltas }, { merge: true });

      tx.set(doc(movCol), {
        ts: serverTimestamp(),
        codUru,
        tipo: "consumo",
        delta: -usadasSueltas,
        pedidoId,
        usuarioId,
      });
    }

    // 2) Remanente de paquete (sin id único, solo tamaño del paquete)
    if (paquete && Number(paquete.packSize) > 0) {
      const packSize  = Number(paquete.packSize);
      const remanente = Math.max(0, packSize - Number(usadasDePaquete || 0));

      if (remanente > 0) {
        const nuevo = (snap.exists() ? stockActual : 0) - (usadasSueltas || 0) + remanente;
        tx.set(refStock, { piezas: nuevo }, { merge: true });

        tx.set(doc(movCol), {
          ts: serverTimestamp(),
          codUru,
          tipo: "alta_remanente",
          delta: remanente,
          pedidoId,
          usuarioId,
          detalle: `remanente paquete (packSize=${packSize})`,
        });
      }

      // evento de paquete abierto (si querés separarlo, usá otra colección)
      tx.set(doc(movCol), {
        ts: serverTimestamp(),
        codUru,
        tipo: "paquete_abierto",
        packSize,
        usadas: Number(usadasDePaquete || 0),
        remanente: Math.max(0, packSize - Number(usadasDePaquete || 0)),
        pedidoId,
        usuarioId,
      });
    }
  });
}

/**
 * Confirma la preparación del pedido completo (varios productos).
 * Ejecuta cada producto en su propia transacción.
 *
 * items: Array<{
 *   codUru: string,
 *   usadasSueltas: number,
 *   paquete: { packSize: number } | null,
 *   usadasDePaquete: number
 * }>
 */
export async function confirmarPedidoConStock({ items, pedidoId, usuarioId }) {
  for (const it of items) {
    await confirmarProductoConStock({ ...it, pedidoId, usuarioId });
  }
}
