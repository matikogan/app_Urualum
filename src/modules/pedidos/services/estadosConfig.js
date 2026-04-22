/**
 * estadosConfig.js — Fuente única de verdad para labels, iconos y colores de estados.
 *
 * Importar desde aquí en toda la app. Al cambiar un label acá, cambia en pipeline Y encargado.
 *
 * Estructura por item:
 *   id          — valor exacto del campo `estado` en Firestore (o virtual para DESP_*)
 *   label       — texto visible en cabeceras de columna y secciones
 *   icon        — emoji representativo
 *   color       — color de texto
 *   bg          — fondo de tarjeta / sección
 *   border      — borde de tarjeta / sección
 *   headerBg    — fondo de cabecera de columna (pipeline)
 *   ventasAction — true → columna resaltada en pipeline (ventas debe actuar)
 *   fromDespachos — true → datos vienen de pedidos_despachados
 */

// ─── ISABELA ────────────────────────────────────────────────────────────────
export const FLUJO_ISABELA = [
  {
    id: "PENDIENTE_ASIGNAR",
    label: "Pendiente",
    icon: "⏳",
    color: "#92400e",
    bg: "#fffbeb",
    border: "#fde68a",
    headerBg: "#fef3c7",
    ventasAction: false,
  },
  {
    id: "EN_PREPARACION",
    label: "En preparación",
    icon: "⚙️",
    color: "#0369a1",
    bg: "#f0f9ff",
    border: "#bae6fd",
    headerBg: "#e0f2fe",
    ventasAction: false,
  },
  {
    id: "CON_ERROR",
    label: "Con error",
    sublabel: "Verificar con encargado",
    icon: "🔴",
    color: "#b91c1c",
    bg: "#fff1f2",
    border: "#fca5a5",
    headerBg: "#fee2e2",
    ventasAction: true,
  },
  {
    // El encargado finaliza preparación → escribe CONTROLADO en Firestore.
    // Desde acá ventas despacha.
    id: "CONTROLADO",
    label: "Para despachar",
    sublabel: "Acción requerida",
    icon: "✅",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    headerBg: "#dcfce7",
    ventasAction: true,
  },
  {
    // Virtual: pedidos en pedidos_despachados (necesitaControl !== false)
    // o en colección pedidos con estado DESPACHADO.
    id: "DESP_PENDIENTE",
    label: "Despachado · entregar",
    sublabel: "En poder del encargado",
    icon: "🚚",
    color: "#b45309",
    bg: "#fffbeb",
    border: "#fde68a",
    headerBg: "#fef3c7",
    ventasAction: false,
    fromDespachos: true,
    isabelaOnly: true,
  },
  {
    // Virtual: pedidos en pedidos_despachados con necesitaControl === false.
    id: "DESP_ENTREGADO",
    label: "Entregado",
    icon: "☑️",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    headerBg: "#dcfce7",
    ventasAction: false,
    fromDespachos: true,
    isabelaOnly: true,
  },
];

// ─── R8 ─────────────────────────────────────────────────────────────────────
//
// Flujo completo R8:
//   PENDIENTE_ASIGNAR → (encargado asigna operario) →
//   ASIGNADO          → (operario inicia) →
//   EN_PREPARACION    → (operario termina OK) → PREPARADO
//                       (operario reporta problema) → CON_ERROR
//   CON_ERROR         → (encargado revisa: confirma) → ERROR_CONFIRMADO
//                       (encargado revisa: resuelve)  → EN_PREPARACION
//   ERROR_CONFIRMADO  → (ventas corrige en Finnegans, encargado resuelve) → EN_PREPARACION
//   PREPARADO         → (encargado control físico) →
//   CONTROLADO        → (ventas despacha) → pedidos_despachados →
//   DESPACHADO        → (encargado entrega con control) → pedidos_entregados →
//   ENTREGADO
//
export const FLUJO_R8 = [
  {
    // Encargado R8 asigna operario desde acá
    id: "PENDIENTE_ASIGNAR",
    label: "Pendiente",
    icon: "⏳",
    color: "#92400e",
    bg: "#fffbeb",
    border: "#fde68a",
    headerBg: "#fef3c7",
    ventasAction: false,
  },
  {
    // Operario asignado, aún no inició
    id: "ASIGNADO",
    label: "Asignado",
    icon: "👤",
    color: "#5b21b6",
    bg: "#f5f3ff",
    border: "#c4b5fd",
    headerBg: "#ede9fe",
    ventasAction: false,
  },
  {
    // Operario clickeó "Comenzar preparación"
    id: "EN_PREPARACION",
    label: "En preparación",
    icon: "⚙️",
    color: "#0369a1",
    bg: "#f0f9ff",
    border: "#bae6fd",
    headerBg: "#e0f2fe",
    ventasAction: false,
  },
  {
    // Operario reportó problema — visible SOLO para encargado (no ventas)
    id: "CON_ERROR",
    label: "Error · revisar",
    sublabel: "Revisión del encargado",
    icon: "⚠️",
    color: "#c2410c",
    bg: "#fff7ed",
    border: "#fdba74",
    headerBg: "#ffedd5",
    ventasAction: false,   // encargado actúa primero
    r8Only: true,
  },
  {
    // Encargado confirmó el error → ventas debe corregir en Finnegans
    id: "ERROR_CONFIRMADO",
    label: "Con error",
    sublabel: "Acción requerida",
    icon: "🔴",
    color: "#b91c1c",
    bg: "#fff1f2",
    border: "#fca5a5",
    headerBg: "#fee2e2",
    ventasAction: true,
    r8Only: true,
  },
  {
    // Operario terminó — encargado hace control físico
    id: "PREPARADO",
    label: "Pendiente de control",
    sublabel: "Control del encargado",
    icon: "📦",
    color: "#0e7490",
    bg: "#f0fdfa",
    border: "#a5f3fc",
    headerBg: "#cffafe",
    ventasAction: false,
  },
  {
    // Encargado aprobó control físico → ventas despacha
    id: "CONTROLADO",
    label: "Para despachar",
    sublabel: "Acción requerida",
    icon: "✅",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    headerBg: "#dcfce7",
    ventasAction: true,
  },
  {
    // Virtual: en pedidos_despachados, pendiente de entrega al cliente
    id: "DESPACHADO",
    label: "Despachado · entregar",
    sublabel: "Control de entrega",
    icon: "🚚",
    color: "#b45309",
    bg: "#fffbeb",
    border: "#fde68a",
    headerBg: "#fef3c7",
    ventasAction: false,
    fromDespachos: true,
    r8Only: true,
  },
  {
    // Virtual: en pedidos_entregados — fin del flujo
    id: "ENTREGADO",
    label: "Entregado",
    icon: "☑️",
    color: "#15803d",
    bg: "#f0fdf4",
    border: "#86efac",
    headerBg: "#dcfce7",
    ventasAction: false,
    fromEntregados: true,
    r8Only: true,
  },
];

/**
 * Convierte un flujo (array) al formato objeto { [id]: config }
 * usado por pedidos.js para renderizar secciones del encargado.
 */
export function flujoToConfigMap(flujo) {
  return Object.fromEntries(flujo.map(e => [e.id, e]));
}
