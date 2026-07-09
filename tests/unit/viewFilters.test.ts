import { describe, it, expect } from "vitest";
import { applyFilters } from "@/lib/client/viewFilters";
import type { ParsedRecord, ParsedDatabaseProperty } from "@/lib/db";

const titleProp = {
  id: "t",
  name: "Titre",
  type: "title",
  position: 1000,
  config: { type: "title" },
} as unknown as ParsedDatabaseProperty;

const selectProp = {
  id: "s",
  name: "Statut",
  type: "select",
  position: 2000,
  config: { type: "select", options: [{ id: "o1", name: "Ouvert", color: "blue" }] },
} as unknown as ParsedDatabaseProperty;

const rec = (id: string, title: string, props: Record<string, unknown> = {}): ParsedRecord =>
  ({ id, title, properties: props }) as unknown as ParsedRecord;

describe("applyFilters", () => {
  it("filtre un titre par contains (insensible à la casse)", () => {
    const out = applyFilters(
      [rec("1", "Alpha"), rec("2", "Beta")],
      [{ propertyId: "t", operator: "contains", value: "al" }],
      [titleProp]
    );
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });

  it("filtre un select par eq sur l'id d'option", () => {
    const out = applyFilters(
      [rec("1", "x", { s: "o1" }), rec("2", "y", { s: "o2" })],
      [{ propertyId: "s", operator: "eq", value: "o1" }],
      [selectProp]
    );
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });

  it("renvoie tous les records quand aucun filtre n'est fourni", () => {
    const records = [rec("1", "x"), rec("2", "y")];
    expect(applyFilters(records, [], [titleProp])).toHaveLength(2);
  });
});
