# 0027 : Connexion par lien email

- Date : 2026-08-06
- Référence : commit `f2e2b6a` (2026-08-06), PR #57 fusionnée le 2026-08-07 avec `16c7e1c` (consommation rendue atomique)
- Statut : acceptée (depuis 0035, la consommation ne crée plus de compte)

## Contexte
Le realm Keycloak est partagé par tout l'écosystème et son auto-inscription est fermée : un invité externe n'y a pas de compte et ne peut pas s'en créer.
Le provisioning par notes (`lib/keycloak.ts`, PR #54) marchait, mais imposait deux emails dont l'ordre comptait sans que rien ne l'indique : l'invité cliquait le premier et tombait sur un écran réclamant un mot de passe qu'il n'avait pas.

## Décision
Un lien de connexion (`lib/magicLink.ts`) devient le canal des invités et remplace le provisioning IdP dans le parcours d'invitation : un message, un clic.
C'est un jeton de connexion, pas d'invitation : usage unique, `id = sha256(token)`, aucun droit propre, droit d'entrer revérifié à la consommation ; 15 min depuis l'écran de connexion, 7 j dans l'email d'invitation, borné par l'invitation.
`POST /api/auth/magic` répond toujours pareil, un nouveau lien invalide le précédent, et un compte de service ne se connecte jamais par email.

## Conséquences
Ce chemin contourne l'IdP : ses politiques (MFA, expiration) ne s'y appliquent pas, et l'email devient un facteur d'authentification, comme pour une réinitialisation de mot de passe. `MAGIC_LINK=off` ferme le canal.
Un filtre anti-hameçonnage qui suit les liens peut consommer le jeton avant le destinataire ; le repli est d'en redemander un, jamais un jeton réutilisable.
La règle « aucun jeton dans l'email » de 0021 est précisée : elle vise le jeton d'invitation, pas ce jeton de connexion.
