"use client";
import { Check } from "lucide-react";

/**
 * Case de sélection multiple RONDE (avec coche), partagée par KanbanView (carte)
 * et TableView (ligne). Remplace la checkbox carrée native : la sémantique « multi »
 * est portée par la coche, pas par la forme (pattern galerie photo / iOS).
 *
 * `role="checkbox"` + `aria-checked` conservent l'accessibilité. La cible tappable
 * fait 24px (`h-6 w-6`) même si le rond visuel n'en fait que 16, et passe à 32px
 * sous md — 24px au doigt, c'est le rond qu'on rate et la carte qu'on ouvre.
 * ⚠️ Écrit en `max-md:` et non « mobile en base + restauration en `md:` » : le
 * composant reçoit parfois un `absolute` par `className`, et un `relative`/une
 * taille de base réécrits ici se retrouveraient à lutter contre l'appelant.
 * `h-6 w-6` reste donc la valeur de base — celle du desktop, au pixel près.
 * `stopPropagation` (click + pointerdown) empêche l'ouverture de la carte et le drag
 * du parent, comme la checkbox d'origine.
 *
 * L'utilitaire d'affichage (grid / opacity / hidden…) est fourni par `className` :
 * l'appelant gère la visibilité (survol, swap avec le numéro de ligne…).
 */
export function SelectCheckbox({
  selected,
  onToggle,
  label,
  className = "",
}: {
  selected: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={[
        "group/sel place-items-center h-6 w-6 max-md:h-8 max-md:w-8 cursor-pointer rounded-full",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "grid place-items-center h-4 w-4 rounded-full border transition-colors",
          selected
            ? "bg-[var(--accent)] border-[var(--accent)] text-white"
            : "border-[var(--border)] bg-[var(--surface)] group-hover/sel:border-[var(--accent)]",
        ].join(" ")}
      >
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  );
}
