"use client";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronRight, GripVertical, Plus, Trash2, FileText } from "lucide-react";
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
import ThemeToggle from "@/components/ThemeToggle";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function Sidebar() {
  const { data } = useSWR<FlatPage[]>("/api/pages", fetcher);
  const router = useRouter();

  const tree = data ? buildTree(data) : [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const createPage = async (parentId: string | null = null) => {
    const res = await fetch("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId }),
    });
    const page = await res.json();
    mutate("/api/pages");
    router.push(`/pages/${page.id}`);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !data) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activePage = data.find((p) => p.id === activeId);
    const overPage = data.find((p) => p.id === overId);
    if (!activePage || !overPage) return;

    // Drag & drop uniquement entre pages du même parent
    if (activePage.parentId !== overPage.parentId) return;

    const siblings = data
      .filter((p) => p.parentId === activePage.parentId)
      .sort((a, b) => a.position - b.position);

    const activeIdx = siblings.findIndex((p) => p.id === activeId);
    const overIdx = siblings.findIndex((p) => p.id === overId);
    if (activeIdx === -1 || overIdx === -1) return;

    // Reconstruit l'ordre après déplacement
    const reordered = [...siblings];
    reordered.splice(activeIdx, 1);
    reordered.splice(overIdx, 0, siblings[activeIdx]);

    const prev = reordered[overIdx - 1];
    const next = reordered[overIdx + 1];

    let newPosition: number;
    if (!prev) {
      newPosition = reordered[1].position - 1;
    } else if (!next) {
      newPosition = reordered[reordered.length - 2].position + 1;
    } else {
      newPosition = (prev.position + next.position) / 2;
    }

    // Optimistic update : UI instantanée, PATCH en arrière-plan
    const optimistic = data.map((p) =>
      p.id === activeId ? { ...p, position: newPosition } : p
    );
    mutate("/api/pages", optimistic, { revalidate: false });

    fetch(`/api/pages/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: newPosition }),
    }).then(() => mutate("/api/pages"));
  };

  const rootIds = tree.map((n) => n.id);

  return (
    <aside className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 h-screen overflow-y-auto p-2 text-sm flex flex-col">
      <div className="px-2 py-3 font-semibold text-gray-700 dark:text-gray-200 text-base">Notes</div>
      <button
        onClick={() => createPage(null)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
      >
        <Plus size={14} /> Nouvelle page
      </button>
      <div className="mt-2 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            {tree.map((node) => (
              <TreeItem key={node.id} node={node} depth={0} onCreate={createPage} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="mt-auto pt-2 border-t border-gray-200 dark:border-gray-700">
        <ThemeToggle />
      </div>
    </aside>
  );
}

function TreeItem({
  node,
  depth,
  onCreate,
}: {
  node: TreeNode;
  depth: number;
  onCreate: (parentId: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const params = useParams<{ id?: string }>();
  const currentId = params?.id;
  const router = useRouter();
  const hasChildren = node.children.length > 0;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id });

  const style = {
    // CSS.Translate = translate uniquement, pas de scale → plus fluide
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
    mutate("/api/pages");
  };

  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setConfirmOpen(false);
    await fetch(`/api/pages/${node.id}`, { method: "DELETE" });
    mutate("/api/pages");
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
        className={`group flex items-center gap-1 px-1 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer ${
          currentId === node.id ? "bg-gray-200 dark:bg-gray-700" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 p-0.5 rounded hover:bg-gray-300"
          title="Déplacer"
          tabIndex={-1}
        >
          <GripVertical size={12} className="text-gray-400" />
        </button>

        {/* Toggle enfants */}
        <button
          onClick={() => setOpen(!open)}
          className="w-4 shrink-0 flex items-center justify-center"
        >
          {hasChildren && (
            <ChevronRight
              size={12}
              className={open ? "rotate-90 transition-transform" : "transition-transform"}
            />
          )}
        </button>

        {/* Titre / rename */}
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
            className="flex-1 bg-white dark:bg-gray-700 dark:text-gray-100 border border-blue-400 rounded px-1 text-sm outline-none min-w-0"
            onClick={(e) => e.preventDefault()}
          />
        ) : (
          <Link
            href={`/pages/${node.id}`}
            className="flex-1 flex items-center gap-1 truncate text-gray-700 dark:text-gray-200"
            onDoubleClick={startEditing}
          >
            {node.icon ? (
              <span className="shrink-0 text-sm leading-none">{node.icon}</span>
            ) : (
              <FileText size={12} className="text-gray-400 shrink-0" />
            )}
            <span className="truncate">{node.title || "Sans titre"}</span>
          </Link>
        )}

        {/* Actions */}
        <button
          onClick={(e) => {
            e.preventDefault();
            onCreate(node.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300 rounded"
          title="Ajouter une sous-page"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300 rounded"
          title="Supprimer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Enfants avec leur propre SortableContext */}
      {open && hasChildren && (
        <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} depth={depth + 1} onCreate={onCreate} />
          ))}
        </SortableContext>
      )}
    </div>
  );
}
