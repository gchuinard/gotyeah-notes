"use client";
import { useEffect, useRef, useState } from "react";
import {
  X, Type, Hash, ChevronDown, List, Calendar, CheckSquare, Link, Mail,
} from "lucide-react";
import { useCreateBlockNote } from "@blocknote/react";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { mutate as globalMutate } from "swr";
import type { ParsedDatabaseProperty, ParsedRecord, PropertyValue } from "@/lib/db";
import Cell from "@/components/databases/Cell";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROP_ICONS: Record<string, React.ReactNode> = {
  text:        <Type size={14} />,
  number:      <Hash size={14} />,
  select:      <ChevronDown size={14} />,
  multiselect: <List size={14} />,
  date:        <Calendar size={14} />,
  checkbox:    <CheckSquare size={14} />,
  url:         <Link size={14} />,
  email:       <Mail size={14} />,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  record: ParsedRecord;
  properties: ParsedDatabaseProperty[];
  databaseId: string;
  onClose: () => void;
};

// ─── RecordPanel ──────────────────────────────────────────────────────────────

export default function RecordPanel({ record, properties, databaseId, onClose }: Props) {
  const recordsKey = `/api/databases/${databaseId}/records`;

  // ── Slide-in animation ───────────────────────────────────────────────────────
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Close on Esc ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Title editing ─────────────────────────────────────────────────────────────
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(record.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Sync title when parent SWR updates (only if not mid-edit)
  useEffect(() => {
    if (!isEditingTitle) setTitleValue(record.title);
  }, [record.title, isEditingTitle]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const saveTitle = () => {
    setIsEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed === record.title) return;
    // Optimistic update
    globalMutate(
      recordsKey,
      (prev: ParsedRecord[] | undefined) =>
        prev?.map((r) => r.id === record.id ? { ...r, title: trimmed } : r),
      { revalidate: false }
    );
    fetch(`/api/records/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    }).then((res) => { if (res.ok) globalMutate(recordsKey); });
  };

  // ── Property save ─────────────────────────────────────────────────────────────
  const saveProperty = (property: ParsedDatabaseProperty, value: PropertyValue | null) => {
    globalMutate(
      recordsKey,
      (prev: ParsedRecord[] | undefined) =>
        prev?.map((r) => {
          if (r.id !== record.id) return r;
          const props = { ...r.properties };
          if (value === null) delete props[property.id];
          else props[property.id] = value;
          return { ...r, properties: props };
        }),
      { revalidate: false }
    );
    fetch(`/api/records/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: { [property.id]: value } }),
    }).then((res) => { if (res.ok) globalMutate(recordsKey); });
  };

  // ── Content save (BlockNote, 500ms debounce) ──────────────────────────────────
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
  }, []);

  const scheduleContentSave = (content: string) => {
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current);
    contentSaveTimer.current = setTimeout(() => {
      fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    }, 500);
  };

  // ── BlockNote editor (same pattern as Editor.tsx) ────────────────────────────
  let parsedContent: unknown = undefined;
  try {
    const arr = JSON.parse(record.content);
    if (Array.isArray(arr) && arr.length > 0) parsedContent = arr;
  } catch {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ initialContent: parsedContent as any, dictionary: fr });

  // ── Visible properties (non-title, sorted) ───────────────────────────────────
  const visibleProps = properties
    .filter((p) => p.type !== "title")
    .sort((a, b) => a.position - b.position);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay — click to close */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        className={[
          "fixed right-0 top-0 bottom-0 w-[600px] max-w-full z-50",
          "bg-[var(--bg)] shadow-2xl overflow-y-auto flex flex-col",
          "transition-transform duration-200",
          visible ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-2 shrink-0">
          <div className="flex-1 min-w-0 mr-3">
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditingTitle(false);
                    setTitleValue(record.title);
                  }
                }}
                className="w-full text-2xl font-bold bg-transparent outline-none border-b-2 border-[var(--accent)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
                placeholder="Sans titre"
              />
            ) : (
              <h2
                onClick={() => setIsEditingTitle(true)}
                className="text-2xl font-bold text-[var(--text)] cursor-text hover:opacity-70 transition-opacity"
              >
                {record.title || (
                  <span className="text-[var(--text-muted)] font-normal">Sans titre</span>
                )}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Properties */}
        {visibleProps.length > 0 && (
          <div className="px-6 py-1 shrink-0">
            {visibleProps.map((property) => (
              <div key={property.id} className="flex items-center gap-3 py-1.5 min-h-[36px]">
                {/* Label */}
                <div className="flex items-center gap-2 w-44 shrink-0 text-sm text-[var(--text-muted)]">
                  <span className="shrink-0">{PROP_ICONS[property.type] ?? <Type size={14} />}</span>
                  <span className="truncate">{property.name}</span>
                </div>
                {/* Value — reuse Cell component */}
                <div className="flex-1 min-w-0 text-sm">
                  <Cell
                    property={property}
                    record={record}
                    onSave={(value) => saveProperty(property, value)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-[var(--border)] mx-6 my-3 shrink-0" />

        {/* BlockNote content */}
        <div className="flex-1 px-2 min-h-[200px]">
          <BlockNoteView
            editor={editor}
            onChange={() => scheduleContentSave(JSON.stringify(editor.document))}
          />
        </div>
      </div>
    </>
  );
}
