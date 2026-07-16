import { describe, it, expect } from "vitest";
import {
  buildTree,
  collectSubtreeIds,
  toggleBranchCollapsed,
  type FlatPage,
  type TreeNode,
} from "@/lib/tree";

const page = (id: string, parentId: string | null, position: number): FlatPage => ({
  id,
  title: id,
  icon: null,
  parentId,
  position,
  sectionId: null,
  visibility: "team",
  ownerId: null,
});

describe("buildTree", () => {
  it("imbrique les enfants sous leur parent et trie par position", () => {
    const tree = buildTree([
      page("a", null, 2),
      page("b", null, 1),
      page("a1", "a", 5),
      page("a2", "a", 3),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["b", "a"]);
    const a = tree.find((n) => n.id === "a")!;
    expect(a.children.map((n) => n.id)).toEqual(["a2", "a1"]);
  });

  it("traite une page dont le parent est absent comme une racine", () => {
    const tree = buildTree([page("orphan", "ghost", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });
});

// Arbre à 3 niveaux : root → { childFolder → grandLeaf, rootLeaf } + un dossier
// racine sans enfants (emptyFolder). Sert aux helpers de repli/dépli récursif.
function subtreeFixture() {
  const tree = buildTree([
    page("root", null, 1),
    page("childFolder", "root", 1),
    page("grandLeaf", "childFolder", 1),
    page("rootLeaf", "root", 2),
    page("emptyFolder", null, 2),
  ]);
  const find = (id: string): TreeNode => {
    const stack = [...tree];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      stack.push(...n.children);
    }
    throw new Error(`node ${id} introuvable`);
  };
  return {
    root: find("root"),
    childFolder: find("childFolder"),
    grandLeaf: find("grandLeaf"),
    emptyFolder: find("emptyFolder"),
  };
}

describe("collectSubtreeIds", () => {
  it("renvoie l'id du nœud + tous ses descendants sur un arbre à 3 niveaux", () => {
    const { root } = subtreeFixture();
    expect(new Set(collectSubtreeIds(root))).toEqual(
      new Set(["root", "childFolder", "grandLeaf", "rootLeaf"])
    );
  });

  it("renvoie seulement son id sur une feuille", () => {
    const { grandLeaf } = subtreeFixture();
    expect(collectSubtreeIds(grandLeaf)).toEqual(["grandLeaf"]);
  });

  it("renvoie seulement son id sur un dossier sans enfants", () => {
    const { emptyFolder } = subtreeFixture();
    expect(collectSubtreeIds(emptyFolder)).toEqual(["emptyFolder"]);
  });
});

describe("toggleBranchCollapsed", () => {
  it("replie récursivement une branche dépliée (nœud + tous ses descendants)", () => {
    const { root } = subtreeFixture();
    const next = toggleBranchCollapsed(new Set(), root);
    expect(next).toEqual(new Set(["root", "childFolder", "grandLeaf", "rootLeaf"]));
  });

  it("déplie récursivement une branche repliée (retire le nœud + ses descendants)", () => {
    const { root } = subtreeFixture();
    const collapsed = new Set(["root", "childFolder", "grandLeaf", "rootLeaf"]);
    expect(toggleBranchCollapsed(collapsed, root)).toEqual(new Set());
  });

  it("replie toute la branche même si un sous-dossier était déjà replié", () => {
    const { root } = subtreeFixture();
    // root déplié (absent du Set) → Maj+clic = repli, quel que soit l'état des enfants.
    const collapsed = new Set(["childFolder"]);
    expect(toggleBranchCollapsed(collapsed, root)).toEqual(
      new Set(["root", "childFolder", "grandLeaf", "rootLeaf"])
    );
  });

  it("ne mute pas le Set d'entrée et retourne toujours un nouveau Set", () => {
    const { root } = subtreeFixture();
    const collapsed = new Set<string>();
    const next = toggleBranchCollapsed(collapsed, root);
    expect(next).not.toBe(collapsed);
    expect(collapsed.size).toBe(0);
  });
});
