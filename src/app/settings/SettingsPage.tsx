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

// text-base sous sm : iOS Safari zoome sur tout champ dont la police fait moins
// de 16px, et ne dézoome pas au blur. Cette constante habille TOUT l'écran.
const fieldClass =
  "border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] rounded-lg px-3 py-2 text-base sm:text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors w-full";

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
      className="mt-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2.5 md:py-2 text-sm font-medium transition-colors"
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
          className={`${fieldClass} pr-12 md:pr-10`}
        />
        {/* Cible tactile pleine hauteur sous md ; au-dessus, on retrouve exactement
            l'icône flottante d'origine (mêmes offsets, largeur au contenu). */}
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute right-0 top-0 bottom-0 flex w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] md:right-2.5 md:top-1/2 md:bottom-auto md:w-auto md:-translate-y-1/2"
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
        <div className="w-16 h-16 rounded-full bg-blue-500/15 flex items-center justify-center text-xl font-bold text-blue-500">
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
              <Check size={13} className={passwordsMatch ? "text-green-500" : "text-[var(--text-muted)]"} />
            )}
          </div>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className={`${fieldClass} pr-12 md:pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              tabIndex={-1}
              aria-label={showConfirm ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              className="absolute right-0 top-0 bottom-0 flex w-11 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] md:right-2.5 md:top-1/2 md:bottom-auto md:w-auto md:-translate-y-1/2"
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

/**
 * Retour d'envoi : l'écriture a RÉUSSI, seul le mail peut avoir échoué.
 *
 * Le `status` compte autant que `emailSent` : un compte existant devient membre
 * sur-le-champ et n'apparaît jamais dans « En attente », donc lui parler
 * d'« invitation » et le renvoyer vers un bouton « Renvoyer » qu'il ne verra pas
 * serait doublement faux.
 */
function mailNotice(
  body: { emailSent?: boolean; emailReason?: string; status?: string; idpAccount?: string },
  to: string
): string {
  const acquis = body.status === "member" ? `${to} a rejoint l'espace` : "Invitation enregistrée";

  let envoi: string;
  if (body.emailSent) envoi = "Email envoyé.";
  else if (body.emailReason === "disabled") {
    envoi = `L'envoi d'email n'est pas configuré sur cette instance : préviens ${to} toi-même.`;
  } else if (body.emailReason === "http") {
    // Brevo a refusé (expéditeur non vérifié, clé invalide…). Réessayer à
    // l'identique redonnera la même erreur : ne promettons pas le contraire.
    envoi = "Brevo a refusé l'envoi (expéditeur ou clé à vérifier) — préviens la personne toi-même.";
  } else envoi = "L'email n'est pas parti (réseau). Tu peux réessayer.";

  // Sans compte sur l'IdP, l'invité reçoit un message qui l'invite à se
  // connecter… sans pouvoir. C'est le point qui doit remonter à l'admin.
  const idp =
    body.idpAccount === "created"
      ? " Un compte GotYeah a été créé : elle recevra un second message pour choisir son mot de passe."
      : body.idpAccount === "failed"
        ? " ⚠️ En revanche son compte GotYeah n'a PAS pu être créé — crée-le dans Keycloak, sinon elle ne pourra pas se connecter."
        : body.idpAccount === "disabled"
          ? " Si elle n'a pas encore de compte GotYeah, pense à le lui créer dans Keycloak."
          : "";

  return `${acquis}. ${envoi}${idp}`;
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
    // Le message de la dernière invitation décrit une ligne qu'on s'apprête à
    // supprimer : le laisser affiché après coup, c'est afficher une confirmation
    // pour quelque chose qui n'existe plus.
    setNotice(null);
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
      setNotice(mailNotice(body as Parameters<typeof mailNotice>[0], inv.email));
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
      setNotice(mailNotice(body as Parameters<typeof mailNotice>[0], trimmed));
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
    setNotice(null);
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
    setNotice(null);
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
          <form onSubmit={addMember} className="flex flex-col sm:flex-row sm:items-end gap-2 mb-2">
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
                className={`${fieldClass} sm:w-auto`}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={adding || !email.trim()}
              className="shrink-0 flex items-center justify-center gap-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-3 py-2.5 md:py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <UserPlus size={14} />
              {adding ? "Ajout…" : "Ajouter"}
            </button>
          </form>
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Si la personne a déjà un compte, elle rejoint l&apos;espace tout de suite. Sinon
            son accès est réservé et s&apos;ouvrira à sa première connexion, dans un délai de{" "}
            {INVITATION_TTL_DAYS} jours — passé ce délai, renvoie l&apos;invitation. Un email
            est envoyé si l&apos;instance est configurée pour ; le message qui suit
            l&apos;ajout te dira ce qu&apos;il en est. Lecteur par défaut : élève son rôle si besoin.
          </p>
        </>
      )}

      {isAdmin && (invitations ?? []).length > 0 && (
        <div className="mb-4">
          <Label>En attente de première connexion</Label>
          <div className="mt-1.5 flex flex-col divide-y divide-[var(--border)] border border-dashed border-[var(--border)] rounded-lg">
            {(invitations ?? []).map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="w-8 h-8 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <Clock size={14} />
                </div>
                {/* basis pleine ligne (moins l'icône et son gap) sous sm : les deux
                    actions passent en dessous plutôt que d'écraser l'email. */}
                <div className="min-w-0 grow basis-[calc(100%_-_2.75rem)] sm:basis-0">
                  <p className="text-sm text-[var(--text)] truncate">{inv.email}</p>
                  {/* Sans truncate : il coupait par la droite, donc supprimait
                      « expire dans N j » — la seule info actionnable de la ligne. */}
                  <p className="text-xs text-[var(--text-muted)]">
                    {ROLE_OPTIONS.find((r) => r.id === inv.role)?.label ?? inv.role}
                    {inv.invitedByName ? ` · invité par ${inv.invitedByName}` : ""}
                    {` · ${expiryLabel(inv.createdAt)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-11 sm:ml-0">
                  <button
                    onClick={() => resendInvitation(inv)}
                    disabled={resending !== null}
                    title="Renvoyer l'email d'invitation"
                    className="shrink-0 flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40 md:h-auto md:w-auto md:p-1.5"
                  >
                    <Send size={14} />
                  </button>
                  <button
                    onClick={() => revokeInvitation(inv)}
                    title="Annuler l'invitation"
                    className="shrink-0 flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface-hover)] transition-colors md:h-auto md:w-auto md:p-1.5"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      {notice && <p className="text-xs text-[var(--text-muted)] mb-3">{notice}</p>}

      <div className="flex flex-col divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
        {(members ?? []).map((m) => (
          <div key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-500/15 flex items-center justify-center text-sm font-bold text-blue-500 shrink-0">
              {m.displayName.charAt(0).toUpperCase()}
            </div>
            {/* basis pleine ligne (moins l'avatar et son gap) sous sm : rôle et
                retrait passent en dessous plutôt que de réduire le nom à rien. */}
            <div className="min-w-0 grow basis-[calc(100%_-_2.75rem)] sm:basis-0">
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
            <div className="flex items-center gap-3 ml-11 sm:ml-0">
              {isAdmin ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as WorkspaceRole)}
                  title={ROLE_OPTIONS.find((r) => r.id === m.role)?.description}
                  className="shrink-0 text-base sm:text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2 py-2 md:py-1 text-[var(--text)] outline-none focus:border-blue-400"
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
                // Retrait d'un membre : action destructrice, elle jouxtait le
                // sélecteur de rôle sur ~22px de large.
                <button
                  type="button"
                  onClick={() => removeMember(m)}
                  title={m.userId === user.id ? "Quitter l'espace" : "Retirer de l'espace"}
                  className="shrink-0 flex h-10 w-10 items-center justify-center rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors md:h-auto md:w-auto md:p-1"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
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
          className="mt-2 self-start bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-4 py-2.5 md:py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
          ? "bg-[var(--surface-active)] text-[var(--text)]"
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
      {/* 2 colonnes sous sm : à 375px, 3 tuiles réduisaient le libellé du thème
          à une bouillie tronquée. Au-dessus de sm, la grille est inchangée. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-8">
        {lightThemes.map(renderTheme)}
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">Sombres</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

  // Colonne sous md : une nav latérale de 208px + un contenu en p-8 mangeaient
  // 272px de chrome avant le premier champ, sur un écran qui en fait 375.
  return (
    <div className="flex flex-col md:flex-row h-full text-sm">
      {/* Left nav — bandeau d'onglets défilant sous md, colonne au-dessus */}
      <nav className="shrink-0 flex flex-col border-b border-[var(--border)] md:w-52 md:border-b-0 md:border-r">
        <div className="px-4 py-3 md:py-4 border-b border-[var(--border)]">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] mb-3 py-2 md:py-0"
          >
            <ArrowLeft size={13} />
            Retour
          </Link>
          <h1 className="font-semibold text-[var(--text)]">Paramètres</h1>
        </div>
        <div className="flex flex-row overflow-x-auto gap-1 p-2 md:flex-col md:gap-0.5 md:overflow-x-visible">
          {visibleNav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`shrink-0 flex items-center gap-2.5 px-3 py-2.5 md:py-2 rounded-lg text-left whitespace-nowrap transition-colors ${
                effectiveActive === id
                  ? "bg-[var(--surface-active)] text-[var(--text)] font-medium"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <Icon size={15} className="shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {/* min-h-0 : en flex-col, sans lui le contenu pousse le conteneur et le
          défilement interne disparaît. */}
      <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 md:p-8">
        {effectiveActive === "profile"    && <ProfileSection user={user} />}
        {effectiveActive === "users"      && <MembersSection user={user} />}
        {effectiveActive === "storage"    && <StorageSection />}
        {effectiveActive === "appearance" && <AppearanceSection />}
      </main>
    </div>
  );
}
