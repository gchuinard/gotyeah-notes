"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * ⚠️ Le jeton n'est JAMAIS consommé par cet écran. L'aperçu (GET) ne rend que
 * des libellés — nom de l'espace, qui invite — et surtout jamais le rôle offert
 * ni un identifiant exploitable. C'est le POST « Accepter » qui consomme, une
 * seule fois, et qui crée enfin le compte.
 *
 * ⚠️ Réponse UNIFORME sur tout échec d'aperçu : jeton inventé, expiré, déjà
 * utilisé ou invitation révoquée rendent le même écran. Distinguer ferait de
 * cette page publique un oracle sur les adresses connues de l'instance.
 */

type Preview = {
  valid: boolean;
  hasAccount?: boolean;
  email?: string;
  invitations?: { workspaceName: string; inviterName: string | null }[];
};

export default function InvitationClient() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview({ valid: false });
      return;
    }
    fetch(`/api/invitations/claim?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setPreview)
      .catch(() => setPreview({ valid: false }));
  }, [token]);

  const answer = async (action: "accept" | "decline") => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/invitations/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Ce lien n'est plus valable.");
        return;
      }
      if (action === "decline") {
        setDeclined(true);
        return;
      }
      // La session vient d'être posée par la réponse : on entre.
      router.push("/");
      router.refresh();
    } catch {
      setError("Impossible de répondre (réseau).");
    } finally {
      setBusy(false);
    }
  };

  const Cadre = ({ children }: { children: React.ReactNode }) => (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md border border-[var(--border)] rounded-xl p-6 bg-[var(--surface)]">
        {children}
      </div>
    </main>
  );

  if (preview === null) {
    return (
      <Cadre>
        <p className="text-sm text-[var(--text-muted)]">Chargement…</p>
      </Cadre>
    );
  }

  if (declined) {
    return (
      <Cadre>
        <h1 className="text-lg font-semibold text-[var(--text)] mb-2">Invitation refusée</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Aucun compte n&apos;a été créé. Si tu changes d&apos;avis, demande à la personne
          qui t&apos;a invité de renvoyer l&apos;invitation.
        </p>
      </Cadre>
    );
  }

  if (!preview.valid) {
    return (
      <Cadre>
        <h1 className="text-lg font-semibold text-[var(--text)] mb-2">Lien inutilisable</h1>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Ce lien a expiré, a déjà servi, ou l&apos;invitation a été annulée.
        </p>
        <Link href="/login" className="text-sm text-blue-500 hover:underline">
          Aller à la connexion
        </Link>
      </Cadre>
    );
  }

  // Compte déjà existant : ce n'est pas le bon écran. On ne crée rien et on
  // renvoie vers la connexion — l'invitation l'attendra dans sa cloche.
  if (preview.hasAccount) {
    return (
      <Cadre>
        <h1 className="text-lg font-semibold text-[var(--text)] mb-2">Tu as déjà un compte</h1>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Connecte-toi : l&apos;invitation t&apos;attend dans la cloche, en haut de l&apos;écran.
        </p>
        <Link href="/login" className="text-sm text-blue-500 hover:underline">
          Se connecter
        </Link>
      </Cadre>
    );
  }

  const invitations = preview.invitations ?? [];
  const premier = invitations[0];

  return (
    <Cadre>
      <h1 className="text-lg font-semibold text-[var(--text)] mb-2">
        {invitations.length > 1 ? "Tu es invité·e à rejoindre plusieurs espaces" : "Tu es invité·e"}
      </h1>
      <p className="text-sm text-[var(--text)] mb-1">
        {premier?.inviterName ? `${premier.inviterName} t'invite` : "Tu es invité·e"} à rejoindre
        {invitations.length > 1 ? " :" : ` « ${premier?.workspaceName} ».`}
      </p>
      {invitations.length > 1 && (
        <ul className="text-sm text-[var(--text)] list-disc pl-5 mb-1">
          {invitations.map((i) => (
            <li key={i.workspaceName}>{i.workspaceName}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[var(--text-muted)] mb-5">
        {preview.email} — un compte sera créé à cette adresse seulement si tu acceptes.
      </p>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => answer("accept")}
          disabled={busy}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
        >
          {busy ? "…" : "Accepter"}
        </button>
        <button
          type="button"
          onClick={() => answer("decline")}
          disabled={busy}
          className="text-sm text-[var(--text-muted)] hover:text-red-500 disabled:opacity-50 transition-colors"
        >
          Refuser
        </button>
      </div>
    </Cadre>
  );
}
