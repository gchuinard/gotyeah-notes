"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import type { ParsedDatabaseProperty, SelectOption } from "@/lib/db";
import Portal from "@/components/databases/portal";
import { SELECT_COLORS } from "@/lib/propertyColors";
import TransitionRulesEditor from "@/components/databases/TransitionRulesEditor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLORS: readonly string[] = SELECT_COLORS;

/** Libellés des rôles dans l'écran des règles (hiérarchiques : « Éditeur »
 *  laisse aussi passer un admin). */
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
  /** Suppression DÉFINITIVE d'une colonne (purge la clé de tous les records) : admin. */
  canDelete?: boolean;
  /** Écran des règles d'accès — ADMINS seulement (le serveur le gate aussi). */
  canManageRules?: boolean;
  /** Espace de la database : source des membres pour désigner une personne. */
  workspaceId?: string;
};

// ─── SelectOption editor row ──────────────────────────────────────────────────

function OptionRow({
  option,
  onChange,
  onDelete,
  autoFocus,
  dropSide,
}: {
  option: SelectOption;
  onChange: (next: SelectOption) => void;
  onDelete: () => void;
  autoFocus?: boolean;
  /** Côté où l'option glissée atterrira (trait accent), ou null si pas la cible. */
  dropSide?: "top" | "bottom" | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: option.id });

  // Focus + select text when this option was just created
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={setNodeRef}
      className={`relative px-2 py-1.5 group/opt ${isDragging ? "opacity-40" : ""}`}
    >
      {dropSide && (
        <div
          aria-hidden
          className={[
            "absolute left-2 right-2 h-[3px] rounded-full bg-[var(--accent)] z-10 pointer-events-none",
            dropSide === "top" ? "-top-[2px]" : "-bottom-[2px]",
          ].join(" ")}
        />
      )}
      {/* Name + delete.
          Sans survol, poignée et corbeille resteraient invisibles au doigt : on
          les montre en base et on rend le survol au desktop. `pointer-events` suit
          l'opacité — un bouton transparent reste cliquable, donc tapable par
          accident au beau milieu du champ de saisie. */}
      <div className="flex items-center gap-1.5">
        <span
          {...attributes}
          {...listeners}
          title="Glisser pour réordonner"
          className="opacity-100 md:opacity-0 md:group-hover/opt:opacity-100 cursor-grab active:cursor-grabbing text-[var(--text-muted)] transition-opacity shrink-0 touch-none p-2 -m-2 md:p-0 md:m-0"
        >
          <GripVertical size={12} />
        </span>
        <input
          ref={inputRef}
          value={option.name}
          onChange={(e) => onChange({ ...option, name: e.target.value })}
          className="flex-1 text-base sm:text-sm bg-transparent text-[var(--text)] outline-none min-w-0"
          placeholder="Option sans nom"
        />
        <button
          type="button"
          onClick={onDelete}
          className="opacity-100 md:opacity-0 md:group-hover/opt:opacity-100 text-[var(--text-muted)] hover:text-red-500 transition-opacity shrink-0 p-2.5 -my-2.5 md:p-0 md:my-0"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Color swatches — 8 dots, 1 click to change.
          `flex-wrap` : à 32px la rangée dépasse la largeur d'un popover étroit ;
          sans lui, les dernières couleurs sortiraient du panneau. */}
      <div className="flex flex-wrap gap-1 mt-2 md:mt-1">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onChange({ ...option, color })}
            title={color}
            className={[
              "w-8 h-8 md:w-5 md:h-5 rounded-full shrink-0 cursor-pointer transition-all",
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
  canDelete = false,
  canManageRules = false,
  workspaceId,
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
  // Au doigt, le PointerSensor perdait le geste : le navigateur le revendique pour
  // le scroll et émet `pointercancel`. Le délai du TouchSensor distingue l'appui
  // long (déplacer) du glissement (faire défiler la liste d'options).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } })
  );

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
        // Le spread réémet les `rules` de `property.config` À L'IDENTIQUE : le
        // gate serveur portant sur la DIFFÉRENCE, un éditeur peut donc toujours
        // renommer une option sans se prendre un 403. Ne JAMAIS y injecter l'état
        // local `rules` : sur un config obsolète, ce serait une modification.
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

  // Indicateur de drop : on suit l'option active + celle survolée pour dessiner un
  // trait accent à l'endroit exact où l'option glissée atterrira.
  const [activeOptId, setActiveOptId] = useState<string | null>(null);
  const [overOptId, setOverOptId] = useState<string | null>(null);
  const resetDrag = () => {
    setActiveOptId(null);
    setOverOptId(null);
  };

  const handleOptionDragEnd = (e: DragEndEvent) => {
    resetDrag();
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = options.findIndex((o) => o.id === active.id);
    const newIdx = options.findIndex((o) => o.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(options, oldIdx, newIdx);
    setOptions(reordered);
    saveOptions(reordered);
  };

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

  // ── PATCH rules (règles d'accès par colonne) ──────────────────────────────
  // Écriture optimiste comme les options : on restaure si le serveur refuse.

  // ── DELETE property ───────────────────────────────────────────────────────
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = async () => {
    setDeleteError(null);
    try {
      const res = await fetch(`/api/properties/${property.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onPropertyDeleted(property.id);
        onClose();
        return;
      }
      // Un refus (403 rôle insuffisant, 400 colonne titre…) doit se VOIR :
      // le bouton était muet, le clic semblait mort.
      const body = await res.json().catch(() => ({}));
      setDeleteError((body as { error?: string }).error ?? `Erreur ${res.status}`);
    } catch {
      setDeleteError("Suppression impossible.");
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
          className="w-full text-base sm:text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-2.5 sm:py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setActiveOptId(String(e.active.id))}
            onDragOver={(e) => setOverOptId(e.over ? String(e.over.id) : null)}
            onDragEnd={handleOptionDragEnd}
            onDragCancel={resetDrag}
          >
            <SortableContext items={options.map((o) => o.id)} strategy={verticalListSortingStrategy}>
              {options.map((opt, idx) => {
                const activeIdx = activeOptId ? options.findIndex((o) => o.id === activeOptId) : -1;
                const overIdx = overOptId ? options.findIndex((o) => o.id === overOptId) : -1;
                const dropSide: "top" | "bottom" | null =
                  overOptId && opt.id === overOptId && opt.id !== activeOptId && activeIdx !== -1
                    ? activeIdx < overIdx
                      ? "bottom"
                      : "top"
                    : null;
                return (
                  <OptionRow
                    key={opt.id}
                    option={opt}
                    onChange={(next) => handleOptionChange(idx, next)}
                    onDelete={() => handleOptionDelete(idx)}
                    autoFocus={newOptionId === opt.id}
                    dropSide={dropSide}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          <button
            type="button"
            onClick={handleAddOption}
            className="w-full flex items-center gap-1.5 px-3 py-3 md:py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Plus size={13} />
            Ajouter une option
          </button>
        </div>
      )}

      {/* Règles d'accès — ADMINS seulement. Le serveur gate aussi la clé `rules`
          (403) : cet écran n'est que le confort, jamais l'autorité.

          ⚠️ Composant PARTAGÉ avec le panneau d'options de la page : il n'y avait
          qu'un point de montage — ici — donc les règles étaient inatteignables
          depuis un board sans vue Tableau. Ne pas le redupliquer. */}
      {hasOptions && canManageRules && (
        <div className="border-t border-[var(--border)] mt-1 pt-1">
          <TransitionRulesEditor
            property={property}
            workspaceId={workspaceId}
            onPropertyUpdated={onPropertyUpdated}
          />
        </div>
      )}

      {/* Delete property — DÉFINITIF (admin) : masqué aux éditeurs et lecteurs. */}
      {canDelete && (
      <div className="border-t border-[var(--border)] mt-1 pt-1 px-2">
        {deleteError && (
          <p className="px-1 pb-1 text-xs text-red-500">{deleteError}</p>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="text-xs text-[var(--text-muted)] flex-1">Supprimer la colonne ?</span>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-3 py-2.5 md:px-2 md:py-1 rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              Non
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="text-xs px-3 py-2.5 md:px-2 md:py-1 rounded bg-red-100 text-red-600 hover:bg-red-200"
            >
              Oui
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-2 px-1 py-3 md:py-1.5 text-sm text-red-500 hover:bg-red-50 rounded"
          >
            <Trash2 size={13} />
            Supprimer la propriété
          </button>
        )}
      </div>
      )}
    </Portal>
  );
}
