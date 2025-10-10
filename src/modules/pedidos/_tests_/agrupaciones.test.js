import { test, expect } from "vitest";
import { agruparPorEstadoYFecha, ordenarEstados, ORDEN_ESTADOS } from "../services/agrupaciones";


test("ordena estados por pipeline", () => {
  expect(ordenarEstados(["DESPACHADO","ASIGNADO","PREPARADO"])).toEqual(["ASIGNADO","PREPARADO","DESPACHADO"]);
  expect(ordenarEstados(ORDEN_ESTADOS)).toEqual(ORDEN_ESTADOS);
});

test("agrupar por estado y fecha", () => {
  const hoy = new Date();
  const pedidos = [
    { id:"1", estado:"ASIGNADO", timestamps:{ ASIGNADO: hoy } },
    { id:"2", estado:"DESPACHADO", timestamps:{ DESPACHADO: new Date(hoy.getTime()-2*86400000) } },
  ];
  const g = agruparPorEstadoYFecha(pedidos);
  expect(g.ASIGNADO.HOY[0].id).toBe("1");
  expect(g.DESPACHADO.AYER || g.DESPACHADO["ÚLTIMA SEMANA"]).toBeDefined();
});
