/**
 * lib/db.ts
 *
 * Helpers parse/serialize pour les 3 modèles dont des champs sont stockés
 * en JSON string (contrainte SQLite). Toujours passer par ces fonctions
 * plutôt que d'appeler JSON.parse/stringify à la main dans les routes API.
 *
 * Règle d'or : les propriétés USER d'un Record sont indexées par
 * DatabaseProperty.id (stable), JAMAIS par le nom de la propriété.
 */

import type {
  DatabasePropertyModel as DatabaseProperty,
  RecordModel as PrismaRecord,
  ViewModel as View,
} from "../../generated/prisma/models";

// ─── Types : sprints (vue backlog façon Jira) ─────────────────────────────────

export type SprintState = "future" | "active" | "completed";

/**
 * Sprint tel que renvoyé par l'API (dates sérialisées en string ISO).
 * Record.sprintId pointe dessus ; null = backlog (issue non planifiée).
 */
export type ParsedSprint = {
  id: string;
  databaseId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  state: SprintState;
  // Notes de version générées server-side à la clôture (markdown des issues livrées).
  // null tant que le sprint n'a pas été terminé. Lecture seule côté client.
  releaseNotes: string | null;
  position: number;
};

// ─── Types : valeurs de propriétés ───────────────────────────────────────────

export type PropertyType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "relation";

/** Une option d'un champ select ou multiselect. */
export type SelectOption = {
  id: string;     // ID stable — renommer une option ne casse pas les records
  name: string;
  color: string;  // ex: "red" | "blue" | "green" | …
};

/**
 * Config JSON stockée dans DatabaseProperty.config.
 * Vide ({}) pour les types qui n'ont pas d'options (text, checkbox, url, email).
 *
 * relation : la valeur du record est un string[] d'ids de Record appartenant à
 * `targetDatabaseId` (même workspace). Pas de backlink en v1 ; un id dont le
 * record a été supprimé est un « lien mort » toléré à l'affichage.
 */
export type PropertyConfig =
  | { type: "select";      options: SelectOption[] }
  | { type: "multiselect"; options: SelectOption[] }
  | { type: "number";      format: "integer" | "decimal" | "currency" | "percent" }
  | { type: "date";        includeTime: boolean }
  | { type: "relation";    targetDatabaseId: string }
  | { type: "title" | "text" | "checkbox" | "url" | "email" };

/**
 * Valeur possible pour une propriété user dans Record.properties.
 * - text/url/email  → string
 * - number          → number
 * - checkbox        → boolean
 * - select          → string (SelectOption.id)
 * - multiselect     → string[] (SelectOption.id[])
 * - relation        → string[] (Record.id[] de la database cible)
 * - date            → string ISO 8601
 * - null = la propriété existe dans le schéma mais n'a pas de valeur sur ce record
 */
export type PropertyValue = string | number | boolean | string[] | null;

/**
 * Forme du champ Record.properties une fois parsé.
 * Clé = DatabaseProperty.id  (ex: "clxabc123")
 * Valeur = PropertyValue selon le type de la propriété
 */
export type RecordProperties = Record<string, PropertyValue>;

// ─── Types : configuration de vue ────────────────────────────────────────────

export type SortDirection = "asc" | "desc";

export type FilterOperator =
  | "eq" | "neq"
  | "contains" | "notContains"
  | "isEmpty" | "isNotEmpty"
  | "gt" | "lt" | "gte" | "lte";

export type ViewSort = {
  propertyId: string;
  direction: SortDirection;
};

export type ViewFilter = {
  propertyId: string;
  operator: FilterOperator;
  value?: PropertyValue;
};

/**
 * Forme du champ View.config une fois parsé.
 *
 * - visiblePropertyIds  : ordre et liste des colonnes affichées (table/gallery)
 * - sorts               : liste de tris appliqués (ordre = priorité)
 * - filters             : filtres actifs (tous en AND pour l'instant)
 * - groupByPropertyId   : colonne de regroupement (kanban)
 * - calendarPropertyId  : propriété date utilisée pour le calendrier
 *
 * Backlog (façon Jira) — propriétés câblées par le template scrum à la création.
 * Toutes optionnelles : la vue dégrade proprement si elles manquent.
 * - pointsPropertyId    : propriété number = story points (somme par sprint)
 * - statusPropertyId    : propriété select = statut (badge + avancement done/total)
 * - epicPropertyId      : propriété select = épic (panneau de filtrage latéral)
 * - doneStatusOptionId  : option de statusProperty considérée « terminé »
 */
export type ViewConfig = {
  visiblePropertyIds?: string[];
  sorts?: ViewSort[];
  filters?: ViewFilter[];
  groupByPropertyId?: string;
  // Kanban : si true, le bouton « + Nouveau » n'apparaît que sur la colonne « Sans valeur »
  // (toute carte naît sans valeur d'axe, à classer ensuite). Opt-in par vue ;
  // absent/false = bouton sur toutes les colonnes (comportement historique).
  createInUnassignedOnly?: boolean;
  calendarPropertyId?: string;
  columnWidths?: Record<string, number>;
  pointsPropertyId?: string;
  statusPropertyId?: string;
  epicPropertyId?: string;
  doneStatusOptionId?: string;
  // Kanban « sprint-aware » (board Scrum). undefined = "all" (kanban classique, toutes
  // les issues). "active" = le sprint en cours. Sinon un id de Sprint précis.
  sprintScope?: "all" | "active" | string;
};

// ─── Types : modèles parsés ───────────────────────────────────────────────────

/** DatabaseProperty avec config JSON parsé en objet. */
export type ParsedDatabaseProperty = Omit<DatabaseProperty, "config"> & {
  config: PropertyConfig;
};

/**
 * Record avec properties JSON parsé en objet.
 * Note : content (BlockNote) reste une string — ne pas toucher.
 */
export type ParsedRecord = Omit<PrismaRecord, "properties"> & {
  properties: RecordProperties;
};

/** View avec config JSON parsé en objet. */
export type ParsedView = Omit<View, "config"> & {
  config: ViewConfig;
};

// ─── Parse (DB → app) ────────────────────────────────────────────────────────

export function parseDatabaseProperty(raw: DatabaseProperty): ParsedDatabaseProperty {
  return { ...raw, config: JSON.parse(raw.config) as PropertyConfig };
}

export function parseRecord(raw: PrismaRecord): ParsedRecord {
  return { ...raw, properties: JSON.parse(raw.properties) as RecordProperties };
}

export function parseView(raw: View): ParsedView {
  return { ...raw, config: JSON.parse(raw.config) as ViewConfig };
}

export const parseManyDatabaseProperties = (raws: DatabaseProperty[]): ParsedDatabaseProperty[] =>
  raws.map(parseDatabaseProperty);

export const parseManyRecords = (raws: PrismaRecord[]): ParsedRecord[] =>
  raws.map(parseRecord);

/**
 * Projection : record sans les corps lourds (content BlockNote + sectionsBody).
 * Utilisée par GET /records?includeContent=false (payloads MCP allégés).
 */
export function stripRecordBody(
  record: ParsedRecord
): Omit<ParsedRecord, "content" | "sectionsBody"> {
  const clone: Record<string, unknown> = { ...record };
  delete clone.content;
  delete clone.sectionsBody;
  return clone as Omit<ParsedRecord, "content" | "sectionsBody">;
}

export const parseManyViews = (raws: View[]): ParsedView[] =>
  raws.map(parseView);

// ─── Serialize (app → DB) ────────────────────────────────────────────────────

/** Prépare un objet à écrire en DB : stringify uniquement les champs JSON présents. */
export function serializeDatabaseProperty(
  data: Partial<ParsedDatabaseProperty>
): Partial<DatabaseProperty> {
  const { config, ...rest } = data;
  return {
    ...rest,
    ...(config !== undefined && { config: JSON.stringify(config) }),
  };
}

export function serializeRecord(
  data: Partial<ParsedRecord>
): Partial<PrismaRecord> {
  const { properties, ...rest } = data;
  return {
    ...rest,
    ...(properties !== undefined && { properties: JSON.stringify(properties) }),
  };
}

export function serializeView(
  data: Partial<ParsedView>
): Partial<View> {
  const { config, ...rest } = data;
  return {
    ...rest,
    ...(config !== undefined && { config: JSON.stringify(config) }),
  };
}

// ─── Helpers de mutation ──────────────────────────────────────────────────────

/**
 * Fusionne un patch partiel dans les propriétés existantes d'un Record.
 *
 * Règle : une valeur `null` dans `patch` signifie "supprimer cette cellule".
 * La clé est retirée du résultat final — elle n'est PAS conservée avec null.
 * Cela évite que les JSON de properties se polluent de nulls au fil du temps.
 *
 * Exemple : merge({ a: "foo", b: 42 }, { b: null, c: true })
 *           → { a: "foo", c: true }   (b supprimé)
 */
export function mergeRecordProperties(
  existing: RecordProperties,
  patch: RecordProperties
): RecordProperties {
  const merged = { ...existing, ...patch };
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== null)
  ) as RecordProperties;
}

/**
 * Retire une clé de propriété (par DatabaseProperty.id) dans chaque Record
 * fourni, et retourne un tableau `{ id, properties }` prêt à être passé en
 * bulk à prisma.$transaction([...records.map(r => prisma.record.update(…))]).
 *
 * Ne fait pas les updates lui-même — c'est à l'appelant de les exécuter en
 * transaction pour garantir l'atomicité.
 */
export function removePropertyKey(
  records: PrismaRecord[],
  propertyId: string
): Array<{ id: string; properties: string }> {
  return records.map((r) => {
    const props = JSON.parse(r.properties) as RecordProperties;
    delete props[propertyId];
    return { id: r.id, properties: JSON.stringify(props) };
  });
}

// ─── Corps sectionné (templates à libellés fixes) ─────────────────────────────

/**
 * Une section du corps d'un record templaté.
 * - id      : stable (correspond à TemplateSection.id)
 * - label   : libellé FIXE (non éditable, rendu hors éditeur)
 * - content : document BlockNote (mêmes blocs que Record.content / Page.content)
 */
export type RecordSection = {
  id: string;
  label: string;
  content: unknown[];
};

/** Parse `Record.sectionsBody` (JSON) → sections, ou null si corps libre. */
export function parseSectionsBody(raw: string | null): RecordSection[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecordSection[]) : null;
  } catch {
    return null;
  }
}

export function serializeSectionsBody(sections: RecordSection[]): string {
  return JSON.stringify(sections);
}

// ─── Notes de version : blocs BlockNote de la page « Patch notes » ────────────
//
// À la clôture d'un sprint, un groupe de blocs BlockNote (titre daté + issues
// livrées + compteur reporté) est appendé À LA FIN du document BlockNote de la
// page « 📓 Patch notes » de la database. Ces helpers sont PURS (aucun accès DB)
// pour être testables ; l'écriture transactionnelle vit dans lib/pages.ts.

/**
 * Bloc BlockNote minimal. Un document BlockNote (Page.content) est un tableau de
 * ces blocs. On produit la forme canonique sérialisée (props/content/children
 * explicites) pour un rendu robuste au rechargement de l'éditeur.
 */
export type BlockNoteBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: Array<{ type: "text"; text: string; styles: Record<string, unknown> }>;
  children: unknown[];
};

/** Préfixe de l'id du bloc titre — marqueur d'idempotence porté par sprintId. */
export const RELEASE_NOTES_BLOCK_PREFIX = "release-notes-";

/** Id déterministe du bloc titre d'un sprint (marqueur d'idempotence de l'append). */
export function releaseNotesBlockId(sprintId: string): string {
  return `${RELEASE_NOTES_BLOCK_PREFIX}${sprintId}`;
}

const DEFAULT_BLOCK_PROPS = {
  textColor: "default",
  backgroundColor: "default",
  textAlignment: "left",
} as const;

function textBlock(
  id: string,
  type: "paragraph" | "bulletListItem",
  text: string
): BlockNoteBlock {
  return {
    id,
    type,
    props: { ...DEFAULT_BLOCK_PROPS },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

export type ReleaseNotesBlockInput = {
  sprintId: string;
  sprintName: string;
  closedDate: string; // "YYYY-MM-DD"
  deliveredTitles: string[];
  reportedCount: number;
};

/**
 * Construit le groupe de blocs BlockNote appendé à la page « Patch notes ».
 * - Bloc titre (heading) portant l'id marqueur `release-notes-<sprintId>`.
 * - Un compteur de livrées, puis une puce par issue livrée.
 * - Un compteur de reportées (distinct des livrées) si reportedCount > 0.
 * Garde-fou titre vide : repli « Sans titre » (jamais une puce/ligne vide).
 */
export function buildReleaseNotesBlocks(input: ReleaseNotesBlockInput): BlockNoteBlock[] {
  const markerId = releaseNotesBlockId(input.sprintId);
  const n = input.deliveredTitles.length;

  const heading: BlockNoteBlock = {
    id: markerId,
    type: "heading",
    props: { ...DEFAULT_BLOCK_PROPS, level: 2 },
    content: [
      {
        type: "text",
        text: `${input.sprintName || "Sprint"} — ${input.closedDate}`,
        styles: {},
      },
    ],
    children: [],
  };

  const summary = textBlock(
    `${markerId}-summary`,
    "paragraph",
    `${n} issue${n > 1 ? "s" : ""} livrée${n > 1 ? "s" : ""}`
  );

  const bullets = input.deliveredTitles.map((t, i) =>
    textBlock(`${markerId}-d${i}`, "bulletListItem", t || "Sans titre")
  );

  const blocks: BlockNoteBlock[] = [heading, summary, ...bullets];

  if (input.reportedCount > 0) {
    const r = input.reportedCount;
    blocks.push(
      textBlock(
        `${markerId}-reported`,
        "paragraph",
        `${r} issue${r > 1 ? "s" : ""} reportée${r > 1 ? "s" : ""} au backlog`
      )
    );
  }

  return blocks;
}

/**
 * Réconciliation d'exhaustivité : les issues qui SERAIENT listées (encore dans le
 * sprint au moment de la génération) doivent toutes être « livrées » (statut ===
 * doneStatusOptionId). Sinon le bloc listerait comme livrée une issue non terminée
 * → l'appelant doit annuler la clôture (rollback) et renvoyer une erreur.
 */
export function reconcileDelivered(
  records: Array<{ properties: RecordProperties }>,
  statusPropertyId: string,
  doneStatusOptionId: string
): { ok: boolean; listed: number; delivered: number } {
  const listed = records.length;
  const delivered = records.filter(
    (r) => r.properties[statusPropertyId] === doneStatusOptionId
  ).length;
  return { ok: listed === delivered, listed, delivered };
}

export type AppendBlocksResult =
  | { status: "appended"; content: string }
  | { status: "already"; content: string }
  | { status: "corrupt" };

/**
 * Append idempotent des blocs À LA FIN d'un document BlockNote sérialisé.
 * - Contenu non parsable ou non-tableau → { status: "corrupt" } (l'appelant décide
 *   de rollback ; jamais d'écrasement du contenu existant).
 * - Marqueur `release-notes-<sprintId>` déjà présent (bloc titre) → { status:
 *   "already" }, contenu inchangé (jamais 2 blocs pour le même sprint).
 * - Sinon les blocs sont concaténés en fin de tableau (aucun bloc préexistant
 *   réordonné ni écrasé).
 */
export function appendReleaseNotesToContent(
  rawContent: string,
  sprintId: string,
  blocks: BlockNoteBlock[]
): AppendBlocksResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { status: "corrupt" };
  }
  if (!Array.isArray(parsed)) return { status: "corrupt" };

  const marker = releaseNotesBlockId(sprintId);
  const already = parsed.some(
    (b) => typeof b === "object" && b !== null && (b as { id?: unknown }).id === marker
  );
  if (already) return { status: "already", content: rawContent };

  return { status: "appended", content: JSON.stringify([...parsed, ...blocks]) };
}
