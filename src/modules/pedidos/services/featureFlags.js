import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../utils/firebase";

let cache = null;
let lastFetch = 0;

export async function loadFlags() {
  const now = Date.now();
  if (cache && now - lastFetch < 60_000) return cache;
  const out = {};
  try {
    // Soporta tu esquema: config/app { liteMode: true }
    const appSnap = await getDoc(doc(db, "config", "app"));
    if (appSnap.exists()) {
      const d = appSnap.data();
      if (typeof d.liteMode === "boolean") out.MODO_LITE = d.liteMode;
    }
    // Compatibilidad con el esquema anterior: config/modes { MODO_LITE: true }
    const modesSnap = await getDoc(doc(db, "config", "modes"));
    if (modesSnap.exists()) {
      const d = modesSnap.data();
      if (typeof d.MODO_LITE === "boolean") out.MODO_LITE = d.MODO_LITE;
    }
  } catch (e) {
    console.error("featureFlags load error", e);
  }
  cache = out;
  lastFetch = now;
  return cache;
}

export async function getFlag(name) {
  const flags = await loadFlags();
  if (name in flags) return !!flags[name];
  if (name === "MODO_LITE") {
    return String(import.meta.env.VITE_MODO_LITE || "false") === "true";
  }
  return false;
}
