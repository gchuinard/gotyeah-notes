# 0022 : Provisioning OIDC réservé aux invités

- Date : 2026-08-05
- Référence : commit `a2a0ff4`, PR #53 fusionnée le 2026-08-06 ; garde `tests/unit/signupGate.test.ts`
- Statut : acceptée

## Contexte
Le realm Keycloak `gotyeah` est partagé par tous les sites de l'écosystème.
Avec le provisioning ouvert, l'utilisateur de n'importe lequel de ces sites obtenait un compte notes, et son « Mon espace », en cliquant « Se connecter ».

## Décision
À `OIDC_ALLOW_SIGNUP=false`, le callback OIDC ne crée un compte que si `hasPendingInvitation(email)` : une invitation vivante (non expirée, et non refusée depuis 0035) attend l'adresse vérifiée par l'IdP.
L'IdP dit qui tu es, l'invitation dit si tu es attendu ici. Le compose pose `false` ; le code garde `true` par défaut, pour un self-host sans invitations.

## Conséquences
`signupGate.test.ts` lit le callback et exige la condition complète : le flag seul refuserait tous les invités en silence, l'invitation seule n'ouvrirait rien.
Le durcissement dépend de la valeur dans le conteneur : `OIDC_ALLOW_SIGNUP` étant figée dans le `.env` du Pi, changer le défaut du compose ne suffisait pas (cf. 0025).
Avec le défaut du code, cette garde saute : un compte OIDC neuf sans `email_verified` reçoit alors ses invitations d'office (fiche F4).
