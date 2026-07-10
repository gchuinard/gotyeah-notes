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
import type { ParsedRecord, ParsedView, SelectOption } from "./db";

/** Une option de select/multiselect telle qu'acceptée par l'API. */
export const selectOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.enum(SELECT_COLORS),
});

const selectConfigSchema = z.object({
  type: z.enum(["select", "multiselect"]),
  options: z.array(selectOptionSchema),
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
 *    (« eq » n'affiche plus rien, « neq » cesse silencieusement d'exclure).
 */
export function findReferencedOptionIds(
  propertyId: string,
  removedIds: string[],
  records: ParsedRecord[],
  views: ParsedView[]
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
    return inRecord || inDoneStatus || inViewFilter;
  });
}
