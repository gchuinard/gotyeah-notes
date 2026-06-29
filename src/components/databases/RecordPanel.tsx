"use client";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  X, Type, Hash, ChevronDown, List, Calendar, CheckSquare, Link, Mail,
  LayoutTemplate,
} from "lucide-react";
import { useCreateBlockNote } from "@blocknote/react";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { ParsedDatabaseProperty, ParsedRecord, PropertyValue, RecordSection } from "@/lib/db";
import Cell from "@/components/databases/Cell";
import { useThemeMode } from "@/lib/client/useThemeMode";
import { useWorkspace } from "@/contexts/WorkspaceContext";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type TemplateLite = {
  id: string;
  name: string;
  builtin: boolean;
  sections: { id: string; label: string }[];
};

function parseSections(raw: string | null): RecordSection[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RecordSection[]) : null;
  } catch {
    return null;
  }
}

// ─── Éditeur d'une section (corps sectionné) ──────────────────────────────────
// Le libellé est rendu HORS éditeur → non modifiable.

function SectionEditor({
  section,
  themeMode,
  onChange,
}: {
  section: RecordSection;
  themeMode: "light" | "dark";
  onChange: (content: unknown[]) => void;
}) {
  const initial =
    Array.isArray(section.content) && section.content.length > 0 ? section.content : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ initialContent: initial as any, dictionary: fr });
  return (
    <div className="mb-3">
      <h3 className="px-3 text-sm font-semibold text-[var(--text)] select-none">
        {section.label}
      </h3>
      <BlockNoteView
        editor={editor}
        theme={themeMode}
        onChange={() => onChange(editor.document)}
      />
    </div>
  );
}

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
  const themeMode = useThemeMode();
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;

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

  // ── Corps sectionné (templates) ──────────────────────────────────────────────
  const [sections, setSections] = useState<RecordSection[]>(() => parseSections(record.sectionsBody) ?? []);
  const [bodyVersion, setBodyVersion] = useState(0); // force le remount des éditeurs
  useEffect(() => {
    setSections(parseSections(record.sectionsBody) ?? []);
    setBodyVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id]);

  const sectionsRef = useRef<RecordSection[]>(sections);
  sectionsRef.current = sections;
  const sectionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sectionsSaveTimer.current) clearTimeout(sectionsSaveTimer.current); }, []);

  const scheduleSectionsSave = () => {
    if (sectionsSaveTimer.current) clearTimeout(sectionsSaveTimer.current);
    sectionsSaveTimer.current = setTimeout(() => {
      fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionsBody: sectionsRef.current }),
      });
    }, 600);
  };

  const onSectionChange = (id: string, content: unknown[]) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, content } : s)));
    scheduleSectionsSave();
  };

  // ── Menu de template (par carte) ─────────────────────────────────────────────
  const [tplMenuOpen, setTplMenuOpen] = useState(false);
  const { data: templates = [] } = useSWR<TemplateLite[]>(
    tplMenuOpen && wsId ? `/api/templates?workspaceId=${wsId}` : null,
    fetcher
  );

  const applyTemplate = async (tpl: TemplateLite | null) => {
    setTplMenuOpen(false);
    if (!tpl) {
      setSections([]);
      setBodyVersion((v) => v + 1);
      await fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionsBody: null, templateId: null }),
      });
      globalMutate(recordsKey);
      return;
    }
    // Nouvelles sections : on préserve le contenu par id ; les anciennes sections
    // non vides absentes du nouveau template sont conservées (ajoutées à la fin).
    const prev = sectionsRef.current;
    const byId = new Map(prev.map((s) => [s.id, s]));
    const used = new Set<string>();
    const next: RecordSection[] = tpl.sections.map((ts) => {
      used.add(ts.id);
      const old = byId.get(ts.id);
      return { id: ts.id, label: ts.label, content: old?.content ?? [] };
    });
    for (const s of prev) {
      if (!used.has(s.id) && Array.isArray(s.content) && s.content.length > 0) next.push(s);
    }
    setSections(next);
    setBodyVersion((v) => v + 1);
    await fetch(`/api/records/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionsBody: next, templateId: tpl.id }),
    });
    globalMutate(recordsKey);
  };

  // ── Éditeur de corps LIBRE (utilisé hors mode sectionné) ─────────────────────
  let parsedContent: unknown = undefined;
  try {
    const arr = JSON.parse(record.content);
    if (Array.isArray(arr) && arr.length > 0) parsedContent = arr;
  } catch {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ initialContent: parsedContent as any, dictionary: fr });
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current); }, []);
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

  const isSectioned = sections.length > 0;

  // ── Visible properties (non-title, sorted) ───────────────────────────────────
  const visibleProps = properties
    .filter((p) => p.type !== "title")
    .sort((a, b) => a.position - b.position);

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

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
          <div className="flex items-center gap-1 shrink-0">
            <div className="relative">
              <button
                onClick={() => setTplMenuOpen((o) => !o)}
                title="Modèle de cette carte"
                className="flex items-center gap-1 px-2 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded transition-colors"
              >
                <LayoutTemplate size={15} />
                <ChevronDown size={13} />
              </button>
              {tplMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setTplMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-[61] w-60 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1 text-sm max-h-80 overflow-y-auto">
                    <div className="px-3 py-1 text-xs text-[var(--text-muted)] uppercase tracking-wide">Appliquer un modèle</div>
                    {templates.map((tpl) => (
                      <button
                        key={tpl.id}
                        onClick={() => applyTemplate(tpl)}
                        className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text)]"
                      >
                        {tpl.name}
                        {tpl.builtin && (
                          <span className="ml-1 text-xs text-[var(--text-muted)]">(fourni)</span>
                        )}
                      </button>
                    ))}
                    <div className="border-t border-[var(--border)] my-1" />
                    <button
                      onClick={() => applyTemplate(null)}
                      className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
                    >
                      Corps libre (sans modèle)
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Properties */}
        {visibleProps.length > 0 && (
          <div className="px-6 py-1 shrink-0">
            {visibleProps.map((property) => (
              <div key={property.id} className="flex items-center gap-3 py-1.5 min-h-[36px]">
                <div className="flex items-center gap-2 w-44 shrink-0 text-sm text-[var(--text-muted)]">
                  <span className="shrink-0">{PROP_ICONS[property.type] ?? <Type size={14} />}</span>
                  <span className="truncate">{property.name}</span>
                </div>
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

        <div className="border-t border-[var(--border)] mx-6 my-3 shrink-0" />

        {/* Corps : sectionné (libellés fixes) ou libre */}
        <div className="flex-1 px-2 min-h-[200px]">
          {isSectioned ? (
            sections.map((section) => (
              <SectionEditor
                key={`${section.id}-${bodyVersion}`}
                section={section}
                themeMode={themeMode}
                onChange={(content) => onSectionChange(section.id, content)}
              />
            ))
          ) : (
            <BlockNoteView
              editor={editor}
              theme={themeMode}
              onChange={() => scheduleContentSave(JSON.stringify(editor.document))}
            />
          )}
        </div>
      </div>
    </>
  );
}
