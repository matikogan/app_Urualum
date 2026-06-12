// src/modules/pedidos/services/etiquetasFinnegans.js
//
// Trae los pedidos pendientes directo del informe de Finnegans
// (reporte analisisPedidoVenta, verPendientes=2), sin tocar Firestore
// ni los estados de la app. Pensado para el módulo de Etiquetas mientras
// el flujo de estados está en standby.

import { getPedidosPendientes } from "../../../API/finnegans";
import { mapFinDocToPedido } from "./mapFinnegans";

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Devuelve los pedidos pendientes de Finnegans de la última semana
 * (hoy - 7 días hasta hoy), agrupados por pedido (un registro por pedido,
 * no por línea de producto), excluyendo cotizaciones.
 *
 * @param {{deposito?: string}} opts - si se pasa, filtra por depósito (ej: "R8")
 */
export async function fetchPedidosPendientesUltimaSemana({ deposito } = {}) {
  const hoy = new Date();
  const hace7dias = new Date();
  hace7dias.setDate(hoy.getDate() - 7);

  const fechaDesde = toYMD(hace7dias);
  const fechaHasta = toYMD(hoy);

  const filas = await getPedidosPendientes({ fechaDesde, fechaHasta });

  const pedidosMap = new Map();
  for (const fin of Array.isArray(filas) ? filas : []) {
    const p = mapFinDocToPedido(fin);
    if (!p?.id || p.esCotizacion) continue;
    if (!pedidosMap.has(p.id)) {
      pedidosMap.set(p.id, p);
    }
  }

  let pedidos = Array.from(pedidosMap.values());
  if (deposito) {
    pedidos = pedidos.filter((p) => p.deposito === deposito);
  }

  pedidos.sort((a, b) => String(a.numero || a.id).localeCompare(String(b.numero || b.id)));
  return pedidos;
}
