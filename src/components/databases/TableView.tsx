"use client";
import useSWR, { mutate as globalMutate } from "swr";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { ParsedDatabaseProperty, ParsedRecord, ParsedView, PropertyValue } from "@/lib/db";
import { applyViewConfig } from "@/lib/client/viewFilters";
import Cell, { CellDisplay } from "@/components/databases/Cell";
import AddPropertyModal from "@/components/databases/AddPropertyModal";
import PropertyPopover from "@/components/databases/PropertyPopover";
import RecordPanel from "@/components/databases/RecordPanel";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_COL_WIDTH = 180;
const DEFAULT_TITLE_WIDTH = 250;
const MIN_COL_WIDTH = 80;
const MAX_COL_WIDTH = 600;
// Fixed-width columns (row# + delete + add-property)
const FIXED_COLS_WIDTH = 56 + 32 + 40;

function getColWidth(propId: string, propType: string, widths: Record<string, number>): number {
  if (propId in widths) return widths[propId];
  return propType === "title" ? DEFAULT_TITLE_WIDTH : DEFAULT_COL_WIDTH;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function sortProperties(properties: ParsedDatabaseProperty[]): ParsedDatabaseProperty[] {
  const title = properties.find((p) => p.type === "title");
  const rest = properties
    .filter((p) => p.type !== "title")
    .sort((a, b) => a.position - b.position);
  return title ? [title, ...rest] : rest;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function TableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {Array.from({ length: cols || 3 }).map((_, i) => (
              <th key={i} className="px-3 py-2 text-left">
                <div className="h-3 w-20 bg-[var(--surface)] rounded animate-pulse" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }).map((_, i) => (
            <tr key={i} className="border-b border-[var(--border)]">
              {Array.from({ length: cols || 3 }).map((_, j) => (
                <td key={j} className="px-3 py-2">
                  <div
                    className="h-3 bg-[var(--surface)] rounded animate-pulse"
                    style={{ width: `${60 + ((i * 3 + j) % 5) * 8}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ResizeHandle ─────────────────────────────────────────────────────────────

function ResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-4 flex items-stretch justify-center cursor-col-resize z-10 group/rh"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="w-px bg-transparent group-hover/rh:bg-[var(--accent)] opacity-60 transition-colors" />
    </div>
  );
}

// ─── SortableRow ──────────────────────────────────────────────────────────────

function SortableRow({
  record,
  index,
  sorted,
  colWidths,
  onSave,
  onDelete,
  onTitleClick,
}: {
  record: ParsedRecord;
  index: number;
  sorted: ParsedDatabaseProperty[];
  colWidths: Record<string, number>;
  onSave: (property: ParsedDatabaseProperty, value: PropertyValue | null) => void;
  onDelete: () => void;
  onTitleClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: record.id });

  return (
    <tr
      ref={setNodeRef}
      className={[
        "border-b border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors group",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      {/* Drag handle + row number — fixed width, not resizable */}
      <td className="px-2 py-1.5 select-none" style={{ width: 56, minWidth: 56 }}>
        <div className="flex items-center gap-1">
          <span
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-[var(--text-muted)] transition-opacity shrink-0 touch-none"
          >
            <GripVertical size={13} />
          </span>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">{index + 1}</span>
        </div>
      </td>

      {sorted.map((property) => {
        const w = getColWidth(property.id, property.type, colWidths);
        if (property.type === "title") {
          return (
            <td
              key={property.id}
              style={{ width: w, minWidth: w, maxWidth: w }}
              className="px-3 py-1.5 text-[var(--text)] cursor-pointer hover:text-[var(--accent)] transition-colors overflow-hidden"
              onClick={onTitleClick}
            >
              <div className="truncate">
                <CellDisplay property={property} record={record} />
              </div>
            </td>
          );
        }
        return (
          <td
            key={property.id}
            style={{ width: w, minWidth: w, maxWidth: w }}
            className="px-3 py-1.5 text-[var(--text)] overflow-hidden"
          >
            <Cell
              property={property}
              record={record}
              onSave={(value) => onSave(property, value)}
            />
          </td>
        );
      })}

      {/* Delete action — fixed width, not resizable */}
      <td className="px-1 py-1.5" style={{ width: 32, minWidth: 32 }}>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-500 transition-opacity"
          title="Supprimer l'enregistrement"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

// ─── DragOverlay row ──────────────────────────────────────────────────────────

function DragRow({ record }: { record: ParsedRecord }) {
  return (
    <table className="text-sm border-collapse" style={{ tableLayout: "fixed" }}>
      <tbody>
        <tr className="bg-[var(--bg)] border border-[var(--border)] shadow-xl rounded">
          <td className="px-2 py-1.5 text-[var(--text-muted)]" style={{ width: 56 }}>
            <GripVertical size={13} />
          </td>
          <td className="px-3 py-1.5 text-[var(--text)] font-medium" style={{ width: 250 }}>
            {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TableView({ databaseId, view: _view, properties: initialProperties }: Props) {
  const { data: records, error, isLoading, mutate } = useSWR<ParsedRecord[]>(
    `/api/databases/${databaseId}/records`,
    fetcher
  );

  const [properties, setProperties] = useState<ParsedDatabaseProperty[]>(initialProperties);
  useEffect(() => { setProperties(initialProperties); }, [initialProperties]);

  const sorted = sortProperties(properties);

  const sortedRecords = useMemo(() => {
    const byPosition = [...(records ?? [])].sort((a, b) => a.position - b.position);
    return applyViewConfig(byPosition, _view.config, properties);
  }, [records, _view.config, properties]);

  // ── Column widths ─────────────────────────────────────────────────────────

  const [widths, setWidths] = useState<Record<string, number>>(
    () => _view.config.columnWidths ?? {}
  );

  // Sync from external view config changes (sorts/filters PATCH carries columnWidths through)
  useEffect(() => {
    if (!resizeState.current) {
      setWidths(_view.config.columnWidths ?? {});
    }
  }, [_view.config.columnWidths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ref to track active resize — avoids stale closures in event listeners
  const resizeState = useRef<{
    propId: string;
    propType: string;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  const persistWidths = useCallback(
    (newWidths: Record<string, number>) => {
      fetch(`/api/views/${_view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ..._view.config, columnWidths: newWidths } }),
      }).then((res) => { if (res.ok) globalMutate(`/api/databases/${databaseId}`); });
    },
    [_view, databaseId]
  );

  const handleResizeMouseDown = useCallback(
    (propId: string, propType: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startWidth = getColWidth(propId, propType, widths);
      resizeState.current = { propId, propType, startX: e.clientX, startWidth, currentWidth: startWidth };

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: MouseEvent) => {
        if (!resizeState.current) return;
        const delta = ev.clientX - resizeState.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, resizeState.current.startWidth + delta));
        resizeState.current.currentWidth = newWidth;
        setWidths((prev) => ({ ...prev, [resizeState.current!.propId]: newWidth }));
      };

      const onUp = () => {
        if (!resizeState.current) return;
        const { propId: pid, currentWidth: cw } = resizeState.current;
        resizeState.current = null;

        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        setWidths((prev) => {
          const newWidths = { ...prev, [pid]: cw };
          persistWidths(newWidths);
          return newWidths;
        });

        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [widths, persistWidths]
  );

  const handleResizeDblClick = useCallback(
    (propId: string, propType: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setWidths((prev) => {
        const newWidths = { ...prev };
        delete newWidths[propId];
        persistWidths(newWidths);
        return newWidths;
      });
    },
    [persistWidths]
  );

  const totalWidth = useMemo(
    () => sorted.reduce((sum, p) => sum + getColWidth(p.id, p.type, widths), FIXED_COLS_WIDTH),
    [sorted, widths]
  );

  // ── Other state ─────────────────────────────────────────────────────────────

  const headerRefs = useRef<Map<string, HTMLTableCellElement | null>>(new Map());
  const [openPopoverId, setOpenPopoverId] = useState<string | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const pendingIds = useRef<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const getHeaderRef = useCallback((propId: string): React.RefObject<HTMLElement | null> => {
    return {
      get current() { return headerRefs.current.get(propId) ?? null; },
    } as React.RefObject<HTMLElement | null>;
  }, []);

  // ── Cell save ─────────────────────────────────────────────────────────────

  const handleSave = useCallback(
    (record: ParsedRecord, property: ParsedDatabaseProperty, value: PropertyValue | null) => {
      if (!records) return;
      if (pendingIds.current.has(record.id)) return;

      const snapshot = records;
      const isTitle = property.type === "title";

      const optimistic = records.map((r) => {
        if (r.id !== record.id) return r;
        if (isTitle) return { ...r, title: (value as string) ?? "" };
        const props = { ...r.properties };
        if (value === null) { delete props[property.id]; }
        else { props[property.id] = value; }
        return { ...r, properties: props };
      });

      mutate(optimistic, { revalidate: false });

      const body = isTitle
        ? { title: value ?? "" }
        : { properties: { [property.id]: value } };

      fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          mutate();
        })
        .catch(() => {
          mutate(snapshot, { revalidate: false });
          console.error("Échec de la sauvegarde du record", record.id);
        });
    },
    [records, mutate]
  );

  // ── Add row ────────────────────────────────────────────────────────────────

  const handleAddRecord = useCallback(async () => {
    const tempId = crypto.randomUUID();
    const now = new Date();
    const lastPos = (records ?? []).reduce((max, r) => Math.max(max, r.position), 0);

    const tempRecord: ParsedRecord = {
      id: tempId,
      databaseId,
      title: "",
      icon: null,
      coverUrl: null,
      content: "[]",
      templateId: null,
      sectionsBody: null,
      sprintId: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      position: lastPos + 1000,
      properties: {},
    };

    pendingIds.current.add(tempId);
    mutate((prev) => [...(prev ?? []), tempRecord], { revalidate: false });

    try {
      const res = await fetch(`/api/databases/${databaseId}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: ParsedRecord = await res.json();

      pendingIds.current.delete(tempId);
      mutate(
        (prev) => (prev ?? []).map((r) => r.id === tempId ? created : r),
        { revalidate: false }
      );
      mutate();
      setSelectedRecordId(created.id);
    } catch (err) {
      pendingIds.current.delete(tempId);
      mutate((prev) => (prev ?? []).filter((r) => r.id !== tempId), { revalidate: false });
      console.error("Échec de la création du record", err);
    }
  }, [databaseId, records, mutate]);

  // ── Delete row ────────────────────────────────────────────────────────────

  const handleDeleteRecord = useCallback(
    async (record: ParsedRecord) => {
      if (!records) return;
      if (!window.confirm(`Supprimer cet enregistrement ?`)) return;
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

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !records) return;

      const oldIndex = sortedRecords.findIndex((r) => r.id === active.id);
      const newIndex = sortedRecords.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortedRecords, oldIndex, newIndex);
      const prev = reordered[newIndex - 1];
      const next = reordered[newIndex + 1];

      let newPosition: number;
      if (!prev && !next) newPosition = 1000;
      else if (!prev) newPosition = next.position / 2;
      else if (!next) newPosition = prev.position + 1000;
      else newPosition = (prev.position + next.position) / 2;

      const movedId = active.id as string;
      const snapshot = records;

      mutate(
        records.map((r) => r.id === movedId ? { ...r, position: newPosition } : r),
        { revalidate: false }
      );

      fetch(`/api/records/${movedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: newPosition }),
      })
        .then((res) => { if (!res.ok) throw new Error(); mutate(); })
        .catch(() => { mutate(snapshot, { revalidate: false }); });
    },
    [records, sortedRecords, mutate]
  );

  // ── Property handlers ─────────────────────────────────────────────────────

  const handlePropertyCreated = useCallback((prop: ParsedDatabaseProperty) => {
    setProperties((prev) => [...prev, prop]);
    setShowAddProperty(false);
    globalMutate(`/api/databases/${databaseId}`);
  }, [databaseId]);

  const handlePropertyUpdated = useCallback((updated: ParsedDatabaseProperty) => {
    setProperties((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    globalMutate(`/api/databases/${databaseId}`);
  }, [databaseId]);

  const handlePropertyDeleted = useCallback((propId: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== propId));
    globalMutate(`/api/databases/${databaseId}`);
  }, [databaseId]);

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) return <TableSkeleton cols={sorted.length} />;

  if (error || !records) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-red-500">
        Impossible de charger les enregistrements.
      </div>
    );
  }

  const activeRecord = activeId ? sortedRecords.find((r) => r.id === activeId) ?? null : null;
  const selectedRecord = selectedRecordId
    ? (records.find((r) => r.id === selectedRecordId) ?? null)
    : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto">
          <table
            className="text-sm border-collapse"
            style={{ tableLayout: "fixed", width: totalWidth }}
          >
            <thead>
              <tr className="border-b border-[var(--border)]">
                {/* Row number — fixed, not resizable */}
                <th
                  className="px-2 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide select-none"
                  style={{ width: 56, minWidth: 56 }}
                >
                  #
                </th>

                {sorted.map((p) => {
                  const w = getColWidth(p.id, p.type, widths);
                  return (
                    <th
                      key={p.id}
                      ref={(el) => { headerRefs.current.set(p.id, el); }}
                      style={{ width: w, minWidth: w }}
                      className={[
                        "relative px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide overflow-hidden",
                        p.type !== "title" ? "cursor-pointer hover:bg-[var(--surface-hover)]" : "",
                      ].join(" ")}
                      onClick={() => {
                        if (p.type === "title") return;
                        setOpenPopoverId((prev) => (prev === p.id ? null : p.id));
                      }}
                    >
                      <span className="truncate block pr-3">{p.name}</span>
                      <ResizeHandle
                        onMouseDown={(e) => handleResizeMouseDown(p.id, p.type, e)}
                        onDoubleClick={(e) => handleResizeDblClick(p.id, p.type, e)}
                      />
                    </th>
                  );
                })}

                {/* Add property — fixed, not resizable */}
                <th className="px-2 py-2" style={{ width: 40, minWidth: 40 }}>
                  <button
                    onClick={() => setShowAddProperty(true)}
                    className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                    title="Ajouter une propriété"
                  >
                    <Plus size={14} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.length === 0 ? (
                <tr>
                  <td
                    colSpan={sorted.length + 2}
                    className="px-3 py-8 text-center text-sm text-[var(--text-muted)]"
                  >
                    Aucun enregistrement. Cliquez sur + Nouveau pour commencer.
                  </td>
                </tr>
              ) : (
                <SortableContext
                  items={sortedRecords.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {sortedRecords.map((record, index) => (
                    <SortableRow
                      key={record.id}
                      record={record}
                      index={index}
                      sorted={sorted}
                      colWidths={widths}
                      onSave={(property, value) => handleSave(record, property, value)}
                      onDelete={() => handleDeleteRecord(record)}
                      onTitleClick={() => setSelectedRecordId(record.id)}
                    />
                  ))}
                </SortableContext>
              )}
              <tr>
                <td colSpan={sorted.length + 2} className="px-3 py-1.5">
                  <button
                    onClick={handleAddRecord}
                    className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    <Plus size={13} />
                    Nouveau
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <DragOverlay>
          {activeRecord ? <DragRow record={activeRecord} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Property popover */}
      {openPopoverId && (() => {
        const prop = properties.find((p) => p.id === openPopoverId);
        if (!prop) return null;
        return (
          <PropertyPopover
            anchor={getHeaderRef(openPopoverId)}
            property={prop}
            onPropertyUpdated={handlePropertyUpdated}
            onPropertyDeleted={handlePropertyDeleted}
            onClose={() => setOpenPopoverId(null)}
          />
        );
      })()}

      {/* Add property modal */}
      {showAddProperty && (
        <AddPropertyModal
          databaseId={databaseId}
          onCreated={handlePropertyCreated}
          onClose={() => setShowAddProperty(false)}
        />
      )}

      {/* Record panel */}
      {selectedRecord && (
        <RecordPanel
          key={selectedRecord.id}
          record={selectedRecord}
          properties={properties}
          databaseId={databaseId}
          onClose={() => setSelectedRecordId(null)}
        />
      )}
    </>
  );
}
