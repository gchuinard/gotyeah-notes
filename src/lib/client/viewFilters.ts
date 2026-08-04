import { CURRENT_USER_TOKEN } from "@/lib/db";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  RecordProperties,
  ViewConfig,
  ViewFilter,
  ViewSort,
  SelectOption,
} from "@/lib/db";

function getRawValue(record: ParsedRecord, property: ParsedDatabaseProperty): unknown {
  if (property.type === "title") return record.title ?? "";
  return record.properties[property.id] ?? null;
}

/**
 * Remplace le jeton « @me » d'un filtre par l'id de l'utilisateur qui regarde.
 *
 * Le jeton est ce qui permet à UNE vue partagée de montrer à chacun SES cartes :
 * `View.config` est en base et commun à tous les membres, y figer un userId
 * donnerait les cartes de son auteur à tout le monde.
 *
 * ⚠️ Sans identité (`currentUserId` absent), le filtre est laissé TEL QUEL : il
 * ne matche alors rien et la vue est vide. C'est délibéré — un board vide se
 * remarque, un board qui montre les cartes de tout le monde ne se remarque pas.
 *
 * Renvoie le tableau d'origine s'il ne contient aucun jeton (aucune allocation
 * inutile, et l'identité des références reste stable pour les mémos React).
 *
 * Fonction PURE → testable en environnement node, et utilisée AUSSI côté serveur
 * (GET /api/databases/[id]/records accepte un param `filter`).
 */
export function resolveFilterTokens(
  filters: ViewFilter[],
  currentUserId: string | null | undefined,
  properties: ParsedDatabaseProperty[]
): ViewFilter[] {
  if (!currentUserId) return filters;
  const isUserFilter = (f: ViewFilter) =>
    f.value === CURRENT_USER_TOKEN &&
    properties.find((p) => p.id === f.propertyId)?.type === "user";
  // Scopé au type `user` : « @me » saisi à la main dans le filtre d'une colonne
  // TEXTE resterait sinon réécrit en cuid, et cette vue passerait silencieusement
  // à zéro résultat pour tout le monde.
  if (!filters.some(isUserFilter)) return filters;
  return filters.map((f) => (isUserFilter(f) ? { ...f, value: currentUserId } : f));
}

/**
 * Dérive les valeurs de pré-remplissage d'une carte créée depuis une vue filtrée.
 *
 * Ne retient QUE les filtres `{ operator: "eq", value }` à valeur unique (string)
 * sur des propriétés `select` ou `text` : ce sont les seuls dont on peut déduire
 * une valeur qui satisfera le filtre PAR CONSTRUCTION, afin que la carte reste
 * visible au lieu de disparaître silencieusement après revalidation.
 *
 * Tout le reste est écarté volontairement :
 * - opérateurs `neq`/`gt`/`lt`/`gte`/`lte`/`contains`/`notContains`/`isEmpty`/
 *   `isNotEmpty` → ambigus ou négatifs (aucune valeur unique à semer) ;
 * - `multiselect`/`relation` (leur `eq` n'existe pas ; ils filtrent par `contains`
 *   sur un tableau) → jamais pré-remplis ;
 * - `title` → stocké dans `Record.title`, pas dans `properties` : hors périmètre.
 *
 * Fonction PURE (aucune dépendance navigateur) → testable en environnement node.
 */
export function deriveSeedFromFilters(
  filters: ViewFilter[],
  properties: ParsedDatabaseProperty[],
  currentUserId?: string | null
): RecordProperties {
  const seed: RecordProperties = {};
  // Résolu ICI et pas seulement chez l'appelant : sans ça, une carte créée dans
  // une vue « Moi » naîtrait assignée à la chaîne littérale « @me » — refusée
  // en 400 par validateUserValues.
  for (const filter of resolveFilterTokens(filters, currentUserId, properties)) {
    const property = properties.find((p) => p.id === filter.propertyId);
    if (!property) continue;
    if (typeof filter.value !== "string") continue;
    // Jeton NON résolu (identité inconnue) : ne rien semer. Le semer écrirait la
    // chaîne « @me » dans un champ d'assignés → 400 de validateUserValues, et la
    // création de carte échouerait au lieu de naître simplement sans assigné.
    if (filter.value === CURRENT_USER_TOKEN) continue;

    // `user` filtre par `contains` (valeur = tableau) : sans cette branche, une
    // carte créée dans un board filtré par assigné naîtrait SANS assigné et
    // disparaîtrait à la revalidation — le bug que ce helper existe pour éviter.
    if (property.type === "user") {
      if (filter.operator !== "contains") continue;
      seed[filter.propertyId] = [filter.value];
      continue;
    }

    if (filter.operator !== "eq") continue;
    if (property.type !== "select" && property.type !== "text") continue;
    seed[filter.propertyId] = filter.value;
  }
  return seed;
}

export function applyFilters(
  records: ParsedRecord[],
  filters: ViewFilter[],
  properties: ParsedDatabaseProperty[]
): ParsedRecord[] {
  if (!filters.length) return records;

  return records.filter((record) =>
    filters.every((filter) => {
      const property = properties.find((p) => p.id === filter.propertyId);
      if (!property) return true;

      const raw = getRawValue(record, property);
      const op = filter.operator;
      const fv = filter.value;

      switch (property.type) {
        case "title":
        case "text":
        case "url":
        case "email": {
          const str = raw != null ? String(raw) : "";
          const fvStr = fv != null ? String(fv) : "";
          if (op === "isEmpty")     return str === "";
          if (op === "isNotEmpty")  return str !== "";
          if (op === "eq")          return str === fvStr;
          if (op === "neq")         return str !== fvStr;
          if (op === "contains")    return str.toLowerCase().includes(fvStr.toLowerCase());
          if (op === "notContains") return !str.toLowerCase().includes(fvStr.toLowerCase());
          return true;
        }

        case "number": {
          const isEmpty = raw === null || raw === undefined || raw === "";
          if (op === "isEmpty")    return isEmpty;
          if (op === "isNotEmpty") return !isEmpty;
          if (isEmpty) return false;
          const n = Number(raw);
          const fvn = Number(fv);
          if (op === "eq")  return n === fvn;
          if (op === "neq") return n !== fvn;
          if (op === "gt")  return n > fvn;
          if (op === "lt")  return n < fvn;
          if (op === "gte") return n >= fvn;
          if (op === "lte") return n <= fvn;
          return true;
        }

        case "checkbox": {
          const b = Boolean(raw);
          if (op === "eq")          return b === Boolean(fv);
          if (op === "isEmpty")     return !b;
          if (op === "isNotEmpty")  return b;
          return true;
        }

        case "select": {
          const isEmpty = raw === null || raw === undefined || raw === "";
          if (op === "isEmpty")    return isEmpty;
          if (op === "isNotEmpty") return !isEmpty;
          if (op === "eq")         return raw === fv;
          if (op === "neq")        return raw !== fv;
          return true;
        }

        // relation = ids de records cibles, user = ids de membres → même forme
        // (string[]) et donc mêmes opérateurs que multiselect. ⚠️ Ce bloc IGNORE
        // eq/neq : l'UI doit mapper « est / n'est pas » sur contains/notContains,
        // sinon le filtre s'affiche actif tout en ne filtrant rien.
        case "multiselect":
        case "relation":
        case "user": {
          const arr = Array.isArray(raw) ? (raw as string[]) : [];
          if (op === "isEmpty")     return arr.length === 0;
          if (op === "isNotEmpty")  return arr.length > 0;
          if (op === "contains")    return arr.includes(String(fv ?? ""));
          if (op === "notContains") return !arr.includes(String(fv ?? ""));
          return true;
        }

        case "date": {
          const isEmpty = raw === null || raw === undefined || raw === "";
          if (op === "isEmpty")    return isEmpty;
          if (op === "isNotEmpty") return !isEmpty;
          if (isEmpty) return false;
          try {
            const d = new Date(String(raw)).getTime();
            const fvd = new Date(String(fv ?? "")).getTime();
            if (op === "eq") {
              const da = new Date(String(raw));
              const fb = new Date(String(fv ?? ""));
              return da.toDateString() === fb.toDateString();
            }
            if (op === "gt") return d > fvd;
            if (op === "lt") return d < fvd;
          } catch {
            return true;
          }
          return true;
        }

        default: return true;
      }
    })
  );
}

export function applySorts(
  records: ParsedRecord[],
  sorts: ViewSort[],
  properties: ParsedDatabaseProperty[]
): ParsedRecord[] {
  if (!sorts.length) return records;

  return [...records].sort((a, b) => {
    for (const sort of sorts) {
      const property = properties.find((p) => p.id === sort.propertyId);
      if (!property) continue;

      const av = getRawValue(a, property);
      const bv = getRawValue(b, property);
      const dir = sort.direction === "asc" ? 1 : -1;
      let cmp = 0;

      switch (property.type) {
        case "title":
        case "text":
        case "url":
        case "email": {
          const as = av != null ? String(av) : "";
          const bs = bv != null ? String(bv) : "";
          cmp = as.localeCompare(bs, "fr");
          break;
        }
        case "number": {
          const an = av != null ? Number(av) : -Infinity;
          const bn = bv != null ? Number(bv) : -Infinity;
          cmp = an - bn;
          break;
        }
        case "checkbox":
          cmp = (av ? 1 : 0) - (bv ? 1 : 0);
          break;
        case "select": {
          const opts = (property.config as { options?: SelectOption[] }).options ?? [];
          const an = opts.find((o) => o.id === av)?.name ?? "";
          const bn = opts.find((o) => o.id === bv)?.name ?? "";
          cmp = an.localeCompare(bn, "fr");
          break;
        }
        // relation / user : tri par nombre d'éléments, comme un multiselect.
        case "multiselect":
        case "relation":
        case "user": {
          const al = Array.isArray(av) ? (av as string[]).length : 0;
          const bl = Array.isArray(bv) ? (bv as string[]).length : 0;
          cmp = al - bl;
          break;
        }
        case "date": {
          const ad = av ? new Date(String(av)).getTime() : -Infinity;
          const bd = bv ? new Date(String(bv)).getTime() : -Infinity;
          cmp = ad - bd;
          break;
        }
      }

      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

/**
 * `currentUserId` est un 4e argument OPTIONNEL : les sites d'appel existants
 * restent valides, et applyFilters garde ses 3 arguments positionnels.
 * Le passer est ce qui rend un filtre « Moi » opérant sur cette vue.
 */
export function applyViewConfig(
  records: ParsedRecord[],
  config: ViewConfig,
  properties: ParsedDatabaseProperty[],
  currentUserId?: string | null
): ParsedRecord[] {
  const filters = resolveFilterTokens(config.filters ?? [], currentUserId, properties);
  const filtered = applyFilters(records, filters, properties);
  return applySorts(filtered, config.sorts ?? [], properties);
}
