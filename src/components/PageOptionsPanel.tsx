"use client";
import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { Table2 } from "lucide-react";
import Portal from "@/components/databases/portal";
import TransitionRulesEditor from "@/components/databases/TransitionRulesEditor";
import type { ParsedDatabaseProperty } from "@/lib/db";
import type { TreeNode } from "@/lib/tree";

/**
 * Réglages d'UN élément de la barre latérale — page ou tableau.
 *
 * ⚠️ POURQUOI CE PANNEAU EXISTE. Les règles de transition (« qui peut mettre une
 * carte ici ») n'avaient qu'UN point de montage : l'en-tête de colonne de la vue
 * TABLEAU. Sur un board qui n'a qu'un kanban, elles étaient inatteignables —
 * d'où 0 colonne sur 306 en portant une, un mois après la livraison. Même
 * famille que `patchNotesPageId`, resté null sur 20 boards faute d'écran.
 *
 * ⚠️ Le contenu est chargé PARESSEUSEMENT à l'ouverture. L'arbre
 * (`GET /api/pages`) ne dit PAS si une page est une database, et on n'y ajoute
 * pas de drapeau : cette clé SWR est partagée, et la conversion en database ne
 * la revalide pas — le drapeau serait faux jusqu'au prochain rechargement.
 */

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type PageDetail = { id: string; database: { id: string } | null };
type DatabaseDetail = {
  workspaceId: string;
  properties: ParsedDatabaseProperty[];
};

type Props = {
  node: TreeNode;
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Clé SWR de l'arbre, à revalider après un renommage. */
  pagesKey: string | null;
  /** Les règles d'accès sont réservées aux admins — le serveur le gate aussi (403). */
  isAdmin: boolean;
  readOnly: boolean;
};

export default function PageOptionsPanel({
  node,
  anchor,
  onClose,
  pagesKey,
  isAdmin,
  readOnly,
}: Props) {
  const [title, setTitle] = useState(node.title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: page } = useSWR<PageDetail>(`/api/pages/${node.id}`, fetcher);
  const databaseId = page?.database?.id ?? null;
  const { data: database } = useSWR<DatabaseDetail>(
    databaseId ? `/api/databases/${databaseId}` : null,
    fetcher
  );

  // Le focus entre dans le panneau à l'ouverture, et le champ de renommage est
  // ce qu'on vient y faire neuf fois sur dix. Au clavier, c'est aussi ce qui
  // rend Échap utile : sans focus dedans, la touche n'atteindrait pas le panneau.
  useEffect(() => {
    if (!readOnly) inputRef.current?.focus();
  }, [readOnly]);

  async function rename() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === node.title) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pages/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok && pagesKey) await mutate(pagesKey);
      else if (!res.ok) setTitle(node.title); // rollback : le serveur a refusé
    } catch {
      setTitle(node.title);
    } finally {
      setSaving(false);
    }
  }

  const selectProps = (database?.properties ?? []).filter(
    (p) => p.type === "select" || p.type === "multiselect"
  );

  return (
    <Portal
      anchor={anchor}
      onClose={onClose}
      closeOnEscape
      minWidth={280}
      className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg overflow-y-auto max-h-[70vh] w-[min(22rem,calc(100vw-1rem))]"
    >
      <div className="px-3 pt-3 pb-2">
        <label
          htmlFor={`rename-${node.id}`}
          className="block text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1"
        >
          Nom
        </label>
        <input
          id={`rename-${node.id}`}
          ref={inputRef}
          value={title}
          disabled={readOnly || saving}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void rename();
            }
          }}
          className="w-full px-2 py-2 md:py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-blue-400 focus:outline-none disabled:opacity-60"
        />
      </div>

      {/* ⚠️ PAS de ligne « page privée / page d'équipe » ici, et ce n'est pas un
          oubli. L'écrire demandait de tester la confidentialité à la main, ce que
          le méta-test de service-account.test.ts interdit hors de lib/workspace.ts
          — un test réécrit échapperait à l'exemption du compte de service. La
          garde vaut plus qu'un libellé, d'autant que l'information est déjà à
          l'écran : la barre latérale range la page sous « PAGES PRIVÉES » ou
          « ESPACE D'ÉQUIPE ».

          ⚠️ Et la garde scanne le TEXTE du fichier : même citée dans un
          commentaire, l'expression la déclenche. Ne pas la réécrire ici. */}

      {databaseId && (
        <div className="border-t border-[var(--border)]">
          <div className="px-3 py-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Table2 size={12} />
            Tableau
          </div>

          {!isAdmin ? (
            // ⚠️ Affiché plutôt que masqué : un écran muet enverrait chercher une
            // panne. Et `isAdmin` vaut false pendant tout le chargement du rôle.
            <p className="px-3 pb-3 text-[11px] leading-snug text-[var(--text-muted)]">
              Les règles d&apos;accès aux colonnes sont réservées aux administrateurs
              de cet espace.
            </p>
          ) : selectProps.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] leading-snug text-[var(--text-muted)]">
              Aucune colonne à options. Une règle porte sur une valeur de colonne
              — il faut donc une colonne « sélection » pour en poser une.
            </p>
          ) : (
            selectProps.map((p) => (
              <div key={p.id} className="border-t border-[var(--border)] pt-1">
                <p className="px-3 pt-1 text-xs font-medium text-[var(--text)]">{p.name}</p>
                <TransitionRulesEditor
                  property={p}
                  workspaceId={database?.workspaceId}
                  onPropertyUpdated={() => {
                    if (databaseId) void mutate(`/api/databases/${databaseId}`);
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </Portal>
  );
}
