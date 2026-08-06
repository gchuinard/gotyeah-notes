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
 * ⚠️ `opacity-0` ne désactive PAS les clics : masquée au survol, cette barre
 * restait tapable, et un appui sur le bord d'une carte déclenchait « Dupliquer »
 * — immédiat, sans confirmation, donc création de données. Sur le calendrier son
 * conteneur couvre tout le bord droit de la pilule, ce qui rendait le tir facile.
 *
 * Le correctif est la VISIBILITÉ sous md : il n'y a pas de survol au doigt, donc
 * on montre ce qu'on peut toucher. Au-dessus de md, le comportement historique
 * est conservé tel quel — une souris révèle avant de cliquer.
 *
 * ⚠️ Ne pas « compléter » avec `pointer-events-none` sur la branche invisible :
 * l'ajout paraît rigoureux mais casse le clic après survol dans Playwright (qui
 * refuse de cliquer une cible sans pointer-events et attend le timeout), pour
 * corriger un risque qui n'existe que sur tactile — là où les actions sont
 * désormais visibles.
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
        "opacity-100 md:opacity-0",
        "md:group-hover:opacity-100",
        "md:focus-within:opacity-100",
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
