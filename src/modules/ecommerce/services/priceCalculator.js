// src/utils/priceCalculator.js

// Prefijos que identifican a los Perfiles de Aluminio (Sujetos a descuento)
const PREFIJOS_PERFILES = ["50", "51", "58", "60"];

/**
 * Verifica si un producto es un Perfil de Aluminio basado en su código.
 */
function esPerfilAluminio(codigoProducto) {
  if (!codigoProducto) return false;
  const codigoStr = String(codigoProducto).trim();
  
  // Revisamos si empieza con alguno de los prefijos permitidos
  return PREFIJOS_PERFILES.some(prefijo => codigoStr.startsWith(prefijo));
}

/**
 * Detecta la categoría basada en el último dígito del código.
 * 1: anodizado, 2: madera, 3: anolok, 4: blanco.
 */
export function detectarCategoria(codigoProducto) {
  if (!codigoProducto) return "default";
  const codigoStr = String(codigoProducto).trim();
  const ultimoDigito = codigoStr.slice(-1); 

  switch (ultimoDigito) {
    case "1": return "anodizado";
    case "2": return "madera";
    case "3": return "anolok";
    case "4": return "blanco";
    default: return "default"; 
  }
}

/**
 * Calcula el Precio Final NETO (Sin IVA).
 * Regla: Solo aplica descuentos si es Perfil de Aluminio (50, 51, 58, 60).
 * Caso contrario: Precio Base neto.
 */
export function calcularPrecioFinal(precioBase, reglasLista, codigoProducto) {
  // 1. Validaciones de seguridad
  const base = Number(precioBase);
  if (!base || base <= 0) return 0;

  // 2. FILTRO DE NEGOCIO: ¿Es un perfil de aluminio?
  if (!esPerfilAluminio(codigoProducto)) {
    // NO es perfil (es accesorio, goma, motor, etc.)
    // SE VENDE A PRECIO BASE NETO (Sin descuento y SIN IVA)
    return Math.round((base + Number.EPSILON) * 100) / 100;
  }

  // --- A PARTIR DE ACÁ, SABEMOS QUE ES UN PERFIL ---

  // 3. Si no hay reglas cargadas, devolvemos Base neto
  if (!reglasLista) {
    return Math.round((base + Number.EPSILON) * 100) / 100;
  }

  // 4. Detectar categoría (anodizado, blanco, etc.)
  const categoria = detectarCategoria(codigoProducto);

  // 5. Obtener porcentaje de descuento
  const descuentoPorcentaje = reglasLista[categoria] ?? reglasLista["default"] ?? 0;

  // 6. Aplicar Descuento
  const precioConDescuento = base - (base * (descuentoPorcentaje / 100));

  // 7. Redondear y devolver precio NETO
  return Math.round((precioConDescuento + Number.EPSILON) * 100) / 100;
}