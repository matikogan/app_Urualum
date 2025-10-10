import { test, expect } from "vitest";
import { parseDescripcionPedido } from "../services/parseDescripcionPedido";


test("parsea 'R8 - CAMION'", () => {
  expect(parseDescripcionPedido("R8 - CAMION")).toEqual(expect.objectContaining({ deposito:"R8", metodoEntrega:"CAMION" }));
});

test("tolera guiones largos y minúsculas", () => {
  const r = parseDescripcionPedido("Isabela — agencia");
  expect(r.deposito).toBe("ISABELA");
  expect(r.metodoEntrega).toBe("AGENCIA");
});

test("devuelve nulls si no encuentra", () => {
  expect(parseDescripcionPedido("pedido normal")).toEqual(expect.objectContaining({ deposito:null, metodoEntrega:null }));
});
