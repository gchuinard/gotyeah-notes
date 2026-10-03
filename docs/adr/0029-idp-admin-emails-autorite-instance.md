# 0029 : IDP_ADMIN_EMAILS, autorité d'instance sur le realm partagé

- Date : 2026-08-07
- Référence : commit `d345c24` (PR #60, avec `3dc9a2b` et `c3e93ca`)
- Statut : acceptée

## Contexte
La gestion des comptes SSO depuis Réglages → Membres (`create`, `suspend`, `resume`) n'était gardée que par le rôle admin de l'espace, alors que son effet porte sur le realm Keycloak partagé par tous les sites.
Ce rôle était auto-attribuable : `POST /api/workspaces` n'a aucun gate, et `POST /members` créait alors une Membership immédiate pour toute adresse ayant un compte, sans son consentement. Un lecteur pouvait ainsi couper la connexion Keycloak de n'importe qui ; la chaîne a été trouvée en revue adversariale, puis reproduite.

## Décision
Une seconde garde, hors du modèle de rôles, s'ajoute au gate admin : l'allowlist d'instance `IDP_ADMIN_EMAILS` (`isIdpAdmin`, `lib/keycloak.ts`), sur les trois actions, `resume` comprise, car rendre un accès coupé ailleurs est aussi une décision.
Vide vaut personne, jamais tout le monde. Le GET `/idp` répond 200 avec `{configured, allowed, available}` ; c'est le POST qui répond 403 hors allowlist.

## Conséquences
Tant que la variable n'est pas posée, aucun bouton SSO n'apparaît, et l'écran affiche l'état `!allowed` plutôt que de se taire.
Depuis 0035, `POST /members` ne crée plus de Membership et le tremplin a disparu ; l'allowlist reste la seconde ligne, et `tests/api/idp-accounts.test.ts` rejoue la chaîne (201 `invited`, puis 403 ou 404, sans appel à Keycloak).
