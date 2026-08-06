import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Garde de CÂBLAGE du provisioning sur invitation.
 *
 * ⚠️ Ce trou est invisible au typecheck et aux tests fonctionnels : la ligne
 * `if (!OIDC_ALLOW_SIGNUP) return fail("nosignup")` compile parfaitement sans
 * consulter les invitations — elle refuserait simplement TOUT invité, en silence,
 * avec un message d'erreur plausible. Symétriquement, retirer la condition
 * rouvrirait le provisioning à tout le realm Keycloak sans qu'aucun test rouge
 * ne le signale : le realm `gotyeah` est partagé par tous les sites.
 *
 * C'est la même famille de panne que l'exemption `isService` perdue dans deux
 * appels sur seize (PR #49) : un défaut sûr, une CI verte, et une fonctionnalité
 * muette. On lit donc le source, faute de pouvoir monter un vrai flux OIDC ici.
 */
const callback = readFileSync("src/app/api/auth/oidc/callback/route.ts", "utf8");

describe("Provisioning OIDC — l'invitation est le laissez-passer", () => {
  it("le refus de création consulte les invitations, il ne se contente pas du flag", () => {
    // On exige les deux morceaux DANS la même condition : `!OIDC_ALLOW_SIGNUP`
    // seul refuserait les invités, `hasPendingInvitation` seul n'ouvrirait rien.
    const guard = /if\s*\(\s*!OIDC_ALLOW_SIGNUP\s*&&\s*!\(await hasPendingInvitation\(\s*email\s*\)\)\s*\)/;
    expect(callback).toMatch(guard);
  });

  it("le laissez-passer porte sur l'email VÉRIFIÉ par l'IdP, pas sur une entrée libre", () => {
    // `email` est dérivé des claims et le callback refuse déjà
    // email_verified === false. Si cette garde disparaissait, l'invitation
    // deviendrait réclamable par quiconque déclare l'adresse.
    expect(callback).toMatch(/const email = str\(claims\.email\)/);
    expect(callback).toMatch(/if \(claims\.email_verified === false\) return fail\("unverified"\)/);
    // L'ordre compte : la vérification d'email précède le provisioning.
    // `await hasPendingInvitation` et pas le nom nu — celui-ci apparaît d'abord
    // dans la ligne d'import, bien avant le corps du handler.
    expect(callback.indexOf("email_verified")).toBeLessThan(
      callback.indexOf("await hasPendingInvitation")
    );
  });

  it("un invité atterrit sur l'espace réclamé, pas sur un « Mon espace » vide", () => {
    // Sans ça, quelqu'un qui suit une invitation découvre l'application sur un
    // espace vide, sans indice que celui où on l'attend existe.
    expect(callback).toMatch(/claimed\.workspaceIds\[0\] \?\? workspace\.id/);
  });
});
