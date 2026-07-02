"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function ssoErrorMessage(code: string): string {
  switch (code) {
    case "provider":
      return "Connexion via GotYeah refusée ou annulée.";
    case "nosignup":
      return "Aucun compte n'est associé à cet identifiant.";
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
  ssoError,
}: {
  oidcEnabled?: boolean;
  oidcLabel?: string;
  legacyLogin?: boolean;
  ssoError?: string;
}) {
  // Fail-safe : on garde le formulaire tant que l'OIDC n'est pas confirmé actif,
  // pour ne jamais présenter une page sans aucune entrée possible.
  const showPasswordForm = legacyLogin || !oidcEnabled;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(ssoError ? ssoErrorMessage(ssoError) : "");
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
