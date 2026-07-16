"use client";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import useSWR from "swr";
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
import {
  Plus, MoreHorizontal, Trash2, ChevronRight, ChevronDown,
  Play, CheckCircle2, RotateCcw, CalendarDays, Layers, GripVertical,
} from "lucide-react";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  ParsedView,
  ParsedSprint,
  SelectOption,
  SprintState,
} from "@/lib/db";
import { SelectBadge, CellDisplay } from "@/components/databases/Cell";
import { applyViewConfig } from "@/lib/client/viewFilters";
import { useDialog } from "@/contexts/DialogContext";
import Portal from "@/components/databases/portal";
import CardActions from "@/components/databases/CardActions";
import RecordPanel from "@/components/databases/RecordPanel";
import { useRecordDeepLink } from "@/lib/client/useRecordDeepLink";

// ─── Constants / types ────────────────────────────────────────────────────────

const BACKLOG_LANE = "__backlog__";
const EPIC_NONE = "__none__";

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
};

/** Une « lane » = un sprint (avec ses issues) ou le backlog (sprint = null). */
type Lane = {
  id: string;                  // droppable id : sprint.id ou BACKLOG_LANE
  sprint: ParsedSprint | null; // null = backlog (non planifié)
  records: ParsedRecord[];
};

type SprintPatch = Partial<
  Pick<ParsedSprint, "name" | "goal" | "startDate" | "endDate" | "state" | "position">
>;

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

function formatRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const s = start ? DATE_FMT.format(new Date(start)) : "?";
  const e = end ? DATE_FMT.format(new Date(end)) : "?";
  return `${s} – ${e}`;
}

const STATE_BADGE: Record<SprintState, { label: string; cls: string }> = {
  future:    { label: "À venir", cls: "bg-[var(--surface)] text-[var(--text-muted)]" },
  active:    { label: "Actif",   cls: "bg-green-100 text-green-700" },
  completed: { label: "Terminé", cls: "bg-[var(--surface)] text-[var(--text-muted)]" },
};

function pointsOf(record: ParsedRecord, pointsPropId: string | undefined): number {
  if (!pointsPropId) return 0;
  const v = record.properties[pointsPropId];
  return typeof v === "number" ? v : 0;
}

function laneOf(lanes: Lane[], id: string): Lane | null {
  const direct = lanes.find((l) => l.id === id);
  if (direct) return direct;
  return lanes.find((l) => l.records.some((r) => r.id === id)) ?? null;
}

// ─── RowMeta (épic / statut / points) ─────────────────────────────────────────

function RowMeta({
  record, previewProps, statusProp, epicProp, pointsProp,
}: {
  record: ParsedRecord;
  previewProps?: ParsedDatabaseProperty[];
  statusProp?: ParsedDatabaseProperty;
  epicProp?: ParsedDatabaseProperty;
  pointsProp?: ParsedDatabaseProperty;
}) {
  const pts = pointsProp ? record.properties[pointsProp.id] : undefined;
  return (
    <>
      {(previewProps ?? []).map((p) => {
        const v = record.properties[p.id];
        if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return null;
        return (
          <span key={p.id} className="shrink-0 max-w-[160px] truncate text-xs text-[var(--text-muted)]">
            <CellDisplay property={p} record={record} />
          </span>
        );
      })}
      {epicProp && record.properties[epicProp.id] != null && (
        <span className="shrink-0"><CellDisplay property={epicProp} record={record} /></span>
      )}
      {statusProp && record.properties[statusProp.id] != null && (
        <span className="shrink-0"><CellDisplay property={statusProp} record={record} /></span>
      )}
      {pointsProp && typeof pts === "number" && (
        <span
          className="shrink-0 inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full text-xs font-medium bg-[var(--surface)] text-[var(--text-muted)] tabular-nums"
          title="Story points"
        >
          {pts}
        </span>
      )}
    </>
  );
}

// ─── BacklogRow (issue) ───────────────────────────────────────────────────────

function BacklogRow({
  record, previewProps, statusProp, epicProp, pointsProp, autoEdit,
  onTitleSave, onRowClick, onDelete, onDuplicate,
}: {
  record: ParsedRecord;
  previewProps?: ParsedDatabaseProperty[];
  statusProp?: ParsedDatabaseProperty;
  epicProp?: ParsedDatabaseProperty;
  pointsProp?: ParsedDatabaseProperty;
  autoEdit?: boolean;
  onTitleSave: (id: string, title: string) => void;
  onRowClick: (record: ParsedRecord) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(record.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoEdit) setIsEditingTitle(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitle = () => {
    setIsEditingTitle(false);
    onTitleSave(record.id, titleValue.trim());
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: record.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={[
        "group flex items-center gap-2 pl-1.5 pr-1 py-1.5 rounded-md border border-transparent bg-[var(--bg)]",
        isDragging ? "opacity-40" : "hover:bg-[var(--surface)] hover:border-[var(--border)]",
      ].join(" ")}
    >
      <span
        {...(isEditingTitle ? {} : listeners)}
        className={[
          "shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity",
          isEditingTitle ? "" : "cursor-grab active:cursor-grabbing",
        ].join(" ")}
        title="Déplacer"
      >
        <GripVertical size={14} />
      </span>

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
          className="flex-1 min-w-0 text-sm bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)]"
        />
      ) : (
        <button
          className="flex-1 min-w-0 text-left text-sm text-[var(--text)] truncate"
          onClick={() => onRowClick(record)}
        >
          {record.title || <span className="text-[var(--text-muted)]">Sans titre</span>}
        </button>
      )}

      <div className="flex items-center gap-1.5 shrink-0">
        <RowMeta record={record} previewProps={previewProps} statusProp={statusProp} epicProp={epicProp} pointsProp={pointsProp} />
      </div>

      {/* Actions directes (dupliquer / supprimer), visibles au survol. */}
      <CardActions className="shrink-0" onDuplicate={onDuplicate} onDelete={onDelete} />
    </div>
  );
}

function BacklogRowOverlay({
  record, previewProps, statusProp, epicProp, pointsProp,
}: {
  record: ParsedRecord;
  previewProps?: ParsedDatabaseProperty[];
  statusProp?: ParsedDatabaseProperty;
  epicProp?: ParsedDatabaseProperty;
  pointsProp?: ParsedDatabaseProperty;
}) {
  return (
    <div className="flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] shadow-xl cursor-grabbing">
      <GripVertical size={14} className="text-[var(--text-muted)] shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-[var(--text)] truncate">
        {record.title || "Sans titre"}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <RowMeta record={record} previewProps={previewProps} statusProp={statusProp} epicProp={epicProp} pointsProp={pointsProp} />
      </div>
    </div>
  );
}

// ─── SprintMenu (⋯) ───────────────────────────────────────────────────────────

function SprintMenu({
  anchor, sprint, onClose, onAction, onEdit, onDelete,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  sprint: ParsedSprint;
  onClose: () => void;
  onAction: (state: SprintState) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Portal anchor={anchor} onClose={onClose} minWidth={200}>
      {sprint.state === "future" && (
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); onClose(); onAction("active"); }}
        >
          <Play size={13} /> Démarrer le sprint
        </button>
      )}
      {sprint.state === "active" && (
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); onClose(); onAction("completed"); }}
        >
          <CheckCircle2 size={13} /> Terminer le sprint
        </button>
      )}
      {sprint.state === "completed" && (
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
          onMouseDown={(e) => { e.preventDefault(); onClose(); onAction("active"); }}
        >
          <RotateCcw size={13} /> Rouvrir le sprint
        </button>
      )}
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text)] flex items-center gap-2"
        onMouseDown={(e) => { e.preventDefault(); onClose(); onEdit(); }}
      >
        <CalendarDays size={13} /> Dates & objectif
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-red-500 flex items-center gap-2"
        onMouseDown={(e) => { e.preventDefault(); onClose(); onDelete(); }}
      >
        <Trash2 size={13} /> Supprimer
      </button>
    </Portal>
  );
}

// ─── SprintLane ───────────────────────────────────────────────────────────────

export function SprintLane({
  lane, collapsed, onToggleCollapse,
  statusProp, epicProp, pointsProp, previewProps, doneOptionId, newRecordId,
  onAddRecord, onTitleSave, onRowClick, onDeleteRecord, onDuplicateRecord,
  onRenameSprint, onSprintAction, onEditSprint, onDeleteSprint,
}: {
  lane: Lane;
  collapsed: boolean;
  onToggleCollapse: () => void;
  statusProp?: ParsedDatabaseProperty;
  epicProp?: ParsedDatabaseProperty;
  pointsProp?: ParsedDatabaseProperty;
  previewProps?: ParsedDatabaseProperty[];
  doneOptionId?: string;
  newRecordId: string | null;
  onAddRecord: (lane: Lane) => void;
  onTitleSave: (id: string, title: string) => void;
  onRowClick: (record: ParsedRecord) => void;
  onDeleteRecord: (record: ParsedRecord) => void;
  onDuplicateRecord: (record: ParsedRecord) => void;
  onRenameSprint: (id: string, name: string) => void;
  onSprintAction: (id: string, state: SprintState) => void;
  onEditSprint: (sprint: ParsedSprint) => void;
  onDeleteSprint: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  const sprint = lane.sprint;

  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(sprint?.name ?? "");
  const [showNotes, setShowNotes] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!isRenaming && sprint) setNameValue(sprint.name); }, [sprint, isRenaming]);
  useEffect(() => {
    if (isRenaming) { nameInputRef.current?.focus(); nameInputRef.current?.select(); }
  }, [isRenaming]);

  const commitRename = () => {
    setIsRenaming(false);
    const trimmed = nameValue.trim();
    if (!sprint || !trimmed || trimmed === sprint.name) return;
    onRenameSprint(sprint.id, trimmed);
  };

  const totalPts = lane.records.reduce((s, r) => s + pointsOf(r, pointsProp?.id), 0);
  const donePts = doneOptionId && statusProp
    ? lane.records.reduce(
        (s, r) => s + (r.properties[statusProp.id] === doneOptionId ? pointsOf(r, pointsProp?.id) : 0),
        0
      )
    : null;

  const range = sprint ? formatRange(sprint.startDate, sprint.endDate) : null;
  const stateBadge = sprint ? STATE_BADGE[sprint.state] : null;

  return (
    <div
      className={[
        "rounded-lg border",
        sprint?.state === "active"
          ? "border-[var(--accent)]/40"
          : "border-[var(--border)]",
      ].join(" ")}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          onClick={onToggleCollapse}
          className="shrink-0 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
          title={collapsed ? "Déplier" : "Replier"}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>

        {sprint && isRenaming ? (
          <input
            ref={nameInputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); setIsRenaming(false); setNameValue(sprint.name); }
            }}
            className="text-sm font-semibold bg-transparent outline outline-1 outline-[var(--accent)] rounded px-1 text-[var(--text)] min-w-0"
            style={{ width: Math.max(80, nameValue.length * 8) + "px" }}
          />
        ) : (
          <span
            className={sprint ? "text-sm font-semibold text-[var(--text)] cursor-text" : "text-sm font-semibold text-[var(--text)]"}
            onClick={() => { if (sprint) setIsRenaming(true); }}
            title={sprint ? "Cliquer pour renommer" : undefined}
          >
            {sprint ? sprint.name : "Backlog"}
          </span>
        )}

        {stateBadge && (
          <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${stateBadge.cls}`}>
            {stateBadge.label}
          </span>
        )}
        {range && (
          <span className="shrink-0 text-xs text-[var(--text-muted)]">{range}</span>
        )}

        <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)] tabular-nums">
          {lane.records.length} issue{lane.records.length !== 1 ? "s" : ""}
        </span>
        {pointsProp && (
          <span
            className="shrink-0 text-xs text-[var(--text-muted)] tabular-nums"
            title="Story points (terminés / total)"
          >
            · {donePts !== null ? `${donePts}/${totalPts}` : totalPts} pts
          </span>
        )}

        {/* Bouton d'ajout ANCRÉ en tête de lane : reste visible même quand la lane
            déborde (le corps ne scrolle pas, le board oui). Absent tant que la lane
            est repliée — il réapparaît au dépliage. */}
        {!collapsed && (
          <button
            onClick={() => onAddRecord(lane)}
            className="shrink-0 flex items-center gap-1 pl-1 pr-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded-md transition-colors"
            title="Créer une issue"
          >
            <Plus size={13} />
            Créer une issue
          </button>
        )}

        {sprint && (
          <button
            ref={menuBtnRef}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(true); }}
            className="shrink-0 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
            title="Options du sprint"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
        {sprint && menuOpen && (
          <SprintMenu
            anchor={menuBtnRef as React.RefObject<HTMLElement | null>}
            sprint={sprint}
            onClose={() => setMenuOpen(false)}
            onAction={(state) => onSprintAction(sprint.id, state)}
            onEdit={() => onEditSprint(sprint)}
            onDelete={() => onDeleteSprint(sprint.id)}
          />
        )}
      </div>

      {sprint?.goal && !collapsed && (
        <p className="px-9 -mt-1 pb-2 text-xs text-[var(--text-muted)] italic">{sprint.goal}</p>
      )}

      {/* Notes de version (lecture seule) — présentes sur les sprints terminés.
          Accessibles même quand la lane est repliée (les terminés le sont par défaut). */}
      {sprint?.releaseNotes && (
        <div className="px-2 pb-2">
          <button
            onClick={() => setShowNotes((v) => !v)}
            className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded-md transition-colors"
            title="Notes de version (lecture seule)"
          >
            {showNotes ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span aria-hidden>📝</span> Notes de version
          </button>
          {showNotes && (
            <div className="mt-1 ml-1 px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed select-text">
              {sprint.releaseNotes}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      {!collapsed && (
        <div
          ref={setNodeRef}
          className={[
            "px-2 pb-2 flex flex-col gap-1 min-h-[44px] transition-colors rounded-b-lg",
            isOver ? "bg-[var(--surface)]" : "",
          ].join(" ")}
        >
          <SortableContext items={lane.records.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {lane.records.map((record) => (
              <BacklogRow
                key={record.id}
                record={record}
                previewProps={previewProps}
                statusProp={statusProp}
                epicProp={epicProp}
                pointsProp={pointsProp}
                autoEdit={record.id === newRecordId}
                onTitleSave={onTitleSave}
                onRowClick={onRowClick}
                onDelete={() => onDeleteRecord(record)}
                onDuplicate={() => onDuplicateRecord(record)}
              />
            ))}
          </SortableContext>
          {lane.records.length === 0 && (
            <p className="text-xs text-[var(--text-muted)] text-center py-2 select-none pointer-events-none">
              {sprint ? "Glissez des issues ici" : "Aucune issue non planifiée"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EpicsPanel ───────────────────────────────────────────────────────────────

function EpicsPanel({
  epicProp, baseCount, counts, noneCount, epicFilter, onSelect,
}: {
  epicProp: ParsedDatabaseProperty;
  baseCount: number;
  counts: Record<string, number>;
  noneCount: number;
  epicFilter: string | null;
  onSelect: (value: string | null) => void;
}) {
  const options = (epicProp.config as { options?: SelectOption[] }).options ?? [];
  const itemCls = (active: boolean) =>
    [
      "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
      active ? "bg-[var(--surface-active)] text-[var(--text)]" : "hover:bg-[var(--surface-hover)] text-[var(--text)]",
    ].join(" ");

  return (
    <div className="w-56 shrink-0 border-r border-[var(--border)] overflow-auto p-3">
      <div className="flex items-center gap-1.5 px-1 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        <Layers size={13} /> Épics
      </div>
      <button onClick={() => onSelect(null)} className={itemCls(epicFilter === null)}>
        <span>Toutes les issues</span>
        <span className="ml-auto tabular-nums text-[var(--text-muted)]">{baseCount}</span>
      </button>
      {options.map((opt) => (
        <button key={opt.id} onClick={() => onSelect(opt.id)} className={itemCls(epicFilter === opt.id)}>
          <SelectBadge option={opt} />
          <span className="ml-auto tabular-nums text-[var(--text-muted)]">{counts[opt.id] ?? 0}</span>
        </button>
      ))}
      <button onClick={() => onSelect(EPIC_NONE)} className={itemCls(epicFilter === EPIC_NONE)}>
        <span className="text-[var(--text-muted)]">Sans épic</span>
        <span className="ml-auto tabular-nums text-[var(--text-muted)]">{noneCount}</span>
      </button>
    </div>
  );
}

// ─── SprintEditModal ──────────────────────────────────────────────────────────

function SprintEditModal({
  sprint, onClose, onSave,
}: {
  sprint: ParsedSprint;
  onClose: () => void;
  onSave: (patch: SprintPatch) => void;
}) {
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [start, setStart] = useState(sprint.startDate ? sprint.startDate.slice(0, 10) : "");
  const [end, setEnd] = useState(sprint.endDate ? sprint.endDate.slice(0, 10) : "");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim() || sprint.name,
      goal: goal.trim() || null,
      startDate: start || null,
      endDate: end || null,
    });
    onClose();
  };

  const field = "text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <form
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl p-4 w-[360px] flex flex-col gap-3"
      >
        <h3 className="text-sm font-semibold text-[var(--text)]">Modifier le sprint</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Objectif</label>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} className={field} />
        </div>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-[var(--text-muted)]">Début</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-[var(--text-muted)]">Fin</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">
            Annuler
          </button>
          <button type="submit" className="text-sm px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:opacity-90">
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── BacklogView (main) ───────────────────────────────────────────────────────

export default function BacklogView({ databaseId, view, properties }: Props) {
  const { confirm, alert } = useDialog();
  const {
    data: records,
    error,
    isLoading: recordsLoading,
    mutate,
  } = useSWR<ParsedRecord[]>(`/api/databases/${databaseId}/records`, fetcher);

  const {
    data: sprints,
    isLoading: sprintsLoading,
    mutate: mutateSprints,
  } = useSWR<ParsedSprint[]>(`/api/databases/${databaseId}/sprints`, fetcher);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [newRecordId, setNewRecordId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useRecordDeepLink(records);
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editingSprintId, setEditingSprintId] = useState<string | null>(null);

  const pendingIds = useRef<Set<string>>(new Set());
  const pendingTitles = useRef<Map<string, string>>(new Map());
  const newRecordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // ── Propriétés câblées (template scrum) ────────────────────────────────────
  const cfg = view.config;
  const statusProp = cfg.statusPropertyId ? properties.find((p) => p.id === cfg.statusPropertyId) : undefined;
  const pointsProp = cfg.pointsPropertyId ? properties.find((p) => p.id === cfg.pointsPropertyId) : undefined;
  const epicProp = cfg.epicPropertyId ? properties.find((p) => p.id === cfg.epicPropertyId) : undefined;

  // Autres colonnes affichées sur chaque ligne (type, priorité, assigné, échéance…),
  // hors titre et hors propriétés déjà rendues à part (statut / épic / points).
  const previewProps = properties
    .filter(
      (p) =>
        p.type !== "title" &&
        p.id !== statusProp?.id &&
        p.id !== epicProp?.id &&
        p.id !== pointsProp?.id
    )
    .sort((a, b) => a.position - b.position);

  // ── Records filtrés (filtres de vue, sans tri → on garde l'ordre manuel) ───
  const baseRecords = useMemo(() => {
    if (!records) return [];
    const byPosition = [...records].sort((a, b) => a.position - b.position);
    return applyViewConfig(byPosition, { ...cfg, sorts: [] }, properties);
  }, [records, cfg, properties]);

  const { counts: epicCounts, none: epicNoneCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    let none = 0;
    if (epicProp) {
      for (const r of baseRecords) {
        const v = r.properties[epicProp.id];
        if (typeof v === "string" && v) counts[v] = (counts[v] ?? 0) + 1;
        else none += 1;
      }
    }
    return { counts, none };
  }, [baseRecords, epicProp]);

  const visibleRecords = useMemo(() => {
    if (!epicProp || epicFilter === null) return baseRecords;
    if (epicFilter === EPIC_NONE) {
      return baseRecords.filter((r) => {
        const v = r.properties[epicProp.id];
        return !(typeof v === "string" && v);
      });
    }
    return baseRecords.filter((r) => r.properties[epicProp.id] === epicFilter);
  }, [baseRecords, epicProp, epicFilter]);

  // ── Lanes (sprints ouverts → backlog → sprints terminés) ───────────────────
  const lanes = useMemo<Lane[]>(() => {
    const list = sprints ?? [];
    const order: Record<SprintState, number> = { active: 0, future: 1, completed: 2 };
    const sorted = [...list].sort(
      (a, b) => order[a.state] - order[b.state] || a.position - b.position
    );
    const sprintIds = new Set(list.map((s) => s.id));
    const bySprint = new Map<string, ParsedRecord[]>();
    const backlog: ParsedRecord[] = [];
    for (const r of visibleRecords) {
      if (r.sprintId && sprintIds.has(r.sprintId)) {
        const arr = bySprint.get(r.sprintId) ?? [];
        arr.push(r);
        bySprint.set(r.sprintId, arr);
      } else {
        backlog.push(r);
      }
    }
    const byPos = (a: ParsedRecord, b: ParsedRecord) => a.position - b.position;
    const sprintLanes: Lane[] = sorted.map((s) => ({
      id: s.id,
      sprint: s,
      records: (bySprint.get(s.id) ?? []).sort(byPos),
    }));
    const backlogLane: Lane = { id: BACKLOG_LANE, sprint: null, records: backlog.sort(byPos) };
    const open = sprintLanes.filter((l) => l.sprint && l.sprint.state !== "completed");
    const done = sprintLanes.filter((l) => l.sprint && l.sprint.state === "completed");
    return [...open, backlogLane, ...done];
  }, [sprints, visibleRecords]);

  const activeRecord = useMemo(
    () => records?.find((r) => r.id === activeId) ?? null,
    [records, activeId]
  );

  const isCollapsed = useCallback(
    (lane: Lane) => collapsed[lane.id] ?? lane.sprint?.state === "completed",
    [collapsed]
  );
  const toggleCollapse = useCallback(
    (lane: Lane) =>
      setCollapsed((c) => ({ ...c, [lane.id]: !(c[lane.id] ?? lane.sprint?.state === "completed") })),
    []
  );

  // ── Record handlers ─────────────────────────────────────────────────────────

  const handleRowClick = useCallback((record: ParsedRecord) => {
    setSelectedRecordId(record.id);
  }, []);

  const handleTitleSave = useCallback(
    (recordId: string, title: string) => {
      if (!records) return;
      if (pendingIds.current.has(recordId)) {
        pendingTitles.current.set(recordId, title);
        mutate(records.map((r) => (r.id === recordId ? { ...r, title } : r)), { revalidate: false });
        return;
      }
      const snapshot = records;
      mutate(records.map((r) => (r.id === recordId ? { ...r, title } : r)), { revalidate: false });
      fetch(`/api/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => mutate(snapshot, { revalidate: false }));
    },
    [records, mutate]
  );

  const handleDeleteRecord = useCallback(
    async (record: ParsedRecord) => {
      if (!records) return;
      const ok = await confirm({
        title: "Supprimer cette issue ?",
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!ok) return;
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
    [records, mutate, selectedRecordId, confirm]
  );

  const handleDuplicateRecord = useCallback(
    async (record: ParsedRecord) => {
      try {
        const res = await fetch(`/api/records/${record.id}/duplicate`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        mutate();
      } catch (err) {
        console.error("Échec de la duplication", err);
      }
    },
    [mutate]
  );

  const handleAddRecord = useCallback(
    async (lane: Lane) => {
      if (!records) return;
      const tempId = crypto.randomUUID();
      const now = new Date();
      const lastPos = lane.records.length > 0
        ? Math.max(...lane.records.map((r) => r.position))
        : records.reduce((m, r) => Math.max(m, r.position), 0);
      const sprintId = lane.sprint ? lane.sprint.id : null;

      const tempRecord: ParsedRecord = {
        id: tempId,
        databaseId,
        title: "",
        icon: null,
        coverUrl: null,
        content: "[]",
        templateId: null,
        sectionsBody: null,
        trashedAt: null,
        sprintId,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        position: lastPos + 1000,
        properties: {},
      };

      pendingIds.current.add(tempId);
      mutate((prev) => [...(prev ?? []), tempRecord], { revalidate: false });
      setNewRecordId(tempId);

      try {
        const res = await fetch(`/api/databases/${databaseId}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sprintId ? { sprintId } : {}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created: ParsedRecord = await res.json();

        pendingIds.current.delete(tempId);
        const bufferedTitle = pendingTitles.current.get(tempId);
        pendingTitles.current.delete(tempId);

        const realRecord = bufferedTitle ? { ...created, title: bufferedTitle } : created;
        setNewRecordId(created.id);
        mutate((prev) => (prev ?? []).map((r) => (r.id === tempId ? realRecord : r)), { revalidate: false });

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
        console.error("Échec de la création de l'issue", err);
      }
    },
    [databaseId, records, mutate]
  );

  // ── Drag ────────────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || !records) return;

      const activeRecordId = active.id as string;
      const overId = over.id as string;
      if (activeRecordId === overId) return;

      const sourceLane = laneOf(lanes, activeRecordId);
      const targetLane = laneOf(lanes, overId);
      if (!sourceLane || !targetLane) return;

      const targetRecords = targetLane.records.filter((r) => r.id !== activeRecordId);
      const overIsLane = targetLane.id === overId;
      const insertIndex = overIsLane
        ? targetRecords.length
        : Math.max(0, targetRecords.findIndex((r) => r.id === overId));

      const prev = targetRecords[insertIndex - 1];
      const next = targetRecords[insertIndex];
      let newPosition: number;
      if (!prev && !next) newPosition = 1000;
      else if (!prev) newPosition = next.position / 2;
      else if (!next) newPosition = prev.position + 1000;
      else newPosition = (prev.position + next.position) / 2;

      const isNewLane = sourceLane.id !== targetLane.id;
      const newSprintId = targetLane.sprint ? targetLane.sprint.id : null;

      const snapshot = records;
      const optimistic = records.map((r) =>
        r.id !== activeRecordId
          ? r
          : { ...r, position: newPosition, ...(isNewLane && { sprintId: newSprintId }) }
      );
      mutate(optimistic, { revalidate: false });

      const patchBody: Record<string, unknown> = { position: newPosition };
      if (isNewLane) patchBody.sprintId = newSprintId;

      fetch(`/api/records/${activeRecordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => mutate(snapshot, { revalidate: false }));
    },
    [lanes, records, mutate]
  );

  // ── Sprint handlers ───────────────────────────────────────────────────────

  const createSprint = useCallback(async () => {
    const n = (sprints?.length ?? 0) + 1;
    const res = await fetch(`/api/databases/${databaseId}/sprints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Sprint ${n}` }),
    });
    if (res.ok) mutateSprints();
  }, [databaseId, sprints, mutateSprints]);

  const patchSprint = useCallback(
    async (id: string, patch: SprintPatch) => {
      const snapshot = sprints;
      if (sprints) {
        mutateSprints(
          sprints.map((s) => (s.id === id ? ({ ...s, ...patch } as ParsedSprint) : s)),
          { revalidate: false }
        );
      }
      try {
        const res = await fetch(`/api/sprints/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error ?? `Erreur ${res.status}`);
        }
        mutateSprints();
      } catch (e) {
        mutateSprints(snapshot, { revalidate: false });
        await alert({
          title: "Échec",
          message: e instanceof Error ? e.message : "Échec.",
          tone: "danger",
        });
      }
    },
    [sprints, mutateSprints, alert]
  );

  const renameSprint = useCallback((id: string, name: string) => patchSprint(id, { name }), [patchSprint]);

  // Clôture : passe le sprint en "completed" ET renvoie les issues non terminées
  // au backlog (statut != doneStatusOptionId). Atomique côté serveur.
  const completeSprint = useCallback(
    async (id: string) => {
      // Non destructif : les issues non terminées retournent au backlog.
      const ok = await confirm({
        title: "Terminer le sprint ?",
        message: "Les issues non terminées retournent au backlog.",
        confirmLabel: "Terminer",
      });
      if (!ok) return;
      const snapSprints = sprints;
      const snapRecords = records;
      const statusId = cfg.statusPropertyId;
      const done = cfg.doneStatusOptionId;
      if (sprints) {
        mutateSprints(
          sprints.map((s) => (s.id === id ? ({ ...s, state: "completed" } as ParsedSprint) : s)),
          { revalidate: false }
        );
      }
      if (records && statusId && done) {
        mutate(
          records.map((r) =>
            r.sprintId === id && r.properties[statusId] !== done ? { ...r, sprintId: null } : r
          ),
          { revalidate: false }
        );
      }
      try {
        const res = await fetch(`/api/sprints/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            state: "completed",
            moveIncompleteToBacklog: true,
            ...(statusId && { statusPropertyId: statusId }),
            ...(done && { doneStatusOptionId: done }),
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error((b as { error?: string }).error ?? `Erreur ${res.status}`);
        }
        mutateSprints();
        mutate();
      } catch (e) {
        mutateSprints(snapSprints, { revalidate: false });
        mutate(snapRecords, { revalidate: false });
        await alert({
          title: "Clôture impossible",
          message: e instanceof Error ? e.message : "Échec de la clôture.",
          tone: "danger",
        });
      }
    },
    [sprints, records, cfg.statusPropertyId, cfg.doneStatusOptionId, mutateSprints, mutate, confirm, alert]
  );

  const sprintAction = useCallback(
    (id: string, state: SprintState) => {
      if (state === "completed") return completeSprint(id);
      return patchSprint(id, { state });
    },
    [completeSprint, patchSprint]
  );

  const deleteSprint = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Supprimer ce sprint ?",
        message: "Ses issues retournent au backlog.",
        confirmLabel: "Supprimer",
        tone: "danger",
      });
      if (!ok) return;
      const snapSprints = sprints;
      const snapRecords = records;
      if (sprints) mutateSprints(sprints.filter((s) => s.id !== id), { revalidate: false });
      if (records) mutate(records.map((r) => (r.sprintId === id ? { ...r, sprintId: null } : r)), { revalidate: false });
      try {
        const res = await fetch(`/api/sprints/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        mutateSprints();
        mutate();
      } catch {
        mutateSprints(snapSprints, { revalidate: false });
        mutate(snapRecords, { revalidate: false });
      }
    },
    [sprints, records, mutateSprints, mutate, confirm]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (recordsLoading || sprintsLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Chargement…
      </div>
    );
  }

  if (error || !records) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">
        Impossible de charger le backlog.
      </div>
    );
  }

  const selectedRecord = selectedRecordId
    ? records.find((r) => r.id === selectedRecordId) ?? null
    : null;
  const editingSprint = editingSprintId
    ? (sprints ?? []).find((s) => s.id === editingSprintId) ?? null
    : null;

  return (
    <div className="flex h-full">
      {epicProp && (
        <EpicsPanel
          epicProp={epicProp}
          baseCount={baseRecords.length}
          counts={epicCounts}
          noneCount={epicNoneCount}
          epicFilter={epicFilter}
          onSelect={setEpicFilter}
        />
      )}

      <div className="flex-1 overflow-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="p-4 flex flex-col gap-3 max-w-3xl mx-auto">
            <div className="flex items-center justify-end">
              <button
                onClick={createSprint}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)] transition-colors"
              >
                <Plus size={14} />
                Créer un sprint
              </button>
            </div>

            {lanes.map((lane) => (
              <SprintLane
                key={lane.id}
                lane={lane}
                collapsed={isCollapsed(lane)}
                onToggleCollapse={() => toggleCollapse(lane)}
                statusProp={statusProp}
                epicProp={epicProp}
                pointsProp={pointsProp}
                previewProps={previewProps}
                doneOptionId={cfg.doneStatusOptionId}
                newRecordId={newRecordId}
                onAddRecord={handleAddRecord}
                onTitleSave={handleTitleSave}
                onRowClick={handleRowClick}
                onDeleteRecord={handleDeleteRecord}
                onDuplicateRecord={handleDuplicateRecord}
                onRenameSprint={renameSprint}
                onSprintAction={sprintAction}
                onEditSprint={(s) => setEditingSprintId(s.id)}
                onDeleteSprint={deleteSprint}
              />
            ))}
          </div>

          <DragOverlay>
            {activeRecord ? (
              <BacklogRowOverlay
                record={activeRecord}
                previewProps={previewProps}
                statusProp={statusProp}
                epicProp={epicProp}
                pointsProp={pointsProp}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {selectedRecord && (
        <RecordPanel
          key={selectedRecord.id}
          record={selectedRecord}
          properties={properties}
          databaseId={databaseId}
          onClose={() => setSelectedRecordId(null)}
        />
      )}

      {editingSprint && (
        <SprintEditModal
          sprint={editingSprint}
          onClose={() => setEditingSprintId(null)}
          onSave={(patch) => patchSprint(editingSprint.id, patch)}
        />
      )}
    </div>
  );
}
