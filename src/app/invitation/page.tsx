import InvitationClient from "./InvitationClient";

/**
 * Écran d'acceptation d'un invité — PUBLIQUE (cf. PUBLIC_PATHS du proxy).
 *
 * C'est la première page que voit quelqu'un qui n'a pas encore de compte, et
 * rien ne doit être créé avant qu'il ait cliqué « Accepter » : ni User, ni
 * Membership. Sa garde n'est pas un cookie mais le jeton du lien reçu par email,
 * vérifié côté serveur à chaque appel.
 */
export default function InvitationPage() {
  return <InvitationClient />;
}
