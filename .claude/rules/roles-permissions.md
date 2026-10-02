---
paths:
  - "src/lib/workspace.ts"
  - "src/lib/{permissionRules,transitionGuard}.ts"
  - "src/app/api/workspaces/**/*"
  - "src/components/databases/TransitionRulesEditor.tsx"
  - "scripts/{create-service-account,backfill-service-memberships}.mjs"
---

# Rôles et permissions : invariants

- Trois rôles hiérarchiques `admin ⊇ editor ⊇ viewer`, résolus sur l'espace de la ressource, jamais sur `currentWorkspaceId` ; le lecteur n'a aucune mutation, même sur ses pages privées ; `hasRole` rend `false`, il ne lève jamais.
- Le rôle admin d'un espace est auto-attribuable (`POST /api/workspaces` n'a pas de gate) : une action sur le realm SSO partagé exige en plus `IDP_ADMIN_EMAILS`.
- La règle d'une page privée vit dans `lib/workspace.ts` seulement : jamais de `visibility === "private"` écrit à la main, et `isService` se passe à chaque appel (l'omettre rend le compte de service aveugle, sans erreur).
- Les `check*Access` rendent `null` en cascade (page hôte privée d'autrui ou en corbeille) ; `includeTrashed` ne sert qu'au cycle de la corbeille.
- Un compte de service voit les pages privées des espaces où il est membre, ne reçoit aucune notification, ne s'invite pas et ne change pas son profil (409) ; `withServiceAccounts` vaut `false` par défaut et seul `POST /api/workspaces` le passe, pour un rattachement en `admin`.
- `updateMemberRole` et `removeMember` rendent une union sans lever ; le comptage des admins et l'écriture partagent la même transaction ; retirer ou rétrograder le dernier admin = 409.
- Règles de transition : l'absence de règle vaut permission, aucune exemption admin, `canTransition` garde son ordre (« aucune règle, permis » avant « pas d'identité, refus ») ; `permissionRules.ts` reste sans aucun import ; écrire `rules` demande l'admin.

Détail et gardes : `docs/doctrine/roles-permissions.md`.
