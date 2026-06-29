/**
 * lib/templates.ts
 *
 * Modèles de database réutilisables (registre `DATABASE_TEMPLATES`). Chaque modèle
 * définit ses colonnes, sa propriété de regroupement kanban et un corps de record
 * pré-rempli (BlockNote JSON).
 *
 * Appliqués par `POST /api/databases { template }` (scaffolding) ; le corps est
 * stocké dans `Database.recordTemplate` puis posé sur chaque nouveau record quand
 * aucun `content` n'est fourni (cf. POST /api/databases/[id]/records) → web + MCP.
 *
 * Le corps est un document BlockNote (JSON), PAS du markdown. On reste sur des
 * blocs/props confirmés pour la version installée : heading (level 1-3), paragraph,
 * numberedListItem, checkListItem, prop de bloc `textColor` (les amorces sont
 * grisées via `textColor: "gray"`).
 */

import type { PropertyType, PropertyConfig } from "./db";

// ─── Construction du corps BlockNote ──────────────────────────────────────────

const baseProps = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
} as const;

type Inline = { type: "text"; text: string; styles: Record<string, unknown> };
type Block = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Inline[];
  children: Block[];
};

const text = (s: string): Inline[] => [{ type: "text", text: s, styles: {} }];

/** Titre de zone (h3 : plus léger que h2). */
const zone = (id: string, label: string): Block => ({
  id,
  type: "heading",
  props: { ...baseProps, level: 3 },
  content: text(label),
  children: [],
});

/** Amorce grisée (le contenu que l'utilisateur remplace). */
const hint = (id: string, s: string): Block => ({
  id,
  type: "paragraph",
  props: { ...baseProps, textColor: "gray" },
  content: text(s),
  children: [],
});

const numberedHint = (id: string, s: string): Block => ({
  id,
  type: "numberedListItem",
  props: { ...baseProps, textColor: "gray" },
  content: text(s),
  children: [],
});

const checkHint = (id: string, s: string): Block => ({
  id,
  type: "checkListItem",
  props: { ...baseProps, textColor: "gray", checked: false },
  content: text(s),
  children: [],
});

// ─── Corps des modèles ────────────────────────────────────────────────────────

const TICKET_BODY: Block[] = [
  zone("tk-prob", "Problème fonctionnel"),
  hint("tk-prob-h", "Décris le besoin ou le problème, côté utilisateur."),
  zone("tk-res", "Résolution technique"),
  hint("tk-res-h", "Approche envisagée, fichiers ou zones concernés…"),
  zone("tk-test", "Tests à faire"),
  checkHint("tk-test-h", "À vérifier avant de clôturer"),
];

const BUG_BODY: Block[] = [
  zone("bg-repro", "Comment reproduire"),
  numberedHint("bg-repro-h", "Première étape…"),
  zone("bg-exp", "Résultat attendu"),
  hint("bg-exp-h", "Ce qui devrait se passer."),
  zone("bg-act", "Résultat obtenu"),
  hint("bg-act-h", "Ce qui se passe réellement."),
  zone("bg-env", "Environnement"),
  hint("bg-env-h", "Navigateur, OS, version…"),
];

// ─── Colonnes des modèles ─────────────────────────────────────────────────────

export type PropertyPreset = {
  name: string;
  type: PropertyType;
  config: PropertyConfig;
};

const STATUS_OPTIONS = [
  { id: "todo", name: "À faire", color: "gray" },
  { id: "doing", name: "En cours", color: "blue" },
  { id: "review", name: "En revue", color: "orange" },
  { id: "done", name: "Terminé", color: "green" },
];

const BUG_STATUS_OPTIONS = [
  { id: "open", name: "À traiter", color: "gray" },
  { id: "doing", name: "En cours", color: "blue" },
  { id: "review", name: "En revue", color: "orange" },
  { id: "fixed", name: "Corrigé", color: "green" },
];

const TICKET_PROPERTIES: PropertyPreset[] = [
  { name: "Statut", type: "select", config: { type: "select", options: STATUS_OPTIONS } },
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

const BUG_PROPERTIES: PropertyPreset[] = [
  { name: "Statut", type: "select", config: { type: "select", options: BUG_STATUS_OPTIONS } },
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
];

// ─── Registre ─────────────────────────────────────────────────────────────────

export type TemplateKey = "ticket" | "bug";

export type DatabaseTemplate = {
  defaultTitle: string;
  kanbanGroupProperty: string;
  properties: PropertyPreset[];
  body: string; // document BlockNote sérialisé
};

export const DATABASE_TEMPLATES: Record<TemplateKey, DatabaseTemplate> = {
  ticket: {
    defaultTitle: "Tickets",
    kanbanGroupProperty: "Statut",
    properties: TICKET_PROPERTIES,
    body: JSON.stringify(TICKET_BODY),
  },
  bug: {
    defaultTitle: "Bugs",
    kanbanGroupProperty: "Statut",
    properties: BUG_PROPERTIES,
    body: JSON.stringify(BUG_BODY),
  },
};

export const TEMPLATE_KEYS = ["ticket", "bug"] as const;
