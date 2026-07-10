"use client";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, MoreHorizontal, Trash2, Copy, ChevronDown, Play, CheckCircle2 } from "lucide-react";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  ParsedView,
  ParsedSprint,
  SelectOption,
} from "@/lib/db";
import { SelectBadge, CellDisplay } from "@/components/databases/Cell";
import { applyViewConfig } from "@/lib/client/viewFilters";
import Portal from "@/components/databases/portal";
import RecordPanel from "@/components/databases/RecordPanel";

// ─── Constants / types ────────────────────────────────────────────────────────

const NULL_COL = "__null__";

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
};

type KanbanCol = {
  id: string;
  optionId: string | null;
  label: string;
  option: SelectOption | null;
  records: ParsedRecord[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function buildCols(records: ParsedRecord[], prop: ParsedDatabaseProperty): KanbanCol[] {
  const options = (prop.config as { options?: SelectOption[] }).options ?? [];
  const propId = prop.id;
  const sorted = [...records].sort((a, b) => a.position - b.position);

  const nullCol: KanbanCol = {
    id: NULL_COL,
    optionId: null,
    label: "Sans valeur",
    option: null,
    records: sorted.filter((r) => {
      const v = r.properties[propId];
      return v === undefined || v === null || (Array.isArray(v) && (v as string[]).length === 0);
    }),
  };

  return [
    nullCol,
    ...options.map((opt): KanbanCol => ({
      id: opt.id,
      optionId: opt.id,
      label: opt.name,
      option: opt,
      records: sorted.filter((r) => {
        const v = r.properties[propId];
        if (prop.type === "multiselect") return Array.isArray(v) && (v as string[]).includes(opt.id);
        return v === opt.id;
      }),
    })),
  ];
}

function colOf(cols: KanbanCol[], id: string): KanbanCol | null {
  const direct = cols.find((c) => c.id === id);
  if (direct) return direct;
  return cols.find((c) => c.records.some((r) => r.id === id)) ?? null;
}

// ─── GroupBySelector ──────────────────────────────────────────────────────────

function GroupBySelector({
  view,
  databaseId,
  properties,
}: {
  view: ParsedView;
  databaseId: string;
  properties: ParsedDatabaseProperty[];
}) {
  const eligible = properties.filter(
    (p) => p.type === "select" || p.type === "multiselect"
  );
  const [saving, setSaving] = useState(false);

  const handleSelect = async (propId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { ...view.config, groupByPropertyId: propId },
        }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <p className="text-sm text-[var(--text-muted)]">
        Choisir la propriété de regroupement
      </p>
      {eligible.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          Aucune propriété de type Sélection dans cette base.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 justify-center">
          {eligible.map((p) => (
            <button
              key={p.id}
              disabled={saving}
              onClick={() => handleSelect(p.id)}
              className="px-3 py-1.5 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)] disabled:opacity-50 transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CardMenu ─────────────────────────────────────────────────────────────────

function CardMenu({
  anchor,
  onClose,
  onDelete,
  onDuplicate,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <Portal anchor={anchor} onClose={onClose} minWidth={140}>
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
        onMouseDown={(e) => { e.preventDefault(); onClose(); onDuplicate(); }}
      >
        <Copy size={13} />
        Dupliquer
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-red-500 flex items-center gap-2"
        onMouseDown={(e) => { e.preventDefault(); onClose(); onDelete(); }}
      >
        <Trash2 size={13} />
        Supprimer
      </button>
    </Portal>
  );
}

// ─── KanbanCardContent (pure display — used by DragOverlay) ───────────────────

function KanbanCardContent({
  record,
  previewProps,
  isDragging = false,
}: {
  record: ParsedRecord;
  previewProps: ParsedDatabaseProperty[];
  isDragging?: boolean;
}) {
  const visibleProps = previewProps.filter(
    (p) => record.properties[p.id] !== undefined && record.properties[p.id] !== null
  );

  return (
    <div
      className={[
        "bg-[var(--bg)] rounded-lg border border-[var(--border)] shadow-sm p-3 select-none",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <p className="text-sm font-semibold text-[var(--text)] leading-snug break-words">
        {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
      </p>
      {visibleProps.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {visibleProps.map((p) => (
            <div key={p.id} className="flex items-center gap-1 min-w-0 text-xs">
              <CellDisplay property={p} record={record} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KanbanCard (interactive) ─────────────────────────────────────────────────

function KanbanCard({
  record,
  previewProps,
  autoEdit,
  onTitleSave,
  onCardClick,
  onDelete,
  onDuplicate,
}: {
  record: ParsedRecord;
  previewProps: ParsedDatabaseProperty[];
  autoEdit?: boolean;
  onTitleSave?: (id: string, title: string) => void;
  onCardClick?: (record: ParsedRecord) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(record.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoEdit) setIsEditingTitle(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitle = () => {
    setIsEditingTitle(false);
    onTitleSave?.(record.id, titleValue.trim());
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: record.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const visibleProps = previewProps.filter(
    (p) => record.properties[p.id] !== undefined && record.properties[p.id] !== null
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isEditingTitle ? {} : listeners)}
      onClick={() => {
        if (!isEditingTitle && !menuOpen) onCardClick?.(record);
      }}
      className={`group ${isEditingTitle ? "" : "cursor-pointer"}`}
    >
      <div
        className={[
          "bg-[var(--bg)] rounded-lg border border-[var(--border)] shadow-sm p-3 select-none relative",
          isDragging ? "opacity-40" : "hover:border-[var(--accent)] transition-colors",
        ].join(" ")}
      >
        {/* ⋯ menu button */}
        <button
          ref={menuBtnRef}
          onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-opacity"
          title="Options"
        >
          <MoreHorizontal size={14} />
        </button>

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
              if (e.key === "Escape") { e.preventDefault(); setIsEditingTitle(false); }
            }}
            className="w-full text-sm font-semibold bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)]"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <p className="text-sm font-semibold text-[var(--text)] leading-snug break-words pr-5">
            {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
          </p>
        )}
        {visibleProps.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {visibleProps.map((p) => (
              <div key={p.id} className="flex items-center gap-1 min-w-0 text-xs">
                <CellDisplay property={p} record={record} />
              </div>
            ))}
          </div>
        )}

        {menuOpen && (
          <CardMenu
            anchor={menuBtnRef as React.RefObject<HTMLElement | null>}
            onClose={() => setMenuOpen(false)}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
          />
        )}
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColView({
  col,
  previewProps,
  onAddRecord,
  newRecordId,
  onTitleSave,
  onCardClick,
  onDeleteRecord,
  onDuplicateRecord,
  onRenameOption,
}: {
  col: KanbanCol;
  previewProps: ParsedDatabaseProperty[];
  onAddRecord: (col: KanbanCol) => void;
  newRecordId: string | null;
  onTitleSave: (id: string, title: string) => void;
  onCardClick: (record: ParsedRecord) => void;
  onDeleteRecord: (record: ParsedRecord) => void;
  onDuplicateRecord: (record: ParsedRecord) => void;
  onRenameOption: (optionId: string, newName: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  const [isRenamingCol, setIsRenamingCol] = useState(false);
  const [colNameValue, setColNameValue] = useState(col.label);
  const colNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isRenamingCol) setColNameValue(col.label);
  }, [col.label, isRenamingCol]);

  useEffect(() => {
    if (isRenamingCol) {
      colNameInputRef.current?.focus();
      colNameInputRef.current?.select();
    }
  }, [isRenamingCol]);

  const commitRename = () => {
    setIsRenamingCol(false);
    const trimmed = colNameValue.trim();
    if (!trimmed || trimmed === col.label || col.optionId === null) return;
    onRenameOption(col.optionId, trimmed);
  };

  return (
    <div className="w-64 shrink-0 flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 min-h-[28px]">
        {col.option ? (
          isRenamingCol ? (
            <input
              ref={colNameInputRef}
              value={colNameValue}
              onChange={(e) => setColNameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsRenamingCol(false);
                  setColNameValue(col.label);
                }
              }}
              className="text-sm font-medium bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)] min-w-0 max-w-[160px]"
              style={{ width: Math.max(60, colNameValue.length * 8) + "px" }}
            />
          ) : (
            <span
              className="cursor-text"
              onClick={() => setIsRenamingCol(true)}
              title="Cliquer pour renommer"
            >
              <SelectBadge option={col.option} />
            </span>
          )
        ) : (
          <span className="text-sm font-medium text-[var(--text-muted)]">Sans valeur</span>
        )}
        <span className="text-xs text-[var(--text-muted)] ml-auto tabular-nums">
          {col.records.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={[
          "flex flex-col gap-2 min-h-[60px] rounded-lg p-1 pb-10 transition-colors",
          isOver ? "bg-[var(--surface)]" : "",
        ].join(" ")}
      >
        <SortableContext
          items={col.records.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          {col.records.map((record) => (
            <KanbanCard
              key={record.id}
              record={record}
              previewProps={previewProps}
              autoEdit={record.id === newRecordId}
              onTitleSave={onTitleSave}
              onCardClick={onCardClick}
              onDelete={() => onDeleteRecord(record)}
              onDuplicate={() => onDuplicateRecord(record)}
            />
          ))}
          {col.records.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center py-4 select-none pointer-events-none">
              Aucun enregistrement
            </p>
          )}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddRecord(col)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded-md transition-colors"
      >
        <Plus size={13} />
        Nouveau
      </button>
    </div>
  );
}

// ─── SprintBoardHeader (board scopé à un sprint) ──────────────────────────────

function SprintBoardHeader({
  sprints, scope, targetSprint, onScopeChange, onStart, onComplete,
}: {
  sprints: ParsedSprint[];
  scope: string;
  targetSprint: ParsedSprint | null;
  onScopeChange: (scope: string) => void;
  onStart: () => void;
  onComplete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const stateLabel = (s: ParsedSprint) =>
    s.state === "active" ? "actif" : s.state === "completed" ? "terminé" : "à venir";

  const label =
    scope === "all"
      ? "Toutes les issues"
      : scope === "active"
        ? targetSprint ? targetSprint.name : "Sprint actif"
        : targetSprint ? targetSprint.name : "Sprint";

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
      >
        {label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <Portal anchor={btnRef} onClose={() => setOpen(false)} minWidth={210}>
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)]"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange("active"); }}
          >
            Sprint actif
          </button>
          {sprints.map((s) => (
            <button
              key={s.id}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange(s.id); }}
            >
              <span className="truncate">{s.name}</span>
              <span className="ml-auto text-xs text-[var(--text-muted)] shrink-0">{stateLabel(s)}</span>
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)] border-t border-[var(--border)]"
            onMouseDown={(e) => { e.preventDefault(); setOpen(false); onScopeChange("all"); }}
          >
            Toutes les issues
          </button>
        </Portal>
      )}

      {targetSprint?.state === "future" && (
        <button
          onClick={onStart}
          className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90"
        >
          <Play size={14} /> Démarrer
        </button>
      )}
      {targetSprint?.state === "active" && (
        <button
          onClick={onComplete}
          className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
        >
          <CheckCircle2 size={14} /> Terminer le sprint
        </button>
      )}
    </div>
  );
}

// ─── KanbanView (main) ────────────────────────────────────────────────────────

export default function KanbanView({ databaseId, view, properties }: Props) {
  const {
    data: records,
    error,
    isLoading,
    mutate,
  } = useSWR<ParsedRecord[]>(`/api/databases/${databaseId}/records`, fetcher);

  // Board « sprint-aware » : ne fetch les sprints QUE si la vue est scopée
  // (kanban classique → key null → aucune requête, comportement inchangé).
  const sprintScope = view.config.sprintScope;
  const { data: sprints, mutate: mutateSprints } = useSWR<ParsedSprint[]>(
    sprintScope ? `/api/databases/${databaseId}/sprints` : null,
    fetcher
  );
  const targetSprint = useMemo(() => {
    if (!sprintScope || sprintScope === "all") return null;
    const list = sprints ?? [];
    if (sprintScope === "active") return list.find((s) => s.state === "active") ?? null;
    return list.find((s) => s.id === sprintScope) ?? null;
  }, [sprintScope, sprints]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [newRecordId, setNewRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const pendingIds = useRef<Set<string>>(new Set());
  const pendingTitles = useRef<Map<string, string>>(new Map());
  const newRecordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragJustEndedRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const groupByPropId = (view.config as { groupByPropertyId?: string }).groupByPropertyId;
  const groupByProp = groupByPropId
    ? properties.find((p) => p.id === groupByPropId)
    : undefined;

  const displayedRecords = useMemo(() => {
    if (!records) return [];
    let scoped: ParsedRecord[] = records;
    if (sprintScope && sprintScope !== "all") {
      scoped = targetSprint ? records.filter((r) => r.sprintId === targetSprint.id) : [];
    }
    const byPosition = [...scoped].sort((a, b) => a.position - b.position);
    return applyViewConfig(byPosition, view.config, properties);
  }, [records, sprintScope, targetSprint, view.config, properties]);

  const columns = useMemo(
    () => (groupByProp ? buildCols(displayedRecords, groupByProp) : []),
    [displayedRecords, groupByProp]
  );

  const previewProps = useMemo(
    () =>
      properties
        .filter((p) => p.type !== "title" && p.id !== groupByPropId)
        .sort((a, b) => a.position - b.position)
        .slice(0, 2),
    [properties, groupByPropId]
  );

  const activeRecord = useMemo(
    () => records?.find((r) => r.id === activeId) ?? null,
    [records, activeId]
  );

  // ── Card click → open panel ─────────────────────────────────────────────────

  const handleCardClick = useCallback((record: ParsedRecord) => {
    if (dragJustEndedRef.current) return;
    setSelectedRecordId(record.id);
  }, []);

  // ── Title save ──────────────────────────────────────────────────────────────

  const handleTitleSave = useCallback(
    (recordId: string, title: string) => {
      if (!records) return;

      if (pendingIds.current.has(recordId)) {
        pendingTitles.current.set(recordId, title);
        mutate(
          records.map((r) => r.id === recordId ? { ...r, title } : r),
          { revalidate: false }
        );
        return;
      }

      const snapshot = records;
      mutate(records.map((r) => r.id === recordId ? { ...r, title } : r), { revalidate: false });
      fetch(`/api/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => { mutate(snapshot, { revalidate: false }); });
    },
    [records, mutate]
  );

  // ── Delete record ───────────────────────────────────────────────────────────

  const handleDeleteRecord = useCallback(
    async (record: ParsedRecord) => {
      if (!records) return;
      if (!window.confirm("Supprimer cet enregistrement ?")) return;
      if (selectedRecordId === record.id) setSelectedRecordId(null);
      const snapshot = records;
      mutate(records.filter((r) => r.id !== record.id), { revalidate: false });
      try {
        const res = await fetch(`/api/records/${record.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        mutate();
      } catch {
        mutate(snapshot, { revalidate: false });
      }
    },
    [records, mutate, selectedRecordId]
  );

  // ── Duplicate record ────────────────────────────────────────────────────────

  const handleDuplicateRecord = useCallback(
    async (record: ParsedRecord) => {
      try {
        const res = await fetch(`/api/databases/${databaseId}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Copie de ${record.title || "Sans titre"}`,
            properties: record.properties,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        mutate();
      } catch (err) {
        console.error("Échec de la duplication", err);
      }
    },
    [databaseId, mutate]
  );

  // ── Rename select option (column header) ────────────────────────────────────

  const handleRenameOption = useCallback(
    async (optionId: string, newName: string) => {
      if (!groupByProp) return;
      // Un nom vide est refusé par la validation serveur (400) : ne rien envoyer.
      const trimmed = newName.trim();
      if (!trimmed) return;
      const config = groupByProp.config as { type: string; options?: SelectOption[] };
      const options = config.options ?? [];
      const updatedConfig = {
        ...config,
        options: options.map((o) => o.id === optionId ? { ...o, name: trimmed } : o),
      };
      try {
        const res = await fetch(`/api/properties/${groupByProp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: updatedConfig }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        globalMutate(`/api/databases/${databaseId}`);
      } catch (err) {
        console.error("Échec du renommage de la colonne", err);
      }
    },
    [groupByProp, databaseId]
  );

  // ── Add record (optimistic) ─────────────────────────────────────────────────

  const handleAddRecord = useCallback(
    async (col: KanbanCol) => {
      if (!groupByPropId) return;

      const tempId = crypto.randomUUID();
      const now = new Date();
      const lastPos = col.records.length > 0
        ? Math.max(...col.records.map((r) => r.position))
        : (records ?? []).reduce((max, r) => Math.max(max, r.position), 0);

      const initProperties = col.optionId !== null
        ? { [groupByPropId]: col.optionId }
        : {};

      const tempRecord: ParsedRecord = {
        id: tempId,
        databaseId,
        title: "",
        icon: null,
        coverUrl: null,
        content: "[]",
        templateId: null,
        sectionsBody: null,
        sprintId: targetSprint?.id ?? null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        position: lastPos + 1000,
        properties: initProperties,
      };

      pendingIds.current.add(tempId);
      mutate((prev) => [...(prev ?? []), tempRecord], { revalidate: false });
      setNewRecordId(tempId);

      try {
        const body: Record<string, unknown> = col.optionId === null
          ? {}
          : { properties: { [groupByPropId]: col.optionId } };
        if (targetSprint) body.sprintId = targetSprint.id;

        const res = await fetch(`/api/databases/${databaseId}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created: ParsedRecord = await res.json();

        pendingIds.current.delete(tempId);
        const bufferedTitle = pendingTitles.current.get(tempId);
        pendingTitles.current.delete(tempId);

        const realRecord = bufferedTitle ? { ...created, title: bufferedTitle } : created;
        setNewRecordId(created.id);
        mutate(
          (prev) => (prev ?? []).map((r) => r.id === tempId ? realRecord : r),
          { revalidate: false }
        );

        if (newRecordTimer.current) clearTimeout(newRecordTimer.current);
        newRecordTimer.current = setTimeout(() => setNewRecordId(null), 500);

        if (bufferedTitle) {
          fetch(`/api/records/${created.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: bufferedTitle }),
          })
            .then(() => mutate())
            .catch(() => mutate());
        } else {
          mutate();
        }
      } catch (err) {
        pendingIds.current.delete(tempId);
        pendingTitles.current.delete(tempId);
        setNewRecordId(null);
        mutate((prev) => (prev ?? []).filter((r) => r.id !== tempId), { revalidate: false });
        console.error("Échec de la création du record (kanban)", err);
      }
    },
    [databaseId, groupByPropId, records, mutate, targetSprint]
  );

  // ── Drag start ──────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  // ── Drag end ────────────────────────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      dragJustEndedRef.current = true;
      setTimeout(() => { dragJustEndedRef.current = false; }, 50);

      const { active, over } = event;
      if (!over || !records || !groupByPropId) return;

      const activeRecordId = active.id as string;
      const overId = over.id as string;
      if (activeRecordId === overId) return;

      const sourceCol = colOf(columns, activeRecordId);
      const targetCol = colOf(columns, overId);
      if (!sourceCol || !targetCol) return;

      const targetRecords = targetCol.records.filter((r) => r.id !== activeRecordId);
      const overIsColumn = targetCol.id === overId;
      const insertIndex = overIsColumn
        ? targetRecords.length
        : Math.max(0, targetRecords.findIndex((r) => r.id === overId));

      const prev = targetRecords[insertIndex - 1];
      const next = targetRecords[insertIndex];
      let newPosition: number;
      if (!prev && !next) newPosition = 1000;
      else if (!prev) newPosition = next.position / 2;
      else if (!next) newPosition = prev.position + 1000;
      else newPosition = (prev.position + next.position) / 2;

      const isNewColumn = sourceCol.id !== targetCol.id;

      const snapshot = records;
      const optimistic = records.map((r) => {
        if (r.id !== activeRecordId) return r;
        const props = { ...r.properties };
        if (isNewColumn) {
          if (targetCol.optionId === null) {
            delete props[groupByPropId];
          } else {
            props[groupByPropId] = targetCol.optionId;
          }
        }
        return { ...r, position: newPosition, properties: props };
      });
      mutate(optimistic, { revalidate: false });

      const patchBody: Record<string, unknown> = { position: newPosition };
      if (isNewColumn) {
        patchBody.properties = { [groupByPropId]: targetCol.optionId };
      }

      fetch(`/api/records/${activeRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          mutate();
        })
        .catch(() => {
          mutate(snapshot, { revalidate: false });
        });
    },
    [columns, records, groupByPropId, mutate]
  );

  // ── Sprint board : scope + démarrer / terminer ─────────────────────────────

  const handleScopeChange = useCallback(
    async (scope: string) => {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...view.config, sprintScope: scope } }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    },
    [view.id, view.config, databaseId]
  );

  const handleStartSprint = useCallback(async () => {
    if (!targetSprint) return;
    const res = await fetch(`/api/sprints/${targetSprint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "active" }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert((b as { error?: string }).error ?? "Échec du démarrage.");
      return;
    }
    mutateSprints();
  }, [targetSprint, mutateSprints]);

  const handleCompleteSprint = useCallback(async () => {
    if (!targetSprint) return;
    if (!window.confirm("Terminer le sprint ? Les issues non terminées retournent au backlog.")) return;
    const res = await fetch(`/api/sprints/${targetSprint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: "completed",
        moveIncompleteToBacklog: true,
        statusPropertyId: groupByPropId,
        ...(view.config.doneStatusOptionId && { doneStatusOptionId: view.config.doneStatusOptionId }),
      }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert((b as { error?: string }).error ?? "Échec de la clôture.");
      return;
    }
    mutateSprints();
    mutate(); // des records ont changé de sprint (incomplètes → backlog)
  }, [targetSprint, groupByPropId, view.config.doneStatusOptionId, mutateSprints, mutate]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Chargement…
      </div>
    );
  }

  if (error || !records) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        Impossible de charger les enregistrements.
      </div>
    );
  }

  if (!groupByProp) {
    return (
      <GroupBySelector
        view={view}
        databaseId={databaseId}
        properties={properties}
      />
    );
  }

  const selectedRecord = selectedRecordId
    ? records.find((r) => r.id === selectedRecordId) ?? null
    : null;

  const scopedEmpty = !!sprintScope && sprintScope !== "all" && !targetSprint;

  return (
    <div className="flex flex-col h-full">
      {sprintScope && (
        <SprintBoardHeader
          sprints={sprints ?? []}
          scope={sprintScope}
          targetSprint={targetSprint}
          onScopeChange={handleScopeChange}
          onStart={handleStartSprint}
          onComplete={handleCompleteSprint}
        />
      )}

      {scopedEmpty ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-1.5 text-[var(--text-muted)]">
          <p className="text-sm">Aucun sprint actif.</p>
          <p className="text-xs">Démarre un sprint depuis la vue Backlog, ou choisis-en un ci-dessus.</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 p-4 overflow-x-auto flex-1">
            {columns.map((col) => (
              <KanbanColView
                key={col.id}
                col={col}
                previewProps={previewProps}
                onAddRecord={handleAddRecord}
                newRecordId={newRecordId}
                onTitleSave={handleTitleSave}
                onCardClick={handleCardClick}
                onDeleteRecord={handleDeleteRecord}
                onDuplicateRecord={handleDuplicateRecord}
                onRenameOption={handleRenameOption}
              />
            ))}
          </div>

          <DragOverlay>
            {activeRecord ? (
              <div className="cursor-grabbing shadow-xl">
                <KanbanCardContent record={activeRecord} previewProps={previewProps} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {selectedRecord && (
        <RecordPanel
          key={selectedRecord.id}
          record={selectedRecord}
          properties={properties}
          databaseId={databaseId}
          onClose={() => setSelectedRecordId(null)}
        />
      )}
    </div>
  );
}
