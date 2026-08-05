/**
 * Permissions fines par colonne — décision PURE, zéro dépendance.
 *
 * ⚠️ Ce module est importé par des composants `"use client"` (Cell, KanbanView,
 * BulkActionBar). Il ne doit JAMAIS importer `lib/workspace` : celui-ci tire
 * `lib/prisma`, donc l'adaptateur `better-sqlite3` — un addon NATIF — dans le
 * bundle navigateur. Le problème n'est pas l'exécution (le singleton Prisma est
 * paresseux) mais le BUNDLING. D'où le rang de rôles redéclaré ici, gardé en
 * phase avec `lib/workspace` par un test unitaire.
 *
 * Modèle : une règle dit « pour poser CETTE option, il faut être dans ces rôles
 * OU être l'une de ces personnes ». L'ABSENCE de règle vaut permission — c'est
 * ce qui rend le lot rétrocompatible avec les 22 boards de production, dont
 * aucun config ne porte de clé `rules`.
 *
 * ⚠️ Il n'y a PAS d'exemption pour les administrateurs (décision de Gautier,
 * 05/08). Un admin bloqué par une règle ne la contourne pas : il la MODIFIE,
 * ce que lui seul peut faire (le gate `rules` de PATCH /api/properties/[id] est
 * admin). L'échappatoire existe donc, mais elle est explicite, écrite dans le
 * config et réversible — là où une exemption serait invisible.
 */

export const TRANSITION_ROLES = ["admin", "editor", "viewer"] as const;
export type RuleRole = (typeof TRANSITION_ROLES)[number];

/** Hiérarchie admin ⊇ editor ⊇ viewer — miroir de ROLE_RANK (lib/workspace). */
const RULE_ROLE_RANK: Record<RuleRole, number> = { viewer: 0, editor: 1, admin: 2 };

export type TransitionRule = {
  /** Option CIBLE gouvernée par la règle. */
  toOptionId: string;
  /** Rôles autorisés, hiérarchiques : « editor » laisse aussi passer un admin. */
  roles?: RuleRole[];
  /** Personnes nommément autorisées, quel que soit leur rôle. */
  userIds?: string[];
};

export type TransitionActor = { userId: string; role: string };

/** Vrai si `role` atteint au moins `required` (tolère un rôle inconnu → false). */
function rankSatisfies(role: string, required: RuleRole): boolean {
  const rank = RULE_ROLE_RANK[role as RuleRole];
  return rank !== undefined && rank >= RULE_ROLE_RANK[required];
}

/**
 * `actor` peut-il poser l'option `to` ?
 *
 * ⚠️ L'ORDRE D'ÉVALUATION EST FIGÉ, et c'est la seule ligne de ce lot qui peut
 * casser la production. Le raccourci « pas d'identité → refus » ne doit JAMAIS
 * s'exécuter avant le test « pas de règle » : inversé, il viderait tous les
 * menus déroulants select des 22 boards dès que le rôle n'est pas transmis.
 *
 * `from` est accepté et volontairement IGNORÉ : le lot 1 ne gouverne que la
 * cible. Le déclarer dès maintenant évite de réécrire tous les call sites quand
 * le lot 2 introduira les transitions « depuis A ».
 */
export function canTransition(
  rules: TransitionRule[] | undefined,
  from: string | null,
  to: string | null,
  actor: TransitionActor | undefined
): boolean {
  void from;
  // 1. Aucune règle sur cette cible → permis. TOUJOURS en premier.
  const rule = (rules ?? []).find((r) => r.toOptionId === to);
  if (!rule) return true;
  // 2. « Sans valeur » n'est pas une option gouvernable en lot 1.
  if (to === null) return true;
  // 3. Règle existante mais identité inconnue → refus (côté UI : verrouillé).
  if (!actor) return false;
  // 4. Clauses en OU : un rôle suffisant, ou être nommément désigné.
  const byRole = (rule.roles ?? []).some((r) => rankSatisfies(actor.role, r));
  const byName = (rule.userIds ?? []).includes(actor.userId);
  return byRole || byName;
}

/**
 * Options que `after` fait ENTRER par rapport à `before`, pour une propriété
 * select ou multiselect. Une valeur réémise à l'identique n'entre pas — c'est ce
 * qui évite de refuser un membre restreint qui modifie le titre d'une carte
 * posée dans une colonne interdite.
 */
export function enteredOptionIds(before: unknown, after: unknown): (string | null)[] {
  const norm = (v: unknown): (string | null)[] => {
    if (v === null || v === undefined || v === "") return [];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    return typeof v === "string" ? [v] : [];
  };
  const had = new Set(norm(before));
  return norm(after).filter((id) => !had.has(id));
}

/**
 * Options que `actor` n'a pas le droit de poser dans cette transition.
 * Vide = la transition passe. C'est la fonction que les routes appellent.
 */
export function deniedTransitions(
  rules: TransitionRule[] | undefined,
  before: unknown,
  after: unknown,
  actor: TransitionActor | undefined
): string[] {
  return enteredOptionIds(before, after).filter(
    (id): id is string => id !== null && !canTransition(rules, null, id, actor)
  );
}
