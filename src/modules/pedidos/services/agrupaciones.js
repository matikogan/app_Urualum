export const ORDEN_ESTADOS = [
  "PENDIENTE_ASIGNAR",
  "ASIGNADO",
  "EN_PREPARACION",
  "CON_ERROR",
  "PREPARADO",
  "CONTROLADO",
  "DESPACHADO"
];

export const BUCKET_ORDER = ["HOY", "AYER", "ÚLTIMA SEMANA", "ÚLTIMO MES"];

export function ordenarEstados(estados = []) {
  const idx = new Map(ORDEN_ESTADOS.map((e,i)=>[e,i]));
  return [...estados].sort((a,b)=>(idx.get(a)??99)-(idx.get(b)??99));
}

/** Convierte un timestamp (Date, Firestore Timestamp, ms number) a bucket de fecha */
export function bucketFecha(ts) {
  if (!ts) return "ÚLTIMO MES";
  // Soporte para Firestore Timestamp ({ seconds, nanoseconds })
  const d = ts?.seconds ? new Date(ts.seconds * 1000) : ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d)) return "ÚLTIMO MES";
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const dCopy = new Date(d); dCopy.setHours(0,0,0,0);
  const dif = (hoy - dCopy) / 86400000;
  if (dif <= 0) return "HOY";
  if (dif <= 1) return "AYER";
  if (dif <= 7) return "ÚLTIMA SEMANA";
  return "ÚLTIMO MES";
}

export function agruparPorEstadoYFecha(pedidos = []) {
  const out = {};
  for (const p of pedidos) {
    const est = p.estado || "PENDIENTE_ASIGNAR";
    const ts = p.timestamps?.[est] || p.updatedAt || p.createdAt;
    const fecha = bucketFecha(ts);
    out[est] ||= {};
    out[est][fecha] ||= [];
    out[est][fecha].push(p);
  }
  return out;
}
