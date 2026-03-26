// functions/finnegans/http.js
const fetch = require("node-fetch");
const { getFinnegansConfig } = require("./config");
const { getAccessToken } = require("./token");

function withAccessToken(url, token) {
  // agrega ACCESS_TOKEN respetando si ya había query
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}ACCESS_TOKEN=${encodeURIComponent(token)}`;
}

async function finRequest({ method, path, body }) {
  const { baseUrl } = getFinnegansConfig();
  const token = await getAccessToken();

  if (!baseUrl) throw new Error("FINN_API_BASE_URL is not defined");
  if (!token) throw new Error("Finnegans access token missing");

  // baseUrl ejemplo: https://api.finneg.com/api
  let url = `${baseUrl}${path}`;

  // IMPORTANTE: Finnegans (según doc) usa ACCESS_TOKEN en query
  url = withAccessToken(url, token);

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    // Dejamos también Authorization por si Finnegans lo tolera
    Authorization: `Bearer ${token}`,
  };

  const init = { method, headers };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }

  return { ok: res.ok, status: res.status, data, urlSent: url, bodySent: body };
}

module.exports = { finRequest };
