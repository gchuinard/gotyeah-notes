"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Check } from "lucide-react";

const CRITERIA = [
  { label: "8 caractères minimum", test: (p: string) => p.length >= 8 },
  { label: "Une majuscule", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Un chiffre", test: (p: string) => /[0-9]/.test(p) },
  { label: "Un caractère spécial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function PasswordInput({
  value,
  onChange,
  placeholder,
  show,
  onToggleShow,
  required,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  show: boolean;
  onToggleShow: () => void;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className="w-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-lg px-3 py-2 pr-10 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
      />
      <button
        type="button"
        onClick={onToggleShow}
        tabIndex={-1}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export default function RegisterForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const criteria = CRITERIA.map((c) => ({ ...c, met: c.test(password) }));
  const allMet = criteria.every((c) => c.met);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = allMet && passwordsMatch && !loading;

  const inputClass =
    "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, displayName, email, password }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erreur lors de la création du compte");
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <div className="flex items-center justify-center min-h-screen w-full bg-[var(--bg)] py-10">
      <div className="w-full max-w-sm px-6">
        <h1 className="text-2xl font-bold text-center text-[var(--text)] mb-8">
          📝 Notes
        </h1>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Prénom / Nom */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">Prénom</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoFocus
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-muted)]">Nom</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
          </div>

          {/* Pseudo */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-muted)]">
              Pseudo / Nom affiché
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-muted)]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          {/* Mot de passe */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-[var(--text-muted)]">
              Mot de passe
            </label>
            <PasswordInput
              value={password}
              onChange={setPassword}
              show={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              required
            />
            {/* Critères */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-0.5">
              {criteria.map((c) => (
                <div
                  key={c.label}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    c.met ? "text-green-500" : "text-[var(--text-muted)]"
                  }`}
                >
                  {c.met ? (
                    <Check size={12} className="shrink-0" />
                  ) : (
                    <span className="shrink-0 w-3 h-3 rounded-full border border-current inline-block" />
                  )}
                  {c.label}
                </div>
              ))}
            </div>
          </div>

          {/* Confirmer le mot de passe */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[var(--text-muted)]">
                Confirmer le mot de passe
              </label>
              {confirm.length > 0 && (
                <span
                  className={`text-xs flex items-center gap-0.5 transition-colors ${
                    passwordsMatch ? "text-green-500" : "text-red-400"
                  }`}
                >
                  {passwordsMatch ? (
                    <Check size={12} />
                  ) : (
                    <span className="w-3 h-3 rounded-full border border-current inline-block shrink-0" />
                  )}
                </span>
              )}
            </div>
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              show={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
              required
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors mt-1"
          >
            {loading ? "Création…" : "Créer un compte"}
          </button>
        </form>

        <p className="text-sm text-center text-[var(--text-muted)] mt-6">
          Déjà un compte ?{" "}
          <Link href="/login" className="text-blue-500 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
