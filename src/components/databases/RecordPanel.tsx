"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import {
  X, Type, Hash, ChevronDown, List, Calendar, CheckSquare, Link, Mail, Users,
  LayoutTemplate, History,
} from "lucide-react";
import { useCreateBlockNote } from "@blocknote/react";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import type { ParsedDatabaseProperty, ParsedRecord, PropertyValue, RecordSection } from "@/lib/db";
import Cell, { CellDisplay } from "@/components/databases/Cell";
import { useThemeMode } from "@/lib/client/useThemeMode";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { createDebouncedSaver, type DebouncedSaver } from "@/lib/client/debouncedSaver";
import { uploadFile } from "@/lib/client/upload";
import { pageLinkSchema, PageLinkMenu } from "@/lib/client/blocknoteSchema";

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
  user:        <Users size={14} />,
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
  workspaceId,
  onChange,
  readOnly,
}: {
  section: RecordSection;
  themeMode: "light" | "dark";
  workspaceId: string | null;
  onChange: (content: unknown[]) => void;
  readOnly: boolean;
}) {
  const initial =
    Array.isArray(section.content) && section.content.length > 0 ? section.content : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ schema: pageLinkSchema, initialContent: initial as any, dictionary: fr, uploadFile });
  return (
    <div className="mb-3">
      <h3 className="px-3 text-sm font-semibold text-[var(--text)] select-none">
        {section.label}
      </h3>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme={themeMode}
        onChange={() => onChange(editor.document)}
      >
        <PageLinkMenu editor={editor} workspaceId={workspaceId} />
      </BlockNoteView>
    </div>
  );
}

// ─── Onglet Historique (piste d'audit qui/quoi/quand) ─────────────────────────

type RevisionEntry = {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Rendu court d'une valeur scalaire (title/property) pour l'aperçu before → after. */
function renderScalar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "vide";
  return String(v);
}

function RevisionHistory({
  recordId,
  properties,
}: {
  recordId: string;
  properties: ParsedDatabaseProperty[];
}) {
  const { data: revisions, isLoading } = useSWR<RevisionEntry[]>(
    `/api/records/${recordId}/revisions`,
    fetcher
  );

  const fieldLabel = (field: string): string => {
    if (field === "title") return "Titre";
    if (field === "content") return "Contenu";
    if (field === "sectionsBody") return "Corps";
    const prop = properties.find((p) => p.id === field);
    return prop ? prop.name : "Section";
  };

  // Les champs de corps (BlockNote) n'ont pas d'aperçu lisible → mention générique.
  const isBodyField = (field: string): boolean =>
    field === "content" ||
    field === "sectionsBody" ||
    (field !== "title" && !properties.some((p) => p.id === field));

  if (isLoading) {
    return <p className="px-6 py-4 text-sm text-[var(--text-muted)]">Chargement…</p>;
  }
  if (!revisions || revisions.length === 0) {
    return (
      <p className="px-6 py-4 text-sm text-[var(--text-muted)]">
        Aucune modification enregistrée pour l’instant.
      </p>
    );
  }

  return (
    <ul className="px-6 py-3 flex flex-col gap-3">
      {revisions.map((rev) => (
        <li key={rev.id} className="flex flex-col gap-0.5 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[var(--text)]">
              <span className="font-medium">{rev.actor?.displayName ?? "Utilisateur inconnu"}</span>
              {" a modifié "}
              <span className="font-medium">{fieldLabel(rev.field)}</span>
            </span>
            <time className="shrink-0 text-xs text-[var(--text-muted)]">
              {dateFmt.format(new Date(rev.createdAt))}
            </time>
          </div>
          {isBodyField(rev.field) ? (
            <span className="text-xs text-[var(--text-muted)]">Contenu mis à jour</span>
          ) : (
            <span className="text-xs text-[var(--text-muted)] truncate">
              {renderScalar(rev.before)} → {renderScalar(rev.after)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  record: ParsedRecord;
  properties: ParsedDatabaseProperty[];
  databaseId: string;
  /** Espace de la database — source des membres pour les propriétés « utilisateur ». */
  workspaceId?: string;
  onClose: () => void;
  readOnly?: boolean;
};

// ─── RecordPanel ──────────────────────────────────────────────────────────────

export default function RecordPanel({
  record,
  properties,
  databaseId,
  workspaceId,
  onClose,
  readOnly = false,
}: Props) {
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

  // ── Autosave debouncé, flushé à la fermeture / au démontage ───────────────────
  const contentSaverRef = useRef<DebouncedSaver<string> | null>(null);
  if (!contentSaverRef.current) {
    contentSaverRef.current = createDebouncedSaver<string>(500, (content) => {
      fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        keepalive: true,
      });
    });
  }
  const sectionsSaverRef = useRef<DebouncedSaver<RecordSection[]> | null>(null);
  if (!sectionsSaverRef.current) {
    sectionsSaverRef.current = createDebouncedSaver<RecordSection[]>(600, (body) => {
      fetch(`/api/records/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionsBody: body }),
        keepalive: true,
      });
    });
  }
  const flushSaves = () => {
    sectionsSaverRef.current?.flush();
    contentSaverRef.current?.flush();
  };
  const handleClose = () => {
    flushSaves();
    onClose();
  };
  // Flush des saisies en attente si le panneau se démonte par un chemin quelconque.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushSaves(), []);

  // ── Fermeture par Échap : uniquement hors champ/éditeur, après flush ─────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Un champ qui « consomme » Échap le preventDefault (ex. l'input titre, qui
      // sort de l'édition). React flushe l'événement discret de façon synchrone et
      // retire l'input AVANT ce handler (même nœud document → stopPropagation
      // insuffisant) : on se fie donc à defaultPrevented, robuste au retrait.
      if (e.defaultPrevented) return;
      // L'éditeur BlockNote (contentEditable) reste focus et gère lui-même Échap.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      flushSaves();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const onSectionChange = (id: string, content: unknown[]) => {
    // Ceinture + bretelles avec editable={!readOnly} : aucun PATCH en lecture seule.
    if (readOnly) return;
    const next = sectionsRef.current.map((s) => (s.id === id ? { ...s, content } : s));
    setSections(next);
    sectionsSaverRef.current?.schedule(next);
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
  const editor = useCreateBlockNote({ schema: pageLinkSchema, initialContent: parsedContent as any, dictionary: fr, uploadFile });

  const isSectioned = sections.length > 0;

  // ── Onglets : « Contenu » (défaut) / « Historique » ──────────────────────────
  // L'onglet contenu reste sélectionné à l'ouverture ET à chaque changement de carte.
  const [activeTab, setActiveTab] = useState<"content" | "history">("content");
  useEffect(() => {
    setActiveTab("content");
  }, [record.id]);

  // ── Visible properties (non-title, sorted) ───────────────────────────────────
  const visibleProps = properties
    .filter((p) => p.type !== "title")
    .sort((a, b) => a.position - b.position);

  // ─── Render ───────────────────────────────────────────────────────────────────

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 600;
    const saved = Number(window.localStorage.getItem("recordPanel:width"));
    return saved >= 380 ? saved : 600;
  });

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    let latest = panelWidth;
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(window.innerWidth, Math.max(380, window.innerWidth - ev.clientX));
      setPanelWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.localStorage.setItem("recordPanel:width", String(Math.round(latest)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />

      {visible && (
        <div
          onPointerDown={startResize}
          onDoubleClick={() => {
            setPanelWidth(600);
            window.localStorage.removeItem("recordPanel:width");
          }}
          style={{ right: panelWidth }}
          className="fixed top-0 bottom-0 w-1 z-[51] cursor-ew-resize hover:bg-[var(--accent)] transition-colors"
          title="Glisser pour redimensionner · double-clic pour réinitialiser"
        />
      )}

      <div
        style={{ width: panelWidth }}
        className={[
          "fixed right-0 top-0 bottom-0 max-w-full z-50",
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
                    e.stopPropagation();
                    setIsEditingTitle(false);
                    setTitleValue(record.title);
                  }
                }}
                className="w-full text-2xl font-bold bg-transparent outline-none border-b-2 border-[var(--accent)] text-[var(--text)] placeholder:text-[var(--text-muted)]"
                placeholder="Sans titre"
              />
            ) : (
              <h2
                onClick={readOnly ? undefined : () => setIsEditingTitle(true)}
                className={[
                  "text-2xl font-bold text-[var(--text)]",
                  readOnly ? "" : "cursor-text hover:opacity-70 transition-opacity",
                ].join(" ")}
              >
                {record.title || (
                  <span className="text-[var(--text-muted)] font-normal">Sans titre</span>
                )}
              </h2>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!readOnly && (
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
            )}
            <button
              onClick={handleClose}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] rounded transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Onglets : Contenu / Historique */}
        <div className="flex items-center gap-4 px-6 border-b border-[var(--border)] shrink-0">
          {([
            { key: "content", label: "Contenu", icon: null },
            { key: "history", label: "Historique", icon: <History size={14} /> },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                "flex items-center gap-1.5 py-2 -mb-px border-b-2 text-sm transition-colors",
                activeTab === tab.key
                  ? "border-[var(--accent)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
              ].join(" ")}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Onglet Contenu : properties + corps. Masqué (non démonté) hors onglet
            pour préserver l'instance BlockNote et son autosave debouncé. */}
        <div className={activeTab === "content" ? "flex flex-col flex-1 min-h-0" : "hidden"}>
          {/* Properties */}
          {visibleProps.length > 0 && (
            <div className="px-6 py-1 pt-3 shrink-0 grid grid-cols-[minmax(5.5rem,max-content)_minmax(0,1fr)] gap-x-3">
              {visibleProps.map((property) => (
                <Fragment key={property.id}>
                  <div className="flex items-center gap-2 max-w-[11rem] py-1.5 min-h-[36px] text-sm text-[var(--text-muted)]">
                    <span className="shrink-0">{PROP_ICONS[property.type] ?? <Type size={14} />}</span>
                    <span className="truncate">{property.name}</span>
                  </div>
                  <div className="flex items-center min-w-0 py-1.5 min-h-[36px] text-sm">
                    {readOnly ? (
                      <CellDisplay property={property} record={record} workspaceId={workspaceId} />
                    ) : (
                      <Cell
                        property={property}
                        record={record}
                        onSave={(value) => saveProperty(property, value)}
                        workspaceId={workspaceId}
                      />
                    )}
                  </div>
                </Fragment>
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
                  workspaceId={wsId}
                  onChange={(content) => onSectionChange(section.id, content)}
                  readOnly={readOnly}
                />
              ))
            ) : (
              <BlockNoteView
                editor={editor}
                editable={!readOnly}
                theme={themeMode}
                onChange={() => {
                  if (readOnly) return;
                  contentSaverRef.current?.schedule(JSON.stringify(editor.document));
                }}
              >
                <PageLinkMenu editor={editor} workspaceId={wsId} />
              </BlockNoteView>
            )}
          </div>
        </div>

        {/* Onglet Historique : monté à la demande → fetch paresseux des révisions. */}
        {activeTab === "history" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <RevisionHistory recordId={record.id} properties={properties} />
          </div>
        )}
      </div>
    </>
  );
}
