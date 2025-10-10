// src/utils/qr.js
// Normaliza cualquier QR a { version, codigo, cantidad, nroPaquete, raw }
export function parseQR(rawInput) {
  const raw = typeof rawInput === "string" ? rawInput.trim() : rawInput;

  // 1) Intentar JSON
  let data = null;
  if (typeof raw === "string") {
    try { data = JSON.parse(raw); } catch { /* no JSON */ }
  } else if (raw && typeof raw === "object") {
    data = raw;
  }

  if (data && typeof data === "object") {
    const codigo =
      data.codigo_urualum || data.codigo || data.codUru || data.coduru || data.cod || null;
    const cantidad = Number(data.cantidad ?? data.qty ?? data.pieces ?? NaN);
    const nroPaqueteRaw = data.nro_paquete ?? data.paquete ?? data.packet ?? data.id ?? null;
    const nroPaquete = typeof nroPaqueteRaw === "number"
      ? nroPaqueteRaw
      : (Number(nroPaqueteRaw) || null);

    if (!codigo) return null;
    // si viene nroPaquete asumimos formato "package", si no "product"
    return {
      version: nroPaquete != null ? "package" : "product",
      codigo: String(codigo),
      cantidad: Number.isFinite(cantidad) ? cantidad : null,
      nroPaquete,
      raw: rawInput,
    };
  }

  // 2) Texto plano antiguo: "...-PKT-7"
  if (typeof raw === "string" && raw.includes("-PKT-")) {
    const [left, pktStr] = raw.split("-PKT-");
    const parts = left.split("-");
    const codigo = parts.pop();
    const nroPaquete = Number(pktStr);
    return {
      version: "package",
      codigo: String(codigo),
      cantidad: null,
      nroPaquete: Number.isFinite(nroPaquete) ? nroPaquete : null,
      raw: rawInput,
    };
  }

  // 3) Texto plano nuevo: "csv-codigo"
  if (typeof raw === "string") {
    const parts = raw.split("-");
    const codigo = parts.pop();
    return { version: "product", codigo: String(codigo), cantidad: null, nroPaquete: null, raw: rawInput };
  }

  return null;
}
