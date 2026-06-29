/**
 * lib/templates.ts
 *
 * Système de modèles (templates) façon Jira. Un template définit :
 *   - `columns`              : les colonnes (PropertyPreset[]) de la database
 *   - `kanbanGroupProperty`  : la colonne servant au regroupement kanban
 *   - `sections`             : les sections du corps, à LIBELLÉS FIXES ([{id,label}])
 *
 * Deux origines :
 *   - templates FOURNIS (ticket, bug) définis ici en code (id `builtin-*`),
 *   - templates UTILISATEUR stockés en base (modèle `Template`, par workspace).
 *
 * Le corps d'un record templaté est SECTIONNÉ : `Record.sectionsBody` =
 * [{id,label,content}] (content = document BlockNote). Les libellés ne sont pas
 * éditables (rendus hors éditeur). Cf. lib/db.ts pour les types/parse de sections.
 */

import type { PropertyType, PropertyConfig } from "./db";

export type TemplateSection = { id: string; label: string };

export type PropertyPreset = {
  name: string;
  type: PropertyType;
  config: PropertyConfig;
};

export type TemplateShape = {
  id: string;
  name: string;
  icon: string | null;
  columns: PropertyPreset[];
  kanbanGroupProperty: string | null;
  sections: TemplateSection[];
  builtin: boolean;
};

// ─── Templates fournis ────────────────────────────────────────────────────────

const TICKET_STATUS = [
  { id: "todo", name: "À faire", color: "gray" },
  { id: "doing", name: "En cours", color: "blue" },
  { id: "review", name: "En revue", color: "orange" },
  { id: "done", name: "Terminé", color: "green" },
];

const BUG_STATUS = [
  { id: "open", name: "À traiter", color: "gray" },
  { id: "doing", name: "En cours", color: "blue" },
  { id: "review", name: "En revue", color: "orange" },
  { id: "fixed", name: "Corrigé", color: "green" },
];

export const BUILTIN_TEMPLATES: TemplateShape[] = [
  {
    id: "builtin-ticket",
    name: "Tickets",
    icon: null,
    builtin: true,
    kanbanGroupProperty: "Statut",
    columns: [
      { name: "Statut", type: "select", config: { type: "select", options: TICKET_STATUS } },
      {
        name: "Priorité",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "low", name: "Basse", color: "gray" },
            { id: "medium", name: "Moyenne", color: "blue" },
            { id: "high", name: "Haute", color: "orange" },
            { id: "critical", name: "Critique", color: "red" },
          ],
        },
      },
      {
        name: "Type",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "bug", name: "Bug", color: "red" },
            { id: "feature", name: "Feature", color: "green" },
            { id: "tech", name: "Tech", color: "blue" },
            { id: "doc", name: "Doc", color: "gray" },
          ],
        },
      },
      { name: "Assigné", type: "text", config: { type: "text" } },
      { name: "Échéance", type: "date", config: { type: "date", includeTime: false } },
    ],
    sections: [
      { id: "prob", label: "Problème fonctionnel" },
      { id: "res", label: "Résolution technique" },
      { id: "test", label: "Tests à faire" },
    ],
  },
  {
    id: "builtin-bug",
    name: "Bugs",
    icon: null,
    builtin: true,
    kanbanGroupProperty: "Statut",
    columns: [
      { name: "Statut", type: "select", config: { type: "select", options: BUG_STATUS } },
      {
        name: "Sévérité",
        type: "select",
        config: {
          type: "select",
          options: [
            { id: "minor", name: "Mineure", color: "gray" },
            { id: "major", name: "Majeure", color: "orange" },
            { id: "critical", name: "Critique", color: "red" },
            { id: "blocker", name: "Bloquante", color: "purple" },
          ],
        },
      },
      { name: "Assigné", type: "text", config: { type: "text" } },
      { name: "Échéance", type: "date", config: { type: "date", includeTime: false } },
    ],
    sections: [
      { id: "repro", label: "Comment reproduire" },
      { id: "exp", label: "Résultat attendu" },
      { id: "act", label: "Résultat obtenu" },
      { id: "env", label: "Environnement" },
    ],
  },
];

export function resolveBuiltinTemplate(id: string): TemplateShape | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
}

export const isBuiltinTemplateId = (id: string): boolean => id.startsWith("builtin-");

// ─── Conversion d'une ligne `Template` (DB) en TemplateShape ──────────────────

type TemplateRow = {
  id: string;
  name: string;
  icon: string | null;
  columns: string;
  kanbanGroupProperty: string | null;
  sections: string;
};

export function parseTemplateRow(row: TemplateRow): TemplateShape {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    builtin: false,
    kanbanGroupProperty: row.kanbanGroupProperty,
    columns: JSON.parse(row.columns) as PropertyPreset[],
    sections: JSON.parse(row.sections) as TemplateSection[],
  };
}

// ─── Helpers de corps sectionné ───────────────────────────────────────────────

/** Squelette de corps (sections vides) pour un nouveau record templaté. */
export function emptySectionsBody(
  sections: TemplateSection[]
): Array<{ id: string; label: string; content: unknown[] }> {
  return sections.map((s) => ({ id: s.id, label: s.label, content: [] }));
}
