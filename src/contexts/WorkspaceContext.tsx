"use client";
import { createContext, useContext, useEffect, useState } from "react";
import useSWR from "swr";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function WorkspaceProvider({
  initialWorkspaceId,
  children,
}: {
  initialWorkspaceId: string | null;
  children: React.ReactNode;
}) {
  const { data: workspaces = [], isLoading } = useSWR<Workspace[]>("/api/workspaces", fetcher);
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
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
