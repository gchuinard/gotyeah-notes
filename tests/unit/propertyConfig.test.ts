import { describe, it, expect } from "vitest";
import {
  validatePropertyConfig,
  removedOptionIds,
  findReferencedOptionIds,
} from "@/lib/propertyConfig";
import type { ParsedRecord, ParsedView, SelectOption } from "@/lib/db";

const opt = (id: string, name = id, color = "blue"): SelectOption => ({ id, name, color });

const rec = (properties: Record<string, unknown>) =>
  ({ properties } as unknown as ParsedRecord);
const view = (doneStatusOptionId?: string) =>
  ({ config: { doneStatusOptionId } } as unknown as ParsedView);
const viewWithFilter = (propertyId: string, value: unknown) =>
  ({ config: { filters: [{ propertyId, operator: "eq", value }] } } as unknown as ParsedView);

describe("validatePropertyConfig", () => {
  it("accepte un select bien formé", () => {
    expect(validatePropertyConfig({ type: "select", options: [opt("o1", "Fait", "green")] }).ok).toBe(true);
  });

  it("accepte un multiselect bien formé, y compris sans option", () => {
    expect(validatePropertyConfig({ type: "multiselect", options: [] }).ok).toBe(true);
  });

  it("refuse une option sans id, à id vide ou non-string", () => {
    expect(validatePropertyConfig({ type: "select", options: [{ name: "x", color: "blue" }] }).ok).toBe(false);
    expect(validatePropertyConfig({ type: "select", options: [opt("")] }).ok).toBe(false);
    expect(validatePropertyConfig({ type: "select", options: [{ id: 42, name: "x", color: "blue" }] }).ok).toBe(false);
  });

  it("refuse un name vide", () => {
    expect(validatePropertyConfig({ type: "select", options: [opt("o1", "")] }).ok).toBe(false);
  });

  it("refuse une couleur hors palette (plus de repli gris silencieux)", () => {
    expect(validatePropertyConfig({ type: "select", options: [opt("o1", "X", "chartreuse")] }).ok).toBe(false);
  });

  it("refuse un select sans tableau d'options", () => {
    expect(validatePropertyConfig({ type: "select" }).ok).toBe(false);
  });

  it("laisse passer les types non-select tels quels (comportement historique)", () => {
    expect(validatePropertyConfig({ type: "number" }).ok).toBe(true);
    expect(validatePropertyConfig({ type: "date", includeTime: true }).ok).toBe(true);
    expect(validatePropertyConfig({ type: "text" }).ok).toBe(true);
    expect(validatePropertyConfig(undefined).ok).toBe(true);
  });
});

describe("removedOptionIds", () => {
  it("détecte les ids disparus", () => {
    expect(removedOptionIds([opt("a"), opt("b")], [opt("a")])).toEqual(["b"]);
  });
  it("un ajout ne retire rien", () => {
    expect(removedOptionIds([opt("a")], [opt("a"), opt("b")])).toEqual([]);
  });
  it("renommer/recolorer en gardant l'id ne retire rien", () => {
    expect(removedOptionIds([opt("a", "Vieux", "blue")], [opt("a", "Neuf", "red")])).toEqual([]);
  });
});

describe("findReferencedOptionIds", () => {
  const P = "prop1";

  it("aucune option retirée → aucune référence", () => {
    expect(findReferencedOptionIds(P, [], [rec({ [P]: "a" })], [])).toEqual([]);
  });

  it("référencée par un select", () => {
    expect(findReferencedOptionIds(P, ["a"], [rec({ [P]: "a" })], [])).toEqual(["a"]);
  });

  it("référencée par un multiselect", () => {
    expect(findReferencedOptionIds(P, ["b"], [rec({ [P]: ["a", "b"] })], [])).toEqual(["b"]);
  });

  it("référencée par View.config.doneStatusOptionId (backlog)", () => {
    expect(findReferencedOptionIds(P, ["done"], [], [view("done")])).toEqual(["done"]);
  });

  it("référencée par un FILTRE de vue portant sur cette propriété", () => {
    expect(findReferencedOptionIds(P, ["a"], [], [viewWithFilter(P, "a")])).toEqual(["a"]);
  });

  it("référencée par un filtre multiselect (valeur tableau)", () => {
    expect(findReferencedOptionIds(P, ["b"], [], [viewWithFilter(P, ["a", "b"])])).toEqual(["b"]);
  });

  it("un filtre sur une AUTRE propriété ne protège pas l'option", () => {
    expect(findReferencedOptionIds(P, ["a"], [], [viewWithFilter("autre", "a")])).toEqual([]);
  });

  it("non référencée → supprimable", () => {
    expect(findReferencedOptionIds(P, ["z"], [rec({ [P]: "a" })], [view("done")])).toEqual([]);
  });

  it("ignore la valeur d'une AUTRE propriété", () => {
    expect(findReferencedOptionIds(P, ["a"], [rec({ autre: "a" })], [])).toEqual([]);
  });
});
