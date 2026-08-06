"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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

  // Sous md la sidebar est un tiroir hors écran ; son ouverture est un état LOCAL
  // du shell (aucun autre composant n'en a besoin, donc ni contexte ni state global).
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Naviguer ferme le tiroir : sans ça il resterait par-dessus la page qu'on vient
  // d'ouvrir depuis l'arbre, et il faudrait un second geste pour voir le résultat.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Pendant du voile pour le clavier : un tiroir modal doit pouvoir se fermer sans souris.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navOpen]);

  if (isLoading) {
    return (
      <>
        {/* Le fantôme de sidebar n'a pas lieu d'être sous md : le tiroir y est hors
            écran, réserver 256 px amputerait un écran de 375 px pendant le chargement. */}
        <div className="hidden md:block w-64 bg-[var(--surface)] border-r border-[var(--border)] h-dvh shrink-0" />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </>
    );
  }

  if (workspaces.length === 0) {
    return <EmptyWorkspaceScreen />;
  }

  return (
    <>
      {/* Contrat de props avec Sidebar :
          - `open: boolean`       → sous md, traduit le tiroir dans l'écran ; sans effet à
                                    partir de md, où la sidebar redevient un élément de flux.
          - `onClose: () => void` → la sidebar s'en sert pour se refermer d'elle-même (clic
                                    sur un lien). Redondant avec la fermeture au changement
                                    de route ci-dessus, mais les deux sont idempotents — et
                                    cliquer la page DÉJÀ ouverte ne change pas la route. */}
      <Sidebar user={user} open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Voile de fermeture, sous md uniquement. z-[45] : le Header est `sticky z-40` et
          rendu APRÈS dans l'arbre — un z-index inférieur le laisserait cliquable au travers
          du voile. Reste sous le tiroir (z-50), qui doit rester au-dessus. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-[45] bg-black/40 md:hidden"
        />
      )}

      {/* <main> empilait Header et contenu en FLUX : un enfant en `h-full` (DatabaseShell,
          SettingsPage, l'accueil) réclamait alors 100 % de <main> sans déduire le Header,
          et débordait de sa hauteur exacte — d'où une 2e barre verticale parasite, qui ne
          faisait défiler que ces 56 px. `flex flex-col` fait partager la hauteur au lieu de
          l'empiler ; le `h-full` se résout désormais contre la zone restante.
          <main> RESTE le conteneur défilant : le Header est `sticky` par-dessus lui, et son
          fond translucide + backdrop-blur n'a d'effet que si le contenu passe derrière.
          `min-w-0` : sans lui, un enfant flex refuse de descendre sous la largeur de son
          contenu — c'est la source du débordement horizontal de tout le document. */}
      <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
        <Header user={user} onOpenNav={() => setNavOpen(true)} />
        <div className="flex-1 min-h-0">{children}</div>
      </main>
      <SearchPalette />
    </>
  );
}
