// functions/finnegans/token.js
const fetch = require("node-fetch");
const { getFinnegansConfig } = require("./config");

let cachedToken = null;
let cachedExp = 0;

async function fetchToken() {
  const { tokenUrl, clientId, clientSecret } = getFinnegansConfig();

  const url =
    `${tokenUrl}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}`;

  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`Token HTTP ${r.status}`);

  const token = (await r.text()).trim();
  if (!token) throw new Error("Token vacío");

  cachedToken = token;
  cachedExp = Date.now() + 50 * 60 * 1000; // 50 min

  return token;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedExp) return cachedToken;
  return fetchToken();
}

module.exports = { getAccessToken };
