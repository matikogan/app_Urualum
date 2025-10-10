export const ORDEN_ESTADOS = [
  "PENDIENTE_ASIGNAR",
  "ASIGNADO",
  "EN_PREPARACION",
  "PREPARADO",
  "CONTROLADO",
  "DESPACHADO"
];

export function ordenarEstados(estados = []) {
  const idx = new Map(ORDEN_ESTADOS.map((e,i)=>[e,i]));
  return [...estados].sort((a,b)=>(idx.get(a)??99)-(idx.get(b)??99));
}

function bucketFecha(ts) {
  if (!ts) return "ÚLTIMO MES";
  const d = ts instanceof Date ? ts : new Date(ts);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const dif = (hoy - new Date(d.setHours(0,0,0,0))) / 86400000;
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
