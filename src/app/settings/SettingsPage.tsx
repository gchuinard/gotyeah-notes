"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import {
  ArrowLeft, User, Users, HardDrive, Palette,
  Eye, EyeOff, Check, Trash2, UserPlus, Clock, X, Bot, Send,
} from "lucide-react";
import type { SessionUser } from "@/lib/session";
import { useWorkspace, type WorkspaceRole } from "@/contexts/WorkspaceContext";
import { useDialog } from "@/contexts/DialogContext";

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
  { id: "profile",    label: "Profil",    icon: User },
  { id: "users",      label: "Membres",   icon: Users },
  { id: "storage",    label: "Stockage",  icon: HardDrive },
  { id: "appearance", label: "Apparence", icon: Palette },
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

type Member = {
  userId: string;
  role: WorkspaceRole;
  email: string;
  displayName: string;
  /** Compte de SERVICE (pont MCP) : il voit les pages PRIVÉES de cet espace. */
  isService?: boolean;
  createdAt: string;
};

/** Pré-autorisation en attente : l'email n'a pas encore de compte. */
type Invitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
  invitedByName: string | null;
};

const ROLE_OPTIONS: { id: WorkspaceRole; label: string; description: string }[] = [
  { id: "viewer", label: "Lecteur", description: "Lecture seule totale" },
  { id: "editor", label: "Éditeur", description: "Crée et modifie le contenu" },
  { id: "admin",  label: "Admin",   description: "Structure, suppressions définitives, membres" },
];

const membersFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

/** Doit rester aligné sur INVITATION_TTL_DAYS (lib/invitations.ts). */
const INVITATION_TTL_DAYS = 7;

/**
 * « expire dans N jours ». Affiché parce qu'une invitation périmée est
 * silencieuse : sans repère de temps, l'admin attend une connexion qui ne peut
 * plus arriver, au lieu de cliquer « Renvoyer ».
 */
function expiryLabel(createdAt: string): string {
  const end = new Date(createdAt).getTime() + INVITATION_TTL_DAYS * 86_400_000;
  const days = Math.ceil((end - Date.now()) / 86_400_000);
  if (days <= 0) return "expirée";
  return days === 1 ? "expire demain" : `expire dans ${days} j`;
}

/** Retour d'envoi : l'invitation est écrite, seul le mail peut avoir échoué. */
function mailNotice(body: { emailSent?: boolean; emailReason?: string }, to: string): string {
  if (body.emailSent) return `Email envoyé à ${to}.`;
  if (body.emailReason === "disabled") {
    return `Invitation enregistrée. L'envoi d'email n'est pas configuré sur cette instance : préviens ${to} toi-même.`;
  }
  return `Invitation enregistrée, mais l'email n'est pas parti. Réessaie avec « Renvoyer ».`;
}

/** Membres de l'ESPACE ACTIF : liste, ajout par email (compte existant), rôle, retrait. */
function MembersSection({ user }: { user: SessionUser }) {
  const { activeWorkspace, isAdmin } = useWorkspace();
  const { confirm } = useDialog();
  const wsId = activeWorkspace?.id ?? null;
  const key = wsId ? `/api/workspaces/${wsId}/members` : null;
  const { data: members, mutate } = useSWR<Member[]>(key, membersFetcher);
  // Route SÉPARÉE de /members à dessein : cette clé-là est partagée avec le board
  // (useWorkspaceMembers), y mêler des invités sans userId ferait apparaître des
  // assignés fantômes dans les cellules et les colonnes kanban. Admin seulement.
  const invitationsKey = wsId && isAdmin ? `/api/workspaces/${wsId}/invitations` : null;
  const { data: invitations, mutate: mutateInvitations } =
    useSWR<Invitation[]>(invitationsKey, membersFetcher);

  const [email, setEmail]   = useState("");
  // Moindre privilège : lecteur proposé par défaut, on élève explicitement.
  const [role, setRole]     = useState<WorkspaceRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  // Distinct de `error` : l'invitation a RÉUSSI, c'est l'email qui peut manquer.
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  // Se retirer / se rétrograder soi-même change son propre rôle → resynchroniser
  // la liste des workspaces (badge lecture seule, entrées de nav, etc.).
  const refreshSelf = (targetUserId: string) => {
    if (targetUserId === user.id) globalMutate("/api/workspaces");
  };

  const revokeInvitation = async (inv: Invitation) => {
    if (!wsId) return;
    const ok = await confirm({
      title: "Annuler l'invitation",
      message: `${inv.email} ne rejoindra pas cet espace. Tu pourras la réinviter plus tard.`,
      confirmLabel: "Annuler l'invitation",
      tone: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/workspaces/${wsId}/invitations/${inv.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`Impossible d'annuler l'invitation (${res.status}).`);
      return;
    }
    mutateInvitations();
  };

  /**
   * Renvoyer = RÉ-INVITER. Aucune route dédiée : POST /members fait déjà un
   * upsert sur (workspace, email), qui rafraîchit la date d'émission — donc
   * prolonge les 7 jours — et repart l'email. Une route « resend » n'aurait rien
   * ajouté qu'une entrée de plus à déclarer dans le méta-test des gates.
   */
  const resendInvitation = async (inv: Invitation) => {
    if (!wsId || resending) return;
    setResending(inv.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inv.email, role: inv.role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
        return;
      }
      setNotice(mailNotice(body as { emailSent?: boolean }, inv.email));
      mutateInvitations();
    } catch {
      setError("Impossible de renvoyer l'invitation.");
    } finally {
      setResending(null);
    }
  };

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!wsId || !trimmed || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${wsId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
        return;
      }
      setEmail("");
      setRole("viewer");
      setNotice(mailNotice(body as { emailSent?: boolean }, trimmed));
      // 201 = pas encore de compte : la personne apparaît dans « invitations en
      // attente », pas dans les membres. On rafraîchit les deux listes plutôt que
      // de deviner laquelle a bougé.
      mutate();
      mutateInvitations();
    } catch {
      setError("Impossible d'ajouter le membre.");
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (m: Member, newRole: WorkspaceRole) => {
    if (!wsId || newRole === m.role) return;
    setError(null);
    const res = await fetch(`/api/workspaces/${wsId}/members/${m.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    mutate();
    refreshSelf(m.userId);
  };

  const removeMember = async (m: Member) => {
    if (!wsId) return;
    const self = m.userId === user.id;
    const ok = await confirm({
      title: self ? "Quitter cet espace ?" : `Retirer ${m.displayName} ?`,
      message: self
        ? "Tu perdras l'accès à cet espace (un admin pourra te ré-ajouter)."
        : `${m.displayName} perdra l'accès à cet espace.`,
      confirmLabel: self ? "Quitter" : "Retirer",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/workspaces/${wsId}/members/${m.userId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
    }
    mutate();
    refreshSelf(m.userId);
  };

  if (!activeWorkspace) {
    return (
      <div className="max-w-lg">
        <SectionTitle title="Membres" description="Aucun espace actif." />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <SectionTitle
        title={`Membres de « ${activeWorkspace.name} »`}
        description="Qui a accès à cet espace, et avec quel rôle."
      />

      {/* Ajout par email — le compte doit déjà exister (connexion GotYeah). */}
      {isAdmin && (
        <>
          <form onSubmit={addMember} className="flex items-end gap-2 mb-2">
            <div className="flex-1 flex flex-col gap-1.5">
              <Label>Ajouter par email</Label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); setNotice(null); }}
                placeholder="email@exemple.fr"
                className={fieldClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Rôle</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as WorkspaceRole)}
                className={`${fieldClass} w-auto`}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={adding || !email.trim()}
              className="shrink-0 flex items-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <UserPlus size={14} />
              {adding ? "Ajout…" : "Ajouter"}
            </button>
          </form>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Si la personne a déjà un compte, elle rejoint l&apos;espace tout de suite. Sinon
            son accès est réservé et s&apos;ouvrira à sa première connexion. Dans les deux cas
            elle reçoit un email. L&apos;invitation vaut {INVITATION_TTL_DAYS} jours ; passé ce
            délai, renvoie-la. Lecteur par défaut : élève son rôle si besoin.
          </p>
        </>
      )}

      {isAdmin && (invitations ?? []).length > 0 && (
        <div className="mb-4">
          <Label>En attente de première connexion</Label>
          <div className="mt-1.5 flex flex-col divide-y divide-[var(--border)] border border-dashed border-[var(--border)] rounded-lg">
            {(invitations ?? []).map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <Clock size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text)] truncate">{inv.email}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {ROLE_OPTIONS.find((r) => r.id === inv.role)?.label ?? inv.role}
                    {inv.invitedByName ? ` · invité par ${inv.invitedByName}` : ""}
                    {` · ${expiryLabel(inv.createdAt)}`}
                  </p>
                </div>
                <button
                  onClick={() => resendInvitation(inv)}
                  disabled={resending !== null}
                  title="Renvoyer l'email d'invitation"
                  className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40"
                >
                  <Send size={14} />
                </button>
                <button
                  onClick={() => revokeInvitation(inv)}
                  title="Annuler l'invitation"
                  className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      {notice && <p className="text-xs text-[var(--text-muted)] mb-3">{notice}</p>}

      <div className="flex flex-col divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
        {(members ?? []).map((m) => (
          <div key={m.userId} className="flex items-center gap-3 px-3 py-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600 shrink-0">
              {m.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text)] truncate flex items-center gap-1.5">
                {m.displayName}
                {m.userId === user.id && (
                  <span className="text-xs text-[var(--text-muted)]">(toi)</span>
                )}
                {m.isService && (
                  <span
                    title="Compte de service : il voit aussi les pages privées de cet espace."
                    className="inline-flex items-center gap-1 text-[10px] font-normal uppercase tracking-wide text-[var(--text-muted)] border border-[var(--border)] rounded px-1 py-0.5"
                  >
                    <Bot size={10} /> service
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">{m.email}</p>
            </div>
            {isAdmin ? (
              <select
                value={m.role}
                onChange={(e) => changeRole(m, e.target.value as WorkspaceRole)}
                title={ROLE_OPTIONS.find((r) => r.id === m.role)?.description}
                className="shrink-0 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2 py-1 text-[var(--text)] outline-none focus:border-blue-400"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            ) : (
              <span className="shrink-0 text-xs text-[var(--text-muted)]">
                {ROLE_OPTIONS.find((r) => r.id === m.role)?.label ?? m.role}
              </span>
            )}
            {(isAdmin || m.userId === user.id) && (
              <button
                type="button"
                onClick={() => removeMember(m)}
                title={m.userId === user.id ? "Quitter l'espace" : "Retirer de l'espace"}
                className="shrink-0 p-1 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {members === undefined && (
          <p className="px-3 py-4 text-xs text-[var(--text-muted)]">Chargement…</p>
        )}
      </div>
    </div>
  );
}

function StorageSection() {
  const [maxMb, setMaxMb]   = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setMaxMb(typeof d.uploadMaxMb === "number" ? d.uploadMaxMb : 10))
      .catch(() => setMaxMb(10));
  }, []);

  const save = async () => {
    if (maxMb == null) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadMaxMb: maxMb }),
      });
      if (res.ok) {
        const d = await res.json();
        setMaxMb(d.uploadMaxMb);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <SectionTitle
        title="Stockage"
        description="Fichiers et médias (captures d'écran collées dans l'éditeur)."
      />

      <div className="flex flex-col gap-5">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">Disque local</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Les images sont stockées sur le serveur (dossier <code>data/uploads</code>, sur le
            volume Docker) et servies via <code>/api/files</code> avec session. Le stockage cloud
            (S3/R2/GCS/B2) n&apos;est pas encore branché.
          </p>
        </div>

        <Divider />

        <div className="flex flex-col gap-1.5">
          <Label>Taille maximale par fichier (Mo)</Label>
          <input
            type="number"
            min={1}
            max={200}
            value={maxMb ?? ""}
            disabled={maxMb == null}
            onChange={(e) => {
              setSaved(false);
              setMaxMb(Math.max(1, Math.min(200, Math.round(Number(e.target.value)) || 1)));
            }}
            className={`${fieldClass} max-w-[160px]`}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Au-delà, l&apos;upload est refusé. Les fichiers orphelins sont purgés après 30 jours.
          </p>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving || maxMb == null}
          className="mt-2 self-start bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Enregistrement…" : saved ? "Enregistré ✓" : "Enregistrer"}
        </button>
      </div>
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
  const { workspaces } = useWorkspace();

  // Membres : liste visible par tout membre (gestion réservée admin dans l'écran).
  // Stockage : config d'INSTANCE, réservée aux admins d'au moins un espace (le
  // serveur refuse en 403 de toute façon — le masquage n'est que du confort).
  const adminSomewhere = workspaces.some((w) => w.role === "admin");
  const visibleNav = NAV.filter(({ id }) => id !== "storage" || adminSomewhere);
  const effectiveActive = visibleNav.some((n) => n.id === active) ? active : "profile";

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
          {visibleNav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                effectiveActive === id
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
        {effectiveActive === "profile"    && <ProfileSection user={user} />}
        {effectiveActive === "users"      && <MembersSection user={user} />}
        {effectiveActive === "storage"    && <StorageSection />}
        {effectiveActive === "appearance" && <AppearanceSection />}
      </main>
    </div>
  );
}
