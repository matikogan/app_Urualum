// Wrappers defensivos para tu API real.
// Ajustá los nombres de parámetro si tu API usa otros.

import {
  getPedidosPendientes as rawGetPedidosPendientes,
  getResumenStock as rawGetResumenStock,
  getDespacho as rawGetDespacho,
} from "./finnegans";

// Utilidad: YYYY-MM-DD en local sin tz issues
function toYMD(d = new Date()) {
  const iso = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString();
  return iso.slice(0,10);
}
function last30Days() {
  const hoy = new Date();
  const desde = new Date(); desde.setDate(hoy.getDate() - 30);
  return { fechaDesde: toYMD(desde), fechaHasta: toYMD(hoy) };
}

// ----- Wrappers seguros -----

export async function getPedidosPendientesSafe(opts = {}) {
  const { fechaDesde, fechaHasta } = (
    opts && (opts.fechaDesde || opts.fechaHasta) ? opts : last30Days()
  );
  // Si tu API usa OTROS nombres, cámbialos acá:
  return rawGetPedidosPendientes({ fechaDesde, fechaHasta });
}

export async function getResumenStockSafe(opts = {}) {
  // Si tu API espera "fechaCorte" en lugar de "fecha", cámbialo acá:
  const fecha = opts?.fecha || toYMD(new Date());
  return rawGetResumenStock({ fecha });
}

export async function getDespachoSafe(opts = {}) {
  // Ajustá si tu API espera otra clave (ej. "numeroDocumento")
  const numero = opts?.numero ?? null;
  return rawGetDespacho({ numero });
}
