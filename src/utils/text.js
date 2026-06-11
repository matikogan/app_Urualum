// src/utils/text.js
export function norm(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos
}

/**
 * fixEncoding \u2014 corrige caracteres mal decodificados provenientes de Finnegans.
 *
 * Finnegans devuelve texto en Windows-1252/ISO-8859-1. Cuando el `fetch` lo
 * interpreta como UTF-8, algunos bytes (especialmente los de caracteres
 * especiales del espa\u00f1ol) se convierten en s\u00edmbolos extra\u00f1os.
 *
 * T\u00e9cnica: reinterpretar la cadena como si cada char fuera un byte Latin-1
 * y re-decodificar como UTF-8.
 *
 * Si la cadena ya es UTF-8 v\u00e1lido (sin mojibake), la funci\u00f3n la devuelve intacta.
 */
export function fixEncoding(str) {
  if (!str || typeof str !== "string") return str;
  try {
    // Verificamos si hay caracteres en el rango Latin-1 extendido (0x80\u20130xFF)
    // dentro del string JavaScript. Si los hay, intentamos reinterpretarlos.
    const hasHighBytes = /[\u0080-\u00ff]/.test(str);
    if (!hasHighBytes) return str; // ya es ASCII limpio, nada que hacer

    // Convertimos cada char a su byte (usando charCodeAt) y decodificamos
    // el buffer resultante como UTF-8.
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    // Sanity check: si el resultado tiene caracteres de reemplazo (U+FFFD),
    // probablemente el texto ya era UTF-8 v\u00e1lido; devolvemos el original.
    if (decoded.includes("\ufffd")) return str;
    return decoded;
  } catch (e) {
    return str;
  }
}
