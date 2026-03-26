// src/modules/pedidos/services/moverPedidoDespachado.js

import { doc, getDoc, deleteDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";

/**
 * Mueve un pedido desde la colección "pedidos" a "pedidos_despachados".
 * NO cambia datos, solo los copia + agrega metadatos del despacho.
 */
export async function moverPedidoADespachados({ pedidoId, usuario }) {
    console.log("🔥 moverPedidoADespachados() ejecutado con:", pedidoId);

  if (!pedidoId) throw new Error("Falta pedidoId");

  const ref = doc(db, "pedidos", String(pedidoId));
  const snap = await getDoc(ref);

    console.log("📦 Documento existe en FS?", snap.exists());
    if (snap.exists()) console.log("📦 Datos:", snap.data());


  if (!snap.exists()) {
    throw new Error("Pedido no existe en la colección 'pedidos'");
  }

  const data = snap.data();

  // Guardar en la colección histórica
  await setDoc(doc(db, "pedidos_despachados", String(pedidoId)), {
    ...data,
    estado: "DESPACHADO",
    despachadoAt: serverTimestamp(),
    despachadoPor: usuario?.uid || null,
    movedAt: serverTimestamp(),
    source: "app",
  });

  // Borrar de pedidos activos
  await deleteDoc(ref);


  return { ok: true };
  console.log("🟩 Pedido movido correctamente a pedidos_despachados");

}
