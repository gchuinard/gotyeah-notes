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
