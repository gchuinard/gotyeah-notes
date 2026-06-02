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
  | "email";

/** Une option d'un champ select ou multiselect. */
export type SelectOption = {
  id: string;     // ID stable — renommer une option ne casse pas les records
  name: string;
  color: string;  // ex: "red" | "blue" | "green" | …
};

/**
 * Config JSON stockée dans DatabaseProperty.config.
 * Vide ({}) pour les types qui n'ont pas d'options (text, checkbox, url, email).
 */
export type PropertyConfig =
  | { type: "select";      options: SelectOption[] }
  | { type: "multiselect"; options: SelectOption[] }
  | { type: "number";      format: "integer" | "decimal" | "currency" | "percent" }
  | { type: "date";        includeTime: boolean }
  | { type: "title" | "text" | "checkbox" | "url" | "email" };

/**
 * Valeur possible pour une propriété user dans Record.properties.
 * - text/url/email  → string
 * - number          → number
 * - checkbox        → boolean
 * - select          → string (SelectOption.id)
 * - multiselect     → string[] (SelectOption.id[])
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
 */
export type ViewConfig = {
  visiblePropertyIds?: string[];
  sorts?: ViewSort[];
  filters?: ViewFilter[];
  groupByPropertyId?: string;
  calendarPropertyId?: string;
  columnWidths?: Record<string, number>;
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
