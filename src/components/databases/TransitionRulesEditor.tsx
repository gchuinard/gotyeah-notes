"use client";
import { useCallback, useRef, useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import type { ParsedDatabaseProperty, SelectOption } from "@/lib/db";
import type { RuleRole, TransitionRule } from "@/lib/permissionRules";
import { useWorkspaceMembers } from "@/lib/client/useWorkspaceMembers";
import { SelectBadge } from "@/components/databases/Cell";

/**
 * « Qui peut mettre une carte ici » — l'éditeur des règles de transition.
 *
 * ⚠️ EXTRAIT de PropertyPopover, pas dupliqué. Il n'y avait qu'UN point de
 * montage — l'en-tête de colonne de la vue Tableau — donc les règles livrées le
 * 05/08 étaient inatteignables depuis un board kanban, et 0 colonne sur 306 en
 * portait une. Ce composant est monté à l'identique par le popover ET par le
 * panneau d'options de la page.
 *
 * ⚠️ Le serveur gate la clé `rules` en ADMIN (sur les deux portes : le PATCH sur
 * la différence, la création sur la présence). Cet écran n'est que du confort —
 * l'autorité reste le 403.
 */

const RULE_ROLE_LABELS: { id: RuleRole; label: string }[] = [
  { id: "admin", label: "Admins" },
  { id: "editor", label: "Éditeurs" },
  { id: "viewer", label: "Lecteurs" },
];

type Props = {
  property: ParsedDatabaseProperty;
  workspaceId: string | null | undefined;
  onPropertyUpdated: (p: ParsedDatabaseProperty) => void;
  /** Ouvert d'emblée dans le panneau de page, replié dans le popover de colonne. */
  defaultOpen?: boolean;
};

export default function TransitionRulesEditor({
  property,
  workspaceId,
  onPropertyUpdated,
  defaultOpen = false,
}: Props) {
  // ⚠️ Options et règles sont lues du CONFIG, jamais d'un état local recopié :
  // le config est réécrit en ENTIER à chaque PATCH, et `onPropertyUpdated`
  // rafraîchit la propriété. Un état local divergerait au premier renommage
  // d'option fait dans le popover pendant que ce panneau est ouvert.
  const options: SelectOption[] = (property.config as { options?: SelectOption[] }).options ?? [];
  const savedRules: TransitionRule[] =
    (property.config as { rules?: TransitionRule[] }).rules ?? [];

  const [open, setOpen] = useState(defaultOpen);
  const [rules, setRules] = useState<TransitionRule[]>(savedRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dernier état réellement persisté : cible de restauration si le serveur refuse.
  const savedRef = useRef<TransitionRule[]>(savedRules);

  // Les membres ne sont chargés qu'à l'ouverture : un écran replié ne paie pas
  // la requête. Clé SWR partagée avec Réglages → Membres.
  const { members } = useWorkspaceMembers(open ? workspaceId ?? null : null);

  const saveRules = useCallback(
    async (next: TransitionRule[]) => {
      setSaving(true);
      setError(null);
      // Une règle sans rôle NI personne n'autoriserait plus personne : on la
      // retire plutôt que de laisser fabriquer une colonne morte.
      const cleaned = next.filter(
        (r) => (r.roles?.length ?? 0) > 0 || (r.userIds?.length ?? 0) > 0
      );
      setRules(cleaned);
      try {
        const res = await fetch(`/api/properties/${property.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { ...property.config, options, rules: cleaned } }),
        });
        if (res.ok) {
          savedRef.current = cleaned;
          onPropertyUpdated((await res.json()) as ParsedDatabaseProperty);
        } else {
          const body = await res.json().catch(() => ({}));
          setRules(savedRef.current);
          setError((body as { error?: string }).error ?? "Modification refusée");
        }
      } catch {
        setRules(savedRef.current);
        setError("Réseau indisponible");
      } finally {
        setSaving(false);
      }
    },
    [property, options, onPropertyUpdated]
  );

  const ruleFor = (optionId: string) => rules.find((r) => r.toOptionId === optionId);

  const toggle = (optionId: string, patch: (r: TransitionRule) => TransitionRule) => {
    const current = ruleFor(optionId) ?? { toOptionId: optionId, roles: [], userIds: [] };
    saveRules([...rules.filter((r) => r.toOptionId !== optionId), patch(current)]);
  };

  const toggleRole = (optionId: string, role: RuleRole) =>
    toggle(optionId, (r) => {
      const roles = new Set(r.roles ?? []);
      if (roles.has(role)) roles.delete(role);
      else roles.add(role);
      return { toOptionId: optionId, roles: [...roles], userIds: r.userIds ?? [] };
    });

  const toggleUser = (optionId: string, userId: string) =>
    toggle(optionId, (r) => {
      const ids = new Set(r.userIds ?? []);
      if (ids.has(userId)) ids.delete(userId);
      else ids.add(userId);
      return { toOptionId: optionId, roles: r.roles ?? [], userIds: [...ids] };
    });

  if (options.length === 0) return null;

  return (
    <div className="px-2 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-1 py-3 md:py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      >
        <Lock size={12} />
        Qui peut mettre une carte ici
        <ChevronDown
          size={12}
          className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 pb-1">
          <p className="px-1 text-[11px] leading-snug text-[var(--text-muted)]">
            Sans règle, tout le monde peut poser l&apos;option. Dès qu&apos;une case est
            cochée, seuls les rôles et les personnes désignés le peuvent —{" "}
            <strong>toi compris</strong> : un administrateur ne contourne pas une règle,
            il la modifie ici.
          </p>
          {error && <p className="px-1 text-[11px] text-red-500">{error}</p>}

          {options.map((opt) => {
            const rule = ruleFor(opt.id);
            const restricted =
              (rule?.roles?.length ?? 0) > 0 || (rule?.userIds?.length ?? 0) > 0;
            return (
              <div key={opt.id} className="px-1 py-1 rounded-md bg-[var(--surface)]">
                <div className="flex items-center gap-1.5 mb-1">
                  <SelectBadge option={opt} />
                  {!restricted && (
                    <span className="text-[10px] text-[var(--text-muted)]">ouverte à tous</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {RULE_ROLE_LABELS.map(({ id, label }) => (
                    <button
                      key={id}
                      disabled={saving}
                      onClick={() => toggleRole(opt.id, id)}
                      className={[
                        "text-[11px] px-2.5 py-2 md:px-1.5 md:py-0.5 rounded border transition-colors",
                        rule?.roles?.includes(id)
                          ? "border-blue-400 text-blue-500 bg-blue-500/10"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                  {members.map((m) => (
                    <button
                      key={m.userId}
                      disabled={saving}
                      onClick={() => toggleUser(opt.id, m.userId)}
                      className={[
                        "text-[11px] px-2.5 py-2 md:px-1.5 md:py-0.5 rounded border transition-colors",
                        rule?.userIds?.includes(m.userId)
                          ? "border-blue-400 text-blue-500 bg-blue-500/10"
                          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]",
                      ].join(" ")}
                    >
                      {m.displayName}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
