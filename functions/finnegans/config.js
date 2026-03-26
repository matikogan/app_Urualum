// functions/finnegans/config.js

function getFinnegansConfig() {
  const tokenUrl = process.env.FINN_TOKEN_URL;
  const clientId = process.env.FINN_CLIENT_ID;
  const clientSecret = process.env.FINN_CLIENT_SECRET;

  // Base usada hoy por tu sistema
  const baseUrl = process.env.FINN_API_BASE_URL || "https://api.finneg.com/api";

  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error(
      "Missing Finnegans env vars. Define FINN_TOKEN_URL, FINN_CLIENT_ID, FINN_CLIENT_SECRET"
    );
  }

  return { tokenUrl, clientId, clientSecret, baseUrl };
}

module.exports = { getFinnegansConfig };
