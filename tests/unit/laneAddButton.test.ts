import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KanbanColView } from "@/components/databases/KanbanView";
import { SprintLane } from "@/components/databases/BacklogView";
import type { ParsedRecord, ParsedSprint, SelectOption } from "@/lib/db";

/**
 * Environnement de test = node (pas de jsdom). On rend les composants de lane en
 * HTML via react-dom/server pour vérifier la POSITION du bouton d'ajout : ancré
 * en tête (avant la zone de cartes), et non plus en pied de lane.
 *
 * Les hooks dnd-kit (useDroppable / useSortable) rendent proprement en SSR sans
 * DndContext → on peut monter KanbanColView et SprintLane isolément.
 */

const noop = () => {};

function makeRecord(id: string, title: string, over: Partial<ParsedRecord> = {}): ParsedRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    databaseId: "db1",
    title,
    icon: null,
    coverUrl: null,
    content: "[]",
    templateId: null,
    sectionsBody: null,
    trashedAt: null,
    sprintId: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    position: 1000,
    properties: {},
    ...over,
  };
}

function makeSprint(over: Partial<ParsedSprint> = {}): ParsedSprint {
  return {
    id: "sp1",
    databaseId: "db1",
    name: "Sprint 1",
    goal: null,
    startDate: null,
    endDate: null,
    state: "active",
    releaseNotes: null,
    position: 1000,
    ...over,
  };
}

const OPTION: SelectOption = { id: "opt-a", name: "Alpha", color: "blue" };

function renderKanbanCol(opts: {
  optionId: string | null;
  option: SelectOption | null;
  records: ParsedRecord[];
  createOnlyInUnassigned: boolean;
}): string {
  return renderToStaticMarkup(
    React.createElement(KanbanColView, {
      col: {
        id: opts.optionId ?? "__null__",
        optionId: opts.optionId,
        label: opts.option?.name ?? "Sans valeur",
        kind: opts.optionId === null ? ("unassigned" as const) : ("seed" as const),
        option: opts.option,
        records: opts.records,
      },
      previewProps: [],
      onAddRecord: noop,
      newRecordId: null,
      selectedIds: new Set<string>(),
      onToggleSelect: noop,
      onTitleSave: noop,
      onPropSave: noop,
      onCardClick: noop,
      onDeleteRecord: noop,
      onDuplicateRecord: noop,
      onRenameOption: noop,
      createOnlyInUnassigned: opts.createOnlyInUnassigned,
    })
  );
}

function renderSprintLane(opts: {
  sprint: ParsedSprint | null;
  records: ParsedRecord[];
  collapsed: boolean;
}): string {
  return renderToStaticMarkup(
    React.createElement(SprintLane, {
      lane: {
        id: opts.sprint?.id ?? "__backlog__",
        sprint: opts.sprint,
        records: opts.records,
      },
      collapsed: opts.collapsed,
      onToggleCollapse: noop,
      previewProps: [],
      newRecordId: null,
      onAddRecord: noop,
      onTitleSave: noop,
      onRowClick: noop,
      onDeleteRecord: noop,
      onDuplicateRecord: noop,
      onRenameSprint: noop,
      onSprintAction: noop,
      onEditSprint: noop,
      onDeleteSprint: noop,
    })
  );
}

// ─── Kanban ─────────────────────────────────────────────────────────────────

describe("KanbanColView — bouton d'ajout ancré en tête (AC1)", () => {
  const records = [
    makeRecord("r1", "CARTE_UNE"),
    makeRecord("r2", "CARTE_DEUX"),
    makeRecord("r3", "CARTE_TROIS"),
  ];

  it("rend le bouton « Nouveau » AVANT la première carte (en-tête, pas en pied)", () => {
    const html = renderKanbanCol({
      optionId: "opt-a",
      option: OPTION,
      records,
      createOnlyInUnassigned: false,
    });
    expect(html).toContain("Nouveau");
    expect(html.indexOf("Nouveau")).toBeLessThan(html.indexOf("CARTE_UNE"));
  });

  it("un seul bouton d'ajout par colonne (pas de doublon tête + pied)", () => {
    const html = renderKanbanCol({
      optionId: "opt-a",
      option: OPTION,
      records,
      createOnlyInUnassigned: false,
    });
    expect((html.match(/Nouveau/g) ?? []).length).toBe(1);
  });

  it("aucun scroll par-lane : pas d'overflow sur la colonne (AC6)", () => {
    const html = renderKanbanCol({
      optionId: "opt-a",
      option: OPTION,
      records,
      createOnlyInUnassigned: false,
    });
    expect(html).not.toContain("overflow-auto");
    expect(html).not.toContain("overflow-y");
  });
});

describe("KanbanColView — garde du flag createInUnassignedOnly (AC3)", () => {
  const records = [makeRecord("r1", "CARTE_UNE")];

  it("flag OFF → bouton présent sur une colonne à option", () => {
    const html = renderKanbanCol({
      optionId: "opt-a",
      option: OPTION,
      records,
      createOnlyInUnassigned: false,
    });
    expect(html).toContain("Nouveau");
  });

  it("flag ON → bouton ABSENT sur une colonne à option", () => {
    const html = renderKanbanCol({
      optionId: "opt-a",
      option: OPTION,
      records,
      createOnlyInUnassigned: true,
    });
    expect(html).not.toContain("Nouveau");
  });

  it("flag ON → bouton présent sur la colonne « Sans valeur » (optionId null)", () => {
    const html = renderKanbanCol({
      optionId: null,
      option: null,
      records,
      createOnlyInUnassigned: true,
    });
    expect(html).toContain("Nouveau");
  });
});

// ─── Backlog ─────────────────────────────────────────────────────────────────

describe("SprintLane — bouton d'ajout ancré en tête (AC4)", () => {
  const records = [
    makeRecord("r1", "ISSUE_UNE", { sprintId: "sp1" }),
    makeRecord("r2", "ISSUE_DEUX", { sprintId: "sp1" }),
  ];

  it("lane dépliée : « Créer une issue » rendu AVANT la première issue", () => {
    const html = renderSprintLane({ sprint: makeSprint(), records, collapsed: false });
    expect(html).toContain("Créer une issue");
    expect(html.indexOf("Créer une issue")).toBeLessThan(html.indexOf("ISSUE_UNE"));
  });

  it("aucun scroll par-lane : pas d'overflow sur la lane (AC6)", () => {
    const html = renderSprintLane({ sprint: makeSprint(), records, collapsed: false });
    expect(html).not.toContain("overflow-auto");
    expect(html).not.toContain("overflow-y");
  });
});

describe("SprintLane — repli/dépliage (AC5)", () => {
  const records = [makeRecord("r1", "ISSUE_UNE")];

  it("lane repliée : « Créer une issue » ABSENT", () => {
    const html = renderSprintLane({ sprint: null, records, collapsed: true });
    expect(html).not.toContain("Créer une issue");
  });

  it("lane dépliée : « Créer une issue » réapparaît en tête", () => {
    const html = renderSprintLane({ sprint: null, records, collapsed: false });
    expect(html).toContain("Créer une issue");
  });
});
