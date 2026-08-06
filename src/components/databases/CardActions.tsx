"use client";
import { Copy, Trash2 } from "lucide-react";

/**
 * Stoppe la propagation de l'événement (pour ne pas ouvrir la carte / le
 * RecordPanel ni démarrer le drag du parent) puis exécute l'action.
 * Exporté pour être testé unitairement (pas de DOM en environnement node).
 */
export function withStopPropagation(action: () => void) {
  return (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    action();
  };
}

/**
 * Deux boutons-icônes directs (Dupliquer / Supprimer) affichés au survol de la
 * carte, en remplacement de l'ancien menu ⋯. Partagé par KanbanView (carte) et
 * BacklogView (ligne d'issue). La duplication est immédiate ; la confirmation de
 * suppression reste gérée par l'appelant (useDialog().confirm).
 *
 * ⚠️ `opacity-0` ne désactive PAS les clics : la version « masquée au survol »
 * restait tapable au doigt, et un appui sur le bord d'une carte déclenchait
 * « Dupliquer » — immédiat, sans confirmation, donc création de données. D'où
 * les deux mesures ci-dessous, indissociables :
 *   1. sous md il n'y a pas de survol → les actions sont VISIBLES (on tape ce
 *      qu'on voit) ;
 *   2. à partir de md, `pointer-events-none` accompagne l'opacité pour que la
 *      branche invisible cesse d'être une cible — le survol (ou le focus
 *      clavier) rend l'un et l'autre en même temps.
 */
export default function CardActions({
  onDuplicate,
  onDelete,
  className = "",
}: {
  onDuplicate: () => void;
  /** Omis = pas de bouton Supprimer. Galerie et Calendrier n'en exposaient aucun ;
   *  ce lot n'ajoute que la duplication, il n'invente pas une affordance de
   *  suppression là où il n'y en avait pas. */
  onDelete?: () => void;
  /** Positionnement/layout du conteneur (absolute pour le kanban, inline pour le backlog). */
  className?: string;
}) {
  return (
    <div
      // ⚠️ Sur le CONTENEUR, pas seulement sur les boutons : la gouttière entre
      // les deux icônes — et toute zone du conteneur non couverte par un bouton —
      // laisserait sinon le clic remonter au parent, qui ouvre la carte (kanban),
      // ou pire CRÉE un enregistrement (case du calendrier).
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={[
        "flex items-center gap-0.5 transition-opacity",
        "opacity-100 md:opacity-0 md:pointer-events-none",
        "md:group-hover:opacity-100 md:group-hover:pointer-events-auto",
        "md:focus-within:opacity-100 md:focus-within:pointer-events-auto",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Dupliquer"
        title="Dupliquer"
        onClick={withStopPropagation(onDuplicate)}
        onPointerDown={(e) => e.stopPropagation()}
        // Le padding est la seule variable d'ajustement : l'icône fait 14px, et
        // la pilule du calendrier (24px de haut) interdit une cible plus large.
        className="p-1.5 md:p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
      >
        <Copy size={14} />
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label="Supprimer"
          title="Supprimer"
          onClick={withStopPropagation(onDelete)}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1.5 md:p-0.5 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface-hover)]"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
