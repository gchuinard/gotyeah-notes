/**
 * Position Float à écrire pour un élément déplacé entre deux voisins, en
 * exploitant le gap-based ordering (miroir CLIENT de lib/positions.ts, qui lui
 * touche la DB). On n'écrit QUE l'élément déplacé : aucune renumérotation des
 * autres, on insère une valeur intermédiaire dans le gap laissé par nextPosition().
 *
 * @param prev position du voisin de gauche, ou null si l'élément passe en tête
 * @param next position du voisin de droite, ou null si l'élément passe en fin
 * @param gap  écart par défaut quand il manque un voisin encadrant (défaut 1000,
 *             cohérent avec nextPosition)
 * @returns
 *  - entre deux voisins → (prev + next) / 2 (strictement entre les deux)
 *  - en tête (prev absent) → next / 2 (strictement < next tant que next > 0)
 *  - en fin (next absent) → prev + gap (strictement > prev)
 *  - liste réduite au seul élément déplacé (aucun voisin) → gap
 */
export function intermediatePosition(
  prev: number | null,
  next: number | null,
  gap = 1000
): number {
  if (prev !== null && next !== null) return (prev + next) / 2;
  if (prev !== null) return prev + gap;
  if (next !== null) return next / 2;
  return gap;
}
