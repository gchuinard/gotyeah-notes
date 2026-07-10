"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { buildBreadcrumb, type FlatPage } from "@/lib/tree";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
type Section = { id: string; name: string; icon: string | null };

/**
 * Fil d'ariane cliquable (Section / ancêtres / page courante). Deux emplacements
 * pendant l'évaluation : `content` (au-dessus du contenu, cf. AppShell) et `header`
 * (dans le Header). Ne s'affiche que sur une route /pages/[id] existante.
 * Réutilise les listes pages/sections déjà chargées par la sidebar (cache SWR).
 */
export default function Breadcrumb({ variant = "content" }: { variant?: "content" | "header" }) {
  const params = useParams();
  const raw = params?.id;
  const pageId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;
  const { data: pages = [] } = useSWR<FlatPage[]>(wsId ? `/api/pages?workspaceId=${wsId}` : null, fetcher);
  const { data: sections = [] } = useSWR<Section[]>(wsId ? `/api/sections?workspaceId=${wsId}` : null, fetcher);

  if (!pageId) return null;
  const crumbs = buildBreadcrumb(pages, sections, pageId);
  if (crumbs.length === 0) return null;

  const wrapper =
    variant === "header"
      ? "flex items-center gap-1 min-w-0 text-sm"
      : "flex items-center gap-1 min-w-0 text-sm px-6 h-9 border-b border-[var(--border)] bg-[var(--bg)]";

  return (
    <nav aria-label="Fil d'ariane" className={wrapper}>
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight size={13} className="text-[var(--text-muted)] shrink-0" />}
          {c.href ? (
            <Link
              href={c.href}
              className="truncate text-[var(--text-muted)] hover:text-[var(--text)] hover:underline"
            >
              {c.icon ? `${c.icon} ` : ""}
              {c.label}
            </Link>
          ) : (
            <span className="truncate text-[var(--text)] font-medium">
              {c.icon ? `${c.icon} ` : ""}
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
