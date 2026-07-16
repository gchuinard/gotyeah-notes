import { describe, it, expect } from "vitest";
import {
  diffRecordRevisions,
  shouldCoalesceRevision,
  REVISION_COALESCE_MS,
  type RecordSnapshot,
} from "@/lib/db";

const base: RecordSnapshot = {
  title: "A",
  content: "[]",
  properties: {},
  sectionsBody: null,
};

describe("diffRecordRevisions — champs réellement modifiés", () => {
  it("titre modifié → une entrée field=title avec before/after", () => {
    const changes = diffRecordRevisions(base, { title: "B" });
    expect(changes).toEqual([{ field: "title", before: "A", after: "B" }]);
  });

  it("titre identique → aucune entrée", () => {
    expect(diffRecordRevisions(base, { title: "A" })).toEqual([]);
  });

  it("contenu modifié / identique", () => {
    expect(diffRecordRevisions(base, { content: '[{"x":1}]' })).toEqual([
      { field: "content", before: "[]", after: '[{"x":1}]' },
    ]);
    expect(diffRecordRevisions(base, { content: "[]" })).toEqual([]);
  });

  it("titre + deux properties distinctes → 3 entrées, une par champ", () => {
    const snap: RecordSnapshot = { ...base, properties: { p1: "old", p2: null } };
    const changes = diffRecordRevisions(snap, {
      title: "B",
      properties: { p1: "new", p2: "set" },
    });
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual({ field: "title", before: "A", after: "B" });
    expect(changes).toContainEqual({ field: "p1", before: "old", after: "new" });
    expect(changes).toContainEqual({ field: "p2", before: null, after: "set" });
  });

  it("property inchangée → aucune entrée ; property mise à null → suppression tracée", () => {
    const snap: RecordSnapshot = { ...base, properties: { p1: "same", p2: "gone" } };
    expect(diffRecordRevisions(snap, { properties: { p1: "same" } })).toEqual([]);
    expect(diffRecordRevisions(snap, { properties: { p2: null } })).toEqual([
      { field: "p2", before: "gone", after: null },
    ]);
  });

  it("section modifiée → field = id de section ; section vide inchangée ignorée", () => {
    const snap: RecordSnapshot = {
      ...base,
      sectionsBody: [{ id: "s1", label: "Contexte", content: [{ t: "old" }] }],
    };
    const changes = diffRecordRevisions(snap, {
      sectionsBody: [{ id: "s1", label: "Contexte", content: [{ t: "new" }] }],
    });
    expect(changes).toEqual([
      { field: "s1", before: [{ t: "old" }], after: [{ t: "new" }] },
    ]);
    // Contenu de section identique → pas de révision.
    expect(
      diffRecordRevisions(snap, {
        sectionsBody: [{ id: "s1", label: "Contexte", content: [{ t: "old" }] }],
      })
    ).toEqual([]);
  });

  it("passage en corps libre (sectionsBody=null) journalisé si le record était sectionné", () => {
    const sectioned: RecordSnapshot = {
      ...base,
      sectionsBody: [{ id: "s1", label: "L", content: [{ t: "x" }] }],
    };
    const changes = diffRecordRevisions(sectioned, { sectionsBody: null });
    expect(changes).toEqual([
      { field: "sectionsBody", before: sectioned.sectionsBody, after: null },
    ]);
    // Déjà en corps libre → rien à journaliser.
    expect(diffRecordRevisions(base, { sectionsBody: null })).toEqual([]);
  });
});

describe("shouldCoalesceRevision — fenêtre de 2 minutes", () => {
  const now = new Date("2026-07-17T12:00:00.000Z");

  it("aucune révision précédente → pas de fusion", () => {
    expect(shouldCoalesceRevision(null, "u1", now)).toBe(false);
  });

  it("même acteur, < 2 min → fusion", () => {
    const last = { actorId: "u1", createdAt: new Date(now.getTime() - 60_000) };
    expect(shouldCoalesceRevision(last, "u1", now)).toBe(true);
  });

  it("même acteur, > 2 min → nouvelle ligne", () => {
    const last = { actorId: "u1", createdAt: new Date(now.getTime() - REVISION_COALESCE_MS - 1) };
    expect(shouldCoalesceRevision(last, "u1", now)).toBe(false);
  });

  it("acteur différent, même instant → nouvelle ligne", () => {
    const last = { actorId: "u2", createdAt: new Date(now.getTime() - 1_000) };
    expect(shouldCoalesceRevision(last, "u1", now)).toBe(false);
  });
});
