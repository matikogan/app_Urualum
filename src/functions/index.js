// functions/index.js
import * as functions from "firebase-functions";
import fetch from "node-fetch";

// Configurar estos en variables de entorno de Functions:
const TOKEN_URL = process.env.FINN_TOKEN_URL;            // p.ej. https://api.finneg.com/api/oauth/token
const CLIENT_ID = process.env.FINN_CLIENT_ID;
const CLIENT_SECRET = process.env.FINN_CLIENT_SECRET;
const API_BASE = "https://api.finneg.com/api";

async function getToken() {
  const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new functions.https.HttpsError("unavailable", `Token HTTP ${r.status}`);
  const txt = await r.text();
  return txt.trim();
}

export const postDespacho = functions.https.onCall(async (data, context) => {
  // Auth y rol
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Requiere sesión.");
  }
  const role = context.auth?.token?.role || context.auth?.token?.customClaims?.role;
  if (String(role || "").toLowerCase() !== "ventas") {
    throw new functions.https.HttpsError("permission-denied", "Solo ventas puede despachar.");
  }

  // Payload básico
  if (!data || typeof data !== "object") {
    throw new functions.https.HttpsError("invalid-argument", "Payload inválido.");
  }

  const token = await getToken();
  const url = `${API_BASE}/despachoVenta?ACCESS_TOKEN=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(data),
  });
  const txt = await resp.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* texto plano */ }

  if (!resp.ok) {
    const msg = json?.Message || json?.message || txt || `HTTP ${resp.status}`;
    throw new functions.https.HttpsError("failed-precondition", `Finnegans: ${msg}`);
  }

  return json || txt;
});
