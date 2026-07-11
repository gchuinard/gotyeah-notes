"use client";
import { Search, Settings } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { getAvatarColor, getInitials } from "@/lib/avatar";
import Breadcrumb from "@/components/Breadcrumb";

export default function Header({ user }: { user: SessionUser }) {
  const initials = getInitials(user.displayName);
  const avatarColor = getAvatarColor(user.id);

  return (
    <header className="app-header-bg sticky top-0 z-40 flex items-center justify-between px-6 h-14 w-full shrink-0 backdrop-blur-md border-b border-[var(--border)] shadow-sm">

      {/* Fil d'ariane dans le Header ; la recherche passe à droite */}
      <div className="flex items-center min-w-0 flex-1">
        <Breadcrumb />
      </div>

      {/* Actions droite : recherche + réglages + avatar */}
      <div className="flex items-center gap-1 ml-4 shrink-0">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-search"))}
          className="relative w-56 text-left"
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
        <Link
          href="/settings"
          aria-label="Paramètres"
          className="p-2 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
        >
          <Settings size={17} />
        </Link>

        {/* Avatar déterministe : couleur calculée depuis user.id */}
        <div
          className={`ml-2 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border border-[var(--border)] shrink-0 ${avatarColor}`}
          title={user.displayName}
          aria-label={user.displayName}
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
