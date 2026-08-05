import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canTransition,
  enteredOptionIds,
  deniedTransitions,
  selectableOptions,
  TRANSITION_ROLES,
  type TransitionRule,
} from "@/lib/permissionRules";
import { WORKSPACE_ROLES } from "@/lib/workspace";

const DONE = "opt-done";
const editor = { userId: "u-ed", role: "editor" };
const viewer = { userId: "u-vi", role: "viewer" };
const admin = { userId: "u-ad", role: "admin" };
const marie = { userId: "u-marie", role: "viewer" };

const onlyEditors: TransitionRule[] = [{ toOptionId: DONE, roles: ["editor"] }];

describe("canTransition — rétrocompatibilité des 22 boards", () => {
  it("aucune règle → permis, même sans identité", () => {
    // LE test du lot : c'est lui qui garantit que la production ne bouge pas.
    expect(canTransition([], null, DONE, undefined)).toBe(true);
    expect(canTransition(undefined, null, DONE, undefined)).toBe(true);
    expect(canTransition([], null, DONE, viewer)).toBe(true);
  });

  it("une règle sur une AUTRE option ne verrouille pas celle-ci", () => {
    expect(canTransition(onlyEditors, null, "opt-todo", viewer)).toBe(true);
  });

  it("« Sans valeur » reste toujours atteignable", () => {
    const rules: TransitionRule[] = [{ toOptionId: DONE, roles: ["admin"] }];
    expect(canTransition(rules, null, null, viewer)).toBe(true);
  });
});

describe("canTransition — la règle mord", () => {
  it("le rôle est hiérarchique : « editor » laisse passer un admin, pas un lecteur", () => {
    expect(canTransition(onlyEditors, null, DONE, editor)).toBe(true);
    expect(canTransition(onlyEditors, null, DONE, admin)).toBe(true);
    expect(canTransition(onlyEditors, null, DONE, viewer)).toBe(false);
  });

  it("une personne nommée passe quel que soit son rôle", () => {
    const rules: TransitionRule[] = [{ toOptionId: DONE, userIds: [marie.userId] }];
    expect(canTransition(rules, null, DONE, marie)).toBe(true);
    expect(canTransition(rules, null, DONE, editor)).toBe(false);
  });

  it("rôles et personnes sont en OU", () => {
    const rules: TransitionRule[] = [
      { toOptionId: DONE, roles: ["editor"], userIds: [marie.userId] },
    ];
    expect(canTransition(rules, null, DONE, editor)).toBe(true);
    expect(canTransition(rules, null, DONE, marie)).toBe(true);
    expect(canTransition(rules, null, DONE, viewer)).toBe(false);
  });

  it("une règle vide n'autorise personne (ni rôle, ni nom)", () => {
    const rules: TransitionRule[] = [{ toOptionId: DONE }];
    for (const a of [admin, editor, viewer]) {
      expect(canTransition(rules, null, DONE, a)).toBe(false);
    }
  });

  it("un ADMIN n'est PAS exempté : il change la règle, il ne la contourne pas", () => {
    // Décision de Gautier du 05/08. Une exemption admin serait invisible ;
    // modifier la règle laisse une trace dans le config.
    const rules: TransitionRule[] = [{ toOptionId: DONE, userIds: [marie.userId] }];
    expect(canTransition(rules, null, DONE, admin)).toBe(false);
  });

  it("un rôle inconnu en base ne satisfait aucune règle (jamais d'exception)", () => {
    expect(canTransition(onlyEditors, null, DONE, { userId: "u", role: "sudo" })).toBe(false);
  });

  it("identité absente + règle existante → refus", () => {
    expect(canTransition(onlyEditors, null, DONE, undefined)).toBe(false);
  });
});

describe("enteredOptionIds — ne compter que les transitions RÉELLES", () => {
  it("une valeur réémise à l'identique n'entre pas", () => {
    expect(enteredOptionIds(DONE, DONE)).toEqual([]);
    expect(enteredOptionIds(["a", "b"], ["b", "a"])).toEqual([]);
  });

  it("select : seule la nouvelle valeur entre", () => {
    expect(enteredOptionIds("opt-todo", DONE)).toEqual([DONE]);
  });

  it("multiselect : seuls les ajouts entrent, les retraits sont ignorés", () => {
    expect(enteredOptionIds(["a"], ["a", "b"])).toEqual(["b"]);
    expect(enteredOptionIds(["a", "b"], ["a"])).toEqual([]);
  });

  it("vider une valeur n'entre nulle part", () => {
    expect(enteredOptionIds(DONE, null)).toEqual([]);
    expect(enteredOptionIds(DONE, "")).toEqual([]);
  });

  it("depuis rien vers une option : c'est une entrée (cas de la CRÉATION)", () => {
    expect(enteredOptionIds(null, DONE)).toEqual([DONE]);
    expect(enteredOptionIds(undefined, DONE)).toEqual([DONE]);
  });
});

describe("deniedTransitions — ce que les routes appellent", () => {
  it("vide quand la transition passe", () => {
    expect(deniedTransitions(onlyEditors, "opt-todo", DONE, editor)).toEqual([]);
  });

  it("nomme l'option refusée", () => {
    expect(deniedTransitions(onlyEditors, "opt-todo", DONE, viewer)).toEqual([DONE]);
  });

  it("modifier une carte DÉJÀ dans une colonne interdite n'est pas refusé", () => {
    // Sans ça, un membre restreint ne pourrait plus toucher au titre d'une carte
    // posée dans une colonne qu'il n'a pas le droit d'alimenter.
    expect(deniedTransitions(onlyEditors, DONE, DONE, viewer)).toEqual([]);
  });

  it("multiselect : seule l'option ajoutée et interdite ressort", () => {
    const rules: TransitionRule[] = [{ toOptionId: "x", roles: ["admin"] }];
    expect(deniedTransitions(rules, ["a"], ["a", "x"], viewer)).toEqual(["x"]);
  });
});

describe("Garde-fou de la duplication assumée", () => {
  it("le rang de rôles local est en phase avec lib/workspace", () => {
    expect([...TRANSITION_ROLES].sort()).toEqual([...WORKSPACE_ROLES].sort());
  });

  it("le module reste SANS import — sinon better-sqlite3 part dans le bundle client", () => {
    // Cell.tsx, KanbanView.tsx et BulkActionBar.tsx sont "use client" et
    // importent ce module : un `import` vers lib/workspace y tirerait lib/prisma,
    // donc un addon natif, et casserait le build navigateur.
    const src = readFileSync("src/lib/permissionRules.ts", "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe("Options proposées dans une cellule", () => {
  const OPTS = [{ id: "opt-todo" }, { id: DONE }];

  it("sans règles, toutes les options restent proposées", () => {
    expect(selectableOptions(OPTS, [], undefined, viewer)).toHaveLength(2);
  });

  it("une option verrouillée disparaît du menu", () => {
    expect(selectableOptions(OPTS, [], onlyEditors, viewer).map((o) => o.id)).toEqual(["opt-todo"]);
  });

  it("…SAUF si la carte la porte déjà : sinon la valeur courante devient invisible", () => {
    // Le piège : masquer l'option posée ferait paraître la cellule vide et
    // empêcherait de la retirer.
    expect(selectableOptions(OPTS, [DONE], onlyEditors, viewer).map((o) => o.id)).toEqual([
      "opt-todo",
      DONE,
    ]);
  });

  it("un utilisateur autorisé voit tout", () => {
    expect(selectableOptions(OPTS, [], onlyEditors, editor)).toHaveLength(2);
  });
});
