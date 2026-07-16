import { describe, it, expect } from "vitest";
import {
  groupValueOnDrop,
  initialGroupValue,
  cardDndId,
  parseDndId,
  shouldShowKanbanAddButton,
  buildCardProps,
} from "@/lib/client/kanban";

type StubProp = { id: string; name: string; type: string; position: number };
const p = (id: string, name: string, position: number, type = "text"): StubProp => ({
  id,
  name,
  type,
  position,
});

describe("identité DnD des cartes (colonne::record)", () => {
  it("une même carte dans deux colonnes a deux ids distincts", () => {
    expect(cardDndId("a", "rec1")).not.toBe(cardDndId("c", "rec1"));
  });

  it("parseDndId retrouve la colonne DE DÉPART et le record", () => {
    expect(parseDndId(cardDndId("a", "rec1"))).toEqual({ colId: "a", recordId: "rec1" });
  });

  it("un id nu désigne une colonne (droppable), pas une carte", () => {
    expect(parseDndId("__null__")).toEqual({ colId: "__null__", recordId: null });
  });

  it("ne coupe qu'au premier séparateur (les cuid n'en contiennent pas)", () => {
    expect(parseDndId("col::rec::x")).toEqual({ colId: "col", recordId: "rec::x" });
  });
});

describe("groupValueOnDrop — multiselect", () => {
  it("AC1 : carte sans valeur déposée sur l'option X → [X] (tableau)", () => {
    expect(groupValueOnDrop("multiselect", undefined, null, "X")).toEqual(["X"]);
  });

  it("AC2 : [A, C] déplacée de A vers B → [C, B] (A retiré, C conservé)", () => {
    expect(groupValueOnDrop("multiselect", ["A", "C"], "A", "B")).toEqual(["C", "B"]);
  });

  it("AC4 : dépôt dans « Sans valeur » → null (clé retirée, aucune valeur résiduelle)", () => {
    expect(groupValueOnDrop("multiselect", ["A", "C"], "A", null)).toBeNull();
  });

  it("pas de doublon si la cible est déjà présente", () => {
    expect(groupValueOnDrop("multiselect", ["A", "B"], "A", "B")).toEqual(["B"]);
    expect(groupValueOnDrop("multiselect", ["B"], null, "B")).toEqual(["B"]);
  });

  it("valeur corrompue (string au lieu d'un tableau) → repartie sur [cible]", () => {
    expect(groupValueOnDrop("multiselect", "A", "A", "B")).toEqual(["B"]);
  });

  it("valeur absente et source null → [cible]", () => {
    expect(groupValueOnDrop("multiselect", null, null, "X")).toEqual(["X"]);
  });
});

describe("groupValueOnDrop — select (non-régression)", () => {
  it("dépôt sur une option → l'id d'option (string)", () => {
    expect(groupValueOnDrop("select", "A", "A", "B")).toBe("B");
  });

  it("dépôt dans « Sans valeur » → null (clé retirée)", () => {
    expect(groupValueOnDrop("select", "A", "A", null)).toBeNull();
  });

  it("ignore la valeur courante", () => {
    expect(groupValueOnDrop("select", undefined, null, "X")).toBe("X");
  });
});

describe("initialGroupValue (création de carte dans une colonne)", () => {
  it("multiselect → tableau d'un id", () => {
    expect(initialGroupValue("multiselect", "X")).toEqual(["X"]);
  });

  it("select → string", () => {
    expect(initialGroupValue("select", "X")).toBe("X");
  });

  it("colonne « Sans valeur » → null (aucune clé posée)", () => {
    expect(initialGroupValue("multiselect", null)).toBeNull();
    expect(initialGroupValue("select", null)).toBeNull();
  });
});

describe("shouldShowKanbanAddButton (garde du flag createInUnassignedOnly)", () => {
  it("flag désactivé → bouton sur toutes les colonnes (option ET « Sans valeur »)", () => {
    expect(shouldShowKanbanAddButton(false, "opt-a")).toBe(true);
    expect(shouldShowKanbanAddButton(false, null)).toBe(true);
  });

  it("flag activé → bouton UNIQUEMENT sur la colonne « Sans valeur » (optionId === null)", () => {
    expect(shouldShowKanbanAddButton(true, null)).toBe(true);
    expect(shouldShowKanbanAddButton(true, "opt-a")).toBe(false);
  });
});

describe("buildCardProps — propriétés affichées/éditables sur la carte", () => {
  it("AC4 : « Main à » et « Projet » en position 3 et 4 sont TOUJOURS présentes (hors slice(0,2))", () => {
    const props = [
      p("t", "Nom", 100, "title"),
      p("axe", "Statut", 200, "select"),
      p("p1", "Priorité", 300),
      p("p2", "Estimation", 400),
      p("main", "Main à", 500),
      p("proj", "Projet", 600),
    ];
    const result = buildCardProps(props, "axe");
    const names = result.map((r) => r.name);
    // Top-2 par position (hors title/axe) = Priorité, Estimation → puis forcées.
    expect(names).toContain("Main à");
    expect(names).toContain("Projet");
    expect(names).toEqual(["Priorité", "Estimation", "Main à", "Projet"]);
  });

  it("exclut la propriété title et l'axe de regroupement", () => {
    const props = [
      p("t", "Nom", 100, "title"),
      p("axe", "Statut", 200, "select"),
      p("p1", "Priorité", 300),
    ];
    const result = buildCardProps(props, "axe");
    expect(result.map((r) => r.id)).toEqual(["p1"]);
  });

  it("ne duplique pas une propriété forcée déjà dans le top-2", () => {
    const props = [
      p("main", "Main à", 100),
      p("proj", "Projet", 200),
      p("p3", "Autre", 300),
    ];
    const result = buildCardProps(props, undefined);
    // Main à + Projet sont déjà le top-2 ; pas de doublon, Autre exclue.
    expect(result.map((r) => r.id)).toEqual(["main", "proj"]);
    expect(result.filter((r) => r.name === "Main à")).toHaveLength(1);
  });

  it("match par nom insensible à la casse et aux accents", () => {
    const props = [
      p("x", "Colonne X", 100),
      p("y", "Colonne Y", 200),
      p("main", "MAIN A", 300), // sans accent, majuscules
      p("proj", "projet", 400), // minuscules
    ];
    const result = buildCardProps(props, undefined);
    expect(result.map((r) => r.id)).toContain("main");
    expect(result.map((r) => r.id)).toContain("proj");
  });

  it("sans propriété forcée : comportement historique = top-2 par position", () => {
    const props = [
      p("p1", "Un", 100),
      p("p2", "Deux", 200),
      p("p3", "Trois", 300),
    ];
    const result = buildCardProps(props, undefined);
    expect(result.map((r) => r.id)).toEqual(["p1", "p2"]);
  });
});
