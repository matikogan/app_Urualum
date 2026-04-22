export const METODOS = ["AGENCIA", "RETIRA", "CAMION", "GIRA"];

/** Lista canónica de agencias en el orden de carga al camión */
export const AGENCIAS = [
  { nombre: "EL CALABRES", orden: 1,  alias: ["EL CALABRES", "CALABRES"] },
  { nombre: "VENEZUELA",   orden: 2,  alias: ["VENEZUELA"] },
  { nombre: "ASTRANS",     orden: 3,  alias: ["ASTRANS"] },
  { nombre: "ECHENIQUE",   orden: 4,  alias: ["ECHENIQUE"] },
  { nombre: "ARIEL",       orden: 5,  alias: ["ARIEL"] },
  { nombre: "BERRO",       orden: 6,  alias: ["BERRO"] },
  { nombre: "ACC",         orden: 7,  alias: ["ACC"] },
  { nombre: "TRUJILLO",    orden: 8,  alias: ["TRUJILLO"] },
  { nombre: "TAMER",       orden: 9,  alias: ["TAMER"] },
  { nombre: "CUAREIM",     orden: 10, alias: ["CUAREIM"] },
  { nombre: "YI",          orden: 11, alias: ["\\bYI\\b"] },
  { nombre: "REPUBLICA",   orden: 12, alias: ["REPUBLICA"] },
  { nombre: "EL NORTEÑO",  orden: 13, alias: ["EL NORTENO", "NORTENO"] },
  { nombre: "TURIL",       orden: 14, alias: ["TURIL"] },
  { nombre: "NORESTE",     orden: 15, alias: ["NORESTE"] },
];

/**
 * Extrae el destino y/o fecha de salida que viene después del keyword "CAMION".
 * Soporta formatos:
 *   "CAMION MALDONADO"
 *   "CAMION 15/04"
 *   "CAMION 15/04/2026"
 *   "CAMION MALDONADO 15/04"
 *   "CAMION RIVERA 15-04-2026"
 * Retorna { destino: string|null, fechaStr: "YYYY-MM-DD"|null }
 */
export function detectarInfoCamion(norm = "") {
  const match = norm.match(/CAMION\s+(.*)/);
  if (!match) return { destino: null, fechaStr: null };

  let resto = match[1].trim();
  if (!resto) return { destino: null, fechaStr: null };

  let fechaStr = null;

  // Intentar extraer fecha: dd/mm, dd/mm/yy, dd/mm/yyyy, dd-mm-yyyy
  const dateRe = /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/;
  const dm = resto.match(dateRe);
  if (dm) {
    const day   = dm[1].padStart(2, "0");
    const month = dm[2].padStart(2, "0");
    let   year  = dm[3];
    if (year) {
      year = year.length === 2 ? `20${year}` : year;
    } else {
      year = String(new Date().getFullYear());
    }
    fechaStr = `${year}-${month}-${day}`;
    resto = resto.replace(dm[0], "").trim();
  }

  // Lo que queda es el destino (solo letras y números)
  const destino = resto.replace(/[^A-Z0-9\s]/g, "").trim() || null;

  return { destino: destino || null, fechaStr };
}

/** Intenta detectar la agencia a partir del texto normalizado (sin acentos, en mayúsculas) */
export function detectarAgencia(norm = "") {
  // Intentar primero en el texto que sigue después de "AGENCIA"
  const afterKeyword = norm.match(/AGENCIA\s+(.*)/);
  const searchIn = afterKeyword ? afterKeyword[1] : norm;

  for (const ag of AGENCIAS) {
    for (const alias of ag.alias) {
      // Soporta regex escapado (ej: \bYI\b) o texto plano
      const re = alias.startsWith("\\") ? new RegExp(alias) : new RegExp(`\\b${alias}\\b`);
      if (re.test(searchIn)) return ag.nombre;
    }
  }
  return null;
}

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
  let agencia = null;

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

  // 6) Detectar agencia si el método es AGENCIA
  if (metodoEntrega === "AGENCIA") {
    agencia = detectarAgencia(norm);
  }

  // 7) Detectar destino/fecha de camión si el método es CAMION
  let camionDestino = null;
  let camionFechaStr = null;
  if (metodoEntrega === "CAMION") {
    const info = detectarInfoCamion(norm);
    camionDestino  = info.destino;
    camionFechaStr = info.fechaStr;
  }

  return {
    deposito:      deposito || null,
    metodoEntrega: metodoEntrega || null,
    agencia:       agencia || null,
    camionDestino: camionDestino || null,
    camionFechaStr: camionFechaStr || null,
    raw:           descRaw,
    esCotizacion,
  };
}
