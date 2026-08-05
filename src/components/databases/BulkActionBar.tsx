"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import type { KeyedMutator } from "swr";
import type {
  ParsedDatabaseProperty,
  ParsedRecord,
  PropertyValue,
  SelectOption,
} from "@/lib/db";
import { isMultiValueType, withoutUnknownIds } from "@/lib/db";
import { SelectBadge } from "@/components/databases/Cell";
import { useDialog } from "@/contexts/DialogContext";
import { useWorkspaceMembers } from "@/lib/client/useWorkspaceMembers";
import { deniedTransitions } from "@/lib/permissionRules";
import type { TransitionActor, TransitionRule } from "@/lib/permissionRules";

// Barre d'action flottante affichée dès qu'au moins un record est sélectionné.
// Sélection éphémère, propre à la vue (Set<string> d'ids détenu par la vue).
// Pour CHAQUE propriété select/multiselect/utilisateur, propose d'appliquer une
// valeur au groupe : boucle de N PATCH optimistes, échec partiel toléré
// (rollback ciblé).

type Props = {
  properties: ParsedDatabaseProperty[];
  /** Cache SWR courant des records (même clé que la vue). */
  records: ParsedRecord[];
  selectedIds: Set<string>;
  mutate: KeyedMutator<ParsedRecord[]>;
  onClear: () => void;
  /** Espace de la database — source des membres pour les propriétés « utilisateur ». */
  workspaceId?: string;
  /** Identité + rôle, pour les règles de transition par colonne. */
  actor?: TransitionActor;
};

// ─── Menu ouvert VERS LE HAUT (la barre est ancrée en bas de l'écran) ─────────

function MenuUp({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 180);
    const left = Math.min(rect.left, window.innerWidth - minWidth - 8);
    setStyle({
      position: "fixed",
      // ancre au-dessus du bouton : bord bas du menu = bord haut du bouton.
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(8, left),
      minWidth,
      zIndex: 1100,
      visibility: "visible",
    });
  }, [anchorRef]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        anchorRef.current?.contains(e.target as Node) ||
        contentRef.current?.contains(e.target as Node)
      )
        return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={contentRef}
      style={style}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 overflow-y-auto max-h-72"
    >
      {children}
    </div>,
    document.body
  );
}

// ─── Contrôle par propriété select/multiselect ────────────────────────────────

function BulkSelectControl({
  property,
  onApply,
}: {
  property: ParsedDatabaseProperty;
  onApply: (property: ParsedDatabaseProperty, optionId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const options = (property.config as { options?: SelectOption[] }).options ?? [];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
        title={`Appliquer « ${property.name} » à la sélection`}
      >
        <span className="truncate max-w-[120px]">{property.name}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <MenuUp anchorRef={btnRef} onClose={() => setOpen(false)}>
          {options.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-[var(--text-muted)] whitespace-nowrap">
              Aucune option
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onApply(property, opt.id);
                }}
              >
                <SelectBadge option={opt} />
              </button>
            ))
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)] border-t border-[var(--border)]"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onApply(property, null);
            }}
          >
            Retirer la valeur
          </button>
        </MenuUp>
      )}
    </>
  );
}

// ─── Contrôle par propriété « utilisateur » ───────────────────────────────────

function BulkUserControl({
  property,
  workspaceId,
  onApply,
}: {
  property: ParsedDatabaseProperty;
  workspaceId?: string;
  onApply: (property: ParsedDatabaseProperty, userId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { members } = useWorkspaceMembers(workspaceId);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2.5 py-1 text-sm rounded-md bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)]"
        title={`Appliquer « ${property.name} » à la sélection`}
      >
        <span className="truncate max-w-[120px]">{property.name}</span>
        <ChevronDown size={13} className="shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <MenuUp anchorRef={btnRef} onClose={() => setOpen(false)}>
          {members.length === 0 ? (
            <p className="px-3 py-1.5 text-sm text-[var(--text-muted)] whitespace-nowrap">
              Aucun membre
            </p>
          ) : (
            members.map((m) => (
              <button
                key={m.userId}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2 whitespace-nowrap"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onApply(property, m.userId);
                }}
              >
                {m.displayName}
              </button>
            ))
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)] text-[var(--text-muted)] border-t border-[var(--border)]"
            onMouseDown={(e) => {
              e.preventDefault();
              setOpen(false);
              onApply(property, null);
            }}
          >
            Retirer la valeur
          </button>
        </MenuUp>
      )}
    </>
  );
}

// ─── Barre principale ─────────────────────────────────────────────────────────

export default function BulkActionBar({
  properties,
  records,
  selectedIds,
  mutate,
  onClear,
  workspaceId,
  actor,
}: Props) {
  const { alert } = useDialog();
  // Chargé au niveau de la barre (et pas seulement dans le menu « utilisateur »)
  // : l'union d'assignés doit pouvoir écarter les ids qui ne sont plus membres.
  const { members } = useWorkspaceMembers(workspaceId);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selectProps = properties.filter(
    (p) => p.type === "select" || p.type === "multiselect" || p.type === "user"
  );

  // Seuls les ids encore présents dans le cache comptent (un record supprimé
  // reste éventuellement dans le Set — sélection éphémère, on intersecte ici).
  const targets = records.filter((r) => selectedIds.has(r.id));
  const count = targets.length;

  // Applique une valeur au groupe : boucle de PATCH optimistes.
  // - select                  → remplace la valeur par l'option (ou null = vide).
  // - multiselect / user       → ajoute la valeur aux existantes (union, non destructif).
  const applyOption = async (
    property: ParsedDatabaseProperty,
    optionId: string | null
  ) => {
    const all = records.filter((r) => selectedIds.has(r.id));
    if (all.length === 0) return;

    const computeValue = (r: ParsedRecord): PropertyValue | null => {
      if (optionId === null) return null;
      if (isMultiValueType(property.type)) {
        const cur = Array.isArray(r.properties[property.id])
          ? (r.properties[property.id] as string[])
          : [];
        const union = cur.includes(optionId) ? cur : [...cur, optionId];
        // Une carte portant l'id d'un membre parti ferait refuser tout le
        // tableau (400) : l'assignation groupée échouerait sur ces cartes-là,
        // précisément celles qu'on cherche à réattribuer.
        return property.type === "user"
          ? withoutUnknownIds(union, members.map((m) => m.userId))
          : union;
      }
      return optionId;
    };

    // Règles de transition : on écarte AVANT d'écrire les cartes que cet
    // utilisateur n'a pas le droit de faire entrer dans l'option. Sans ce tri,
    // N PATCH partent et N 403 reviennent — le rollback partiel les traiterait
    // comme des pannes réseau, avec le message trompeur « n'a pas pu être mis à
    // jour » au lieu d'un refus explicite. Le filtrage porte AUSSI sur
    // l'optimiste, sinon les cartes bloquées clignotent avant de revenir.
    const rules = (property.config as { rules?: TransitionRule[] }).rules;
    const blockedIds = new Set(
      rules?.length
        ? all
            .filter(
              (r) =>
                deniedTransitions(rules, r.properties[property.id], computeValue(r), actor).length >
                0
            )
            .map((r) => r.id)
        : []
    );
    const batch = all.filter((r) => !blockedIds.has(r.id));

    if (batch.length === 0) {
      await alert({
        title: "Transition non autorisée",
        message:
          all.length === 1
            ? "Tu n'as pas le droit de mettre cette carte dans cette colonne."
            : `Aucune des ${all.length} cartes sélectionnées ne peut aller dans cette colonne.`,
      });
      return;
    }

    const snapshot = records;

    const optimistic = records.map((r) => {
      if (!selectedIds.has(r.id) || blockedIds.has(r.id)) return r;
      const value = computeValue(r);
      const props = { ...r.properties };
      if (value === null) delete props[property.id];
      else props[property.id] = value;
      return { ...r, properties: props };
    });
    mutate(optimistic, { revalidate: false });

    const settled = await Promise.allSettled(
      batch.map((r) => {
        const value = computeValue(r);
        return fetch(`/api/records/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ properties: { [property.id]: value } }),
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
      })
    );

    const failedIds = batch
      .filter((_, i) => settled[i].status === "rejected")
      .map((r) => r.id);

    if (failedIds.length === 0) {
      mutate();
      // Les cartes écartées par une règle ne sont pas un échec : on le dit à
      // part, avec le bon motif, plutôt que de les mélanger aux pannes.
      if (blockedIds.size > 0) {
        await alert({
          title: "Certaines cartes ont été ignorées",
          message: `${blockedIds.size} carte${blockedIds.size > 1 ? "s" : ""} sur ${
            all.length
          } n'${blockedIds.size > 1 ? "ont" : "a"} pas été déplacée${
            blockedIds.size > 1 ? "s" : ""
          } : tu n'as pas le droit de les mettre dans cette colonne. Les autres ont bien été enregistrées.`,
        });
      }
      return;
    }

    // Échec partiel : on garde les succès (déjà dans l'optimiste), on ne
    // restaure QUE les records en échec depuis le snapshot.
    const failedSet = new Set(failedIds);
    const snapById = new Map(snapshot.map((r) => [r.id, r] as const));
    mutate(
      (current) =>
        (current ?? optimistic).map((r) =>
          failedSet.has(r.id) ? snapById.get(r.id) ?? r : r
        ),
      { revalidate: false }
    );

    await alert({
      title: "Mise à jour partielle",
      message: `${failedIds.length} enregistrement${
        failedIds.length > 1 ? "s" : ""
      } sur ${batch.length} n'${
        failedIds.length > 1 ? "ont" : "a"
      } pas pu être mis à jour. Les autres ont bien été enregistrés.`,
      tone: "danger",
    });
  };

  if (!mounted || count === 0) return null;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg)] border border-[var(--border)] shadow-xl max-w-[92vw]">
      <span className="text-sm font-medium text-[var(--text)] tabular-nums px-1 whitespace-nowrap">
        {count} sélectionné{count > 1 ? "s" : ""}
      </span>
      <button
        onClick={onClear}
        className="flex items-center gap-1 px-2 py-1 text-sm rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        title="Tout désélectionner"
      >
        <X size={14} />
        Désélectionner
      </button>
      {selectProps.length > 0 && (
        <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />
      )}
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {selectProps.map((p) =>
          p.type === "user" ? (
            <BulkUserControl
              key={p.id}
              property={p}
              workspaceId={workspaceId}
              onApply={applyOption}
            />
          ) : (
            <BulkSelectControl key={p.id} property={p} onApply={applyOption} />
          )
        )}
      </div>
    </div>,
    document.body
  );
}
