import { describe, it, expect } from "vitest";
import { applyFilters, applySorts } from "@/lib/client/viewFilters";
import type { ParsedDatabaseProperty, ParsedRecord } from "@/lib/db";

const relProp = {
  id: "rel",
  type: "relation",
  config: { type: "relation", targetDatabaseId: "dbB" },
} as unknown as ParsedDatabaseProperty;

const rec = (id: string, links?: string[]) =>
  ({ id, title: id, properties: links === undefined ? {} : { rel: links } } as unknown as ParsedRecord);

describe("applyFilters — propriété relation (sémantique multiselect)", () => {
  const records = [rec("vide", []), rec("absent"), rec("un", ["r1"]), rec("deux", ["r1", "r2"])];

  const ids = (rs: ParsedRecord[]) => rs.map((r) => r.id);

  it("isEmpty : tableau vide ET valeur absente", () => {
    expect(ids(applyFilters(records, [{ propertyId: "rel", operator: "isEmpty" }], [relProp])))
      .toEqual(["vide", "absent"]);
  });

  it("isNotEmpty : au moins un lien", () => {
    expect(ids(applyFilters(records, [{ propertyId: "rel", operator: "isNotEmpty" }], [relProp])))
      .toEqual(["un", "deux"]);
  });

  it("contains <recordId> : le lien est présent", () => {
    expect(ids(applyFilters(records, [{ propertyId: "rel", operator: "contains", value: "r2" }], [relProp])))
      .toEqual(["deux"]);
  });

  it("notContains <recordId> : le lien est absent", () => {
    expect(ids(applyFilters(records, [{ propertyId: "rel", operator: "notContains", value: "r1" }], [relProp])))
      .toEqual(["vide", "absent"]);
  });

  it("n'est plus ignoré silencieusement (avant : aucun filtre appliqué)", () => {
    const filtered = applyFilters(records, [{ propertyId: "rel", operator: "isNotEmpty" }], [relProp]);
    expect(filtered.length).toBeLessThan(records.length);
  });
});

describe("applySorts — propriété relation (par nombre de liens)", () => {
  it("trie par count croissant puis décroissant", () => {
    const records = [rec("deux", ["a", "b"]), rec("zero", []), rec("un", ["a"])];
    expect(applySorts(records, [{ propertyId: "rel", direction: "asc" }], [relProp]).map((r) => r.id))
      .toEqual(["zero", "un", "deux"]);
    expect(applySorts(records, [{ propertyId: "rel", direction: "desc" }], [relProp]).map((r) => r.id))
      .toEqual(["deux", "un", "zero"]);
  });
});
