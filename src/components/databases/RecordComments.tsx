"use client";
import { useState } from "react";
import useSWR from "swr";
import { Send } from "lucide-react";

/**
 * Fil de discussion d'une carte.
 *
 * ⚠️ APPEND-ONLY : ni modification ni suppression, décision de Gautier du 09/08.
 * Donc aucun bouton au survol, aucune modale, aucune mention « modifié ».
 *
 * ⚠️ Monté à la DEMANDE (l'onglet n'existe qu'ouvert) : fetch paresseux, même
 * patron que l'onglet Historique. Pas de compteur sur l'étiquette de l'onglet —
 * il exigerait de charger le fil à chaque ouverture de carte, sur un Pi, pour un
 * chiffre.
 */

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: string | null;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Date et heure lisibles. Intl est natif — aucune dépendance ajoutée. */
const horodatage = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function RecordComments({
  recordId,
  readOnly,
}: {
  recordId: string;
  readOnly: boolean;
}) {
  const key = `/api/records/${recordId}/comments`;
  const { data: items = [], mutate } = useSWR<Comment[]>(key, fetcher);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publier() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setDraft("");
        // ⚠️ On insère la LIGNE RENDUE PAR LE SERVEUR, sans refaire de GET.
        // Deux raisons. (1) Le fil est append-only : la réponse EST la vérité,
        // il n'y a rien à réconcilier et donc aucun rollback à prévoir.
        // (2) Deux publications rapprochées faisaient dédupliquer le second
        // `mutate()` par SWR — la requête du premier était encore en vol, la
        // seconde était absorbée, et rien ne relançait ensuite : le message
        // n'apparaissait qu'à la revalidation suivante (focus de la fenêtre).
        const cree = (await res.json()) as Comment;
        await mutate((prev = []) => [cree, ...prev], { revalidate: false });
      } else {
        const b = await res.json().catch(() => ({}));
        setError((b as { error?: string }).error ?? "Publication refusée");
      }
    } catch {
      setError("Réseau indisponible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {!readOnly && (
        // Le composeur est EN HAUT, avec le fil antichronologique dessous : sur
        // un panneau plein écran au téléphone, un composeur en bas passe sous le
        // clavier virtuel dès qu'on le touche.
        <div className="px-4 md:px-6 py-3 border-b border-[var(--border)] shrink-0">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Entrée publie, Maj+Entrée passe à la ligne — un commentaire est
              // court, l'envoi doit être le geste par défaut.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void publier();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Écrire un commentaire… (Entrée pour publier)"
            className="w-full px-2 py-2 text-sm rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] focus:border-blue-400 focus:outline-none resize-none"
          />
          <div className="flex items-center gap-2 mt-1.5">
            {error && <span className="text-xs text-red-500">{error}</span>}
            <button
              onClick={publier}
              disabled={busy || draft.trim().length === 0}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-2 md:py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
            >
              <Send size={12} />
              {busy ? "Envoi…" : "Publier"}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-3">
        {items.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            Aucun commentaire.
            {readOnly ? "" : " Une remarque posée ici ne risque pas d'être écrasée par une mise à jour du corps."}
          </p>
        ) : (
          <ul data-comment-list className="flex flex-col gap-3">
            {items.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium text-[var(--text)]">
                    {/* Auteur supprimé (SetNull) : on dégrade sans casser la phrase. */}
                    {c.author ?? "Quelqu'un"}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {horodatage.format(new Date(c.createdAt))}
                  </span>
                </div>
                {/* whitespace-pre-line : les retours à la ligne saisis sont rendus. */}
                <p className="text-sm text-[var(--text)] whitespace-pre-line break-words">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
