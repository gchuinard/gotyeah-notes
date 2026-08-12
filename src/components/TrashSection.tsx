"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { ChevronDown, ChevronRight, FileText, RotateCcw, Trash2, X } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useDialog } from "@/contexts/DialogContext";
import { fetcher, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";

type TrashPage = { id: string; title: string; icon: string | null; trashedAt: string };
type TrashRecord = TrashPage & { pageId: string };
type TrashData = { pages: TrashPage[]; records: TrashRecord[] };

function Row({
  icon, title, onRestore, onPurge, canPurge,
}: {
  icon: string | null; title: string; onRestore: () => void; onPurge: () => void; canPurge: boolean;
}) {
  return (
    <div className="group flex items-center gap-1.5 px-2 py-1.5 md:py-1 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)]">
      {icon ? (
        <span className="shrink-0 text-sm leading-none">{icon}</span>
      ) : (
        <FileText size={12} className="shrink-0" />
      )}
      <span className="truncate text-xs flex-1 line-through opacity-70">{title || "Sans titre"}</span>
      {/* Sans survol, ces deux boutons étaient introuvables au doigt : la corbeille
          devenait un cul-de-sac. `pointer-events` suit l'opacité côté desktop, sinon
          la version invisible reste cliquable. */}
      <button
        onClick={onRestore}
        title="Restaurer"
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2 md:p-0.5 rounded hover:bg-[var(--surface-active)]"
      >
        <RotateCcw size={12} />
      </button>
      {/* Purge = suppression DÉFINITIVE (?permanent=1) → admin seulement. */}
      {canPurge && (
        <button
          onClick={onPurge}
          title="Supprimer définitivement"
          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2 md:p-0.5 rounded hover:bg-[var(--surface-active)] text-red-500"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Corbeille : pages/records supprimés, restaurables ou purgeables (purge auto 30 j). */
export default function TrashSection() {
  const { activeWorkspace, isViewer, isAdmin } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;
  // Un lecteur ne peut ni restaurer ni purger : rien d'actionnable, on n'affiche pas.
  const key = wsId && !isViewer ? `/api/trash?workspaceId=${wsId}` : null;
  // La clé ne dépend PAS du repli : le compte du badge doit être connu avant
  // d'ouvrir. Elle peut donc échouer alors que rien n'est déplié.
  const { data, error } = useSWR<TrashData>(key, fetcher, noRetryOn4xx);
  const { confirm } = useDialog();
  const [open, setOpen] = useState(false);

  const count = (data?.pages.length ?? 0) + (data?.records.length ?? 0);
  if (isViewer) return null;

  // ⚠️ AVANT le repli sur `count === 0` : un chargement raté laisse `data`
  // indéfini, donc un compte à zéro, donc une corbeille qui DISPARAÎT — l'exact
  // contraire de ce qu'on veut dire à qui cherche à récupérer une page.
  if (error) {
    return (
      <div className="px-2">
        <div className="flex items-center gap-1.5 px-2 py-2.5 md:py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          <Trash2 size={11} />
          Corbeille
        </div>
        <p className="px-2 pb-1 text-xs text-red-500">{loadErrorMessage(error)}</p>
      </div>
    );
  }

  if (count === 0) return null;

  const refresh = () => {
    mutate(key);
    if (wsId) {
      mutate(`/api/pages?workspaceId=${wsId}`);
      mutate(`/api/pages/recent?workspaceId=${wsId}`);
    }
  };
  const restore = async (kind: "pages" | "records", id: string) => {
    await fetch(`/api/${kind}/${id}/restore`, { method: "POST" });
    refresh();
  };
  const purge = async (kind: "pages" | "records", id: string, title: string) => {
    const ok = await confirm({
      title: "Supprimer définitivement ?",
      message: `« ${title || "Sans titre"} » sera perdu sans retour possible.`,
      confirmLabel: "Supprimer définitivement",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await fetch(`/api/${kind}/${id}?permanent=1`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="px-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-2.5 md:py-1 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Trash2 size={11} />
        Corbeille
        <span className="ml-auto text-[10px] px-1.5 rounded-full bg-[var(--surface-active)] text-[var(--text-muted)]">
          {count}
        </span>
      </button>
      {open && (
        <div className="mt-0.5">
          {data!.pages.map((p) => (
            <Row
              key={p.id}
              icon={p.icon}
              title={p.title}
              onRestore={() => restore("pages", p.id)}
              onPurge={() => purge("pages", p.id, p.title)}
              canPurge={isAdmin}
            />
          ))}
          {data!.records.map((r) => (
            <Row
              key={r.id}
              icon={r.icon}
              title={r.title}
              onRestore={() => restore("records", r.id)}
              onPurge={() => purge("records", r.id, r.title)}
              canPurge={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
