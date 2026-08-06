"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/** Erreurs renvoyees par /api/auth/magic/consume (jamais le jeton lui-meme). */
function magicErrorMessage(code: string): string {
  switch (code) {
    case "expired":
      return "Ce lien de connexion a expire. Demande-en un nouveau ci-dessous.";
    case "invalid":
      return "Ce lien n'est plus valable — il a peut-etre deja servi. Demande-en un nouveau.";
    case "no_access":
      return "Cette adresse n'a plus d'acces a cette instance. Demande une invitation a un administrateur.";
    case "disabled":
      return "La connexion par lien est desactivee sur cette instance.";
    default:
      return "Connexion par lien impossible. Reessaie.";
  }
}

function ssoErrorMessage(code: string): string {
  switch (code) {
    case "provider":
      return "Connexion via GotYeah refusée ou annulée.";
    case "nosignup":
      // L'identité est bonne (l'IdP a authentifié) — c'est l'accès à CETTE
      // application qui manque. Dire « aucun compte » enverrait chercher un
      // problème de connexion là où il faut demander une invitation.
      return "Cette adresse n'est pas encore invitée sur GotYeah Notes. Demande à un administrateur de t'ajouter à un espace.";
    case "unverified":
      return "Adresse email non vérifiée côté fournisseur d'identité.";
    case "noemail":
      return "Le fournisseur d'identité n'a pas transmis d'adresse email.";
    case "disabled":
      return "La connexion via GotYeah est désactivée.";
    default:
      return "Échec de la connexion via GotYeah. Réessayez.";
  }
}

export default function LoginForm({
  oidcEnabled = false,
  oidcLabel = "Se connecter avec GotYeah",
  legacyLogin = true,
  magicLink = true,
  ssoError,
  magicError,
}: {
  oidcEnabled?: boolean;
  oidcLabel?: string;
  legacyLogin?: boolean;
  magicLink?: boolean;
  ssoError?: string;
  magicError?: string;
}) {
  // Fail-safe : on garde le formulaire tant que l'OIDC n'est pas confirmé actif,
  // pour ne jamais présenter une page sans aucune entrée possible.
  const showPasswordForm = legacyLogin || !oidcEnabled;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    magicError ? magicErrorMessage(magicError) : ssoError ? ssoErrorMessage(ssoError) : ""
  );
  // Connexion par lien : l'ecran ne dit JAMAIS si l'adresse existe (cf. la
  // reponse uniforme de POST /api/auth/magic) — sinon il devient un oracle.
  const [magicEmail, setMagicEmail] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);

  const askMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (magicBusy || !magicEmail.trim()) return;
    setMagicBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/magic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: magicEmail.trim() }),
      });
      if (res.status === 429) {
        setError("Trop de demandes. Reessaie dans quelques minutes.");
        return;
      }
      setMagicSent(true);
    } catch {
      setError("Impossible de demander un lien pour le moment.");
    } finally {
      setMagicBusy(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erreur de connexion");
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex items-center justify-center h-screen w-full bg-[var(--bg)]">
      <div className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-bold text-center text-[var(--text)] mb-8">
          📝 Notes
        </h1>

        {error && (
          <p className="text-sm text-red-500 mb-4 text-center">{error}</p>
        )}

        {showPasswordForm && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors mt-1"
            >
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        )}

        {oidcEnabled && (
          <>
            {showPasswordForm && (
              <div className="flex items-center gap-3 my-5 text-xs text-[var(--text-muted)]">
                <span className="h-px flex-1 bg-[var(--border)]" />
                ou
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}
            <a
              href="/api/auth/oidc/login"
              className={
                showPasswordForm
                  ? "block text-center border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text)] rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  : "block text-center bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              }
            >
              {oidcLabel}
            </a>
          </>
        )}

        {magicLink && (
          <>
            {(showPasswordForm || oidcEnabled) && (
              <div className="flex items-center gap-3 my-5 text-xs text-[var(--text-muted)]">
                <span className="h-px flex-1 bg-[var(--border)]" />
                ou
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}
            {magicSent ? (
              /* Message VOLONTAIREMENT ambigu : il ne dit pas si l'adresse est
                 connue. La réponse de l'API l'est aussi — sinon cet écran
                 devient un moyen de savoir qui a un compte ici. */
              <p className="text-sm text-center text-[var(--text)] border border-[var(--border)] bg-[var(--surface)] rounded-lg px-4 py-3">
                Si un accès existe pour cette adresse, un lien de connexion vient
                d&apos;y être envoyé. Il est valable 15 minutes.
              </p>
            ) : (
              <form onSubmit={askMagicLink} className="flex flex-col gap-2">
                <label className="text-sm font-medium text-[var(--text-muted)]">
                  Recevoir un lien de connexion
                </label>
                <input
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  required
                  placeholder="ton@email.fr"
                  className="border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-lg px-3 py-2 text-base sm:text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
                />
                <button
                  type="submit"
                  disabled={magicBusy}
                  className="border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--text)] rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {magicBusy ? "Envoi…" : "M'envoyer un lien"}
                </button>
              </form>
            )}
          </>
        )}

        {showPasswordForm && (
          <p className="text-sm text-center text-[var(--text-muted)] mt-6">
            Pas encore de compte ?{" "}
            <Link href="/register" className="text-blue-500 hover:underline">
              Créer un compte
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
