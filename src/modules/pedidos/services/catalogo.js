import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/firebase";

// Devuelve { bundles, pieces, finish, customerNo, ... } o null
export async function getCatalogoByCodUru(codUru) {
  if (!codUru) return null;
  const snap = await getDoc(doc(db, "catalogoProductos", String(codUru)));
  return snap.exists() ? snap.data() : null;
}
