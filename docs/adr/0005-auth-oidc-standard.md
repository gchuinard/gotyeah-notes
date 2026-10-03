# 0005 : Auth OIDC standard, mot de passe en break-glass

- Date : 2026-07-02
- Référence : commits `0cee15f` (connexion OIDC) et `33d47a7` (`LEGACY_LOGIN=off`)
- Statut : acceptée

## Contexte
L'app n'avait qu'un login email et mot de passe local, alors qu'un IdP GotYeah authentifiait déjà ailleurs, notamment pour le hub MCP (0002).
Il fallait se connecter avec son compte GotYeah sans lier le code à un fournisseur, et pouvoir couper le mot de passe tout en gardant une porte de secours.

## Décision
La connexion OIDC (Authorization Code + PKCE piloté par le backend, id_token vérifié par JWKS avec `jose`) s'ajoute au formulaire et crée la session applicative habituelle, sans jeton côté client ; le compte est lié par email, ou provisionné avec un espace par défaut.
`LEGACY_LOGIN=off` masque le formulaire et fait répondre 403 à `/api/auth/login`, ainsi qu'à `/api/auth/register` jusqu'à ce que `REGISTRATION` l'en découple (0011) ; la variable reste réactivable en break-glass.

## Conséquences
En production `LEGACY_LOGIN=off` : plus de login par mot de passe, et le rouvrir est un geste d'exploitation, pas un réglage d'écran. Ensuite, le provisioning a été réservé aux invités (0022) et le lien de connexion par email s'est ajouté à l'IdP (0027).
Le code ne connaît que l'OIDC standard : le passage de Pocket ID à Keycloak n'a touché aucune ligne de code ; seules des mentions de la doc et des commentaires ont été corrigées le 2026-08-05 (`a2a0ff4`).
