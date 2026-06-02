import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  ViewConfig,
  ViewFilter,
  ViewSort,
  SelectOption,
} from "@/lib/db";

function getRawValue(record: ParsedRecord, property: ParsedDatabaseProperty): unknown {
  if (property.type === "title") return record.title ?? "";
  return record.properties[property.id] ?? null;
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

        case "multiselect": {
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
        case "multiselect": {
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

export function applyViewConfig(
  records: ParsedRecord[],
  config: ViewConfig,
  properties: ParsedDatabaseProperty[]
): ParsedRecord[] {
  const filtered = applyFilters(records, config.filters ?? [], properties);
  return applySorts(filtered, config.sorts ?? [], properties);
}
