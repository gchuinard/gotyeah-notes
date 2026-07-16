import { describe, it, expect } from "vitest";
import {
  buildReleaseNotesBlocks,
  releaseNotesBlockId,
  RELEASE_NOTES_BLOCK_PREFIX,
  reconcileDelivered,
  appendReleaseNotesToContent,
  type BlockNoteBlock,
} from "@/lib/db";

const preexisting: BlockNoteBlock = {
  id: "pre-1",
  type: "paragraph",
  props: {},
  content: [{ type: "text", text: "Contenu préexistant", styles: {} }],
  children: [],
};

describe("buildReleaseNotesBlocks", () => {
  it("AC5 : un titre vide rend « Sans titre », jamais une puce/ligne vide", () => {
    const blocks = buildReleaseNotesBlocks({
      sprintId: "sp1",
      sprintName: "Sprint Alpha",
      closedDate: "2026-07-17",
      deliveredTitles: ["Feature A", ""],
      reportedCount: 0,
    });

    const bullets = blocks.filter((b) => b.type === "bulletListItem");
    expect(bullets).toHaveLength(2);
    const texts = bullets.map((b) => b.content[0]?.text);
    expect(texts[0]).toBe("Feature A");
    expect(texts[1]).toBe("Sans titre");
    // Aucune puce sans texte (pas de ligne vide).
    for (const t of texts) expect((t ?? "").length).toBeGreaterThan(0);
  });

  it("le bloc titre porte le marqueur d'idempotence release-notes-<sprintId>", () => {
    const blocks = buildReleaseNotesBlocks({
      sprintId: "sp42",
      sprintName: "Sprint",
      closedDate: "2026-07-17",
      deliveredTitles: ["X"],
      reportedCount: 0,
    });
    expect(blocks[0].id).toBe(releaseNotesBlockId("sp42"));
    expect(blocks[0].id).toBe(`${RELEASE_NOTES_BLOCK_PREFIX}sp42`);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[0].content[0].text).toContain("Sprint");
    expect(blocks[0].content[0].text).toContain("2026-07-17");
  });

  it("les reportées sont comptées à part (jamais dans les livrées)", () => {
    const blocks = buildReleaseNotesBlocks({
      sprintId: "sp2",
      sprintName: "S",
      closedDate: "2026-07-17",
      deliveredTitles: ["Livrée 1", "Livrée 2"],
      reportedCount: 3,
    });
    const paragraphs = blocks.filter((b) => b.type === "paragraph").map((b) => b.content[0].text);
    expect(paragraphs.some((t) => t.includes("2 issues livrées"))).toBe(true);
    expect(paragraphs.some((t) => t.includes("3 issues reportées"))).toBe(true);
    // La reportée n'apparaît pas dans les puces livrées.
    const bullets = blocks.filter((b) => b.type === "bulletListItem").map((b) => b.content[0].text);
    expect(bullets).toEqual(["Livrée 1", "Livrée 2"]);
  });

  it("aucune ligne reportée quand reportedCount == 0", () => {
    const blocks = buildReleaseNotesBlocks({
      sprintId: "sp3",
      sprintName: "S",
      closedDate: "2026-07-17",
      deliveredTitles: ["A"],
      reportedCount: 0,
    });
    const texts = blocks.map((b) => b.content[0].text);
    expect(texts.some((t) => t.includes("reportée"))).toBe(false);
  });
});

describe("reconcileDelivered", () => {
  it("ok quand toutes les issues listées sont terminées", () => {
    const r = reconcileDelivered(
      [{ properties: { status: "done" } }, { properties: { status: "done" } }],
      "status",
      "done"
    );
    expect(r).toEqual({ ok: true, listed: 2, delivered: 2 });
  });

  it("échec quand une issue listée n'est pas terminée", () => {
    const r = reconcileDelivered(
      [{ properties: { status: "done" } }, { properties: { status: "todo" } }],
      "status",
      "done"
    );
    expect(r.ok).toBe(false);
    expect(r.listed).toBe(2);
    expect(r.delivered).toBe(1);
  });
});

describe("appendReleaseNotesToContent", () => {
  const blocks = buildReleaseNotesBlocks({
    sprintId: "spA",
    sprintName: "Sprint A",
    closedDate: "2026-07-17",
    deliveredTitles: ["T1"],
    reportedCount: 0,
  });

  it("appende À LA FIN sans réordonner ni écraser l'existant", () => {
    const content = JSON.stringify([preexisting]);
    const res = appendReleaseNotesToContent(content, "spA", blocks);
    expect(res.status).toBe("appended");
    if (res.status !== "appended") return;
    const parsed = JSON.parse(res.content) as BlockNoteBlock[];
    expect(parsed[0].id).toBe("pre-1"); // intact, en tête
    expect(parsed[parsed.length - blocks.length].id).toBe(releaseNotesBlockId("spA"));
    expect(parsed).toHaveLength(1 + blocks.length);
  });

  it("idempotent : marqueur déjà présent → « already », contenu inchangé", () => {
    const first = appendReleaseNotesToContent(JSON.stringify([preexisting]), "spA", blocks);
    if (first.status !== "appended") throw new Error("setup");
    const second = appendReleaseNotesToContent(first.content, "spA", blocks);
    expect(second.status).toBe("already");
    if (second.status !== "already") return;
    expect(second.content).toBe(first.content);
  });

  it("content non parsable → « corrupt » (pas d'écrasement)", () => {
    expect(appendReleaseNotesToContent("not-json", "spA", blocks).status).toBe("corrupt");
  });

  it("content JSON valide mais non-tableau → « corrupt »", () => {
    expect(appendReleaseNotesToContent("{}", "spA", blocks).status).toBe("corrupt");
  });

  it("content vide « [] » → append au premier rang", () => {
    const res = appendReleaseNotesToContent("[]", "spA", blocks);
    expect(res.status).toBe("appended");
    if (res.status !== "appended") return;
    const parsed = JSON.parse(res.content) as BlockNoteBlock[];
    expect(parsed).toHaveLength(blocks.length);
    expect(parsed[0].id).toBe(releaseNotesBlockId("spA"));
  });
});
