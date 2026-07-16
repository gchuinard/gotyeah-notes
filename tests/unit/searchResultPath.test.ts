import { describe, it, expect } from "vitest";
import {
  searchResultPathSegments,
  truncatePathEnd,
  type FlatPage,
} from "@/lib/tree";

const page = (
  id: string,
  title: string,
  parentId: string | null,
  sectionId: string | null
): FlatPage => ({
  id,
  title,
  icon: null,
  parentId,
  position: 1000,
  sectionId,
  visibility: "team",
  ownerId: null,
});

const SECTIONS = [
  { id: "secPrive", name: "Privé", icon: "🔒" },
  { id: "secTeam", name: "Équipe", icon: null },
];

// Deux « Q3 » homonymes dans des arborescences distinctes + une page hôte de db.
const PAGES: FlatPage[] = [
  page("projets", "Projets", null, "secPrive"),
  page("q3a", "Q3", "projets", null),
  page("archives", "Archives", null, "secTeam"),
  page("q3b", "Q3", "archives", null),
  page("dbpage", "Backlog", "archives", null),
];

describe("searchResultPathSegments — résultat page (critères 2 & 4)", () => {
  it("page imbriquée → section › dossiers parents, SANS le titre de la page", () => {
    const seg = searchResultPathSegments(PAGES, SECTIONS, { kind: "page", id: "q3a" });
    expect(seg).toEqual(["Privé", "Projets"]);
    expect(seg).not.toContain("Q3");
  });

  it("deux pages homonymes → chemins distincts (critère 1, logique pure)", () => {
    const a = searchResultPathSegments(PAGES, SECTIONS, { kind: "page", id: "q3a" });
    const b = searchResultPathSegments(PAGES, SECTIONS, { kind: "page", id: "q3b" });
    expect(a).toEqual(["Privé", "Projets"]);
    expect(b).toEqual(["Équipe", "Archives"]);
    expect(a).not.toEqual(b);
  });

  it("page racine d'une section → section seule (jamais son propre titre)", () => {
    const seg = searchResultPathSegments(PAGES, SECTIONS, { kind: "page", id: "projets" });
    expect(seg).toEqual(["Privé"]);
    expect(seg).not.toContain("Projets");
  });
});

describe("searchResultPathSegments — résultat record (critère 3)", () => {
  it("record → fil COMPLET de la page hôte (section › … › page hôte), titre hôte inclus", () => {
    const seg = searchResultPathSegments(PAGES, SECTIONS, { kind: "record", pageId: "dbpage" });
    expect(seg).toEqual(["Équipe", "Archives", "Backlog"]);
  });
});

describe("searchResultPathSegments — cache vide / absent (critère 6)", () => {
  it("listes vides → []", () => {
    expect(searchResultPathSegments([], [], { kind: "page", id: "q3a" })).toEqual([]);
    expect(searchResultPathSegments([], [], { kind: "record", pageId: "dbpage" })).toEqual([]);
  });

  it("résultat absent des listes → []", () => {
    expect(searchResultPathSegments(PAGES, SECTIONS, { kind: "page", id: "inconnu" })).toEqual([]);
    expect(
      searchResultPathSegments(PAGES, SECTIONS, { kind: "record", pageId: "inconnu" })
    ).toEqual([]);
  });
});

describe("truncatePathEnd (critère 5)", () => {
  it("chemin court → inchangé", () => {
    expect(truncatePathEnd(["Privé", "Projets"], 52)).toBe("Privé › Projets");
  });

  it("liste vide → chaîne vide", () => {
    expect(truncatePathEnd([], 52)).toBe("");
  });

  it("chemin trop long → conserve la FIN, préfixe « … › », dernier segment intact", () => {
    const segments = ["Section", "DossierParentTresLong", "AutreDossier", "PageFinale"];
    const out = truncatePathEnd(segments, 20);
    expect(out.startsWith("… › ")).toBe(true);
    expect(out.endsWith("PageFinale")).toBe(true);
    expect(out).not.toContain("DossierParentTresLong");
  });

  it("ajoute autant de segments de fin que le budget le permet", () => {
    const segments = ["Section", "Parent", "PageFinale"];
    // Budget qui laisse entrer « Parent » (23 car.) mais pas « Section » (33 car.).
    const out = truncatePathEnd(segments, 25);
    expect(out).toBe("… › Parent › PageFinale");
  });

  it("dernier segment plus long que le budget → jamais amputé, pas d'ellipse parasite", () => {
    const out = truncatePathEnd(["UnSeulSegmentBeaucoupTropLong"], 10);
    expect(out).toBe("UnSeulSegmentBeaucoupTropLong");
  });

  it("dernier segment seul dépasse mais des parents existent → dernier intact, préfixe « … › »", () => {
    const out = truncatePathEnd(["Parent", "SegmentFinalBeaucoupTropLongPourLeBudget"], 10);
    expect(out.startsWith("… › ")).toBe(true);
    expect(out.endsWith("SegmentFinalBeaucoupTropLongPourLeBudget")).toBe(true);
    expect(out).not.toContain("Parent ");
  });
});
