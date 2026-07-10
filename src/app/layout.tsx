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
      <body className="flex h-screen bg-[var(--bg)] text-[var(--text)]">
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
