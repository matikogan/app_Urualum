export const METODOS = ["AGENCIA", "RETIRA", "CAMION", "GIRA"];

/**
 * Parsea la descripción de Finnegans y devuelve { deposito, metodoEntrega, raw, esCotizacion }.
 * - Soporta formatos “R8 - CAMION”, “ISABELA-CAMION”, “ISA - GIRA”,
 *   “DEPÓSITO: R8 / MÉTODO: CAMION”, etc.
 * - Normaliza acentos, guiones y mayúsculas.
 * - Aplica defaults de negocio:
 *    • AGENCIA  -> deposito R8 (si no viene)
 *    • Si no se aclara depósito -> R8
 *    • ISABELA también se detecta como "ISA"
 * - Si la descripción contiene "COTIZACION", se marca esCotizacion = true
 */
export function parseDescripcionPedido(descRaw = "") {
  const desc = String(descRaw ?? "").trim();
  if (!desc) return { deposito: null, metodoEntrega: null, raw: descRaw, esCotizacion: false };

  const norm = desc
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[–—−]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .toUpperCase();

  // 🔹 0) Detectar COTIZACION
  const esCotizacion = /\bCOTI[ZC]ACION\b/.test(norm) || norm.startsWith("COTIZ");

  let deposito = null;
  let metodoEntrega = null;

  // 1) Intento de formato "DEP - METODO"
  const parts = norm.split(" - ");
  if (parts.length === 2) {
    const [a, b] = parts.map(s => s.trim());

    // detecta depósito por palabra clave (incluye ISA como alias de ISABELA)
    if (/^(ISABELA|ISA)$/.test(a) || /DEP(OSI|OSITO)?\s*(ISABELA|ISA)\b/.test(a)) {
      deposito = "ISABELA";
    } else if (/^R8$/.test(a) || /DEP(OSI|OSITO)?\s*R8\b/.test(a)) {
      deposito = "R8";
    }

    if (METODOS.includes(b)) metodoEntrega = b;
  }

  // 2) Si no se pudo por guión, buscar keywords sueltas
  if (!deposito || !metodoEntrega) {
    if (!deposito) {
      if (/ISABELA|ISA\b/.test(norm)) deposito = "ISABELA";
      else if (/\bR8\b|DEP(OSI|OSITO)?\s*R8\b/.test(norm)) deposito = "R8";
    }
    if (!metodoEntrega) {
      const met = METODOS.find(m => norm.includes(m));
      if (met) metodoEntrega = met;
    }
  }

  // 3) Defaults de negocio
  //    - Si método AGENCIA => R8 (si no vino depósito)
  if (!deposito) {
    if (metodoEntrega === "AGENCIA") deposito = "R8";
  }

  // 4) Si aún falta depósito, default R8
  if (!deposito) deposito = "R8";

  // 5) Sanitizar salida
  if (metodoEntrega && !METODOS.includes(metodoEntrega)) metodoEntrega = null;

  return {
    deposito: deposito || null,
    metodoEntrega: metodoEntrega || null,
    raw: descRaw,
    esCotizacion,
  };
}
