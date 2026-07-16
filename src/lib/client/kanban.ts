import type { PropertyValue } from "@/lib/db";

/**
 * Identité DnD d'une carte : « colonne::record ».
 *
 * En multiselect, un record appartient à PLUSIEURS colonnes et y est donc rendu
 * plusieurs fois. Un id nu (= record.id) serait dupliqué : dnd-kit ne garderait
 * qu'un nœud par id, et on ne saurait pas de QUELLE colonne part le drag —
 * or c'est précisément l'option à retirer.
 */
const DND_SEP = "::";

export const cardDndId = (colId: string, recordId: string) => `${colId}${DND_SEP}${recordId}`;

/** `recordId === null` ⇒ l'id désigne une colonne (droppable), pas une carte. */
export function parseDndId(id: string): { colId: string; recordId: string | null } {
  const idx = id.indexOf(DND_SEP);
  if (idx === -1) return { colId: id, recordId: null };
  return { colId: id.slice(0, idx), recordId: id.slice(idx + DND_SEP.length) };
}

/**
 * Valeur de la propriété d'axe (groupByPropertyId) après avoir déposé une carte
 * dans la colonne cible d'un kanban.
 *
 * `null` en retour signifie « retirer la clé de Record.properties » — c'est la
 * convention de mergeRecordProperties côté API (une valeur null supprime la clé).
 *
 * - select      : la valeur EST l'id d'option (string), ou null pour « Sans valeur ».
 * - multiselect : la valeur est un TABLEAU d'ids. Déplacer de la colonne source
 *   vers la cible retire l'id source et ajoute l'id cible (sans doublon) en
 *   PRÉSERVANT les autres appartenances. Déposer dans « Sans valeur » retire la
 *   clé : cette colonne ne contient que les cartes sans aucune valeur.
 *
 * Fonction PURE (aucune dépendance navigateur) → testable en environnement node.
 */
export function groupValueOnDrop(
  propertyType: string,
  currentValue: PropertyValue | undefined,
  sourceOptionId: string | null,
  targetOptionId: string | null
): PropertyValue | null {
  if (propertyType !== "multiselect") return targetOptionId;

  // « Sans valeur » = aucune valeur résiduelle.
  if (targetOptionId === null) return null;

  const current = Array.isArray(currentValue) ? (currentValue as string[]) : [];
  const withoutSource =
    sourceOptionId === null ? current : current.filter((id) => id !== sourceOptionId);

  return withoutSource.includes(targetOptionId)
    ? withoutSource
    : [...withoutSource, targetOptionId];
}

/**
 * Valeur initiale de la propriété d'axe pour une carte créée dans une colonne.
 * `null` = ne pas poser la clé (colonne « Sans valeur »).
 */
export function initialGroupValue(
  propertyType: string,
  optionId: string | null
): PropertyValue | null {
  return groupValueOnDrop(propertyType, undefined, null, optionId);
}

/**
 * Faut-il proposer le bouton d'ajout en tête d'une colonne kanban ?
 *
 * Avec le flag `createInUnassignedOnly`, la création n'est offerte que dans la
 * colonne « Sans valeur » (`optionId === null`) : toute carte naît sans valeur
 * d'axe, à classer ensuite. Sans le flag, le bouton apparaît sur chaque colonne.
 *
 * Le flag ne pilote QUE l'affichage du bouton, pas sa POSITION (le bouton est
 * ancré en tête de colonne pour rester visible même sur une lane pleine).
 * Fonction PURE → testable en environnement node.
 */
export function shouldShowKanbanAddButton(
  createOnlyInUnassigned: boolean,
  optionId: string | null
): boolean {
  return !createOnlyInUnassigned || optionId === null;
}

/**
 * Propriétés « métier » toujours affichées et éditables sur une carte du board,
 * même si leur position les exclurait du top-2. Repérées par NOM (le nom est le
 * seul point de contact stable avec l'utilisateur ; l'id est opaque).
 */
export const FORCED_CARD_PROPERTY_NAMES = ["Main à", "Projet"];

/** Nom normalisé (trim + minuscules + sans diacritiques) pour un match robuste. */
function normalizePropName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const FORCED_CARD_PROPERTY_SET = new Set(FORCED_CARD_PROPERTY_NAMES.map(normalizePropName));

/**
 * Propriétés à rendre (et éditer en inline) sur une carte kanban.
 *
 * Base historique = les `limit` premières propriétés (hors `title` et hors axe de
 * regroupement) par position. On y ADJOINT toute propriété « forcée » (Main à,
 * Projet) absente de cette base, pour GARANTIR sa présence et son édition inline
 * quelle que soit sa position — sans l'ajouter deux fois si elle est déjà dans le
 * top-2. Ordre final stable = par position.
 *
 * Fonction PURE (contrainte structurelle minimale) → testable en environnement node.
 */
export function buildCardProps<
  T extends { id: string; name: string; type: string; position: number }
>(properties: T[], groupByPropertyId: string | undefined, limit = 2): T[] {
  const eligible = properties
    .filter((p) => p.type !== "title" && p.id !== groupByPropertyId)
    .sort((a, b) => a.position - b.position);

  const base = eligible.slice(0, limit);
  const baseIds = new Set(base.map((p) => p.id));
  const forced = eligible.filter(
    (p) => !baseIds.has(p.id) && FORCED_CARD_PROPERTY_SET.has(normalizePropName(p.name))
  );

  return [...base, ...forced].sort((a, b) => a.position - b.position);
}
