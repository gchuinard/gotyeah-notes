"use client";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, Clock, FileText,
  Home, LayoutTemplate, Lock, LogOut, Plus, Settings, Trash2, Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { buildTree, FlatPage, TreeNode, toggleBranchCollapsed } from "@/lib/tree";
import { useDialog } from "@/contexts/DialogContext";
import WorkspaceSelector from "@/components/WorkspaceSelector";
import TrashSection from "@/components/TrashSection";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { SessionUser } from "@/lib/session";

type Section = { id: string; name: string; type: string; icon: string | null; position: number };
type RecentPage = { id: string; title: string; icon: string | null };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SIDEBAR_DEFAULT_WIDTH = 256; // = l'ancien w-64
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_WIDTH_KEY = "sidebar:width";

export default function Sidebar({ user }: { user: SessionUser }) {
  const { activeWorkspace, isViewer } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;

  const pagesKey = workspaceId ? `/api/pages?workspaceId=${workspaceId}` : null;
  const sectionsKey = workspaceId ? `/api/sections?workspaceId=${workspaceId}` : null;
  const recentKey = workspaceId ? `/api/pages/recent?workspaceId=${workspaceId}` : null;

  const { data: pages = [] } = useSWR<FlatPage[]>(pagesKey, fetcher);
  const { data: sections = [] } = useSWR<Section[]>(sectionsKey, fetcher);
  const { data: recent = [] } = useSWR<RecentPage[]>(recentKey, fetcher);

  const router = useRouter();
  const params = useParams<{ id?: string }>();

  const tree = buildTree(pages);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const createPage = async (parentId: string | null = null, sectionId: string | null = null) => {
    if (!workspaceId) return;
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId, workspaceId, sectionId }),
    });
    const page = await res.json();
    if (pagesKey) mutate(pagesKey);
    router.push(`/pages/${page.id}`);
  };

  // Crée une page puis la scaffold direct en database à partir d'un template
  // (colonnes + kanban + sections). Cf. POST /api/databases { templateId }.
  const [creatingDb, setCreatingDb] = useState(false);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);
  const { data: templates = [] } = useSWR<{ id: string; name: string; builtin: boolean }[]>(
    dbMenuOpen && workspaceId ? `/api/templates?workspaceId=${workspaceId}` : null,
    fetcher
  );
  const createDatabaseFromTemplate = async (templateId: string, name: string) => {
    if (!workspaceId || creatingDb) return;
    setDbMenuOpen(false);
    setCreatingDb(true);
    try {
      const sectionId =
        sections.find((s) => s.type === "private")?.id ??
        sections.find((s) => s.type === "team")?.id ??
        null;
      const pageRes = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, sectionId, title: name }),
      });
      if (!pageRes.ok) return;
      const page = await pageRes.json();
      await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: page.id, templateId }),
      });
      if (pagesKey) mutate(pagesKey);
      router.push(`/pages/${page.id}`);
    } finally {
      setCreatingDb(false);
    }
  };

  const handleDragEnd = (sectionId: string) => (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !pages.length) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activePage = pages.find((p) => p.id === activeId);
    const overPage = pages.find((p) => p.id === overId);
    if (!activePage || !overPage) return;
    if (activePage.parentId !== overPage.parentId) return;

    // Pour les pages racines : limiter les siblings à la même section
    // pour éviter d'utiliser les positions d'une autre section comme repères.
    const siblings = pages
      .filter((p) => {
        if (p.parentId !== activePage.parentId) return false;
        if (activePage.parentId === null) return p.sectionId === activePage.sectionId;
        return true;
      })
      .sort((a, b) => a.position - b.position);

    const activeIdx = siblings.findIndex((p) => p.id === activeId);
    const overIdx = siblings.findIndex((p) => p.id === overId);
    if (activeIdx === -1 || overIdx === -1) return;

    const reordered = [...siblings];
    reordered.splice(activeIdx, 1);
    reordered.splice(overIdx, 0, siblings[activeIdx]);

    const prev = reordered[overIdx - 1];
    const next = reordered[overIdx + 1];

    let newPosition: number;
    if (!prev && reordered.length >= 2) {
      newPosition = reordered[1].position - 1;
    } else if (!next && reordered.length >= 2) {
      newPosition = reordered[reordered.length - 2].position + 1;
    } else if (prev && next) {
      newPosition = (prev.position + next.position) / 2;
    } else {
      return; // garde-fou : situation impossible normalement
    }

    if (!Number.isFinite(newPosition)) return;

    const optimistic = pages.map((p) =>
      p.id === activeId ? { ...p, position: newPosition } : p
    );
    if (pagesKey) mutate(pagesKey, optimistic, { revalidate: false });

    fetch(`/api/pages/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: newPosition }),
    }).then(() => { if (pagesKey) mutate(pagesKey); });
  };

  const privateSection = sections.find((s) => s.type === "private");
  const teamSections = sections.filter((s) => s.type === "team");

  // ── Largeur redimensionnable (même pattern que RecordPanel) ────────────────
  // Lecture en effet et non en initializer : la sidebar est rendue au SSR,
  // lire localStorage au premier render provoquerait un mismatch d'hydratation.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) setSidebarWidth(saved);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    let latest = sidebarWidth;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      latest = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, ev.clientX));
      setSidebarWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = previousUserSelect;
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(latest)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <>
    <aside
      style={{ width: sidebarWidth }}
      className="bg-[var(--surface)] h-screen shrink-0 overflow-y-auto p-2 text-sm flex flex-col"
    >
      <WorkspaceSelector />

      {/* Navigation fixe */}
      <div className="flex flex-col gap-0.5 mb-2">
        <Link
          href="/"
          className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] ${
            !params?.id ? "bg-[var(--surface-active)]" : ""
          }`}
        >
          <Home size={14} />
          Accueil
        </Link>
        {!isViewer && (
        <div className="relative">
          <button
            onClick={() => setDbMenuOpen((o) => !o)}
            disabled={creatingDb || !workspaceId}
            title="Crée une database prête à l'emploi à partir d'un modèle"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] disabled:opacity-50 text-left"
          >
            <LayoutTemplate size={14} />
            <span className="flex-1">{creatingDb ? "Création…" : "Nouvelle database"}</span>
            <ChevronDown size={12} />
          </button>
          {dbMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDbMenuOpen(false)} />
              <div className="absolute left-1 right-1 top-full mt-0.5 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1 max-h-72 overflow-y-auto">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => createDatabaseFromTemplate(t.id, t.name)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text)]"
                  >
                    {t.name}
                    {t.builtin && <span className="ml-1 text-xs text-[var(--text-muted)]">(fourni)</span>}
                  </button>
                ))}
                <div className="border-t border-[var(--border)] my-1" />
                <Link
                  href="/templates"
                  onClick={() => setDbMenuOpen(false)}
                  className="block px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
                >
                  Gérer les modèles…
                </Link>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* Récents */}
      {recent.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            <Clock size={11} />
            Récents
          </div>
          {recent.map((page) => (
            <Link
              key={page.id}
              href={`/pages/${page.id}`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] truncate ${
                params?.id === page.id ? "bg-[var(--surface-active)]" : ""
              }`}
            >
              {page.icon ? (
                <span className="shrink-0 text-sm leading-none">{page.icon}</span>
              ) : (
                <FileText size={12} className="shrink-0" />
              )}
              <span className="truncate text-xs">{page.title || "Sans titre"}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        {/* Section privée */}
        {privateSection && (
          <SectionBlock
            key={privateSection.id}
            section={privateSection}
            icon={<Lock size={11} />}
            tree={tree.filter((n) => n.sectionId === privateSection.id)}
            pages={pages}
            pagesKey={pagesKey}
            params={params}
            onCreate={createPage}
            onDragEnd={handleDragEnd(privateSection.id)}
            readOnly={isViewer}
          />
        )}

        {/* Sections équipe */}
        {teamSections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            icon={<Users size={11} />}
            tree={tree.filter((n) => n.sectionId === section.id)}
            pages={pages}
            pagesKey={pagesKey}
            params={params}
            onCreate={createPage}
            onDragEnd={handleDragEnd(section.id)}
            readOnly={isViewer}
          />
        ))}
      </div>

      {/* Corbeille (pages/records supprimés, restaurables — purge auto 30 j) */}
      <TrashSection />

      <div className="mt-auto pt-2 border-t border-[var(--border)] flex flex-col gap-0.5">
        <div className="flex items-center gap-1 px-2 py-1">
          <span className="flex-1 text-xs text-[var(--text-muted)] truncate" title={user.email}>
            {user.displayName}
          </span>
          <Link
            href="/settings"
            className="p-1 hover:bg-[var(--surface-hover)] rounded"
            title="Paramètres"
          >
            <Settings size={13} className="text-[var(--text-muted)]" />
          </Link>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="p-1 hover:bg-[var(--surface-hover)] rounded"
            title="Se déconnecter"
          >
            <LogOut size={13} className="text-[var(--text-muted)]" />
          </button>
        </div>
      </div>
    </aside>

    <div
      onPointerDown={startResize}
      onDoubleClick={() => {
        setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
        window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      }}
      className="w-1 shrink-0 h-screen bg-[var(--border)] hover:bg-[var(--accent)] cursor-ew-resize transition-colors"
      title="Glisser pour redimensionner · double-clic pour réinitialiser"
    />
    </>
  );
}

// ─── SectionBlock ────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  icon,
  tree,
  pages,
  pagesKey,
  params,
  onCreate,
  onDragEnd,
  readOnly = false,
}: {
  section: Section;
  icon: React.ReactNode;
  tree: TreeNode[];
  pages: FlatPage[];
  pagesKey: string | null;
  params: { id?: string } | null;
  onCreate: (parentId: string | null, sectionId: string | null) => void;
  onDragEnd: (event: DragEndEvent) => void;
  readOnly?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const rootIds = tree.map((n) => n.id);

  // Source de vérité partagée de l'expansion, détenue au niveau de la section
  // (pas de store global) : Set des ids de dossiers REPLIÉS. Vide au démarrage
  // → tout est déplié comme avant. Aucune persistance (ni localStorage ni serveur).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const handleToggle = (node: TreeNode, recursive: boolean) => {
    setCollapsed((prev) => {
      if (recursive) return toggleBranchCollapsed(prev, node);
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide group">
        {icon}
        <span className="flex-1 truncate">{section.name}</span>
        {!readOnly && (
          <button
            onClick={() => onCreate(null, section.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors"
            title="Nouvelle page"
          >
            <Plus size={11} />
          </button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
          {tree.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              onCreate={onCreate}
              pagesKey={pagesKey}
              currentId={params?.id}
              collapsed={collapsed}
              onToggle={handleToggle}
              readOnly={readOnly}
            />
          ))}
        </SortableContext>
      </DndContext>
      {tree.length === 0 && !readOnly && (
        <button
          onClick={() => onCreate(null, section.id)}
          className="w-full flex items-center gap-2 px-3 py-1 rounded cursor-pointer hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs transition-colors"
        >
          <Plus size={11} /> Nouvelle page
        </button>
      )}
    </div>
  );
}

// ─── TreeItem ─────────────────────────────────────────────────────────────────

function TreeItem({
  node,
  depth,
  onCreate,
  pagesKey,
  currentId,
  collapsed,
  onToggle,
  readOnly = false,
}: {
  node: TreeNode;
  depth: number;
  onCreate: (parentId: string | null, sectionId: string | null) => void;
  pagesKey: string | null;
  currentId: string | undefined;
  collapsed: Set<string>;
  onToggle: (node: TreeNode, recursive: boolean) => void;
  readOnly?: boolean;
}) {
  const open = !collapsed.has(node.id);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { confirm } = useDialog();
  const hasChildren = node.children.length > 0;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id, disabled: readOnly });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.4 : 1,
    willChange: isDragging ? "transform" : undefined,
  };

  const startEditing = (e: React.MouseEvent) => {
    e.preventDefault();
    setDraftTitle(node.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = async () => {
    setEditing(false);
    const trimmed = draftTitle.trim() || "Sans titre";
    if (trimmed === node.title) return;
    await fetch(`/api/pages/${node.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (pagesKey) mutate(pagesKey);
  };

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await confirm({
      title: `Supprimer « ${node.title || "Sans titre"} » ?`,
      message: "Cette page et toutes ses sous-pages seront supprimées.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!ok) return;
    await fetch(`/api/pages/${node.id}`, { method: "DELETE" });
    if (pagesKey) mutate(pagesKey);
    if (currentId === node.id) router.push("/");
  };

  const childIds = node.children.map((c) => c.id);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        className={`group flex items-center gap-1 px-1 py-1 rounded hover:bg-[var(--surface-hover)] ${
          isDragging ? "cursor-grabbing" : ""
        } ${currentId === node.id ? "bg-[var(--surface-active)]" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggle(node, e.shiftKey);
            }}
            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
            title="Maj+clic : replier/déplier toute la branche"
            className="w-4 shrink-0 flex items-center justify-center select-none text-[var(--text-muted)]"
          >
            <ChevronRight
              size={12}
              className={open ? "rotate-90 transition-transform" : "transition-transform"}
            />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="flex-1 bg-[var(--bg)] text-[var(--text)] border border-blue-400 rounded px-1 text-sm outline-none min-w-0"
            onClick={(e) => e.preventDefault()}
          />
        ) : (
          <Link
            href={`/pages/${node.id}`}
            className="flex-1 flex items-center gap-1 truncate text-[var(--text)]"
            onDoubleClick={readOnly ? undefined : startEditing}
          >
            {node.icon ? (
              <span className="shrink-0 text-sm leading-none">{node.icon}</span>
            ) : (
              <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
            )}
            <span className="truncate">{node.title || "Sans titre"}</span>
          </Link>
        )}

        {!readOnly && (
          <>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCreate(node.id, null);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors"
              title="Ajouter une sous-page"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer text-[var(--text-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors"
              title="Supprimer"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>

      {open && hasChildren && (
        <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
          {node.children.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              depth={depth + 1}
              onCreate={onCreate}
              pagesKey={pagesKey}
              currentId={currentId}
              collapsed={collapsed}
              onToggle={onToggle}
              readOnly={readOnly}
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}
