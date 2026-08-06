"use client";
import { useState } from "react";
import { mutate } from "swr";
import { useWorkspace } from "@/contexts/WorkspaceContext";

export default function EmptyWorkspaceScreen() {
  const { switchWorkspace } = useWorkspace();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const create = async () => {
    if (loading) return;
    setLoading(true);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Mon espace" }),
    });
    const ws = await res.json();
    await mutate("/api/workspaces");
    await switchWorkspace(ws.id);
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center h-dvh w-full gap-4 px-6 text-center">
      <span className="text-5xl">🗂️</span>
      <h1 className="text-xl font-semibold text-[var(--text)]">
        Aucun espace de travail
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        Crée ton premier espace pour commencer.
      </p>
      <div className="flex gap-2 mt-2 w-full max-w-sm sm:w-auto">
        {/* text-base sous sm : iOS Safari zoome sur tout champ à moins de 16 px et ne
            dézoome pas au blur. */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Nom de l'espace…"
          autoFocus
          className="border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] rounded px-3 py-1.5 text-base sm:text-sm outline-none focus:border-blue-400 flex-1 min-w-0 sm:flex-none sm:w-56"
        />
        <button
          onClick={create}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50 shrink-0"
        >
          Créer
        </button>
      </div>
    </div>
  );
}
