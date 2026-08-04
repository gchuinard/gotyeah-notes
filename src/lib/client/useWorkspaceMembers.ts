"use client";
import useSWR from "swr";

/** Forme renvoyée par GET /api/workspaces/[id]/members (clé `userId`, pas `id`). */
export type WorkspaceMember = {
  userId: string;
  role: string;
  email: string;
  displayName: string;
  createdAt: string;
};

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

/**
 * Membres de l'espace, pour les cellules et filtres « utilisateur ».
 *
 * ⚠️ Le workspaceId doit être celui de la DATABASE ouverte, pas
 * `useWorkspace().activeWorkspace` (workspace de SESSION) : une page atteinte
 * par lien profond ou Cmd+K appartient parfois à un autre espace, et on
 * listerait alors les mauvais membres.
 *
 * Même clé SWR que l'écran Réglages → Membres : le cache est partagé, un seul
 * fetch pour toute l'app.
 */
export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  const { data, isLoading } = useSWR<WorkspaceMember[]>(
    workspaceId ? `/api/workspaces/${workspaceId}/members` : null,
    fetcher
  );
  return { members: data ?? [], isLoading };
}
