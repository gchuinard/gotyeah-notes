"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { Filter, X } from "lucide-react";
import { mutate as globalMutate } from "swr";
import type {
  ParsedDatabaseProperty,
  ParsedView,
  ViewFilter,
  FilterOperator,
  PropertyType,
  SelectOption,
  PropertyValue,
} from "@/lib/db";
import { CURRENT_USER_TOKEN } from "@/lib/db";
import Portal from "@/components/databases/portal";
import { useWorkspaceMembers } from "@/lib/client/useWorkspaceMembers";

// ─── Operator config per type ─────────────────────────────────────────────────

type OpDef = { value: FilterOperator; label: string };

const OPS_TEXT: OpDef[] = [
  { value: "contains",    label: "contient" },
  { value: "notContains", label: "ne contient pas" },
  { value: "eq",          label: "est" },
  { value: "neq",         label: "n'est pas" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];
const OPS_NUMBER: OpDef[] = [
  { value: "eq",          label: "=" },
  { value: "neq",         label: "≠" },
  { value: "gt",          label: ">" },
  { value: "lt",          label: "<" },
  { value: "gte",         label: "≥" },
  { value: "lte",         label: "≤" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];
const OPS_SELECT: OpDef[] = [
  { value: "eq",          label: "est" },
  { value: "neq",         label: "n'est pas" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];
const OPS_MULTISELECT: OpDef[] = [
  { value: "contains",    label: "contient" },
  { value: "notContains", label: "ne contient pas" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];
const OPS_CHECKBOX: OpDef[] = [
  { value: "eq",          label: "est coché" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];
const OPS_DATE: OpDef[] = [
  { value: "eq",          label: "est le" },
  { value: "gt",          label: "est après le" },
  { value: "lt",          label: "est avant le" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];

// ⚠️ « est / n'est pas » sont volontairement mappés sur contains/notContains :
// une valeur `user` est un TABLEAU d'ids, et applyFilters ignore eq/neq sur ce
// type. Proposer « est » afficherait un filtre actif qui ne filtre rien.
const OPS_USER: OpDef[] = [
  { value: "contains",    label: "est" },
  { value: "notContains", label: "n'est pas" },
  { value: "isEmpty",     label: "est vide" },
  { value: "isNotEmpty",  label: "n'est pas vide" },
];

const NO_VALUE_OPS = new Set<FilterOperator>(["isEmpty", "isNotEmpty"]);

function opsForType(type: PropertyType): OpDef[] {
  switch (type) {
    case "number":      return OPS_NUMBER;
    case "select":      return OPS_SELECT;
    case "multiselect": return OPS_MULTISELECT;
    case "user":        return OPS_USER;
    case "checkbox":    return OPS_CHECKBOX;
    case "date":        return OPS_DATE;
    default:            return OPS_TEXT; // title, text, url, email
  }
}

function defaultOpForType(type: PropertyType): FilterOperator {
  switch (type) {
    case "number":      return "eq";
    case "select":      return "eq";
    case "multiselect": return "contains";
    case "user":        return "contains";
    case "checkbox":    return "eq";
    case "date":        return "eq";
    default:            return "contains";
  }
}

// ─── Value input per type + operator ─────────────────────────────────────────

function FilterValueInput({
  property,
  operator,
  value,
  onChange,
  workspaceId,
}: {
  property: ParsedDatabaseProperty;
  operator: FilterOperator;
  value: PropertyValue | undefined;
  onChange: (v: PropertyValue | undefined) => void;
  workspaceId?: string;
}) {
  // Local state for text/number inputs so we don't PATCH on every keystroke
  const [localText, setLocalText] = useState<string>(
    value != null ? String(value) : ""
  );

  // Sync if value changes externally (e.g. switching property resets)
  useEffect(() => {
    setLocalText(value != null ? String(value) : "");
  }, [value]);

  // Hook appelé inconditionnellement (avant tout return) — la clé SWR est nulle
  // hors propriété `user`, donc aucun fetch inutile.
  const { members } = useWorkspaceMembers(property.type === "user" ? workspaceId : null);

  if (NO_VALUE_OPS.has(operator)) return null;

  switch (property.type) {
    case "checkbox":
      return (
        <select
          value={value === true ? "true" : "false"}
          onChange={(e) => onChange(e.target.value === "true")}
          className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="true">Coché</option>
          <option value="false">Non coché</option>
        </select>
      );

    case "select": {
      const opts = (property.config as { options?: SelectOption[] }).options ?? [];
      return (
        <select
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">— choisir —</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      );
    }

    case "multiselect": {
      const opts = (property.config as { options?: SelectOption[] }).options ?? [];
      return (
        <select
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">— choisir —</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      );
    }

    case "user":
      return (
        <select
          value={value != null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">— choisir —</option>
          {/* « Moi » stocke un JETON, pas un userId : le config de vue est partagé
              entre membres, y figer un id donnerait les cartes de son auteur à
              tout le monde. Résolu à la lecture (resolveFilterTokens). */}
          <option value={CURRENT_USER_TOKEN}>Moi</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>{m.displayName}</option>
          ))}
        </select>
      );

    case "date":
      return (
        <input
          type="date"
          value={value != null ? String(value).slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      );

    case "number":
      return (
        <input
          type="number"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={() => {
            const n = parseFloat(localText);
            onChange(isNaN(n) ? undefined : n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          placeholder="Valeur"
        />
      );

    default: // title, text, url, email
      return (
        <input
          type="text"
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onBlur={() => onChange(localText || undefined)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="flex-1 min-w-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          placeholder="Valeur"
        />
      );
  }
}

// ─── FilterControls ───────────────────────────────────────────────────────────

type Props = {
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
  databaseId: string;
  workspaceId?: string;
};

export default function FilterControls({ view, properties, databaseId, workspaceId }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const filters: ViewFilter[] = view.config.filters ?? [];

  const patchFilters = useCallback(
    async (newFilters: ViewFilter[]) => {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...view.config, filters: newFilters } }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    },
    [view, databaseId]
  );

  const handleAdd = () => {
    const firstProp = properties[0];
    if (!firstProp) return;
    patchFilters([
      ...filters,
      { propertyId: firstProp.id, operator: defaultOpForType(firstProp.type as PropertyType) },
    ]);
  };

  const handleRemove = (index: number) => {
    patchFilters(filters.filter((_, i) => i !== index));
  };

  const handleChangeProperty = (index: number, propId: string) => {
    const prop = properties.find((p) => p.id === propId);
    if (!prop) return;
    patchFilters(
      filters.map((f, i) =>
        i === index
          ? { propertyId: propId, operator: defaultOpForType(prop.type as PropertyType) }
          : f
      )
    );
  };

  const handleChangeOperator = (index: number, op: FilterOperator) => {
    patchFilters(
      filters.map((f, i) =>
        i === index ? { ...f, operator: op, value: NO_VALUE_OPS.has(op) ? undefined : f.value } : f
      )
    );
  };

  const handleChangeValue = (index: number, value: PropertyValue | undefined) => {
    patchFilters(
      filters.map((f, i) => (i === index ? { ...f, value } : f))
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors",
          filters.length > 0
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]",
        ].join(" ")}
      >
        <Filter size={13} />
        Filtrer
        {filters.length > 0 && (
          <span className="ml-0.5 bg-[var(--accent)] text-white rounded-full w-4 h-4 text-[10px] font-medium leading-none flex items-center justify-center">
            {filters.length}
          </span>
        )}
      </button>

      {open && (
        <Portal
          anchor={btnRef as React.RefObject<HTMLElement | null>}
          onClose={() => setOpen(false)}
          minWidth={400}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl py-2 overflow-visible"
        >
          <div className="px-3 pb-1 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Filtres
          </div>

          {filters.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-[var(--text-muted)]">Aucun filtre actif</p>
          )}

          {filters.map((filter, i) => {
            const prop = properties.find((p) => p.id === filter.propertyId) ?? properties[0];
            if (!prop) return null;
            const ops = opsForType(prop.type as PropertyType);
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 flex-wrap">
                {/* Property selector */}
                <select
                  value={filter.propertyId}
                  onChange={(e) => handleChangeProperty(i, e.target.value)}
                  className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>

                {/* Operator selector */}
                <select
                  value={filter.operator}
                  onChange={(e) => handleChangeOperator(i, e.target.value as FilterOperator)}
                  className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                >
                  {ops.map((op) => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>

                {/* Value input */}
                <FilterValueInput
                  property={prop}
                  operator={filter.operator}
                  value={filter.value}
                  onChange={(v) => handleChangeValue(i, v)}
                  workspaceId={workspaceId}
                />

                <button
                  onClick={() => handleRemove(i)}
                  className="shrink-0 text-[var(--text-muted)] hover:text-red-500 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}

          <div className="px-3 pt-1.5">
            <button
              onClick={handleAdd}
              disabled={properties.length === 0}
              className="text-sm text-[var(--accent)] hover:opacity-80 transition-opacity disabled:opacity-40"
            >
              + Ajouter un filtre
            </button>
          </div>
        </Portal>
      )}
    </>
  );
}
