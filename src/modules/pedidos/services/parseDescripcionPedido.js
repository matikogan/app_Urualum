export const METODOS = ["AGENCIA", "RETIRA", "CAMION", "GIRA"];

/**
 * Parsea la descripción de Finnegans y devuelve { deposito, metodoEntrega, raw }.
 * - Soporta formatos “R8 - CAMION”, “ISABELA-CAMION”, “DEPÓSITO: R8 / MÉTODO: CAMION”
 * - Normaliza acentos, guiones y mayúsculas.
 * - Aplica defaults de negocio:
 *    • AGENCIA  -> deposito R8 (si no viene)
 *    • GIRA(*)  -> deposito R8 (si no viene)
 *    • Si no se aclara depósito -> R8
 *    • ISABELA sólo si aparece explícito en la descripción
 */
export function parseDescripcionPedido(descRaw = "") {
  const desc = String(descRaw ?? "").trim();
  if (!desc) return { deposito: null, metodoEntrega: null, raw: descRaw };

  const norm = desc
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[–—−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .toUpperCase();

  let deposito = null;
  let metodoEntrega = null;

  // 1) Intento de formato "DEP - METODO"
  const parts = norm.split(" - ");
  if (parts.length === 2) {
    const [a, b] = parts.map(s => s.trim());
    // detecta depósito por palabra clave
    if (/^ISABELA$/.test(a) || /DEP(OSI|OSITO)?\s*ISABELA/.test(a)) deposito = "ISABELA";
    else if (/^R8$/.test(a) || /DEP(OSI|OSITO)?\s*R8/.test(a)) deposito = "R8";

    if (METODOS.includes(b)) metodoEntrega = b;
  }

  // 2) Si no se pudo por guión, buscar keywords sueltas
  if (!deposito || !metodoEntrega) {
    if (!deposito) {
      if (/ISABELA/.test(norm)) deposito = "ISABELA";
      else if (/\bR8\b|DEP(OSI|OSITO)?\s*R8/.test(norm)) deposito = "R8";
    }
    if (!metodoEntrega) {
      const met = METODOS.find(m => norm.includes(m));
      if (met) metodoEntrega = met;
    }
  }

  // 3) Defaults de negocio
  //    - Si método AGENCIA => R8 (si no vino)
  //    - Si menciona GIRA => R8 (si no vino)
  if (!deposito) {
    if (metodoEntrega === "AGENCIA") deposito = "R8";
    else if (norm.includes("GIRA")) deposito = "R8";
  }

  // 4) Si aún falta depósito, default R8 (salvo que se haya indicado ISABELA explícito)
  if (!deposito) deposito = "R8";

  // 5) Sanitizar salida
  if (metodoEntrega && !METODOS.includes(metodoEntrega)) metodoEntrega = null;

  return { deposito: deposito || null, metodoEntrega: metodoEntrega || null, raw: descRaw };
}
