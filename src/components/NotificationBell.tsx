"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { Bell, Check, X } from "lucide-react";
import Portal from "./databases/portal";

/**
 * La cloche. Deux clés SWR distinctes, à dessein :
 *  - le COMPTEUR est sondé en permanence : il ne joint rien et n'écrit rien ;
 *  - la LISTE n'est chargée qu'à l'ouverture du panneau, et c'est elle qui
 *    déclenche la purge paresseuse côté serveur.
 *
 * ⚠️ Pas de polling serré : `refreshInterval` sur un Pi qui sert 42 conteneurs
 * se paie, pour une information qui n'est jamais urgente. SWR revalide déjà au
 * retour de focus, ce qui couvre le cas réel (« je reviens sur l'onglet »).
 */

type Notification = {
  id: string;
  type: string;
  createdAt: string;
  read: boolean;
  message: string;
  actionable: boolean;
  invitationId: string | null;
  invitationRole: string | null;
};

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

const ROLE_LABELS: Record<string, string> = {
  admin: "admin",
  editor: "éditeur",
  viewer: "lecteur",
};

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const { data: counter, mutate: mutateCount } = useSWR<{ unread: number }>(
    "/api/notifications?count=1",
    fetcher
  );
  // `null` tant que le panneau est fermé : SWR ne charge rien.
  const { data: items, mutate: mutateList } = useSWR<Notification[]>(
    open ? "/api/notifications" : null,
    fetcher
  );

  const unread = counter?.unread ?? 0;

  // Échap ferme. Le reste — position, retournement quand la place manque en bas,
  // clavier virtuel, clic extérieur — est déjà le travail de `Portal`.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const markAllRead = async () => {
    if (unread === 0) return;
    await fetch("/api/notifications", { method: "PATCH" }).catch(() => undefined);
    mutateCount();
    mutateList();
  };

  const answer = async (n: Notification, action: "accept" | "decline") => {
    if (!n.invitationId) return;
    setError(null);
    setBusy(n.id);
    try {
      const res = await fetch(`/api/invitations/${n.invitationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Erreur ${res.status}`);
        return;
      }
      mutateList();
      mutateCount();
      if (action === "accept") {
        // Le nouvel espace doit apparaître dans le sélecteur, et la page
        // courante est rendue au SSR : les deux ont besoin d'être resynchronisés.
        globalMutate("/api/workspaces");
        router.refresh();
      }
    } catch {
      setError("Action impossible (réseau).");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications (${unread} non lues)` : "Notifications"}
        className="relative p-2.5 sm:p-2 rounded-full hover:bg-[var(--surface-hover)] text-[var(--text-muted)] transition-colors"
      >
        <Bell size={17} />
        {/* Pastille seulement s'il y a QUELQUE CHOSE : un badge « 0 » permanent
            apprend à ignorer la cloche. */}
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-blue-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <Portal
          anchor={anchor}
          onClose={close}
          minWidth={320}
          className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg overflow-y-auto max-h-96"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-semibold text-[var(--text)]">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-blue-500 hover:underline"
              >
                Tout marquer lu
              </button>
            )}
          </div>

          {error && <p className="px-3 py-2 text-xs text-red-500">{error}</p>}

          {items === undefined && (
            <p className="px-3 py-6 text-xs text-[var(--text-muted)]">Chargement…</p>
          )}
          {items?.length === 0 && (
            <p className="px-3 py-6 text-xs text-[var(--text-muted)]">
              Rien de neuf. Tu verras ici les invitations et les changements qui te
              concernent.
            </p>
          )}

          <div className="flex flex-col divide-y divide-[var(--border)]">
            {(items ?? []).map((n) => (
              <div key={n.id} className={`px-3 py-2.5 ${n.read ? "" : "bg-[var(--surface)]"}`}>
                <p className="text-sm text-[var(--text)]">{n.message}</p>
                {n.actionable && n.invitationRole && (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Rôle proposé : {ROLE_LABELS[n.invitationRole] ?? n.invitationRole}
                  </p>
                )}
                {n.actionable && (
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => answer(n, "accept")}
                      disabled={busy === n.id}
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline disabled:opacity-50"
                    >
                      <Check size={12} /> Accepter
                    </button>
                    <button
                      type="button"
                      onClick={() => answer(n, "decline")}
                      disabled={busy === n.id}
                      className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-red-500 disabled:opacity-50"
                    >
                      <X size={12} /> Refuser
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}
