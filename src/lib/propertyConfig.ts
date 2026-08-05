/**
 * Validation d'un `DatabaseProperty.config` entrant + garde-fous d'options.
 *
 * Module SERVEUR (importe zod) : ne pas l'importer depuis un composant client,
 * la palette partagée vit dans lib/propertyColors.ts.
 *
 * Contrat : PATCH/POST du config restent un remplacement TOTAL (convention du
 * projet). Tout client (UI comme MCP) DOIT donc renvoyer inchangés les ids des
 * options existantes — un id qui disparaît est traité comme une suppression.
 */
import { z } from "zod";
import { SELECT_COLORS } from "./propertyColors";
import { TRANSITION_ROLES, type TransitionRule } from "./permissionRules";
import type { ParsedRecord, ParsedView, SelectOption } from "./db";

/** Une option de select/multiselect telle qu'acceptée par l'API. */
export const selectOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.enum(SELECT_COLORS),
});

/**
 * Règle de permission par colonne : « pour poser cette option, il faut ces rôles
 * OU être l'une de ces personnes ». Absence de règle = permis.
 *
 * ⚠️ `userIds` n'est PAS vérifié contre les Membership de l'espace : un id qui
 * n'est plus membre rend la règle plus STRICTE, jamais plus laxiste. Direction
 * sûre, et zéro requête sur un chemin d'écriture chaud.
 */
const transitionRuleSchema = z.object({
  toOptionId: z.string().min(1),
  roles: z.array(z.enum(TRANSITION_ROLES)).optional(),
  userIds: z.array(z.string().min(1)).optional(),
});

const selectConfigSchema = z
  .object({
    type: z.enum(["select", "multiselect"]),
    options: z.array(selectOptionSchema),
    rules: z.array(transitionRuleSchema).optional(),
  })
  .superRefine((cfg, ctx) => {
    // Deux invariants que le typage seul ne voit pas, et qui produiraient des
    // règles ingouvernables : une règle pointant une option inexistante ne
    // pourrait plus jamais être satisfaite ni retirée depuis l'écran ; deux
    // règles sur la même cible rendraient la décision ambiguë.
    const ids = new Set(cfg.options.map((o) => o.id));
    const seen = new Set<string>();
    for (const [i, rule] of (cfg.rules ?? []).entries()) {
      if (!ids.has(rule.toOptionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "toOptionId"],
          message: `Règle sur une option inexistante : ${rule.toOptionId}`,
        });
      }
      if (seen.has(rule.toOptionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rules", i, "toOptionId"],
          message: `Deux règles pour la même option : ${rule.toOptionId}`,
        });
      }
      seen.add(rule.toOptionId);
    }
  });

export type ConfigValidation = { ok: true } | { ok: false; details: unknown };

/**
 * Valide un config entrant. Seuls select/multiselect sont validés STRICTEMENT :
 * c'est là qu'une option mal formée (id vide, couleur hors palette) orphelinerait
 * des records ou tomberait dans un fallback gris silencieux. Les autres types
 * passent tels quels — comportement historique préservé.
 */
export function validatePropertyConfig(config: unknown): ConfigValidation {
  const type = (config as { type?: unknown } | null | undefined)?.type;
  if (type !== "select" && type !== "multiselect") return { ok: true };

  const parsed = selectConfigSchema.safeParse(config);
  return parsed.success ? { ok: true } : { ok: false, details: parsed.error.flatten() };
}

/** Ids présents dans `prev` mais absents de `next` (= options retirées). */
export function removedOptionIds(prev: SelectOption[], next: SelectOption[]): string[] {
  const nextIds = new Set(next.map((o) => o.id));
  return prev.filter((o) => !nextIds.has(o.id)).map((o) => o.id);
}

/** Vrai si `value` (scalaire ou tableau multiselect) désigne `optionId`. */
function valueRefersTo(value: unknown, optionId: string): boolean {
  return Array.isArray(value) ? value.includes(optionId) : value === optionId;
}

/**
 * Parmi les options retirées, celles ENCORE référencées — donc non supprimables
 * en v1 (aucune stratégie de nettoyage) :
 *  - par un record : Record.properties[propertyId] vaut l'id (select) ou le
 *    contient (multiselect) ;
 *  - par une vue backlog : View.config.doneStatusOptionId pointe dessus ;
 *  - par un FILTRE de vue : View.config.filters[] portant sur cette propriété et
 *    dont la valeur est cet id — sinon le filtre resterait sur un id fantôme
 *    (« eq » n'affiche plus rien, « neq » cesse silencieusement d'exclure) ;
 *  - par une RÈGLE de permission : `rules[].toOptionId` pointe dessus. Sinon on
 *    supprimerait l'option en laissant une règle qui ne peut plus être ni
 *    satisfaite ni retirée depuis l'écran.
 *
 * ⚠️ `rules` doit être les règles EFFECTIVES (celles qu'on s'apprête à écrire),
 * pas les anciennes : passer les anciennes rendrait impossible de supprimer une
 * option ET sa règle dans le même PATCH.
 */
export function findReferencedOptionIds(
  propertyId: string,
  removedIds: string[],
  records: ParsedRecord[],
  views: ParsedView[],
  rules: TransitionRule[] = []
): string[] {
  if (removedIds.length === 0) return [];

  return removedIds.filter((optionId) => {
    const inRecord = records.some((r) => valueRefersTo(r.properties[propertyId], optionId));
    const inDoneStatus = views.some((v) => v.config.doneStatusOptionId === optionId);
    const inViewFilter = views.some((v) =>
      (v.config.filters ?? []).some(
        (f) => f.propertyId === propertyId && valueRefersTo(f.value, optionId)
      )
    );
    const inRule = rules.some((r) => r.toOptionId === optionId);
    return inRecord || inDoneStatus || inViewFilter || inRule;
  });
}
