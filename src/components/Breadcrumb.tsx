"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ChevronRight } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { fetcher, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";
import { buildBreadcrumb, type FlatPage } from "@/lib/tree";

type Section = { id: string; name: string; icon: string | null };

/**
 * Fil d'ariane cliquable (Section / ancêtres / page courante), rendu dans le Header.
 * Ne s'affiche que sur une route /pages/[id] existante. Réutilise les listes
 * pages/sections déjà chargées par la sidebar (cache SWR).
 */
export default function Breadcrumb() {
  const params = useParams();
  const raw = params?.id;
  const pageId = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;
  // Mêmes clés que la sidebar : une session expirée les fait échouer toutes d'un
  // coup, et `noRetryOn4xx` évite d'en faire une boucle de refus.
  const { data: pages = [], error: pagesError } = useSWR<FlatPage[]>(
    wsId ? `/api/pages?workspaceId=${wsId}` : null,
    fetcher,
    noRetryOn4xx
  );
  const { data: sections = [], error: sectionsError } = useSWR<Section[]>(
    wsId ? `/api/sections?workspaceId=${wsId}` : null,
    fetcher,
    noRetryOn4xx
  );

  if (!pageId) return null;

  // ⚠️ L'échec passe AVANT le fil vide. Le fil naît du croisement des deux clés :
  // l'une manquante et `buildBreadcrumb` ne rend plus rien, donc l'en-tête aurait
  // exactement l'air d'une page sans emplacement au lieu d'un chargement raté.
  // On rend un message, jamais un écran mort : la navigation reste entière.
  const loadError = pagesError ?? sectionsError;
  if (loadError) {
    return <p className="min-w-0 truncate text-sm text-red-500">{loadErrorMessage(loadError)}</p>;
  }

  const crumbs = buildBreadcrumb(pages, sections, pageId);
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Fil d'ariane" className="flex items-center gap-1 min-w-0 text-sm">
      {crumbs.map((c, i) => {
        // Sous sm, 5 segments qui `truncate` en parallèle ne donnent qu'une rangée
        // de « … » : on ne garde que le segment courant, seul réellement informatif.
        const isCurrent = i === crumbs.length - 1;
        return (
          <span
            key={i}
            className={`flex items-center gap-1 min-w-0 ${isCurrent ? "" : "hidden sm:flex"}`}
          >
            {i > 0 && (
              <ChevronRight size={13} className="hidden sm:block text-[var(--text-muted)] shrink-0" />
            )}
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
        );
      })}
    </nav>
  );
}
