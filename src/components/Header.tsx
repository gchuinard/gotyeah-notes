"use client";
import { Menu, Search, Settings } from "lucide-react";
import NotificationBell from "./NotificationBell";
import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import Breadcrumb from "@/components/Breadcrumb";

type Props = {
  user: SessionUser;
  /** Ouvre le tiroir de navigation (sous md). Piloté par AppShell. */
  onOpenNav: () => void;
};

export default function Header({ user, onOpenNav }: Props) {
  const initials = getInitials(user.displayName);
  const avatarColor = getAvatarColor(user.id);

  const openSearch = () => window.dispatchEvent(new Event("open-search"));

  return (
    <header className="app-header-bg sticky top-0 z-40 flex items-center justify-between px-3 sm:px-6 h-14 w-full shrink-0 backdrop-blur-md border-b border-[var(--border)] shadow-sm">

      {/* Fil d'ariane dans le Header ; la recherche passe à droite */}
      <div className="flex items-center min-w-0 flex-1">
        {/* Seul accès aux sections, à l'arbre, aux Récents, à la corbeille, au sélecteur
            d'espace et à la déconnexion tant que le tiroir est fermé. */}
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Ouvrir la navigation"
          className="md:hidden -ml-1 mr-1 p-2.5 rounded-full shrink-0 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <Menu size={20} />
        </button>
        <Breadcrumb />
      </div>

      {/* Actions droite : recherche + réglages + avatar */}
      <div className="flex items-center gap-1 ml-2 sm:ml-4 shrink-0">
        {/* Sous sm, la barre de recherche (w-56 = 224 px incompressibles) ne laisserait
            aucune place au fil d'ariane : elle se réduit à une pastille qui ouvre la
            MÊME palette. */}
        <button
          type="button"
          onClick={openSearch}
          className="sm:hidden p-2.5 rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
          aria-label="Rechercher"
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          onClick={openSearch}
          className="hidden sm:block relative w-56 text-left"
          aria-label="Rechercher"
        >
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <span className="block w-full bg-[var(--surface)] rounded-full py-1.5 pl-9 pr-4 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors truncate">
            Rechercher…
          </span>
        </button>
        {/* Entre la recherche et les réglages : c'est là que l'œil va chercher
            une cloche, et c'est la place demandée. */}
        <NotificationBell />
        <Link
          href="/settings"
          aria-label="Paramètres"
          className="p-2.5 sm:p-2 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
        >
          <Settings size={17} />
        </Link>

        {/* Avatar déterministe : couleur calculée depuis user.id */}
        <div
          className={`ml-1 sm:ml-2 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border border-[var(--border)] shrink-0 ${avatarColor}`}
          title={user.displayName}
          aria-label={user.displayName}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
