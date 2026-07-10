"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, Plus } from "lucide-react";
import type { ParsedDatabaseProperty, SelectOption } from "@/lib/db";
import Portal from "@/components/databases/portal";
import { SELECT_COLORS } from "@/lib/propertyColors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLORS: readonly string[] = SELECT_COLORS;

// Solid dot colors for the mini color-picker grid
const SWATCH_BG: Record<string, string> = {
  red:    "bg-red-400",
  orange: "bg-orange-400",
  yellow: "bg-yellow-300",
  green:  "bg-green-400",
  blue:   "bg-blue-400",
  purple: "bg-purple-400",
  pink:   "bg-pink-400",
  gray:   "bg-gray-300",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  anchor: React.RefObject<HTMLElement | null>;
  property: ParsedDatabaseProperty;
  onPropertyUpdated: (updated: ParsedDatabaseProperty) => void;
  onPropertyDeleted: (propertyId: string) => void;
  onClose: () => void;
};

// ─── SelectOption editor row ──────────────────────────────────────────────────

function OptionRow({
  option,
  onChange,
  onDelete,
  autoFocus,
}: {
  option: SelectOption;
  onChange: (next: SelectOption) => void;
  onDelete: () => void;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select text when this option was just created
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="px-2 py-1.5 group/opt">
      {/* Name + delete */}
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={option.name}
          onChange={(e) => onChange({ ...option, name: e.target.value })}
          className="flex-1 text-sm bg-transparent text-[var(--text)] outline-none min-w-0"
          placeholder="Option sans nom"
        />
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover/opt:opacity-100 text-[var(--text-muted)] hover:text-red-500 transition-opacity shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Color swatches — 8 dots, 1 click to change */}
      <div className="flex gap-1 mt-1">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange({ ...option, color })}
            title={color}
            className={[
              "w-5 h-5 rounded-full shrink-0 cursor-pointer transition-all",
              SWATCH_BG[color] ?? "bg-gray-300",
              option.color === color
                ? "ring-2 ring-offset-1 ring-gray-600 scale-110"
                : "hover:scale-110",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PropertyPopover({
  anchor,
  property,
  onPropertyUpdated,
  onPropertyDeleted,
  onClose,
}: Props) {
  const [name, setName] = useState(property.name);
  const [options, setOptions] = useState<SelectOption[]>(
    (property.config as { options?: SelectOption[] }).options ?? []
  );
  const [newOptionId, setNewOptionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  // Dernier état réellement persisté : cible de restauration si le serveur refuse.
  const savedOptionsRef = useRef<SelectOption[]>(options);

  const hasOptions = property.type === "select" || property.type === "multiselect";

  // ── PATCH property name ──────────────────────────────────────────────────
  const saveName = useCallback(async (newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === property.name) return;
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const updated: ParsedDatabaseProperty = await res.json();
        onPropertyUpdated(updated);
      }
    } catch {
      // silent — name reverts on next SWR refresh
    }
  }, [property, onPropertyUpdated]);

  // ── PATCH options (called after every option change) ─────────────────────
  // Écriture optimiste : en cas de refus serveur (ex. 400 « option référencée »),
  // on RESTAURE le dernier état réellement enregistré — sinon l'UI afficherait une
  // option supprimée qui existe toujours en base.
  const saveOptions = useCallback(async (nextOptions: SelectOption[]) => {
    setSaving(true);
    setOptionsError(null);
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...property.config, options: nextOptions } }),
      });
      if (res.ok) {
        const updated: ParsedDatabaseProperty = await res.json();
        savedOptionsRef.current = nextOptions;
        onPropertyUpdated(updated);
      } else {
        const body = await res.json().catch(() => ({}));
        setOptions(savedOptionsRef.current);
        setOptionsError((body as { error?: string }).error ?? "Modification refusée");
      }
    } catch {
      setOptions(savedOptionsRef.current);
      setOptionsError("Réseau indisponible");
    } finally {
      setSaving(false);
    }
  }, [property, onPropertyUpdated]);

  const handleOptionChange = (idx: number, next: SelectOption) => {
    const updated = options.map((o, i) => (i === idx ? next : o));
    setOptions(updated);
    // Un PATCH part à chaque frappe : vider le champ pour retaper produirait un
    // name="" que le serveur refuse (400). On garde la saisie en local et on
    // n'enregistre qu'une fois tous les noms renseignés.
    if (updated.some((o) => !o.name.trim())) {
      setOptionsError(null);
      return;
    }
    saveOptions(updated);
  };

  const handleOptionDelete = (idx: number) => {
    // Le serveur refuse (400) si l'option est encore référencée (record, filtre de
    // vue, doneStatusOptionId) : saveOptions restaure alors la liste.
    const updated = options.filter((_, i) => i !== idx);
    setOptions(updated);
    saveOptions(updated);
  };

  const handleAddOption = () => {
    const newOption: SelectOption = {
      id: crypto.randomUUID(),
      name: "Nouvelle option",
      color: COLORS[options.length % COLORS.length],
    };
    setNewOptionId(newOption.id);
    const updated = [...options, newOption];
    setOptions(updated);
    saveOptions(updated);
  };

  // ── DELETE property ───────────────────────────────────────────────────────
  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onPropertyDeleted(property.id);
        onClose();
      }
    } catch {
      // silent
    }
  };

  return (
    <Portal
      anchor={anchor}
      onClose={onClose}
      minWidth={240}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl py-2 overflow-y-auto max-h-96"
    >
      <div className="px-2 pb-1">
        {/* Rename input */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveName(name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveName(name); }
            if (e.key === "Escape") onClose();
          }}
          className="w-full text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          placeholder="Nom de la propriété"
        />
      </div>

      {/* Select options management */}
      {hasOptions && (
        <div className="mt-1 border-t border-[var(--border)] pt-1">
          <p className="px-3 py-1 text-xs text-[var(--text-muted)] font-medium uppercase tracking-wide">
            Options {saving && <span className="opacity-50">· enreg.</span>}
          </p>
          {optionsError && (
            <p className="px-3 pb-1 text-xs text-red-500 normal-case">{optionsError}</p>
          )}
          {options.map((opt, idx) => (
            <OptionRow
              key={opt.id}
              option={opt}
              onChange={(next) => handleOptionChange(idx, next)}
              onDelete={() => handleOptionDelete(idx)}
              autoFocus={newOptionId === opt.id}
            />
          ))}
          <button
            type="button"
            onClick={handleAddOption}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Plus size={13} />
            Ajouter une option
          </button>
        </div>
      )}

      {/* Delete property */}
      <div className="border-t border-[var(--border)] mt-1 pt-1 px-2">
        {confirmDelete ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="text-xs text-[var(--text-muted)] flex-1">Supprimer la colonne ?</span>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-2 py-1 rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              Non
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs px-2 py-1 rounded bg-red-100 text-red-600 hover:bg-red-200"
            >
              Oui
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-2 px-1 py-1.5 text-sm text-red-500 hover:bg-red-50 rounded"
          >
            <Trash2 size={13} />
            Supprimer la propriété
          </button>
        )}
      </div>
    </Portal>
  );
}
