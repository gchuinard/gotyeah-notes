import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { DialogProvider } from "@/contexts/DialogContext";
import AppShell from "@/components/AppShell";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Notes",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("app-theme")?.value ?? "light";
  const user = await getSession();

  return (
    <html lang="fr" data-theme={theme}>
      {/* h-dvh, pas h-screen : sur mobile `vh` inclut la barre d'URL du navigateur,
          ce qui poussait le bas de l'app sous le chrome. */}
      <body className="flex h-dvh bg-[var(--bg)] text-[var(--text)]">
        <DialogProvider>
          {user ? (
            <WorkspaceProvider initialWorkspaceId={user.currentWorkspaceId}>
              <AppShell user={user}>{children}</AppShell>
            </WorkspaceProvider>
          ) : (
            children
          )}
        </DialogProvider>
      </body>
    </html>
  );
}
