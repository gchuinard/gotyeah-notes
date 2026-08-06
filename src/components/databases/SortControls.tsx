"use client";
import { useState, useRef, useCallback } from "react";
import { ArrowUpDown, X } from "lucide-react";
import { mutate as globalMutate } from "swr";
import type { ParsedDatabaseProperty, ParsedView, ViewSort, SortDirection } from "@/lib/db";
import Portal from "@/components/databases/portal";

type Props = {
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
  databaseId: string;
};

const DIRECTION_LABELS: Record<SortDirection, string> = {
  asc:  "Ascendant",
  desc: "Descendant",
};

export default function SortControls({ view, properties, databaseId }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const sorts: ViewSort[] = view.config.sorts ?? [];

  const patchSorts = useCallback(
    async (newSorts: ViewSort[]) => {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...view.config, sorts: newSorts } }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    },
    [view, databaseId]
  );

  const handleAddSort = () => {
    const firstProp = properties[0];
    if (!firstProp) return;
    patchSorts([...sorts, { propertyId: firstProp.id, direction: "asc" }]);
  };

  const handleUpdate = (index: number, patch: Partial<ViewSort>) => {
    patchSorts(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const handleRemove = (index: number) => {
    patchSorts(sorts.filter((_, i) => i !== index));
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 px-2.5 py-2.5 md:py-1.5 text-sm rounded-md transition-colors",
          sorts.length > 0
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]",
        ].join(" ")}
      >
        <ArrowUpDown size={13} />
        Trier
        {sorts.length > 0 && (
          <span className="ml-0.5 bg-[var(--accent)] text-white rounded-full w-4 h-4 text-[10px] font-medium leading-none flex items-center justify-center">
            {sorts.length}
          </span>
        )}
      </button>

      {open && (
        <Portal
          anchor={btnRef as React.RefObject<HTMLElement | null>}
          onClose={() => setOpen(false)}
          minWidth={340}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl py-2 overflow-visible"
        >
          <div className="px-3 pb-1 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Tris
          </div>

          {sorts.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-[var(--text-muted)]">Aucun tri actif</p>
          )}

          {sorts.map((sort, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5">
              {/* text-base sous sm : iOS Safari zoome sur tout champ < 16px et ne
                  dézoome jamais au blur — la page reste agrandie ensuite. */}
              <select
                value={sort.propertyId}
                onChange={(e) => handleUpdate(i, { propertyId: e.target.value })}
                className="flex-1 min-w-0 text-base sm:text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-2 sm:py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select
                value={sort.direction}
                onChange={(e) => handleUpdate(i, { direction: e.target.value as SortDirection })}
                className="text-base sm:text-sm bg-[var(--surface)] border border-[var(--border)] rounded px-2 py-2 sm:py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {(["asc", "desc"] as SortDirection[]).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>
                ))}
              </select>
              {/* Marge négative VERTICALE seulement : elle agrandit la cible sans
                  déborder sur le sélecteur voisin — un chevauchement au doigt
                  supprimerait le tri qu'on voulait modifier. */}
              <button
                onClick={() => handleRemove(i)}
                className="shrink-0 text-[var(--text-muted)] hover:text-red-500 transition-colors p-2 -my-2 md:p-0 md:my-0"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          <div className="px-3 pt-1.5">
            <button
              onClick={handleAddSort}
              disabled={properties.length === 0}
              className="text-sm text-[var(--accent)] hover:opacity-80 transition-opacity disabled:opacity-40 py-2 -my-2 md:py-0 md:my-0"
            >
              + Ajouter un tri
            </button>
          </div>
        </Portal>
      )}
    </>
  );
}
