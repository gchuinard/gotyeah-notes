import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Garde de CÂBLAGE — `actor` doit atteindre chaque composant qui filtre des
 * options selon les règles de transition.
 *
 * ⚠️ Ce trou est INVISIBLE au typecheck : `actor` est optionnel partout, donc un
 * chaînon manquant compile sans broncher. Et l'effet est pire qu'inutile — sans
 * identité, `canTransition` refuse, donc TOUTES les options gouvernées
 * disparaissent, y compris pour ceux qui y ont droit. C'est exactement ce qui
 * est arrivé à TableView, livré sans son `actor` : tsc vert, tests verts, et
 * seule la vue table aurait montré des menus vides le jour d'une première règle.
 *
 * Le test lit le JSX comme du texte. C'est grossier, mais c'est ce qui attrape
 * un prop non transmis — un test de rendu ne le verrait qu'en montant tout
 * l'arbre avec un board réellement réglementé.
 */
const read = (p: string) => readFileSync(p, "utf8");

/**
 * Contenu de la balise JSX auto-fermante `<Nom ... />`.
 *
 * `[^]` = « n'importe quel caractère, saut de ligne compris » — équivalent de
 * `[\s\S]` mais sans backslash, donc insensible aux mésaventures d'échappement.
 *
 * ⚠️ Le `(?![A-Za-z])` n'est pas décoratif : sans lui, `<Cell` matche d'abord
 * `<CellDisplay`, et le test conclut à un câblage manquant qui existe.
 */
function jsxProps(src: string, tag: string): string {
  const m = new RegExp("<" + tag + "(?![A-Za-z])([^]*?)/>").exec(src);
  return m ? m[1] : "";
}

const VIEWS = ["TableView", "KanbanView", "CalendarView", "GalleryView", "BacklogView"];
const dir = "src/components/databases";

describe("Câblage d'actor jusqu'aux surfaces qui filtrent", () => {
  it("le helper sait lire une balise JSX (sinon le reste ne prouverait rien)", () => {
    // Un helper cassé renverrait "" partout : les tests suivants échoueraient
    // sans qu'on sache si c'est le câblage ou l'outil de mesure qui est en faute.
    expect(jsxProps(read(`${dir}/DatabaseShell.tsx`), "TableView")).toContain(
      "databaseId={databaseId}"
    );
  });

  it("DatabaseShell le passe aux 5 vues", () => {
    const src = read(`${dir}/DatabaseShell.tsx`);
    const manquants = VIEWS.filter((v) => !jsxProps(src, v).includes("actor={actor}"));
    expect(manquants).toEqual([]);
  });

  it("chaque vue le passe au RecordPanel qu'elle monte", () => {
    const manquants = VIEWS.filter((v) => {
      const src = read(`${dir}/${v}.tsx`);
      return src.includes("<RecordPanel") && !jsxProps(src, "RecordPanel").includes("actor={actor}");
    });
    expect(manquants).toEqual([]);
  });

  it("les composants qui filtrent le reçoivent de leur parent", () => {
    const cas: [string, string][] = [
      [`${dir}/RecordPanel.tsx`, "Cell"],
      [`${dir}/TableView.tsx`, "BulkActionBar"],
      [`${dir}/KanbanView.tsx`, "BulkActionBar"],
    ];
    const manquants = cas
      .filter(([f, tag]) => !jsxProps(read(f), tag).includes("actor={actor}"))
      .map(([f, tag]) => `${f} -> ${tag}`);
    expect(manquants).toEqual([]);
  });
});
