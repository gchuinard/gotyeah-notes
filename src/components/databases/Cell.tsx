"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Check, X, ExternalLink, Mail } from "lucide-react";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  PropertyValue,
  SelectOption,
} from "@/lib/db";
import type { SelectColor } from "@/lib/propertyColors";
import Portal from "@/components/databases/portal";

// ─── Types ────────────────────────────────────────────────────────────────────

type CellProps = {
  property: ParsedDatabaseProperty;
  record: ParsedRecord;
  /** Called with the new value (null = clear). No call if value unchanged. */
  onSave: (value: PropertyValue | null) => void;
  /** If true, enters edit mode immediately on mount (used for newly created rows). */
  autoEdit?: boolean;
  /**
   * Notifie l'entrée/sortie du mode édition. Utilisé par la carte kanban pour
   * neutraliser le drag & l'ouverture du panneau tant qu'un dropdown est ouvert.
   */
  onEditingChange?: (editing: boolean) => void;
};

// ─── Badge ────────────────────────────────────────────────────────────────────

// Typé sur la palette partagée (lib/propertyColors, source de vérité aussi côté
// serveur) : ajouter une couleur sans son style ici devient une erreur de compil.
export const COLOR_MAP: Record<SelectColor, string> = {
  red:    "bg-red-100    text-red-700",
  orange: "bg-orange-100 text-orange-700",
  yellow: "bg-yellow-100 text-yellow-700",
  green:  "bg-green-100  text-green-700",
  blue:   "bg-blue-100   text-blue-700",
  purple: "bg-purple-100 text-purple-700",
  pink:   "bg-pink-100   text-pink-700",
  gray:   "bg-[var(--surface)] text-[var(--text-muted)]",
};

/** Classes du badge pour une couleur d'option (repli gris si hors palette). */
export function colorClass(color: string): string {
  return COLOR_MAP[color as SelectColor] ?? COLOR_MAP.gray;
}

export function SelectBadge({ option }: { option: SelectOption }) {
  const cls = colorClass(option.color);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {option.name}
    </span>
  );
}

// ─── Display (view mode) ──────────────────────────────────────────────────────

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
const DATETIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function CellDisplay({
  property,
  record,
}: {
  property: ParsedDatabaseProperty;
  record: ParsedRecord;
}) {
  if (property.type === "title") {
    return record.title ? (
      <span>{record.title}</span>
    ) : (
      <span className="text-[var(--text-muted)]">Sans titre</span>
    );
  }

  const raw = record.properties[property.id];
  if (raw === undefined || raw === null) return null;

  switch (property.type) {
    case "text":
      return <span className="truncate">{String(raw)}</span>;

    case "url": {
      const display = String(raw);
      const truncated = display.length > 30 ? display.slice(0, 30) + "…" : display;
      return (
        <a
          href={display}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-blue-500 underline"
          onClick={(e) => e.stopPropagation()}
        >
          <span>{truncated}</span>
          <ExternalLink size={11} className="shrink-0" />
        </a>
      );
    }

    case "email": {
      const display = String(raw);
      const truncated = display.length > 30 ? display.slice(0, 30) + "…" : display;
      return (
        <a
          href={`mailto:${display}`}
          className="inline-flex items-center gap-1 text-blue-500 underline"
          onClick={(e) => e.stopPropagation()}
        >
          <Mail size={11} className="shrink-0" />
          <span>{truncated}</span>
        </a>
      );
    }

    case "number": {
      const n = Number(raw);
      if (isNaN(n)) return null;
      const fmt = (property.config as { format?: string }).format;
      if (fmt === "integer") return <span>{Math.round(n)}</span>;
      if (fmt === "currency") return <span>{n.toFixed(2)} €</span>;
      if (fmt === "percent") return <span>{n} %</span>;
      return <span>{n}</span>;
    }

    case "checkbox":
      return raw ? (
        <Check size={15} className="text-[var(--accent)]" />
      ) : (
        <X size={15} className="text-[var(--text-muted)]" />
      );

    case "select": {
      const options = (property.config as { options?: SelectOption[] }).options ?? [];
      const opt = options.find((o) => o.id === raw);
      return opt ? (
        <SelectBadge option={opt} />
      ) : (
        <span className="text-[var(--text-muted)]">—</span>
      );
    }

    case "multiselect": {
      const options = (property.config as { options?: SelectOption[] }).options ?? [];
      const ids = Array.isArray(raw) ? (raw as string[]) : [];
      if (ids.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => {
            const opt = options.find((o) => o.id === id);
            return opt ? (
              <SelectBadge key={id} option={opt} />
            ) : (
              <span key={id} className="text-[var(--text-muted)]">—</span>
            );
          })}
        </div>
      );
    }

    case "date": {
      const includeTime = (property.config as { includeTime?: boolean }).includeTime ?? false;
      try {
        const d = new Date(String(raw));
        return <span>{includeTime ? DATETIME_FMT.format(d) : DATE_FMT.format(d)}</span>;
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

// ─── Text / URL / Email / Title editor ───────────────────────────────────────

function TextInput({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string | null;
  onSave: (v: string | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => onSave(value.trim() || null);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="w-full bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-sm text-[var(--text)]"
    />
  );
}

// ─── Number editor ────────────────────────────────────────────────────────────

function NumberInput({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: number | null;
  onSave: (v: number | null) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue !== null ? String(initialValue) : "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    onSave(trimmed === "" ? null : parseFloat(trimmed));
  };

  return (
    <input
      ref={ref}
      type="number"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="w-full bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-sm text-[var(--text)]"
    />
  );
}

// ─── Date editor ─────────────────────────────────────────────────────────────

function DateInput({
  initialValue,
  includeTime,
  onSave,
  onCancel,
}: {
  initialValue: string | null;
  includeTime: boolean;
  onSave: (v: string | null) => void;
  onCancel: () => void;
}) {
  const toInput = (v: string | null) =>
    v ? v.slice(0, includeTime ? 16 : 10) : "";

  const [value, setValue] = useState(toInput(initialValue));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const commit = () => onSave(value || null);

  return (
    <input
      ref={ref}
      type={includeTime ? "datetime-local" : "date"}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="w-full bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-sm text-[var(--text)]"
    />
  );
}


// ─── Select dropdown ──────────────────────────────────────────────────────────

function SelectDropdown({
  triggerRef,
  options,
  value,
  onSelect,
  onClose,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  options: SelectOption[];
  value: string | null;
  onSelect: (v: string | null) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <Portal anchor={triggerRef} onClose={onClose}>
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
        onMouseDown={(e) => { e.preventDefault(); onSelect(null); }}
      >
        Aucune
      </button>
      {options.map((opt) => (
        <button
          key={opt.id}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); onSelect(opt.id); }}
        >
          <SelectBadge option={opt} />
          {value === opt.id && (
            <Check size={12} className="ml-auto text-[var(--accent)]" />
          )}
        </button>
      ))}
    </Portal>
  );
}

// ─── Multiselect dropdown ─────────────────────────────────────────────────────

function MultiSelectDropdown({
  triggerRef,
  options,
  initialValues,
  onClose,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  options: SelectOption[];
  initialValues: string[];
  onClose: (values: string[]) => void;
}) {
  // Use a ref for the current selection so the onClose closure is always fresh
  // without needing to re-register event listeners on every toggle.
  const selectedRef = useRef<string[]>(initialValues);
  const [selected, setSelected] = useState<string[]>(initialValues);

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((i) => i !== id)
      : [...selected, id];
    setSelected(next);
    selectedRef.current = next;
  };

  const close = useCallback(() => onClose(selectedRef.current), [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [close]);

  return (
    <Portal anchor={triggerRef} onClose={close}>
      {options.map((opt) => (
        <button
          key={opt.id}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); toggle(opt.id); }}
        >
          <span
            className={[
              "w-4 h-4 rounded border flex items-center justify-center shrink-0",
              selected.includes(opt.id)
                ? "bg-[var(--accent)] border-[var(--accent)]"
                : "border-[var(--border)]",
            ].join(" ")}
          >
            {selected.includes(opt.id) && (
              <Check size={10} className="text-white" />
            )}
          </span>
          <SelectBadge option={opt} />
        </button>
      ))}
    </Portal>
  );
}

// ─── Main Cell component ──────────────────────────────────────────────────────

export default function Cell({ property, record, onSave, autoEdit, onEditingChange }: CellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Auto-enter edit mode on mount for newly created rows
  useEffect(() => {
    if (autoEdit) setIsEditing(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Signale les transitions d'édition (sans déclencher au montage) : le parent
  // kanban désactive alors drag & clic d'ouverture tant que l'édition est active.
  const prevEditingRef = useRef(isEditing);
  useEffect(() => {
    if (prevEditingRef.current !== isEditing) {
      prevEditingRef.current = isEditing;
      onEditingChange?.(isEditing);
    }
  }, [isEditing, onEditingChange]);

  /** Current stored value for this cell (normalised: undefined → null). */
  const storedValue = useCallback((): PropertyValue | null => {
    if (property.type === "title") return record.title ?? null;
    return record.properties[property.id] ?? null;
  }, [property, record]);

  /** Calls onSave only if value actually changed, then exits edit mode. */
  const commit = useCallback(
    (value: PropertyValue | null) => {
      setIsEditing(false);
      if (JSON.stringify(value) === JSON.stringify(storedValue())) return;
      onSave(value);
    },
    [storedValue, onSave]
  );

  const cancel = useCallback(() => setIsEditing(false), []);

  // ── Checkbox: immediate toggle, no edit mode ──────────────────────────────
  if (property.type === "checkbox") {
    const checked = (record.properties[property.id] as boolean | undefined) ?? false;
    return (
      <div
        className="cursor-pointer flex items-center"
        onClick={() => onSave(!checked)}
      >
        {checked ? (
          <Check size={15} className="text-[var(--accent)]" />
        ) : (
          <X size={15} className="text-[var(--text-muted)]" />
        )}
      </div>
    );
  }

  // ── Select dropdown ───────────────────────────────────────────────────────
  if (isEditing && property.type === "select") {
    const options = (property.config as { options?: SelectOption[] }).options ?? [];
    const value = (record.properties[property.id] as string | undefined) ?? null;
    return (
      <div ref={triggerRef} className="min-h-[22px]">
        <CellDisplay property={property} record={record} />
        <SelectDropdown
          triggerRef={triggerRef}
          options={options}
          value={value}
          onSelect={commit}
          onClose={cancel}
        />
      </div>
    );
  }

  // ── Multiselect dropdown ──────────────────────────────────────────────────
  if (isEditing && property.type === "multiselect") {
    const options = (property.config as { options?: SelectOption[] }).options ?? [];
    const values = (record.properties[property.id] as string[] | undefined) ?? [];
    return (
      <div ref={triggerRef} className="min-h-[22px]">
        <CellDisplay property={property} record={record} />
        <MultiSelectDropdown
          triggerRef={triggerRef}
          options={options}
          initialValues={values}
          onClose={(next) => commit(next.length > 0 ? next : null)}
        />
      </div>
    );
  }

  // ── Text / number / date editors ──────────────────────────────────────────
  if (isEditing) {
    const type = property.type;

    if (type === "number") {
      const v = record.properties[property.id] as number | undefined;
      return <NumberInput initialValue={v ?? null} onSave={commit} onCancel={cancel} />;
    }

    if (type === "date") {
      const v = record.properties[property.id] as string | undefined;
      const includeTime =
        (property.config as { includeTime?: boolean }).includeTime ?? false;
      return (
        <DateInput
          initialValue={v ?? null}
          includeTime={includeTime}
          onSave={commit}
          onCancel={cancel}
        />
      );
    }

    // title | text | url | email
    const v =
      type === "title"
        ? record.title
        : (record.properties[property.id] as string | undefined) ?? null;
    return <TextInput initialValue={v ?? null} onSave={commit} onCancel={cancel} />;
  }

  // ── View mode ─────────────────────────────────────────────────────────────
  const storedRaw =
    property.type === "title" ? record.title : record.properties[property.id];
  const isEmpty =
    storedRaw === undefined ||
    storedRaw === null ||
    storedRaw === "" ||
    (Array.isArray(storedRaw) && storedRaw.length === 0);
  return (
    <div
      ref={triggerRef}
      className="cursor-pointer min-h-[22px] rounded px-1 -mx-1 hover:bg-[var(--surface)] transition-colors"
      onClick={() => setIsEditing(true)}
    >
      {isEmpty && property.type !== "title" ? (
        // État vide (hors titre : CellDisplay y affiche déjà « Sans titre ») : sans
        // repère, une Cell vide se réduit à ~0px de large → aucune cible pour cliquer
        // et renseigner la valeur. On rend une zone large + un hint.
        <span className="block min-w-[3.5rem] italic text-[var(--text-muted)] opacity-50">
          Vide
        </span>
      ) : (
        <CellDisplay property={property} record={record} />
      )}
    </div>
  );
}
