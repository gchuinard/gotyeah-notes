/**
 * lib/avatar.ts
 * Utilitaires pour les avatars utilisateur.
 * Réutilisable partout dans le projet.
 */

// Palette déterministe : fond 100, texte 600, équivalents dark.
// Les classes sont écrites en entier pour que le scanner Tailwind les inclue.
const PALETTE = [
  "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300",
  "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300",
  "bg-pink-100 dark:bg-pink-900/40 text-pink-600 dark:text-pink-300",
  "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300",
  "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-300",
  "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600 dark:text-cyan-300",
  "bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300",
  "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300",
];

/** Hash djb2 simplifié — stable, pas besoin de crypto. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Retourne les classes Tailwind bg + text pour un utilisateur donné.
 * Déterministe : le même id produit toujours la même couleur.
 */
export function getAvatarColor(id: string): string {
  return PALETTE[hashId(id) % PALETTE.length];
}

/**
 * Génère les initiales à afficher dans l'avatar.
 * - Plusieurs mots → première lettre du premier + première lettre du dernier
 * - Un seul mot  → deux premières lettres
 * Toujours en majuscules.
 */
export function getInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}
