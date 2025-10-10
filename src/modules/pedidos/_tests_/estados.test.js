import { test, expect } from "vitest";
import { puedeTransicionar } from "../services/estados.pure";


test("transición adelante es válida", () => {
  expect(puedeTransicionar("ASIGNADO","EN_PREPARACION")).toBe(true);
});
test("transición atrás es inválida", () => {
  expect(puedeTransicionar("EN_PREPARACION","ASIGNADO")).toBe(false);
});
