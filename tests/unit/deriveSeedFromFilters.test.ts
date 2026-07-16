import { describe, it, expect } from "vitest";
import { deriveSeedFromFilters } from "@/lib/client/viewFilters";
import type {
  ParsedDatabaseProperty,
  ViewFilter,
  FilterOperator,
} from "@/lib/db";

// ─── Stubs de propriétés ──────────────────────────────────────────────────────

const selectProp = {
  id: "proj",
  name: "Projet",
  type: "select",
  position: 1000,
  config: { type: "select", options: [{ id: "opt1", name: "Notes", color: "blue" }] },
} as unknown as ParsedDatabaseProperty;

const select2Prop = {
  id: "statut",
  name: "Statut",
  type: "select",
  position: 2000,
  config: { type: "select", options: [{ id: "s1", name: "Ouvert", color: "green" }] },
} as unknown as ParsedDatabaseProperty;

const textProp = {
  id: "note",
  name: "Note",
  type: "text",
  position: 3000,
  config: { type: "text" },
} as unknown as ParsedDatabaseProperty;

const numberProp = {
  id: "pts",
  name: "Points",
  type: "number",
  position: 4000,
  config: { type: "number", format: "integer" },
} as unknown as ParsedDatabaseProperty;

const multiselectProp = {
  id: "tags",
  name: "Tags",
  type: "multiselect",
  position: 5000,
  config: { type: "multiselect", options: [{ id: "t1", name: "Urgent", color: "red" }] },
} as unknown as ParsedDatabaseProperty;

const relationProp = {
  id: "rel",
  name: "Liens",
  type: "relation",
  position: 6000,
  config: { type: "relation", targetDatabaseId: "db-other" },
} as unknown as ParsedDatabaseProperty;

const titleProp = {
  id: "t",
  name: "Titre",
  type: "title",
  position: 100,
  config: { type: "title" },
} as unknown as ParsedDatabaseProperty;

const ALL_PROPS = [
  selectProp,
  select2Prop,
  textProp,
  numberProp,
  multiselectProp,
  relationProp,
  titleProp,
];

const eq = (propertyId: string, value: unknown): ViewFilter =>
  ({ propertyId, operator: "eq", value }) as ViewFilter;

describe("deriveSeedFromFilters", () => {
  // ── C1 ──────────────────────────────────────────────────────────────────────
  it("C1 : un filtre eq sur un select renvoie { [propertyId]: value }", () => {
    const seed = deriveSeedFromFilters([eq("proj", "opt1")], ALL_PROPS);
    expect(seed).toEqual({ proj: "opt1" });
  });

  // ── C2 ──────────────────────────────────────────────────────────────────────
  it("C2 : un filtre eq sur un text renvoie la clé semée", () => {
    const seed = deriveSeedFromFilters([eq("note", "à relire")], ALL_PROPS);
    expect(seed).toEqual({ note: "à relire" });
  });

  it("C2 : plusieurs filtres eq sur des propriétés différentes renvoient toutes les clés", () => {
    const seed = deriveSeedFromFilters(
      [eq("proj", "opt1"), eq("statut", "s1"), eq("note", "hello")],
      ALL_PROPS
    );
    expect(seed).toEqual({ proj: "opt1", statut: "s1", note: "hello" });
  });

  // ── C3 : opérateurs non dérivables ────────────────────────────────────────────
  const nonDerivable: FilterOperator[] = [
    "neq",
    "gt",
    "lt",
    "gte",
    "lte",
    "contains",
    "notContains",
    "isEmpty",
    "isNotEmpty",
  ];

  it.each(nonDerivable)(
    "C3 : l'opérateur %s ne produit aucune clé (même sur select/text)",
    (operator) => {
      const filters: ViewFilter[] = [
        { propertyId: "proj", operator, value: "opt1" },
        { propertyId: "note", operator, value: "hello" },
      ];
      expect(deriveSeedFromFilters(filters, ALL_PROPS)).toEqual({});
    }
  );

  // ── C4 : contains sur multiselect / relation ──────────────────────────────────
  it("C4 : un contains sur un multiselect ne produit aucune clé", () => {
    const filters: ViewFilter[] = [
      { propertyId: "tags", operator: "contains", value: "t1" },
    ];
    expect(deriveSeedFromFilters(filters, ALL_PROPS)).toEqual({});
  });

  it("C4 : un contains sur une relation ne produit aucune clé", () => {
    const filters: ViewFilter[] = [
      { propertyId: "rel", operator: "contains", value: "rec-42" },
    ];
    expect(deriveSeedFromFilters(filters, ALL_PROPS)).toEqual({});
  });

  it("C4 : même un eq sur multiselect/relation ne sème rien (seuls select/text sont dérivés)", () => {
    const seed = deriveSeedFromFilters(
      [eq("tags", "t1"), eq("rel", "rec-42")],
      ALL_PROPS
    );
    expect(seed).toEqual({});
  });

  // ── Garde-fous de type de valeur ──────────────────────────────────────────────
  it("un eq sur un number (valeur numérique) ne sème rien (hors select/text)", () => {
    expect(deriveSeedFromFilters([eq("pts", 5)], ALL_PROPS)).toEqual({});
  });

  it("un eq sur un title ne sème rien (title vit dans Record.title, pas dans properties)", () => {
    expect(deriveSeedFromFilters([eq("t", "Bonjour")], ALL_PROPS)).toEqual({});
  });

  it("un eq dont la valeur n'est pas une string (tableau, null, undefined) est ignoré", () => {
    const filters: ViewFilter[] = [
      { propertyId: "proj", operator: "eq", value: ["opt1"] },
      { propertyId: "statut", operator: "eq", value: null },
      { propertyId: "note", operator: "eq" },
    ];
    expect(deriveSeedFromFilters(filters, ALL_PROPS)).toEqual({});
  });

  it("un filtre visant une propriété inexistante est ignoré", () => {
    expect(deriveSeedFromFilters([eq("ghost", "x")], ALL_PROPS)).toEqual({});
  });

  it("aucun filtre → seed vide (comportement historique préservé)", () => {
    expect(deriveSeedFromFilters([], ALL_PROPS)).toEqual({});
  });
});
