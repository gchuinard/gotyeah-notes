import { describe, it, expect } from "vitest";
import { buildTree, type FlatPage } from "@/lib/tree";

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
