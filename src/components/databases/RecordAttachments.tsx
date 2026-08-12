"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { useDialog } from "@/contexts/DialogContext";
import { fetcher, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";

/**
 * Pièces jointes d'une carte — dépôt, téléchargement, retrait.
 *
 * ⚠️ Le retrait est DÉFINITIF (décision de Gautier, 08/08) et la modale le dit.
 * Un `deletedAt` n'aurait rien acheté : la purge borne sur l'âge du FICHIER, pas
 * sur la date de retrait — un document joint il y a six mois et détaché par
 * erreur serait supprimé au passage suivant, tandis que seuls ceux qu'on vient
 * de poser survivraient. L'inverse de ce qu'une corbeille promet.
 */

type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: string | null;
};

/** Taille lisible. Intl est natif — aucune dépendance ajoutée. */
function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  const ko = octets / 1024;
  if (ko < 1024) return `${Math.round(ko)} Ko`;
  return `${(ko / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export default function RecordAttachments({
  recordId,
  readOnly,
}: {
  recordId: string;
  readOnly: boolean;
}) {
  const key = `/api/records/${recordId}/attachments`;
  // La clé répond 404 dès que la carte part à la corbeille sous les yeux du
  // lecteur : c'est un refus définitif, pas une panne — on ne le réessaie pas.
  const {
    data: items = [],
    mutate,
    error: loadError,
  } = useSWR<Attachment[]>(key, fetcher, noRetryOn4xx);
  const [busy, setBusy] = useState(false);
  // ⚠️ DISTINCT de `loadError` : ici c'est le refus du serveur au DÉPÔT ou au
  // RETRAIT, avec son propre message (type, taille). Les confondre l'écraserait.
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm } = useDialog();

  async function deposer(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(key, { method: "POST", body: form });
      if (res.ok) await mutate();
      else {
        const body = await res.json().catch(() => ({}));
        // Les messages du serveur portent la vraie contrainte (type, taille) :
        // on les affiche tels quels plutôt que d'en réinventer un.
        setError((body as { error?: string }).error ?? "Dépôt refusé");
      }
    } catch {
      setError("Réseau indisponible");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function retirer(a: Attachment) {
    const ok = await confirm({
      title: "Retirer ce document ?",
      // ⚠️ Dire qu'il n'y a pas de retour : il n'y en a pas.
      message: `« ${a.name} » sera retiré de cette carte. C'est définitif — il n'y a pas de corbeille pour les documents.`,
      confirmLabel: "Retirer",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" });
    if (res.ok) await mutate();
    else setError("Retrait refusé");
  }

  return (
    <div className="px-4 md:px-6 py-3 border-t border-[var(--border)]">
      <div className="flex items-center gap-2 mb-2">
        <Paperclip size={14} className="text-[var(--text-muted)]" />
        <span className="text-sm text-[var(--text-muted)]">
          Documents{items.length > 0 ? ` (${items.length})` : ""}
        </span>
        {!readOnly && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 px-2 py-2 md:py-1 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-60"
          >
            <Upload size={12} />
            {busy ? "Dépôt…" : "Ajouter"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void deposer(f);
          }}
        />
      </div>

      {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

      {loadError ? (
        // ⚠️ L'échec de LECTURE passe AVANT « Aucun document ». Ce composant vient
        // d'apprendre à l'utilisateur qu'un retrait est DÉFINITIF : une liste
        // vide affichée alors que le serveur n'a pas répondu se lirait comme une
        // suppression, et il chercherait un document que personne n'a retiré.
        <p className="text-xs text-red-500">{loadErrorMessage(loadError)}</p>
      ) : items.length === 0 ? (
        // Une ligne, pas une zone de dépôt en pointillés : c'est l'état le plus
        // fréquent, il ne doit pas occuper le tiers du panneau.
        <p className="text-xs text-[var(--text-muted)]">Aucun document.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="group flex items-center gap-2 px-2 py-2 md:py-1.5 rounded bg-[var(--surface)] text-sm"
            >
              <a
                href={`/api/attachments/${a.id}`}
                className="flex items-center gap-2 min-w-0 flex-1 text-[var(--text)] hover:underline"
              >
                <Download size={12} className="shrink-0 text-[var(--text-muted)]" />
                <span className="truncate">{a.name}</span>
              </a>
              <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                {tailleLisible(a.size)}
                {a.uploadedBy ? ` · ${a.uploadedBy}` : ""}
              </span>
              {!readOnly && (
                <button
                  onClick={() => retirer(a)}
                  // Visible au doigt, révélé au survol sur desktop : le survol
                  // n'existe pas au tactile, et le panneau y est plein écran.
                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 shrink-0 p-2 md:p-0.5 rounded text-[var(--text-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors"
                  title="Retirer"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
