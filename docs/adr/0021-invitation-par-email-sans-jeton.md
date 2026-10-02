# 0021 : Invitation par email, sans jeton d'invitation

- Date : 2026-08-05
- Référence : commits `a2a0ff4` (2026-08-05) et `f2bf096` (2026-08-06), PR #53 fusionnée le 2026-08-06 ; révision par le lien de connexion, commit `f2e2b6a` (PR #57)
- Statut : acceptée

## Contexte
L'invitation était muette : posée en base, elle ne prévenait personne.
Il fallait choisir ce que porterait le lien de l'email, alors que c'est Keycloak qui authentifie et garantit l'adresse (le callback refuse `email_verified === false`).

## Décision
Un email part par Brevo (`lib/mailer.ts`) quand `BREVO_API_KEY` est posée, sans jeton d'invitation : un jeton qui confère un rôle n'ajouterait aucune preuve et déposerait un secret réutilisable dans une boîte mail, un historique et un `Referer`.
On écrit en base, puis on envoie ; le résultat remonte dans `emailSent` et `emailReason`, champs additifs. Le nom d'espace et le displayName sont échappés dans le HTML.

## Conséquences
L'échec d'envoi n'annule jamais l'invitation, et il se voit : un envoi raté en silence est pire qu'un envoi absent. Sans clé Brevo, l'invitation existe quand même et l'écran le dit.
Révisée le 06/08 (cf. 0027) : la règle vaut pour un jeton d'invitation, pas pour le jeton de connexion à usage unique glissé depuis dans l'email d'une adresse sans compte.
