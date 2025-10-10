// Helpers simples de fechas en formato YYYY-MM-DD (UTC-safe)
export function toYMD(d = new Date()) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString();
  return iso.slice(0,10); // YYYY-MM-DD
}
export function daysAgo(n = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
export function last30DaysRange() {
  const hoy = new Date();
  const desde = daysAgo(30);
  return { fechaDesde: toYMD(desde), fechaHasta: toYMD(hoy) };
}
export function today() {
  return toYMD(new Date());
}
