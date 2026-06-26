"use client";
import { Bell, Search, Settings } from "lucide-react";
import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { getAvatarColor, getInitials } from "@/lib/avatar";

export default function Header({ user }: { user: SessionUser }) {
  const initials = getInitials(user.displayName);
  const avatarColor = getAvatarColor(user.id);

  return (
    <header className="app-header-bg sticky top-0 z-40 flex items-center justify-between px-6 h-14 w-full shrink-0 backdrop-blur-md border-b border-[var(--border)] shadow-sm">

      {/* Barre de recherche */}
      <div className="flex items-center flex-1 max-w-xl">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-search"))}
          className="relative w-full text-left"
        >
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
          />
          <span className="block w-full bg-[var(--surface)] rounded-full py-1.5 pl-9 pr-4 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors">
            Rechercher dans le workspace…
          </span>
        </button>
      </div>

      {/* Actions droite */}
      <div className="flex items-center gap-0.5 ml-4">
        <button
          aria-label="Notifications"
          className="p-2 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
        >
          <Bell size={17} />
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
