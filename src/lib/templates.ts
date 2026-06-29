/**
 * lib/templates.ts
 *
 * Modèles réutilisables. Pour l'instant : la database « Tickets » (façon Jira).
 *
 * - `TICKET_BODY_TEMPLATE` : le corps pré-rempli d'un ticket (3 zones), stocké tel
 *   quel dans `Database.recordTemplate` et appliqué à la création d'un record quand
 *   aucun `content` n'est fourni (cf. POST /api/databases/[id]/records).
 * - `TICKET_PROPERTY_PRESET` / `TICKET_KANBAN_VIEW` : la structure ajoutée par le
 *   scaffolding `POST /api/databases { template: "ticket" }` (en plus de la propriété
 *   titre + vue table créées par défaut).
 *
 * Le corps est un document BlockNote (JSON), PAS du markdown.
 */

import type { PropertyType, PropertyConfig } from "./db";

// ─── Corps du ticket (document BlockNote) ─────────────────────────────────────

const baseProps = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
} as const;

type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Array<{ type: "text"; text: string; styles: Record<string, unknown> }>;
  children: Block[];
};

const heading = (id: string, text: string): Block => ({
  id,
  type: "heading",
  props: { ...baseProps, level: 2 },
  content: [{ type: "text", text, styles: {} }],
  children: [],
});

const paragraph = (id: string, text = ""): Block => ({
  id,
  type: "paragraph",
  props: { ...baseProps },
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children: [],
});

const checkItem = (id: string, text = ""): Block => ({
  id,
  type: "checkListItem",
  props: { ...baseProps, checked: false },
  content: text ? [{ type: "text", text, styles: {} }] : [],
  children: [],
});

/** Les 3 zones d'un ticket : problème fonctionnel / résolution technique / tests. */
export const TICKET_BODY_TEMPLATE: Block[] = [
  heading("tk-prob", "🐛 Problème fonctionnel"),
  paragraph("tk-prob-body"),
  heading("tk-res", "🔧 Résolution technique"),
  paragraph("tk-res-body"),
  heading("tk-test", "✅ Tests à faire"),
  checkItem("tk-test-1"),
];

export const TICKET_BODY_TEMPLATE_JSON = JSON.stringify(TICKET_BODY_TEMPLATE);

// ─── Structure de la database « Tickets » ─────────────────────────────────────

export type PropertyPreset = {
  name: string;
  type: PropertyType;
  config: PropertyConfig;
};

/** Colonnes ajoutées à une database de tickets (en plus de la propriété titre). */
export const TICKET_PROPERTY_PRESET: PropertyPreset[] = [
  {
    name: "Statut",
    type: "select",
    config: {
      type: "select",
      options: [
        { id: "todo", name: "À faire", color: "gray" },
        { id: "doing", name: "En cours", color: "blue" },
        { id: "review", name: "En revue", color: "orange" },
        { id: "done", name: "Terminé", color: "green" },
      ],
    },
  },
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
];

/** Nom de la propriété qui sert de regroupement kanban dans le preset ticket. */
export const TICKET_KANBAN_GROUP_PROPERTY = "Statut";
