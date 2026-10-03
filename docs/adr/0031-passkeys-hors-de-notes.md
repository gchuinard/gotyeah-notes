# 0031 : Les clés d'accès s'enregistrent dans la console de l'IdP

- Date : 2026-08-07
- Référence : commit `e087665` (PR #61)
- Statut : acceptée

## Contexte
Une clé d'accès naît d'une cérémonie `navigator.credentials.create()` exécutée par le navigateur, et le credential est lié au domaine appelant : lancée depuis notes, elle produirait une clé pour le domaine de notes, que Keycloak ne verrait jamais et que notes ne saurait pas vérifier (son auth s'arrête à un id_token).
L'API admin de Keycloak ne sait pas injecter un credential WebAuthn, et Réglages → Profil portait un formulaire « Changer le mot de passe » sans route derrière, que `LEGACY_LOGIN=off` rendait doublement mort.

## Décision
notes ne livre qu'un lien « Gérer mes moyens de connexion » vers `accountConsoleUrl()` (`<issuer>/account`), dans Réglages → Profil, à la place du formulaire mort.
L'URL se construit depuis `OIDC_ISSUER`, jamais depuis `endpoints()` de `lib/keycloak.ts`, qui substitue l'URL interne ; sans OIDC configuré, aucun lien n'est affiché.

## Conséquences
Mot de passe, clés d'accès et MFA se gèrent hors de notes, dans la console de l'IdP.
Le mot de passe reste le filet : `REQUIRED_ACTIONS` ne bascule pas sur `webauthn-register-passwordless`, une clé Windows Hello étant liée au TPM et non synchronisée, et le thème email de Keycloak n'ayant pas de traduction pour ces actions.
Sur un même PC, une seconde clé Hello écrase la première : un vrai secours vit sur un autre authenticator.
