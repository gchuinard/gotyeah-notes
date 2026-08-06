import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { INVITATION_TTL_DAYS } from "@/lib/invitations";

/**
 * Garde de SYNCHRO du TTL d'invitation entre le serveur et l'écran Membres.
 *
 * La duplication est CONTRAINTE, pas paresseuse : `lib/invitations.ts` importe
 * `lib/prisma`, donc l'importer depuis un composant `"use client"` tirerait
 * better-sqlite3 (addon natif) dans le bundle navigateur — exactement la raison
 * pour laquelle `lib/permissionRules.ts` est à zéro import et redéclare son rang
 * de rôles. Ce projet garde ces redéclarations par un test ; celle-ci ne l'était
 * pas.
 *
 * Le mode de panne, si le serveur passe à 14 j et pas l'écran : aucune erreur,
 * aucun test rouge, juste une liste qui annonce « expirée » à des invitations
 * parfaitement valides — et un admin qui renvoie pour rien.
 */
const settings = readFileSync("src/app/settings/SettingsPage.tsx", "utf8");

describe("INVITATION_TTL_DAYS — serveur et écran Membres", () => {
  it("l'écran redéclare exactement la valeur du serveur", () => {
    const m = /const INVITATION_TTL_DAYS = (\d+);/.exec(settings);
    // Si la déclaration disparaît ou change de forme, on échoue ici plutôt que
    // de comparer silencieusement à `undefined`.
    expect(m, "constante INVITATION_TTL_DAYS introuvable dans SettingsPage.tsx").not.toBeNull();
    expect(Number(m![1])).toBe(INVITATION_TTL_DAYS);
  });

  it("l'écran ne l'importe pas depuis lib/invitations (bundle navigateur)", () => {
    // L'import « propre » ferait entrer better-sqlite3 dans le bundle client.
    // La duplication est donc la bonne réponse — c'est sa dérive qu'on garde.
    expect(settings).not.toMatch(/from "@\/lib\/invitations"/);
  });
});
