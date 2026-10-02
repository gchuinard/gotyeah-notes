# 0030 : Suspendre un compte SSO, jamais le supprimer

- Date : 2026-08-07
- Référence : commit `3dc9a2b` (PR #60) ; `sessionsCut` ajouté par `c3e93ca` (même PR)
- Statut : acceptée

## Contexte
Le client `notes-provisioning` a le droit d'appeler `DELETE /users/{id}` sur le realm `gotyeah`, partagé par tous les sites. Supprimer détruit le `sub` sur lequel les voisins reconnaissent la personne, son MFA et ses identités fédérées, sans corbeille Keycloak, et hors de toute sauvegarde de notes (le snapshot pré-MEP ne couvre que sa SQLite).
Recréer donne un `sub` neuf : notes, qui lie par email, ne verrait rien ; le voisin verrait un inconnu.

## Décision
`lib/keycloak.ts` n'expose aucune suppression. Suspendre, c'est `enabled: false` puis `POST /users/{id}/logout`, dont l'échec est rapporté (`sessionsCut`), jamais avalé.
Suspendre exige de recopier l'adresse du membre, et répond 409 sur soi-même et sur un compte de service.
Suspendre le SSO ne retire pas l'accès à notes : le geste qui met dehors reste `DELETE /members/[userId]`, et l'écran le dit.

## Conséquences
Le geste est réversible d'un clic (`resume`), au prix d'un compte désactivé qui demeure dans le realm.
La Membership, le compte notes et le lien de connexion par email survivent à la suspension : un admin qui croirait avoir fermé la porte se tromperait.
Si le logout échoue, le compte est désactivé mais les sessions ouvertes survivent : l'offboarding est partiel, et la réponse le dit.
