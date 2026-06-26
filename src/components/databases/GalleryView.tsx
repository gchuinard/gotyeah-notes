"use client";
import { useState, useMemo, useRef, useCallback } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import type { ParsedDatabaseProperty, ParsedRecord, ParsedView } from "@/lib/db";
import { applyViewConfig } from "@/lib/client/viewFilters";
import { CellDisplay } from "@/components/databases/Cell";
import RecordPanel from "@/components/databases/RecordPanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

function previewProperties(
  properties: ParsedDatabaseProperty[],
  visiblePropertyIds?: string[]
): ParsedDatabaseProperty[] {
  const nonTitle = properties.filter((p) => p.type !== "title");
  if (visiblePropertyIds && visiblePropertyIds.length > 0) {
    return visiblePropertyIds
      .map((id) => nonTitle.find((p) => p.id === id))
      .filter((p): p is ParsedDatabaseProperty => !!p)
      .slice(0, 3);
  }
  return [...nonTitle].sort((a, b) => a.position - b.position).slice(0, 3);
}

// ─── GalleryCard ──────────────────────────────────────────────────────────────

function GalleryCard({
  record,
  previewProps,
  onClick,
}: {
  record: ParsedRecord;
  previewProps: ParsedDatabaseProperty[];
  onClick: () => void;
}) {
  const filledProps = previewProps.filter((p) => {
    const v = record.properties[p.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  });

  return (
    <div
      onClick={onClick}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
    >
      {/* Cover */}
      {record.coverUrl ? (
        <img
          src={record.coverUrl}
          alt=""
          className="w-full h-36 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-20 bg-[var(--surface)]" />
      )}

      {/* Content */}
      <div className="p-3">
        <p className="text-sm font-semibold text-[var(--text)] truncate leading-5">
          {record.title || <span className="text-[var(--text-muted)] font-normal">Sans titre</span>}
        </p>

        {filledProps.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {filledProps.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs text-[var(--text-muted)] shrink-0 min-w-[60px] truncate">
                  {p.name}
                </span>
                <span className="text-xs min-w-0 truncate">
                  <CellDisplay property={p} record={record} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NewRecordCard ────────────────────────────────────────────────────────────

function NewRecordCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border-2 border-dashed border-[var(--border)] rounded-lg h-full min-h-[120px] flex flex-col items-center justify-center gap-2 text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
    >
      <Plus size={20} />
      <span className="text-sm">Nouveau</span>
    </button>
  );
}

// ─── GalleryView (main) ───────────────────────────────────────────────────────

type Props = {
  databaseId: string;
  view: ParsedView;
  properties: ParsedDatabaseProperty[];
};

export default function GalleryView({ databaseId, view, properties }: Props) {
  const { data: records, isLoading, error, mutate } = useSWR<ParsedRecord[]>(
    `/api/databases/${databaseId}/records`,
    fetcher
  );

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const pendingIds = useRef<Set<string>>(new Set());

  const previewProps = useMemo(
    () => previewProperties(properties, view.config.visiblePropertyIds),
    [properties, view.config.visiblePropertyIds]
  );

  const displayedRecords = useMemo(() => {
    if (!records) return [];
    const byPosition = [...records].sort((a, b) => a.position - b.position);
    return applyViewConfig(byPosition, view.config, properties);
  }, [records, view.config, properties]);

  // ── Add record (optimistic) ─────────────────────────────────────────────────

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
      mutate((prev) => (prev ?? []).map((r) => (r.id === tempId ? created : r)), { revalidate: false });
      mutate();
      setSelectedRecordId(created.id);
    } catch (err) {
      pendingIds.current.delete(tempId);
      mutate((prev) => (prev ?? []).filter((r) => r.id !== tempId), { revalidate: false });
      console.error("Échec de la création du record (gallery)", err);
    }
  }, [databaseId, records, mutate]);

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

  const selectedRecord = selectedRecordId
    ? records.find((r) => r.id === selectedRecordId) ?? null
    : null;

  return (
    <>
      <div className="p-4">
        {displayedRecords.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center py-6">
            Aucun enregistrement.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayedRecords.map((record) => (
            <GalleryCard
              key={record.id}
              record={record}
              previewProps={previewProps}
              onClick={() => setSelectedRecordId(record.id)}
            />
          ))}
          <NewRecordCard onClick={handleAddRecord} />
        </div>
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
    </>
  );
}
