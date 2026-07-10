import { describe, it, expect } from "vitest";
import { buildBreadcrumb, type FlatPage } from "@/lib/tree";

const page = (id: string, title: string, parentId: string | null, sectionId: string | null): FlatPage => ({
  id, title, icon: null, parentId, position: 1000, sectionId, visibility: "team", ownerId: null,
});
const SECTIONS = [
  { id: "sec1", name: "Équipe", icon: null },
  { id: "sec2", name: "Privé", icon: "🔒" },
];

describe("buildBreadcrumb", () => {
  it("page racine dans une section → [section, page], section + page non cliquables", () => {
    const pages = [page("p1", "Racine", null, "sec1")];
    const cr = buildBreadcrumb(pages, SECTIONS, "p1");
    expect(cr).toEqual([
      { label: "Équipe", href: null, icon: null },
      { label: "Racine", href: null, icon: null },
    ]);
  });

  it("page imbriquée → [section, racine, …, courante], ancêtres cliquables, courante non", () => {
    const pages = [
      page("root", "Racine", null, "sec1"),
      page("mid", "Milieu", "root", null),
      page("leaf", "Feuille", "mid", null),
    ];
    const cr = buildBreadcrumb(pages, SECTIONS, "leaf");
    expect(cr.map((c) => c.label)).toEqual(["Équipe", "Racine", "Milieu", "Feuille"]);
    expect(cr.map((c) => c.href)).toEqual([null, "/pages/root", "/pages/mid", null]);
  });

  it("la section est dérivée de la RACINE, pas de la page courante", () => {
    const pages = [page("root", "R", null, "sec2"), page("child", "C", "root", null)];
    const cr = buildBreadcrumb(pages, SECTIONS, "child");
    expect(cr[0]).toEqual({ label: "Privé", href: null, icon: "🔒" });
  });

  it("racine sans section → pas de crumb section", () => {
    const pages = [page("p1", "Orpheline", null, null)];
    expect(buildBreadcrumb(pages, SECTIONS, "p1")).toEqual([
      { label: "Orpheline", href: null, icon: null },
    ]);
  });

  it("titre vide → « Sans titre »", () => {
    const pages = [page("p1", "", null, null)];
    expect(buildBreadcrumb(pages, SECTIONS, "p1")[0].label).toBe("Sans titre");
  });

  it("page absente de la liste → []", () => {
    expect(buildBreadcrumb([page("p1", "X", null, null)], SECTIONS, "inconnu")).toEqual([]);
  });

  it("parent manquant (liste partielle) → on s'arrête à ce qui est connu, pas de crash", () => {
    const pages = [page("leaf", "Feuille", "absent", null)];
    const cr = buildBreadcrumb(pages, SECTIONS, "leaf");
    expect(cr.map((c) => c.label)).toEqual(["Feuille"]);
  });

  it("cycle parentId → pas de boucle infinie", () => {
    const pages = [page("a", "A", "b", null), page("b", "B", "a", null)];
    const cr = buildBreadcrumb(pages, SECTIONS, "a");
    // s'arrête dès qu'un id est revu ; longueur bornée
    expect(cr.length).toBeLessThanOrEqual(2);
  });
});
