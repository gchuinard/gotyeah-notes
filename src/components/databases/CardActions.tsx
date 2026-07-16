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
 */
export default function CardActions({
  onDuplicate,
  onDelete,
  className = "",
}: {
  onDuplicate: () => void;
  onDelete: () => void;
  /** Positionnement/layout du conteneur (absolute pour le kanban, inline pour le backlog). */
  className?: string;
}) {
  return (
    <div
      className={[
        "flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Dupliquer"
        title="Dupliquer"
        onClick={withStopPropagation(onDuplicate)}
        onPointerDown={(e) => e.stopPropagation()}
        className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
      >
        <Copy size={14} />
      </button>
      <button
        type="button"
        aria-label="Supprimer"
        title="Supprimer"
        onClick={withStopPropagation(onDelete)}
        onPointerDown={(e) => e.stopPropagation()}
        className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--surface-hover)]"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
