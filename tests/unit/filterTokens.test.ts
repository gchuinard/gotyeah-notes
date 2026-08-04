import { describe, it, expect } from "vitest";
import {
  resolveFilterTokens,
  applyViewConfig,
  applyFilters,
  deriveSeedFromFilters,
} from "@/lib/client/viewFilters";
import { CURRENT_USER_TOKEN } from "@/lib/db";
import type { ParsedDatabaseProperty, ParsedRecord, ViewFilter } from "@/lib/db";

const userProp = {
  id: "assignee",
  name: "Assigné",
  type: "user",
  config: { type: "user" },
} as unknown as ParsedDatabaseProperty;

const rec = (id: string, users: string[]) =>
  ({ id, title: id, position: 1000, properties: { assignee: users } } as unknown as ParsedRecord);

const ids = (rs: ParsedRecord[]) => rs.map((r) => r.id);

const meFilter: ViewFilter[] = [
  { propertyId: "assignee", operator: "contains", value: CURRENT_USER_TOKEN },
];

describe("resolveFilterTokens", () => {
  it("remplace « @me » par l'id de celui qui regarde", () => {
    expect(resolveFilterTokens(meFilter, "u1", [userProp])).toEqual([
      { propertyId: "assignee", operator: "contains", value: "u1" },
    ]);
  });

  it("laisse le filtre INTACT sans identité — une vue vide se voit, une vue qui montre tout ne se voit pas", () => {
    expect(resolveFilterTokens(meFilter, undefined, [userProp])).toEqual(meFilter);
    expect(resolveFilterTokens(meFilter, null, [userProp])).toEqual(meFilter);
    expect(resolveFilterTokens(meFilter, "", [userProp])).toEqual(meFilter);
  });

  it("ne touche pas aux filtres sans jeton et renvoie le MÊME tableau (mémos React stables)", () => {
    const plain: ViewFilter[] = [{ propertyId: "assignee", operator: "contains", value: "u2" }];
    expect(resolveFilterTokens(plain, "u1", [userProp])).toBe(plain);
  });

  it("ne résout que la valeur jeton, les autres filtres passent inchangés", () => {
    const mixed: ViewFilter[] = [
      { propertyId: "assignee", operator: "contains", value: CURRENT_USER_TOKEN },
      { propertyId: "statut", operator: "eq", value: "todo" },
    ];
    expect(resolveFilterTokens(mixed, "u1", [userProp])).toEqual([
      { propertyId: "assignee", operator: "contains", value: "u1" },
      { propertyId: "statut", operator: "eq", value: "todo" },
    ]);
  });

  it("n'invente pas de jeton : une valeur qui contient « @me » sans être égale n'est pas touchée", () => {
    const near: ViewFilter[] = [{ propertyId: "assignee", operator: "contains", value: "@members" }];
    expect(resolveFilterTokens(near, "u1", [userProp])).toBe(near);
  });

  it("le jeton n'a de sens que sur une propriété `user` : sur une colonne TEXTE il reste littéral", () => {
    const textProp = {
      id: "mention",
      name: "Mention",
      type: "text",
      config: { type: "text" },
    } as unknown as ParsedDatabaseProperty;
    const onText: ViewFilter[] = [
      { propertyId: "mention", operator: "contains", value: CURRENT_USER_TOKEN },
    ];
    // Réécrit, ce filtre chercherait un cuid dans du texte libre : la vue
    // passerait à zéro résultat pour tout le monde, sans erreur.
    expect(resolveFilterTokens(onText, "u1", [textProp])).toBe(onText);
  });

  it("une propriété inconnue du schéma ne déclenche aucune résolution", () => {
    const orphan: ViewFilter[] = [
      { propertyId: "supprimee", operator: "contains", value: CURRENT_USER_TOKEN },
    ];
    expect(resolveFilterTokens(orphan, "u1", [userProp])).toBe(orphan);
  });
});

describe("applyViewConfig — 4e argument optionnel", () => {
  const records = [rec("a", ["u1"]), rec("b", ["u2"]), rec("c", ["u1", "u2"])];
  const config = { filters: meFilter };

  it("la MÊME vue montre des cartes DIFFÉRENTES selon qui regarde", () => {
    expect(ids(applyViewConfig(records, config, [userProp], "u1"))).toEqual(["a", "c"]);
    expect(ids(applyViewConfig(records, config, [userProp], "u2"))).toEqual(["b", "c"]);
  });

  it("sans identité, la vue est vide (le jeton ne matche aucun id)", () => {
    expect(applyViewConfig(records, config, [userProp])).toEqual([]);
  });

  it("les sites d'appel à 3 arguments restent valides et inchangés", () => {
    const plain = { filters: [{ propertyId: "assignee", operator: "contains" as const, value: "u2" }] };
    expect(ids(applyViewConfig(records, plain, [userProp]))).toEqual(["b", "c"]);
  });

  it("applyFilters garde ses 3 arguments positionnels (jeton NON résolu à ce niveau)", () => {
    expect(applyFilters(records, meFilter, [userProp])).toEqual([]);
  });
});

describe("deriveSeedFromFilters — jeton résolu avant le pré-remplissage", () => {
  it("une carte créée dans une vue « Moi » naît assignée à MOI", () => {
    expect(deriveSeedFromFilters(meFilter, [userProp], "u1")).toEqual({ assignee: ["u1"] });
  });

  it("sans identité, RIEN n'est semé : semer le jeton littéral ferait échouer la création en 400", () => {
    expect(deriveSeedFromFilters(meFilter, [userProp])).toEqual({});
  });
});
