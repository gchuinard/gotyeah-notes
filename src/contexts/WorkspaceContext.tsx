"use client";
import { createContext, useContext, useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";

export type WorkspaceRole = "admin" | "editor" | "viewer";
export type Workspace = { id: string; name: string; role: WorkspaceRole };

type WorkspaceContextType = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  switchWorkspace: (id: string) => Promise<void>;
  isLoading: boolean;
  /** Rôle sur l'espace actif. undefined tant que la liste n'est pas chargée. */
  role: WorkspaceRole | undefined;
  /** Prudence pendant le chargement : rôle inconnu = traité lecteur, jamais éditeur. */
  isViewer: boolean;
  isAdmin: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextType>({
  workspaces: [],
  activeWorkspace: null,
  switchWorkspace: async () => {},
  isLoading: true,
  role: undefined,
  isViewer: true,
  isAdmin: false,
});

/**
 * Écran d'échec du chargement des espaces. Il REMPLACE l'application, à dessein :
 * sans la liste, `workspaces` vaut `[]` et `AppShell` en conclut « Aucun espace de
 * travail » — un écran de création d'espace, qui se lit comme une perte de données
 * là où il n'y a qu'une session expirée ou une panne réseau.
 */
function WorkspaceLoadError({ error }: { error: unknown }) {
  return (
    <div className="flex flex-col items-center justify-center h-dvh w-full gap-3 px-6 text-center">
      <span className="text-4xl">⚠️</span>
      <h1 className="text-lg font-semibold text-[var(--text)]">
        Espaces de travail indisponibles
      </h1>
      <p className="text-sm text-red-500">{loadErrorMessage(error)}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded"
      >
        Recharger
      </button>
    </div>
  );
}

export function WorkspaceProvider({
  initialWorkspaceId,
  children,
}: {
  initialWorkspaceId: string | null;
  children: React.ReactNode;
}) {
  // Clé montée en permanence et légitimement refusable (session expirée) : sans
  // `noRetryOn4xx`, un 401 relancerait la racine de l'app en boucle.
  const { data, error, isLoading } = useSWR<Workspace[], unknown>(
    "/api/workspaces",
    fetcher,
    noRetryOn4xx
  );
  const workspaces = data ?? [];
  // ⚠️ `data === undefined` est ce qui distingue « jamais chargé » de « échec d'une
  // REVALIDATION » : dans le second cas SWR garde la liste précédente, l'app reste
  // utilisable et il n'y a rien à annoncer. Un `error` seul ferait clignoter tout
  // l'écran au moindre hoquet réseau.
  const loadFailed = Boolean(error) && data === undefined;
  const [activeId, setActiveId] = useState<string | null>(initialWorkspaceId);

  // When workspaces load, ensure the activeId is still valid
  useEffect(() => {
    if (isLoading || workspaces.length === 0) return;
    const exists = workspaces.find((w) => w.id === activeId);
    if (!exists) {
      switchWorkspace(workspaces[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, isLoading]);

  const switchWorkspace = async (id: string) => {
    setActiveId(id);
    await fetch(`/api/workspaces/${id}/switch`, { method: "POST" });
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? null;
  const role = activeWorkspace?.role;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        switchWorkspace,
        isLoading,
        role,
        isViewer: role === undefined || role === "viewer",
        isAdmin: role === "admin",
      }}
    >
      {loadFailed ? <WorkspaceLoadError error={error} /> : children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
