"use client";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import Breadcrumb from "@/components/Breadcrumb";
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
      <main className="flex-1 overflow-y-auto">
        <Header user={user} />
        {/* Fil d'ariane (variante A — au-dessus du contenu) */}
        <Breadcrumb variant="content" />
        {children}
      </main>
      <SearchPalette />
    </>
  );
}
