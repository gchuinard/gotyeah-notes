"use client";
import { useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useWorkspace, Workspace } from "@/contexts/WorkspaceContext";
import { useDialog } from "@/contexts/DialogContext";

export default function WorkspaceSelector() {
  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();
  const { confirm } = useDialog();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 0);
  }, [creating]);

  // Ferme le dropdown au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const createWorkspace = async () => {
    const name = newName.trim() || "Mon espace";
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const ws = await res.json();
    await mutate("/api/workspaces");
    switchWorkspace(ws.id);
    setCreating(false);
    setNewName("");
    setOpen(false);
  };

  const deleteWorkspace = async (workspace: Workspace) => {
    const ok = await confirm({
      title: `Supprimer « ${workspace.name} » ?`,
      message: "Cet espace et toutes ses pages seront supprimés. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!ok) return;
    await fetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
    if (activeWorkspace?.id === workspace.id) {
      const remaining = workspaces.filter((w) => w.id !== workspace.id);
      if (remaining.length > 0) switchWorkspace(remaining[0].id);
    }
    await mutate("/api/workspaces");
  };

  return (
    <div ref={containerRef} className="relative px-2 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded hover:bg-[var(--surface-hover)] font-semibold text-[var(--text)] text-base"
      >
        <span className="truncate">{activeWorkspace?.name ?? "—"}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg z-50 py-1">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] cursor-pointer"
              onClick={() => {
                switchWorkspace(ws.id);
                setOpen(false);
              }}
            >
              <Check
                size={12}
                className={ws.id === activeWorkspace?.id ? "text-blue-500 shrink-0" : "invisible shrink-0"}
              />
              <span className="flex-1 text-sm truncate text-[var(--text)]">{ws.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteWorkspace(ws);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[var(--surface-hover)] rounded"
                title="Supprimer l'espace"
              >
                <Trash2 size={12} className="text-[var(--text-muted)]" />
              </button>
            </div>
          ))}

          <div className="border-t border-[var(--border)] mt-1 pt-1">
            {creating ? (
              <div className="px-3 py-1.5">
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createWorkspace();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  placeholder="Nom de l'espace…"
                  className="w-full bg-[var(--bg)] text-[var(--text)] border border-blue-400 rounded px-2 py-0.5 text-sm outline-none"
                />
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCreating(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--surface-hover)] text-[var(--text-muted)] text-sm"
              >
                <Plus size={12} />
                Nouvel espace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
