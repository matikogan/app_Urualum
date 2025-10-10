import { ORDEN_ESTADOS } from "./agrupaciones";

export const ESTADOS = {
  PENDIENTE_ASIGNAR: "PENDIENTE_ASIGNAR",
  ASIGNADO: "ASIGNADO",
  EN_PREPARACION: "EN_PREPARACION",
  PREPARADO: "PREPARADO",
  CONTROLADO: "CONTROLADO",
  DESPACHADO: "DESPACHADO",
};

export function puedeTransicionar(de, a) {
  const order = new Map(ORDEN_ESTADOS.map((e, i) => [e, i]));
  return (order.get(a) ?? 999) >= (order.get(de) ?? -1);
}
