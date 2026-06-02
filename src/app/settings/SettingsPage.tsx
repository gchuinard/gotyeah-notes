"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, User, Users, HardDrive, Palette,
  Eye, EyeOff, Check, ChevronDown,
} from "lucide-react";
import type { SessionUser } from "@/lib/session";

// ─── Themes ──────────────────────────────────────────────────────────────────

const THEMES = [
  { id: "light",      name: "Clair",        dark: false, colors: ["#ffffff", "#f3f4f6", "#111827", "#3b82f6"] },
  { id: "sepia",      name: "Sépia",        dark: false, colors: ["#fdf8f0", "#f0e6d3", "#3d2b1f", "#a0522d"] },
  { id: "rose",       name: "Rosé",         dark: false, colors: ["#fff1f5", "#ffe4e6", "#881337", "#f43f5e"] },
  { id: "dark",       name: "Sombre",       dark: true,  colors: ["#111827", "#1f2937", "#f9fafb", "#60a5fa"] },
  { id: "midnight",   name: "Minuit",       dark: true,  colors: ["#0d0d1a", "#1a1a3e", "#e2e8f0", "#6366f1"] },
  { id: "ocean",      name: "Océan",        dark: true,  colors: ["#0c1e35", "#1a3a5c", "#e0f2fe", "#0ea5e9"] },
  { id: "forest",     name: "Forêt",        dark: true,  colors: ["#1a2e1a", "#2a4a2a", "#dcfce7", "#22c55e"] },
  { id: "nord",       name: "Nord",         dark: true,  colors: ["#2e3440", "#3b4252", "#eceff4", "#88c0d0"] },
  { id: "tokyo",      name: "Tokyo Night",  dark: true,  colors: ["#1a1b2e", "#24283b", "#a9b1d6", "#7aa2f7"] },
  { id: "dracula",    name: "Dracula",      dark: true,  colors: ["#282a36", "#44475a", "#f8f8f2", "#bd93f9"] },
  { id: "catppuccin", name: "Catppuccin",   dark: true,  colors: ["#1e1e2e", "#313244", "#cdd6f4", "#cba6f7"] },
  { id: "gruvbox",    name: "Gruvbox",      dark: true,  colors: ["#282828", "#3c3836", "#ebdbb2", "#d79921"] },
];

// ─── Constants ───────────────────────────────────────────────────────────────

const NAV = [
  { id: "profile",    label: "Profil",       icon: User },
  { id: "users",      label: "Utilisateurs", icon: Users },
  { id: "storage",    label: "Stockage",     icon: HardDrive },
  { id: "appearance", label: "Apparence",    icon: Palette },
] as const;

type Section = (typeof NAV)[number]["id"];

const PASSWORD_CRITERIA = [
  { label: "8 caractères minimum", test: (p: string) => p.length >= 8 },
  { label: "Une majuscule",        test: (p: string) => /[A-Z]/.test(p) },
  { label: "Un chiffre",           test: (p: string) => /[0-9]/.test(p) },
  { label: "Un caractère spécial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

// ─── Shared UI ───────────────────────────────────────────────────────────────

const fieldClass =
  "border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors w-full";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm font-medium text-[var(--text)]">{children}</label>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-[var(--text)]">{title}</h2>
      {description && <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>}
    </div>
  );
}

function Divider() {
  return <hr className="border-[var(--border)] my-6" />;
}

function SaveButton({ label = "Enregistrer" }: { label?: string }) {
  return (
    <button
      type="button"
      className="mt-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
    >
      {label}
    </button>
  );
}

function Toggle({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-5 rounded-full transition-colors ${
          checked ? "bg-blue-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function PasswordField({ label, show, onToggle, value, onChange }: {
  label: string;
  show: boolean;
  onToggle: () => void;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldClass} pr-10`}
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function ProfileSection({ user }: { user: SessionUser }) {
  const [firstName, setFirstName]     = useState("");
  const [lastName, setLastName]       = useState("");
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail]             = useState(user.email);

  const [currentPw, setCurrentPw]     = useState("");
  const [newPw, setNewPw]             = useState("");
  const [confirmPw, setConfirmPw]     = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const criteria = PASSWORD_CRITERIA.map((c) => ({ ...c, met: c.test(newPw) }));
  const passwordsMatch = confirmPw.length > 0 && newPw === confirmPw;

  return (
    <div className="max-w-lg">
      <SectionTitle title="Profil" description="Informations de votre compte." />

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-xl font-bold text-blue-600">
          {user.displayName.charAt(0).toUpperCase()}
        </div>
        <button
          type="button"
          className="text-sm text-blue-500 hover:underline"
        >
          Changer la photo
        </button>
      </div>

      {/* Identité */}
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Prénom</Label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldClass} placeholder="Prénom" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Nom</Label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={fieldClass} placeholder="Nom" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Pseudo / Nom affiché</Label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Email</Label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </div>
        <SaveButton />
      </div>

      <Divider />

      {/* Mot de passe */}
      <h3 className="text-base font-semibold text-[var(--text)] mb-4">
        Changer le mot de passe
      </h3>
      <div className="flex flex-col gap-4">
        <PasswordField label="Mot de passe actuel" show={showCurrent} onToggle={() => setShowCurrent((v) => !v)} value={currentPw} onChange={setCurrentPw} />
        <div className="flex flex-col gap-2">
          <PasswordField label="Nouveau mot de passe" show={showNew} onToggle={() => setShowNew((v) => !v)} value={newPw} onChange={setNewPw} />
          {newPw.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {criteria.map((c) => (
                <div key={c.label} className={`flex items-center gap-1.5 text-xs transition-colors ${c.met ? "text-green-500" : "text-[var(--text-muted)]"}`}>
                  {c.met
                    ? <Check size={12} className="shrink-0" />
                    : <span className="shrink-0 w-3 h-3 rounded-full border border-current inline-block" />}
                  {c.label}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Label>Confirmer le nouveau mot de passe</Label>
            {confirmPw.length > 0 && (
              <Check size={13} className={passwordsMatch ? "text-green-500" : "text-gray-300"} />
            )}
          </div>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={`${fieldClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              tabIndex={-1}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>
        <SaveButton label="Changer le mot de passe" />
      </div>
    </div>
  );
}

function UsersSection() {
  const [openRegistration, setOpenRegistration] = useState(false);
  const [ssoEnabled, setSsoEnabled]             = useState(false);
  const [defaultRole, setDefaultRole]           = useState<"viewer" | "editor" | "admin">("editor");

  const roles = [
    { id: "viewer" as const,  label: "Lecteur",  description: "Peut lire les pages" },
    { id: "editor" as const,  label: "Éditeur",  description: "Peut créer et modifier" },
    { id: "admin"  as const,  label: "Admin",    description: "Accès complet" },
  ];

  return (
    <div className="max-w-lg">
      <SectionTitle title="Gestion des utilisateurs" description="Contrôlez l'accès et les permissions." />

      <div className="flex flex-col gap-5">
        <Toggle
          checked={openRegistration}
          onChange={setOpenRegistration}
          label="Inscription ouverte"
          description="Autorise n'importe qui à créer un compte sans invitation."
        />
        <Divider />
        <Toggle
          checked={ssoEnabled}
          onChange={setSsoEnabled}
          label="SSO / OAuth"
          description="Connexion via un fournisseur externe (Google, GitHub, etc.)."
        />
        <Divider />

        {/* Rôle par défaut */}
        <div>
          <p className="text-sm font-medium text-[var(--text)] mb-1">
            Rôle par défaut pour les nouveaux utilisateurs
          </p>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Ce rôle est attribué automatiquement à l&apos;inscription.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDefaultRole(r.id)}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-colors ${
                  defaultRole === r.id
                    ? "border-blue-400 bg-blue-50"
                    : "border-[var(--border)] hover:border-gray-300"
                }`}
              >
                <span className={`text-sm font-medium ${defaultRole === r.id ? "text-blue-600" : "text-[var(--text)]"}`}>
                  {r.label}
                </span>
                <span className="text-xs text-[var(--text-muted)] mt-0.5">{r.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StorageSection() {
  const [storageType, setStorageType] = useState<"local" | "cloud">("local");
  const [provider, setProvider]       = useState("s3");
  const [showSecret, setShowSecret]   = useState(false);

  const providers = [
    { id: "s3",  label: "Amazon S3" },
    { id: "r2",  label: "Cloudflare R2" },
    { id: "gcs", label: "Google Cloud Storage" },
    { id: "b2",  label: "Backblaze B2" },
  ];

  return (
    <div className="max-w-lg">
      <SectionTitle title="Stockage" description="Configurez où sont stockés les fichiers et médias." />

      {/* Type */}
      <div className="flex flex-col gap-2 mb-6">
        {(["local", "cloud"] as const).map((type) => (
          <label
            key={type}
            className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
              storageType === type
                ? "border-blue-400 bg-blue-50"
                : "border-[var(--border)] hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="storage"
              value={type}
              checked={storageType === type}
              onChange={() => setStorageType(type)}
              className="accent-blue-500"
            />
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                {type === "local" ? "Disque local" : "Cloud"}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {type === "local"
                  ? "Les fichiers sont stockés sur le serveur."
                  : "Synchronisation avec un bucket distant."}
              </p>
            </div>
          </label>
        ))}
      </div>

      {/* Config locale */}
      {storageType === "local" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Chemin de stockage</Label>
            <input type="text" defaultValue="./storage/uploads" className={fieldClass} />
          </div>
          <SaveButton />
        </div>
      )}

      {/* Config cloud */}
      {storageType === "cloud" && (
        <div className="flex flex-col gap-4">
          {/* Provider */}
          <div className="flex flex-col gap-1.5">
            <Label>Fournisseur</Label>
            <div className="relative">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className={`${fieldClass} appearance-none pr-8`}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Nom du bucket</Label>
            <input type="text" placeholder="mon-bucket" className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Région</Label>
            <input type="text" placeholder="eu-west-3" className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Access Key ID</Label>
            <input type="text" className={fieldClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Secret Access Key</Label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                className={`${fieldClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <SaveButton />
        </div>
      )}
    </div>
  );
}

function AppearanceSection() {
  const [selected, setSelected] = useState("light");
  const router = useRouter();

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current) setSelected(current);
  }, []);

  const applyTheme = (id: string) => {
    setSelected(id);
    // Mise à jour immédiate du DOM (feedback instantané)
    document.documentElement.setAttribute("data-theme", id);
    // Cookie lu par le layout serveur pour persister entre les reloads
    document.cookie = `app-theme=${id}; path=/; max-age=${60 * 60 * 24 * 365}`;
    // Re-render du layout serveur avec le nouveau cookie → synchronise data-theme
    router.refresh();
  };

  const lightThemes = THEMES.filter((t) => !t.dark);
  const darkThemes  = THEMES.filter((t) => t.dark);

  const renderTheme = (theme: typeof THEMES[number]) => (
    <button
      key={theme.id}
      type="button"
      onClick={() => applyTheme(theme.id)}
      className={`group flex flex-col rounded-xl overflow-hidden border-2 transition-all ${
        selected === theme.id
          ? "border-blue-500 shadow-md scale-[1.02]"
          : "border-transparent hover:border-[var(--border)]"
      }`}
    >
      <div className="flex h-12">
        {theme.colors.map((color, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className={`flex items-center justify-between px-2 py-1.5 text-xs font-medium ${
        selected === theme.id
          ? "bg-blue-50 text-blue-600"
          : "bg-[var(--surface)] text-[var(--text-muted)]"
      }`}>
        {theme.name}
        {selected === theme.id && <Check size={11} />}
      </div>
    </button>
  );

  return (
    <div className="max-w-2xl">
      <SectionTitle title="Apparence" description="Choisissez le thème de l'interface." />

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">Clairs</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 mb-8">
        {lightThemes.map(renderTheme)}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">Sombres</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {darkThemes.map(renderTheme)}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SettingsPage({ user }: { user: SessionUser }) {
  const [active, setActive] = useState<Section>("profile");

  return (
    <div className="flex h-full text-sm">
      {/* Left nav */}
      <nav className="w-52 shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="px-4 py-4 border-b border-[var(--border)]">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] mb-3"
          >
            <ArrowLeft size={13} />
            Retour
          </Link>
          <h1 className="font-semibold text-[var(--text)]">Paramètres</h1>
        </div>
        <div className="flex flex-col gap-0.5 p-2">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                active === id
                  ? "bg-blue-50 text-blue-600 font-medium"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {active === "profile"    && <ProfileSection user={user} />}
        {active === "users"      && <UsersSection />}
        {active === "storage"    && <StorageSection />}
        {active === "appearance" && <AppearanceSection />}
      </main>
    </div>
  );
}
