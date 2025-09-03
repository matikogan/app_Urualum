export async function getFinnegansToken() {
  const url = process.env.REACT_APP_FINN_TOKEN_URL;
  const client_id = process.env.REACT_APP_FINN_CLIENT_ID;
  const client_secret = process.env.REACT_APP_FINN_CLIENT_SECRET;

  const fullUrl =
    `${url}?grant_type=client_credentials` +
    `&client_id=${encodeURIComponent(client_id)}` +
    `&client_secret=${encodeURIComponent(client_secret)}`;

  const r = await fetch(fullUrl, { method: "GET" });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Error al obtener token: ${r.status} ${txt}`);
  }
  return r.text(); // Finnegans devuelve el token en texto plano
}
