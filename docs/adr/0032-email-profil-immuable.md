# 0032 : L'email n'est pas modifiable depuis notes

- Date : 2026-08-07
- Référence : commit `3fa24eb` (PR #63)
- Statut : acceptée

## Contexte
Le lot Profil branche Réglages → Profil sur une nouvelle route `PATCH /api/me` (displayName, firstName, lastName).
L'email est la clé de liaison avec l'IdP : le callback OIDC retrouve le compte par `email`, et le claim d'invitation repose dessus.

## Décision
`PATCH /api/me` ne modifie jamais l'email : son schéma zod ne le connaît pas, et un email envoyé est ignoré (`tests/api/profile.test.ts`). Un changement d'adresse part de l'IdP.
La route n'a pas de gate de rôle (on ne modifie que soi-même, l'id vient de la session) et refuse un compte de service en 409, sans compter sur l'absence d'UI puisque le pont MCP passe par `getSession()`.

## Conséquences
Laisser l'email changer ferait qu'à la connexion suivante la personne serait refusée (`OIDC_ALLOW_SIGNUP=false`, aucune invitation vivante) ou provisionnée comme un nouveau compte, sans ses memberships, ses pages privées ni son historique.
L'écran Profil affiche l'email en lecture seule ; l'adresse ne change qu'à la source, dans l'IdP.
