/**
 * lib/avatar.ts
 * Utilitaires pour les avatars utilisateur.
 * Réutilisable partout dans le projet.
 */

// Palette déterministe : bulles pastel (fond 100, texte 600), identiques sur tous
// les thèmes. Les classes sont écrites en entier pour que le scanner Tailwind les inclue.
const PALETTE = [
  "bg-blue-100 text-blue-600",
  "bg-purple-100 text-purple-600",
  "bg-pink-100 text-pink-600",
  "bg-amber-100 text-amber-600",
  "bg-emerald-100 text-emerald-600",
  "bg-cyan-100 text-cyan-600",
  "bg-orange-100 text-orange-600",
  "bg-indigo-100 text-indigo-600",
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
