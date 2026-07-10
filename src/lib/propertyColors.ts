/**
 * Palette des couleurs d'option (select / multiselect).
 *
 * SOURCE DE VÉRITÉ PARTAGÉE : le client s'en sert pour les badges (COLOR_MAP dans
 * Cell.tsx, typé Record<SelectColor, string> → exhaustivité vérifiée à la compil)
 * et le serveur pour VALIDER les options entrantes (lib/propertyConfig.ts).
 * Pas de zod ici : ce module est importé côté client.
 */
export const SELECT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;

export type SelectColor = (typeof SELECT_COLORS)[number];
