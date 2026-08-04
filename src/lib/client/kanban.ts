import { isMultiValueType } from "@/lib/db";
import type { PropertyValue, RecordProperties } from "@/lib/db";

/** Id de la colonne « Sans valeur » — jamais un id d'option ni un userId. */
export const NULL_COL = "__null__";
/** Id de la colonne des valeurs orphelines (assigné qui a quitté l'espace). */
export const ORPHAN_COL = "__orphan__";

/**
 * Source d'une colonne : une option select (id/name) ou un membre (userId/displayName).
 * L'axe de regroupement n'a pas à savoir laquelle des deux il manipule.
 */
export type KanbanColumnSeed = { id: string; label: string };

export type KanbanColumnKind = "unassigned" | "seed" | "orphan";

export type KanbanColumn<R> = {
  id: string;
  /** Valeur d'axe de la colonne. `null` = « Sans valeur » ET colonne orpheline :
   *  utilisé tel quel comme `sourceOptionId`/`targetOptionId` de groupValueOnDrop. */
  optionId: string | null;
  label: string;
  kind: KanbanColumnKind;
  records: R[];
};

type ColumnRecord = { position: number; properties: RecordProperties };

/**
 * Colonnes d'un kanban, à partir des records et d'une liste de « graines »
 * INJECTÉE : options de la propriété pour select/multiselect, membres de
 * l'espace pour une propriété `user`. C'est ce qui rend l'axe « assigné »
 * possible — une propriété user n'a PAS d'options dans son config (à dessein).
 *
 * `includeOrphans` ajoute une colonne fourre-tout pour les valeurs qui ne
 * correspondent à AUCUNE graine. Réservé à l'axe `user` : c'est le seul type
 * dont un id peut devenir orphelin sans garde-fou (un membre part), là où le
 * serveur refuse de supprimer une option select encore référencée. Sans elle,
 * la carte d'un membre parti disparaîtrait du board sans un mot.
 *
 * ⚠️ La colonne orpheline porte `optionId: null` : au drop, elle ne retire donc
 * RIEN (le lien mort survit jusqu'à un passage par la cellule) — et elle ne doit
 * pas être une cible de dépôt, sinon la sémantique « Sans valeur » viderait les
 * assignés de la carte déposée. C'est à l'appelant de la désactiver.
 *
 * Fonction PURE (aucune dépendance navigateur) → testable en environnement node.
 */
export function buildKanbanColumns<R extends ColumnRecord>(
  records: R[],
  propertyId: string,
  propertyType: string,
  seeds: KanbanColumnSeed[],
  options: { includeOrphans?: boolean; orphanLabel?: string } = {}
): KanbanColumn<R>[] {
  const { includeOrphans = false, orphanLabel = "Sans correspondance" } = options;
  const multi = isMultiValueType(propertyType);
  const sorted = [...records].sort((a, b) => a.position - b.position);

  const isEmptyValue = (v: PropertyValue | undefined) =>
    v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

  const belongsTo = (v: PropertyValue | undefined, seedId: string) =>
    multi ? Array.isArray(v) && (v as string[]).includes(seedId) : v === seedId;

  const cols: KanbanColumn<R>[] = [
    {
      id: NULL_COL,
      optionId: null,
      label: "Sans valeur",
      kind: "unassigned",
      records: sorted.filter((r) => isEmptyValue(r.properties[propertyId])),
    },
    ...seeds.map((seed): KanbanColumn<R> => ({
      id: seed.id,
      optionId: seed.id,
      label: seed.label,
      kind: "seed",
      records: sorted.filter((r) => belongsTo(r.properties[propertyId], seed.id)),
    })),
  ];

  if (!includeOrphans) return cols;

  const known = new Set(seeds.map((s) => s.id));
  const isOrphan = (v: PropertyValue | undefined) => {
    if (isEmptyValue(v)) return false;
    const ids = Array.isArray(v) ? (v as string[]) : [String(v)];
    return ids.some((id) => !known.has(id));
  };
  const orphans = sorted.filter((r) => isOrphan(r.properties[propertyId]));
  if (orphans.length === 0) return cols;

  return [
    ...cols,
    { id: ORPHAN_COL, optionId: null, label: orphanLabel, kind: "orphan", records: orphans },
  ];
}

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
  // ⚠️ Tout type MULTI-VALEURS passe par la branche tableau. Renvoyer une string
  // pour un champ string[] corromprait le record en silence (l'optimiste passe,
  // le serveur refuse, la carte cesse d'être filtrée).
  if (!isMultiValueType(propertyType)) return targetOptionId;

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
 * Fusionne le pré-remplissage dérivé des filtres (`seed`) avec la valeur d'axe
 * (groupBy) d'une carte créée dans une colonne kanban.
 *
 * La valeur d'axe PRIME toujours : si un filtre eq porte sur la MÊME propriété
 * que le groupBy, c'est la colonne cliquée (`groupValue`) qui gagne — la carte
 * doit naître dans cette colonne. `groupValue === null` (colonne « Sans valeur »)
 * ne pose aucune clé d'axe : le seed est renvoyé tel quel.
 *
 * Fonction PURE → testable en environnement node.
 */
export function mergeSeedWithGroupValue(
  seed: RecordProperties,
  groupByPropertyId: string,
  groupValue: PropertyValue | null
): RecordProperties {
  const merged: RecordProperties = { ...seed };
  if (groupValue !== null) merged[groupByPropertyId] = groupValue;
  return merged;
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
