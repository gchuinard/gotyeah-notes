"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import type { KeyedMutator } from "swr";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  PropertyValue,
  SelectOption,
} from "@/lib/db";
import { SelectBadge } from "@/components/databases/Cell";
import { useDialog } from "@/contexts/DialogContext";

// Barre d'action flottante affichée dès qu'au moins un record est sélectionné.
// Sélection éphémère, propre à la vue (Set<string> d'ids détenu par la vue).
// Pour CHAQUE propriété select/multiselect, propose d'appliquer une valeur au
// groupe : boucle de N PATCH optimistes, échec partiel toléré (rollback ciblé).

type Props = {
  properties: ParsedDatabaseProperty[];
  /** Cache SWR courant des records (même clé que la vue). */
  records: ParsedRecord[];
  selectedIds: Set<string>;
  mutate: KeyedMutator<ParsedRecord[]>;
  onClear: () => void;
};

// ─── Menu ouvert VERS LE HAUT (la barre est ancrée en bas de l'écran) ─────────

function MenuUp({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 180);
    const left = Math.min(rect.left, window.innerWidth - minWidth - 8);
    setStyle({
      position: "fixed",
      // ancre au-dessus du bouton : bord bas du menu = bord haut du bouton.
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(8, left),
      minWidth,
      zIndex: 1100,
      visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        anchorRef.current?.contains(e.target as Node) ||
        contentRef.current?.contains(e.target as Node)
      )
        return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={contentRef}
      style={style}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 overflow-y-auto max-h-72"
    >
      {children}
    </div>,
    document.body
  );
}

// ─── Contrôle par propriété select/multiselect ────────────────────────────────

function BulkSelectControl({
  property,
  onApply,
}: {
  property: ParsedDatabaseProperty;
  onApply: (property: ParsedDatabaseProperty, optionId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const options = (property.config as { options?: SelectOption[] }).options ?? [];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
        title={`Appliquer « ${property.name} » à la sélection`}
      >
        <span className="truncate max-w-[120px]">{property.name}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <MenuUp anchorRef={btnRef} onClose={() => setOpen(false)}>
          {options.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-[var(--text-muted)] whitespace-nowrap">
              Aucune option
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onApply(property, opt.id);
                }}
              >
                <SelectBadge option={opt} />
              </button>
            ))
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)] border-t border-[var(--border)]"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onApply(property, null);
            }}
          >
            Retirer la valeur
          </button>
        </MenuUp>
      )}
    </>
  );
}

// ─── Barre principale ─────────────────────────────────────────────────────────

export default function BulkActionBar({
  properties,
  records,
  selectedIds,
  mutate,
  onClear,
}: Props) {
  const { alert } = useDialog();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selectProps = properties.filter(
    (p) => p.type === "select" || p.type === "multiselect"
  );

  // Seuls les ids encore présents dans le cache comptent (un record supprimé
  // reste éventuellement dans le Set — sélection éphémère, on intersecte ici).
  const targets = records.filter((r) => selectedIds.has(r.id));
  const count = targets.length;

  // Applique une valeur au groupe : boucle de PATCH optimistes.
  // - select      → remplace la valeur par l'option (ou null = vide).
  // - multiselect → ajoute l'option aux valeurs existantes (union, non destructif).
  const applyOption = async (
    property: ParsedDatabaseProperty,
    optionId: string | null
  ) => {
    const batch = records.filter((r) => selectedIds.has(r.id));
    if (batch.length === 0) return;
    const snapshot = records;

    const computeValue = (r: ParsedRecord): PropertyValue | null => {
      if (optionId === null) return null;
      if (property.type === "multiselect") {
        const cur = Array.isArray(r.properties[property.id])
          ? (r.properties[property.id] as string[])
          : [];
        return cur.includes(optionId) ? cur : [...cur, optionId];
      }
      return optionId;
    };

    const optimistic = records.map((r) => {
      if (!selectedIds.has(r.id)) return r;
      const value = computeValue(r);
      const props = { ...r.properties };
      if (value === null) delete props[property.id];
      else props[property.id] = value;
      return { ...r, properties: props };
    });
    mutate(optimistic, { revalidate: false });

    const settled = await Promise.allSettled(
      batch.map((r) => {
        const value = computeValue(r);
        return fetch(`/api/records/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: { [property.id]: value } }),
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
      })
    );

    const failedIds = batch
      .filter((_, i) => settled[i].status === "rejected")
      .map((r) => r.id);

    if (failedIds.length === 0) {
      mutate();
      return;
    }

    // Échec partiel : on garde les succès (déjà dans l'optimiste), on ne
    // restaure QUE les records en échec depuis le snapshot.
    const failedSet = new Set(failedIds);
    const snapById = new Map(snapshot.map((r) => [r.id, r] as const));
    mutate(
      (current) =>
        (current ?? optimistic).map((r) =>
          failedSet.has(r.id) ? snapById.get(r.id) ?? r : r
        ),
      { revalidate: false }
    );

    await alert({
      title: "Mise à jour partielle",
      message: `${failedIds.length} enregistrement${
        failedIds.length > 1 ? "s" : ""
      } sur ${batch.length} n'${
        failedIds.length > 1 ? "ont" : "a"
      } pas pu être mis à jour. Les autres ont bien été enregistrés.`,
      tone: "danger",
    });
  };

  if (!mounted || count === 0) return null;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] shadow-xl max-w-[92vw]">
      <span className="text-sm font-medium text-[var(--text)] tabular-nums px-1 whitespace-nowrap">
        {count} sélectionné{count > 1 ? "s" : ""}
      </span>
      <button
        onClick={onClear}
        className="flex items-center gap-1 px-2 py-1 text-sm rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title="Tout désélectionner"
      >
        <X size={14} />
        Désélectionner
      </button>
      {selectProps.length > 0 && (
        <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />
      )}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {selectProps.map((p) => (
          <BulkSelectControl key={p.id} property={p} onApply={applyOption} />
        ))}
      </div>
    </div>,
    document.body
  );
}
