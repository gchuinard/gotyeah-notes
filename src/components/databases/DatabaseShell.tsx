"use client";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { Plus, MoreHorizontal, Trash2, Pencil, Table2, Kanban, Calendar, LayoutGrid } from "lucide-react";
import type { ParsedDatabaseProperty, ParsedRecord, ParsedView } from "@/lib/db";
import { applyViewConfig } from "@/lib/client/viewFilters";
import TableView from "@/components/databases/TableView";
import KanbanView from "@/components/databases/KanbanView";
import CalendarView from "@/components/databases/CalendarView";
import GalleryView from "@/components/databases/GalleryView";
import SortControls from "@/components/databases/SortControls";
import FilterControls from "@/components/databases/FilterControls";
import Portal from "@/components/databases/portal";

// ─── Types ────────────────────────────────────────────────────────────────────

type DatabaseData = {
  id: string;
  pageId: string;
  properties: ParsedDatabaseProperty[];
  views: ParsedView[];
};

type ViewType = "table" | "kanban" | "calendar" | "gallery";

const VIEW_TYPES: { value: ViewType; label: string }[] = [
  { value: "table",    label: "Tableau" },
  { value: "kanban",   label: "Kanban" },
  { value: "calendar", label: "Calendrier" },
  { value: "gallery",  label: "Galerie" },
];

const VIEW_TYPE_ICONS: Record<string, React.ReactNode> = {
  table:    <Table2 size={13} />,
  kanban:   <Kanban size={13} />,
  calendar: <Calendar size={13} />,
  gallery:  <LayoutGrid size={13} />,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

// ─── TabMenu ──────────────────────────────────────────────────────────────────

function TabMenu({
  anchor,
  canDelete,
  onRename,
  onDelete,
  onClose,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Portal anchor={anchor} onClose={onClose} minWidth={150}>
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
        onMouseDown={(e) => { e.preventDefault(); onRename(); onClose(); }}
      >
        <Pencil size={13} />
        Renommer
      </button>
      {canDelete && (
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-red-500 flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); onDelete(); }}
        >
          <Trash2 size={13} />
          Supprimer
        </button>
      )}
    </Portal>
  );
}

// ─── AddViewPopover ───────────────────────────────────────────────────────────

function AddViewPopover({
  databaseId,
  anchor,
  onCreated,
  onClose,
}: {
  databaseId: string;
  anchor: React.RefObject<HTMLElement | null>;
  onCreated: (view: ParsedView) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("Nouvelle vue");
  const [type, setType] = useState<ViewType>("table");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Le nom est requis."); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/databases/${databaseId}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, type }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
        return;
      }
      const newView: ParsedView = await res.json();
      onCreated(newView);
    } catch {
      setError("Impossible de créer la vue.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Portal
      anchor={anchor}
      onClose={onClose}
      minWidth={220}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl py-0 overflow-visible"
    >
      <form onSubmit={handleSubmit} className="p-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Nom</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ViewType)}
            className="text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {VIEW_TYPES.map((vt) => (
              <option key={vt.value} value={vt.value}>{vt.label}</option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </Portal>
  );
}

// ─── DatabaseShell ────────────────────────────────────────────────────────────

export default function DatabaseShell({ databaseId }: { databaseId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data, error, isLoading, mutate } = useSWR<DatabaseData>(
    `/api/databases/${databaseId}`,
    fetcher
  );

  // Share SWR cache with view components — same key, no extra fetch
  const { data: records } = useSWR<ParsedRecord[]>(
    data ? `/api/databases/${databaseId}/records` : null,
    fetcher
  );

  const [showAddView, setShowAddView] = useState(false);
  const [tabMenuOpenId, setTabMenuOpenId] = useState<string | null>(null);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const addButtonRef = useRef<HTMLButtonElement>(null);
  const menuBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus rename input when editing starts
  useEffect(() => {
    if (editingViewId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingViewId]);

  const resolveActiveView = useCallback(
    (views: ParsedView[]): ParsedView => {
      const paramId = searchParams.get("v");
      const match = paramId ? views.find((v) => v.id === paramId) : null;
      return match ?? views[0];
    },
    [searchParams]
  );

  const switchView = useCallback(
    (viewId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("v", viewId);
      router.replace(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleViewCreated = useCallback(
    (newView: ParsedView) => {
      setShowAddView(false);
      mutate();
      switchView(newView.id);
    },
    [mutate, switchView]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Chargement…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        Impossible de charger la base de données.
      </div>
    );
  }

  const views = [...data.views].sort((a, b) => a.position - b.position);
  if (views.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Aucune vue configurée.
      </div>
    );
  }

  const activeView = resolveActiveView(views);

  // ── Record count ────────────────────────────────────────────────────────────

  const totalCount = records?.length ?? 0;
  const hasFilters = (activeView.config.filters ?? []).length > 0;
  const filteredCount = hasFilters && records && data
    ? applyViewConfig(
        [...records].sort((a, b) => a.position - b.position),
        activeView.config,
        data.properties
      ).length
    : totalCount;

  const countLabel = hasFilters
    ? `${filteredCount} / ${totalCount} éléments`
    : `${totalCount} élément${totalCount !== 1 ? "s" : ""}`;

  // ── View rename handlers ───────────────────────────────────────────────────

  const commitRename = async () => {
    const trimmed = editingName.trim();
    const view = views.find((v) => v.id === editingViewId);
    setEditingViewId(null);
    if (!view || !trimmed || trimmed === view.name) return;
    await fetch(`/api/views/${view.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    mutate();
  };

  // ── View delete handler ────────────────────────────────────────────────────

  const handleDeleteView = async (view: ParsedView) => {
    setTabMenuOpenId(null);
    if (!window.confirm(`Supprimer la vue "${view.name}" ?`)) return;
    const res = await fetch(`/api/views/${view.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { error?: string }).error ?? `Erreur ${res.status}`);
      return;
    }
    // Switch to first remaining view if the deleted one was active
    if (view.id === activeView.id) {
      const remaining = views.filter((v) => v.id !== view.id);
      if (remaining.length > 0) switchView(remaining[0].id);
    }
    mutate();
  };

  return (
    <div className="flex flex-col h-full">
      {/* View tabs + add button */}
      <div className="flex items-center gap-0.5 px-4 border-b border-[var(--border)] shrink-0 overflow-x-auto">
        {views.map((view) => {
          const isActive = view.id === activeView.id;
          const isEditing = editingViewId === view.id;

          return (
            <div key={view.id} className="relative group/tab flex items-center shrink-0">
              {isEditing ? (
                <input
                  ref={editInputRef}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                    if (e.key === "Escape") { e.preventDefault(); setEditingViewId(null); }
                  }}
                  className="px-2 py-2 text-sm border-b-2 border-[var(--accent)] bg-transparent outline-none text-[var(--text)] min-w-[60px] -mb-px"
                  style={{ width: Math.max(60, editingName.length * 8) + "px" }}
                />
              ) : (
                <button
                  onClick={() => switchView(view.id)}
                  className={[
                    "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                    isActive
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border)]",
                  ].join(" ")}
                >
                  {VIEW_TYPE_ICONS[view.type] ?? null}
                  {view.name}
                </button>
              )}

              {/* ⋯ context button */}
              {!isEditing && (
                <button
                  ref={(el) => { if (el) menuBtnRefs.current.set(view.id, el); }}
                  onClick={(e) => { e.stopPropagation(); setTabMenuOpenId((prev) => prev === view.id ? null : view.id); }}
                  className="opacity-0 group-hover/tab:opacity-100 p-0.5 mr-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-opacity shrink-0"
                  title="Options"
                >
                  <MoreHorizontal size={12} />
                </button>
              )}

              {/* Tab menu */}
              {tabMenuOpenId === view.id && (
                <TabMenu
                  anchor={{ current: menuBtnRefs.current.get(view.id) ?? null }}
                  canDelete={views.length > 1}
                  onRename={() => {
                    setEditingViewId(view.id);
                    setEditingName(view.name);
                  }}
                  onDelete={() => handleDeleteView(view)}
                  onClose={() => setTabMenuOpenId(null)}
                />
              )}
            </div>
          );
        })}

        {/* Add view button */}
        <button
          ref={addButtonRef}
          onClick={() => setShowAddView((v) => !v)}
          className="ml-1 p-2 shrink-0 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          title="Ajouter une vue"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Sort / Filter / Count toolbar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--border)] shrink-0">
        <SortControls view={activeView} properties={data.properties} databaseId={databaseId} />
        <FilterControls view={activeView} properties={data.properties} databaseId={databaseId} />
        <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
          {countLabel}
        </span>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-auto">
        {activeView.type === "table" ? (
          <TableView
            databaseId={databaseId}
            view={activeView}
            properties={data.properties}
          />
        ) : activeView.type === "kanban" ? (
          <KanbanView
            databaseId={databaseId}
            view={activeView}
            properties={data.properties}
          />
        ) : activeView.type === "calendar" ? (
          <CalendarView
            databaseId={databaseId}
            view={activeView}
            properties={data.properties}
          />
        ) : activeView.type === "gallery" ? (
          <GalleryView
            databaseId={databaseId}
            view={activeView}
            properties={data.properties}
          />
        ) : (
          <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
            Vue {activeView.type} — {activeView.name} (à venir)
          </div>
        )}
      </div>

      {/* Add view popover */}
      {showAddView && (
        <AddViewPopover
          databaseId={databaseId}
          anchor={addButtonRef as React.RefObject<HTMLElement | null>}
          onCreated={handleViewCreated}
          onClose={() => setShowAddView(false)}
        />
      )}
    </div>
  );
}
