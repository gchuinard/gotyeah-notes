import { describe, it, expect } from "vitest";
import {
  buildKanbanColumns,
  groupValueOnDrop,
  NULL_COL,
  ORPHAN_COL,
  type KanbanColumnSeed,
} from "@/lib/client/kanban";
import { withoutUnknownIds } from "@/lib/db";
import type { RecordProperties } from "@/lib/db";

type Rec = { id: string; position: number; properties: RecordProperties };

const rec = (id: string, position: number, value?: unknown): Rec => ({
  id,
  position,
  properties: value === undefined ? {} : ({ axis: value } as RecordProperties),
});

const ids = (records: Rec[]) => records.map((r) => r.id);
const byId = (cols: ReturnType<typeof buildKanbanColumns<Rec>>, id: string) =>
  cols.find((c) => c.id === id);

const OPTIONS: KanbanColumnSeed[] = [
  { id: "todo", label: "À faire" },
  { id: "done", label: "Fait" },
];
const MEMBERS: KanbanColumnSeed[] = [
  { id: "u1", label: "Alice" },
  { id: "u2", label: "Bob" },
];

describe("buildKanbanColumns — axe select (scalaire)", () => {
  const records = [rec("c", 3000, "done"), rec("a", 1000, "todo"), rec("b", 2000)];
  const cols = buildKanbanColumns(records, "axis", "select", OPTIONS);

  it("« Sans valeur » en tête, puis les graines DANS LEUR ORDRE", () => {
    expect(cols.map((c) => c.id)).toEqual([NULL_COL, "todo", "done"]);
    expect(cols.map((c) => c.kind)).toEqual(["unassigned", "seed", "seed"]);
  });

  it("chaque carte est dans la colonne de sa valeur, triée par position", () => {
    expect(ids(byId(cols, "todo")!.records)).toEqual(["a"]);
    expect(ids(byId(cols, "done")!.records)).toEqual(["c"]);
    expect(ids(byId(cols, NULL_COL)!.records)).toEqual(["b"]);
  });

  it("la colonne « Sans valeur » porte optionId null (sémantique du drop)", () => {
    expect(byId(cols, NULL_COL)!.optionId).toBeNull();
    expect(byId(cols, "todo")!.optionId).toBe("todo");
  });

  it("aucune colonne orpheline sans opt-in, même sur une valeur inconnue", () => {
    const withGhost = buildKanbanColumns([rec("x", 1000, "supprimee")], "axis", "select", OPTIONS);
    expect(withGhost.map((c) => c.id)).toEqual([NULL_COL, "todo", "done"]);
  });
});

describe("buildKanbanColumns — axe multi-valeurs (user)", () => {
  const records = [
    rec("solo", 1000, ["u1"]),
    rec("duo", 2000, ["u1", "u2"]),
    rec("vide", 3000, []),
    rec("absent", 4000),
  ];
  const cols = buildKanbanColumns(records, "axis", "user", MEMBERS);

  it("les colonnes sont les MEMBRES (une propriété user n'a pas d'options)", () => {
    expect(cols.map((c) => c.id)).toEqual([NULL_COL, "u1", "u2"]);
    expect(cols.map((c) => c.label)).toEqual(["Sans valeur", "Alice", "Bob"]);
  });

  it("une carte multi-assignés apparaît dans la colonne de CHAQUE assigné", () => {
    expect(ids(byId(cols, "u1")!.records)).toEqual(["solo", "duo"]);
    expect(ids(byId(cols, "u2")!.records)).toEqual(["duo"]);
  });

  it("tableau vide ET clé absente tombent en « Sans valeur »", () => {
    expect(ids(byId(cols, NULL_COL)!.records)).toEqual(["vide", "absent"]);
  });
});

describe("buildKanbanColumns — colonne orpheline (membre retiré)", () => {
  const records = [
    rec("connue", 1000, ["u1"]),
    rec("orpheline", 2000, ["u-parti"]),
    rec("mixte", 3000, ["u2", "u-parti"]),
  ];
  const cols = buildKanbanColumns(records, "axis", "user", MEMBERS, {
    includeOrphans: true,
    orphanLabel: "Membre retiré",
  });

  it("la carte d'un membre parti reste VISIBLE, dans une colonne dédiée en fin de board", () => {
    expect(cols.map((c) => c.id)).toEqual([NULL_COL, "u1", "u2", ORPHAN_COL]);
    const orphan = byId(cols, ORPHAN_COL)!;
    expect(orphan.label).toBe("Membre retiré");
    expect(orphan.kind).toBe("orphan");
    expect(ids(orphan.records)).toEqual(["orpheline", "mixte"]);
  });

  it("une carte mixte reste AUSSI dans la colonne de son assigné vivant", () => {
    expect(ids(byId(cols, "u2")!.records)).toEqual(["mixte"]);
  });

  it("optionId null sur la colonne orpheline : au drop, elle ne retire rien", () => {
    expect(byId(cols, ORPHAN_COL)!.optionId).toBeNull();
  });

  it("aucune colonne orpheline quand tous les ids sont connus", () => {
    const clean = buildKanbanColumns([rec("ok", 1000, ["u1"])], "axis", "user", MEMBERS, {
      includeOrphans: true,
    });
    expect(clean.map((c) => c.id)).toEqual([NULL_COL, "u1", "u2"]);
  });

  it("une valeur vide n'est jamais orpheline", () => {
    const empties = buildKanbanColumns(
      [rec("vide", 1000, []), rec("absent", 2000)],
      "axis",
      "user",
      MEMBERS,
      { includeOrphans: true }
    );
    expect(empties.some((c) => c.id === ORPHAN_COL)).toBe(false);
  });
});

describe("buildKanbanColumns — cas limites", () => {
  it("aucune graine (espace sans membre) : seule la colonne « Sans valeur »", () => {
    const cols = buildKanbanColumns([rec("a", 1000, ["u1"])], "axis", "user", []);
    expect(cols.map((c) => c.id)).toEqual([NULL_COL]);
  });

  it("l'entrée n'est pas mutée (tri sur une copie)", () => {
    const records = [rec("b", 2000, "todo"), rec("a", 1000, "todo")];
    buildKanbanColumns(records, "axis", "select", OPTIONS);
    expect(ids(records)).toEqual(["b", "a"]);
  });
});

describe("withoutUnknownIds — la règle qui rend une carte à lien mort réparable", () => {
  it("lâche l'id d'un membre parti et garde les vivants", () => {
    expect(withoutUnknownIds(["u1", "u-parti", "u2"], ["u1", "u2"])).toEqual(["u1", "u2"]);
  });

  it("renvoie null quand il ne reste rien (= retirer la clé)", () => {
    expect(withoutUnknownIds(["u-parti"], ["u1"])).toBeNull();
  });

  it("laisse une valeur scalaire intacte : la règle ne vise que les tableaux", () => {
    expect(withoutUnknownIds("opt-a", ["u1"])).toBe("opt-a");
    expect(withoutUnknownIds(null, ["u1"])).toBeNull();
  });

  it("scénario du board : sortir une carte de « Membre retiré » vers un membre", () => {
    // groupValueOnDrop depuis la colonne orpheline (sourceOptionId null) garde
    // l'id mort — sans nettoyage, le PATCH partirait en 400 et la carte
    // reviendrait dans la colonne dont on essaie justement de la sortir.
    const dropped = groupValueOnDrop("user", ["u-parti"], null, "u1");
    expect(dropped).toEqual(["u-parti", "u1"]);
    expect(withoutUnknownIds(dropped, ["u1", "u2"])).toEqual(["u1"]);
  });
});
