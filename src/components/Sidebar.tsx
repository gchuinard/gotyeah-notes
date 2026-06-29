"use client";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, Clock, FileText,
  Home, LayoutTemplate, Lock, LogOut, Plus, Settings, Trash2, Users,
} from "lucide-react";
import { useRef, useState } from "react";
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
import { buildTree, FlatPage, TreeNode } from "@/lib/tree";
import ConfirmModal from "@/components/ConfirmModal";
import WorkspaceSelector from "@/components/WorkspaceSelector";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import type { SessionUser } from "@/lib/session";

type Section = { id: string; name: string; type: string; icon: string | null; position: number };
type RecentPage = { id: string; title: string; icon: string | null };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Sidebar({ user }: { user: SessionUser }) {
  const { activeWorkspace } = useWorkspace();
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

  // Crée une page puis la scaffold direct en database à partir d'un modèle
  // (colonnes + kanban + modèle de corps). Cf. POST /api/databases?template=…
  const [creatingDb, setCreatingDb] = useState(false);
  const [dbMenuOpen, setDbMenuOpen] = useState(false);
  const createTemplatedDatabase = async (template: "ticket" | "bug", title: string) => {
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
        body: JSON.stringify({ workspaceId, sectionId, title }),
      });
      if (!pageRes.ok) return;
      const page = await pageRes.json();
      await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId: page.id, template }),
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

  return (
    <aside className="w-64 bg-[var(--surface)] border-r border-[var(--border)] h-screen overflow-y-auto p-2 text-sm flex flex-col">
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
              <div className="absolute left-1 right-1 top-full mt-0.5 z-50 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg py-1">
                <button
                  onClick={() => createTemplatedDatabase("ticket", "Tickets")}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text)]"
                >
                  Tickets
                </button>
                <button
                  onClick={() => createTemplatedDatabase("bug", "Bugs")}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text)]"
                >
                  Bugs
                </button>
              </div>
            </>
          )}
        </div>
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
          />
        ))}
      </div>

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
}: {
  section: Section;
  icon: React.ReactNode;
  tree: TreeNode[];
  pages: FlatPage[];
  pagesKey: string | null;
  params: { id?: string } | null;
  onCreate: (parentId: string | null, sectionId: string | null) => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const rootIds = tree.map((n) => n.id);

  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide group">
        {icon}
        <span className="flex-1 truncate">{section.name}</span>
        <button
          onClick={() => onCreate(null, section.id)}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded cursor-pointer text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors"
          title="Nouvelle page"
        >
          <Plus size={11} />
        </button>
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
            />
          ))}
        </SortableContext>
      </DndContext>
      {tree.length === 0 && (
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
}: {
  node: TreeNode;
  depth: number;
  onCreate: (parentId: string | null, sectionId: string | null) => void;
  pagesKey: string | null;
  currentId: string | undefined;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const hasChildren = node.children.length > 0;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

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

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setConfirmOpen(false);
    await fetch(`/api/pages/${node.id}`, { method: "DELETE" });
    if (pagesKey) mutate(pagesKey);
    if (currentId === node.id) router.push("/");
  };

  const childIds = node.children.map((c) => c.id);

  return (
    <div ref={setNodeRef} style={style}>
      {confirmOpen && (
        <ConfirmModal
          message={`Supprimer "${node.title || "Sans titre"}" et toutes ses sous-pages ?`}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      <div
        {...attributes}
        {...listeners}
        className={`group flex items-center gap-1 px-1 py-1 rounded hover:bg-[var(--surface-hover)] ${
          isDragging ? "cursor-grabbing" : ""
        } ${currentId === node.id ? "bg-[var(--surface-active)]" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          className="w-4 shrink-0 flex items-center justify-center"
        >
          {hasChildren && (
            <ChevronRight
              size={12}
              className={open ? "rotate-90 transition-transform" : "transition-transform"}
            />
          )}
        </button>

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
            onDoubleClick={startEditing}
          >
            {node.icon ? (
              <span className="shrink-0 text-sm leading-none">{node.icon}</span>
            ) : (
              <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
            )}
            <span className="truncate">{node.title || "Sans titre"}</span>
          </Link>
        )}

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
            />
          ))}
        </SortableContext>
      )}
    </div>
  );
}
