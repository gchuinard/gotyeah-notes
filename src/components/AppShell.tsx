"use client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import SearchPalette from "@/components/SearchPalette";
import EmptyWorkspaceScreen from "@/components/EmptyWorkspaceScreen";
import type { SessionUser } from "@/lib/session";

type Props = {
  children: React.ReactNode;
  user: SessionUser;
};

export default function AppShell({ children, user }: Props) {
  const { workspaces, isLoading } = useWorkspace();

  if (isLoading) {
    return (
      <>
        <div className="w-64 bg-[var(--surface)] border-r border-[var(--border)] h-screen shrink-0" />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </>
    );
  }

  if (workspaces.length === 0) {
    return <EmptyWorkspaceScreen />;
  }

  return (
    <>
      <Sidebar user={user} />
      {/* <main> empilait Header et contenu en FLUX : un enfant en `h-full` (DatabaseShell,
          SettingsPage, l'accueil) réclamait alors 100 % de <main> sans déduire le Header,
          et débordait de sa hauteur exacte — d'où une 2e barre verticale parasite, qui ne
          faisait défiler que ces 56 px. `flex flex-col` fait partager la hauteur au lieu de
          l'empiler ; le `h-full` se résout désormais contre la zone restante.
          <main> RESTE le conteneur défilant : le Header est `sticky` par-dessus lui, et son
          fond translucide + backdrop-blur n'a d'effet que si le contenu passe derrière. */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        <Header user={user} />
        <div className="flex-1 min-h-0">{children}</div>
      </main>
      <SearchPalette />
    </>
  );
}
