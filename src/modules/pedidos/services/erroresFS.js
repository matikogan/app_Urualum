// v9 modular
import {
  collection, query, where, orderBy, limit, startAfter, getDocs,
} from "firebase/firestore";
import { db } from "../../../firebase";

/**
 * Trae errores de 'errores_preparacion' con filtros y paginado.
 * params: { desde, hasta, deposito, operarioUid, pageSize, cursor }
 * - desde/hasta: Date o timestamp ms
 * - deposito: string opcional
 * - operarioUid: string opcional
 * - pageSize: número (default 25)
 * - cursor: último doc de la página anterior (para paginar)
 *
 * Devuelve: { items, nextCursor }
 */
export async function fetchErroresPreparacion(params = {}) {
  const {
    desde, hasta, deposito, operarioUid, pageSize = 25, cursor,
  } = params;

  const col = collection(db, "errores_preparacion");
  const conds = [];

  // rango de fechas sobre 'fechaReporte'
  if (desde) conds.push(where("fechaReporte", ">=", new Date(desde)));
  if (hasta) conds.push(where("fechaReporte", "<=", new Date(hasta)));

  if (deposito) conds.push(where("deposito", "==", deposito));
  if (operarioUid) conds.push(where("responsableUid", "==", operarioUid));

  let q = query(col, ...conds, orderBy("fechaReporte", "desc"), limit(pageSize));
  if (cursor) {
    q = query(col, ...conds, orderBy("fechaReporte", "desc"), startAfter(cursor), limit(pageSize));
  }

  const snap = await getDocs(q);
  const items = snap.docs.map(d => ({ id: d.id, _doc: d, ...d.data() }));
  const nextCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null;

  return { items, nextCursor };
}
