"use client";
import { useState, useMemo, useRef, useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ParsedDatabaseProperty, ParsedRecord, ParsedView, SelectOption } from "@/lib/db";
import { applyViewConfig } from "@/lib/client/viewFilters";
import { colorClass } from "@/components/databases/Cell";
import RecordPanel from "@/components/databases/RecordPanel";
import { useRecordDeepLink } from "@/lib/client/useRecordDeepLink";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_HEADERS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAX_PILLS = 3;

const MONTH_FMT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

/** "2026-04-17" from a date value stored in a record property (avoid TZ issues). */
function extractDateKey(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

/** "2026-04-17" from a local Date object. */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

/** Build an array of Date objects covering the visible calendar grid for year/month.
 *  Week starts on Monday. Grid is always a multiple of 7 (5 or 6 rows). */
function buildCalendarGrid(year: number, month: number): Array<{ date: Date; isCurrentMonth: boolean }> {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Mon=0 … Sun=6
  const startDow = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(year, month, 1 - startDow + i);
    return { date: d, isCurrentMonth: d.getMonth() === month && d.getFullYear() === year };
  });
}

/** Return Tailwind classes for a pill based on the record's first filled select property. */
function pillColorClass(record: ParsedRecord, properties: ParsedDatabaseProperty[]): string {
  for (const prop of properties) {
    if (prop.type !== "select") continue;
    const optId = record.properties[prop.id] as string | undefined;
    if (!optId) continue;
    const opts = (prop.config as { options?: SelectOption[] }).options ?? [];
    const opt = opts.find((o) => o.id === optId);
    if (opt) return colorClass(opt.color);
  }
  return "bg-[var(--surface)] text-[var(--text)]";
}

// ─── DatePropertySelector ─────────────────────────────────────────────────────

function DatePropertySelector({
  view,
  databaseId,
  dateProps,
}: {
  view: ParsedView;
  databaseId: string;
  dateProps: ParsedDatabaseProperty[];
}) {
  const [saving, setSaving] = useState(false);

  if (dateProps.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Ajoutez une propriété de type Date pour utiliser la vue calendrier.
      </div>
    );
  }

  const handleSelect = async (propId: string) => {
    setSaving(true);
    try {
      await fetch(`/api/views/${view.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...view.config, calendarPropertyId: propId } }),
      });
      globalMutate(`/api/databases/${databaseId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3">
      <p className="text-sm text-[var(--text-muted)]">
        Choisir la propriété date à utiliser pour le calendrier
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {dateProps.map((p) => (
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
    </div>
  );
}

// ─── RecordPill ───────────────────────────────────────────────────────────────

function RecordPill({
  record,
  properties,
  onClick,
}: {
  record: ParsedRecord;
  properties: ParsedDatabaseProperty[];
  onClick: (r: ParsedRecord) => void;
}) {
  const cls = pillColorClass(record, properties);
  const title = record.title || "Sans titre";
  const display = title.length > 22 ? title.slice(0, 22) + "…" : title;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(record); }}
      className={`w-full text-left text-xs rounded px-1.5 py-0.5 truncate leading-5 ${cls} hover:opacity-80 transition-opacity`}
      title={title}
    >
      {display}
    </button>
  );
}

// ─── CalendarCell ─────────────────────────────────────────────────────────────

function CalendarCell({
  date,
  isCurrentMonth,
  isToday,
  dayRecords,
  properties,
  onRecordClick,
  onCellClick,
  readOnly,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  dayRecords: ParsedRecord[];
  properties: ParsedDatabaseProperty[];
  onRecordClick: (r: ParsedRecord) => void;
  onCellClick: (d: Date) => void;
  readOnly: boolean;
}) {
  const visible = dayRecords.slice(0, MAX_PILLS);
  const overflow = dayRecords.length - MAX_PILLS;

  return (
    <div
      onClick={readOnly ? undefined : () => onCellClick(date)}
      className={[
        "min-h-[100px] border border-[var(--border)] p-1 flex flex-col gap-0.5 select-none",
        readOnly ? "" : "cursor-pointer hover:bg-[var(--surface-hover)] transition-colors",
        isToday ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" : "",
      ].join(" ")}
    >
      {/* Day number */}
      <span
        className={[
          "text-xs font-medium self-start leading-5 w-6 h-6 flex items-center justify-center rounded-full",
          isToday
            ? "bg-[var(--accent)] text-white"
            : isCurrentMonth
            ? "text-[var(--text)]"
            : "text-[var(--text-muted)]",
        ].join(" ")}
      >
        {date.getDate()}
      </span>

      {/* Record pills */}
      {visible.map((r) => (
        <RecordPill key={r.id} record={r} properties={properties} onClick={onRecordClick} />
      ))}

      {overflow > 0 && (
        <span className="text-[10px] text-[var(--text-muted)] px-1 leading-4">
          +{overflow} autre{overflow > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// ─── CalendarView (main) ──────────────────────────────────────────────────────

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
  readOnly?: boolean;
  workspaceId?: string;
};

export default function CalendarView({ databaseId, view, properties, readOnly = false, workspaceId }: Props) {
  const { data: records, isLoading, error, mutate } = useSWR<ParsedRecord[]>(
    `/api/databases/${databaseId}/records`,
    fetcher
  );

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedRecordId, setSelectedRecordId] = useRecordDeepLink(records);

  const pendingIds = useRef<Set<string>>(new Set());

  // ── Date property resolution ─────────────────────────────────────────────────

  const dateProps = useMemo(() => properties.filter((p) => p.type === "date"), [properties]);
  const calendarPropId = view.config.calendarPropertyId;
  const calendarProp = calendarPropId ? properties.find((p) => p.id === calendarPropId) : undefined;

  // ── Month navigation ─────────────────────────────────────────────────────────

  const prevMonth = useCallback(() => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }, [month]);

  const goToToday = useCallback(() => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }, [today]);

  // ── Calendar grid & records grouping ─────────────────────────────────────────

  const calendarDays = useMemo(() => buildCalendarGrid(year, month), [year, month]);

  const displayedRecords = useMemo(() => {
    if (!records) return [];
    return applyViewConfig(records, view.config, properties);
  }, [records, view.config, properties]);

  const recordsByDay = useMemo(() => {
    const map = new Map<string, ParsedRecord[]>();
    if (!calendarPropId) return map;
    for (const r of displayedRecords) {
      const key = extractDateKey(r.properties[calendarPropId]);
      if (!key) continue;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return map;
  }, [displayedRecords, calendarPropId]);

  // ── Record click → panel ─────────────────────────────────────────────────────

  const handleRecordClick = useCallback((record: ParsedRecord) => {
    setSelectedRecordId(record.id);
  }, []);

  // ── Cell click → create record ───────────────────────────────────────────────

  const handleCellClick = useCallback(
    async (date: Date) => {
      if (readOnly || !calendarPropId) return;
      const dateStr = toLocalDateKey(date);
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
        trashedAt: null,
        sprintId: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        position: lastPos + 1000,
        properties: { [calendarPropId]: dateStr },
      };

      pendingIds.current.add(tempId);
      mutate((prev) => [...(prev ?? []), tempRecord], { revalidate: false });

      try {
        const res = await fetch(`/api/databases/${databaseId}/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: { [calendarPropId]: dateStr } }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created: ParsedRecord = await res.json();

        pendingIds.current.delete(tempId);
        mutate((prev) => (prev ?? []).map((r) => (r.id === tempId ? created : r)), { revalidate: false });
        mutate();
        setSelectedRecordId(created.id);
      } catch (err) {
        pendingIds.current.delete(tempId);
        mutate((prev) => (prev ?? []).filter((r) => r.id !== tempId), { revalidate: false });
        console.error("Échec de la création du record calendrier", err);
      }
    },
    [readOnly, calendarPropId, databaseId, records, mutate]
  );

  // ── States ────────────────────────────────────────────────────────────────────

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

  if (!calendarProp) {
    // Le sélecteur PATCHe le config partagé de la vue → message statique en RO.
    if (readOnly) {
      return (
        <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
          Vue calendrier non configurée.
        </div>
      );
    }
    return (
      <DatePropertySelector view={view} databaseId={databaseId} dateProps={dateProps} />
    );
  }

  const todayKey = toLocalDateKey(today);
  const selectedRecord = selectedRecordId
    ? records.find((r) => r.id === selectedRecordId) ?? null
    : null;

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Month navigation header */}
        <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-[var(--border)]">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            title="Mois précédent"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="text-sm font-semibold text-[var(--text)] capitalize min-w-[140px] text-center">
            {MONTH_FMT.format(new Date(year, month))}
          </span>

          <button
            onClick={nextMonth}
            className="p-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            title="Mois suivant"
          >
            <ChevronRight size={16} />
          </button>

          <button
            onClick={goToToday}
            className="ml-2 px-2.5 py-1 text-xs rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            Aujourd'hui
          </button>
        </div>

        {/* Calendar grid */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[560px]">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-[var(--border)]">
              {DAY_HEADERS.map((d) => (
                <div
                  key={d}
                  className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide text-center border-r border-[var(--border)] last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7">
              {calendarDays.map(({ date, isCurrentMonth }) => {
                const key = toLocalDateKey(date);
                const dayRecords = recordsByDay.get(key) ?? [];
                const isToday = key === todayKey;
                return (
                  <CalendarCell
                    key={key}
                    date={date}
                    isCurrentMonth={isCurrentMonth}
                    isToday={isToday}
                    dayRecords={dayRecords}
                    properties={properties}
                    onRecordClick={handleRecordClick}
                    onCellClick={handleCellClick}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedRecord && (
        <RecordPanel
          key={selectedRecord.id}
          record={selectedRecord}
          properties={properties}
          databaseId={databaseId}
          workspaceId={workspaceId}
          onClose={() => setSelectedRecordId(null)}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
