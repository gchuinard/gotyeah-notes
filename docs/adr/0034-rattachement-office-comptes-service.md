# 0034 : Rattacher d'office les comptes de service aux espaces créés

- Date : 2026-08-08
- Référence : commit `ca170ee` (PR #67)
- Statut : acceptée

## Contexte
Le pont MCP incarne le compte de service « IA », qui ne voit que les espaces dont il est membre : il était muet sur tout espace créé après lui, `notes_list_workspaces` n'en rendait qu'un et le reste répondait 404 sans dire pourquoi.
Or un compte de service voit les pages privées des espaces où il est membre : le rattacher partout ouvrirait le « Mon espace » personnel de toute personne qui s'inscrit.

## Décision
`createWorkspaceWithDefaults(name, userId, { withServiceAccounts })` rattache tous les `User.isService` au nouvel espace, en admin, sur opt-in à défaut `false`. Des quatre appelants, seul `POST /api/workspaces` le demande ; `register`, le callback OIDC et l'acceptation d'invitation créent un espace personnel.
Le rôle est admin parce que six outils MCP (`notes_delete_database`, `_property`, `_view`, `_sprint`, `_section`, `_template`) sont gatés admin, et le créateur est exclu (`id: { not: userId }`) car il peut être lui-même le compte de service.

## Conséquences
La garde n'est pas le défaut de l'argument mais le nombre d'appelants : `tests/api/service-account-autojoin.test.ts` refuse tout second appelant.
Les espaces existants se rattrapent par `scripts/backfill-service-memberships.mjs`, à blanc par défaut, qui chiffre les pages privées qu'il ouvre, et de qui, avant d'écrire.
Les scripts horodatent par `prismaNow()`, jamais par `CURRENT_TIMESTAMP`, dont le séparateur espace rendrait la membership la plus ancienne et déplacerait l'espace par défaut du compte de service.
