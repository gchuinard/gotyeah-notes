# Doctrine : Rôles et permissions

Périmètre : rôles d'espace et gates `hasRole`, pages privées et confidentialité, compte de service et rattachement d'office, gestion des membres (rôle, retrait), rattachement inter-espace, règles de transition par colonne.
Invariants courts : `.claude/rules/roles-permissions.md` · Décisions datées : `docs/adr/`

## Modules

- `src/lib/workspace.ts` : `getMembership`, `isPageAccessible`, `pageVisibilityFilter`, les `check*Access`, `hasRole`, `hasRoleInAnyWorkspace`, `updateMemberRole`, `removeMember`, `createWorkspaceWithDefaults`.
- `src/lib/permissionRules.ts` : décision pure des règles de transition, partagée avec le navigateur. `src/lib/transitionGuard.ts` : garde serveur des créations de carte, qui s'appuie dessus.
- `src/components/databases/TransitionRulesEditor.tsx` : l'éditeur des règles, monté par `PropertyPopover` et par `PageOptionsPanel`.
- `scripts/create-service-account.mjs` et `scripts/backfill-service-memberships.mjs` : création et rattrapage des comptes de service (doctrine `deploiement` pour leur exécution).

## Rôles

- Trois rôles hiérarchiques, `admin` ⊇ `editor` ⊇ `viewer`, portés par `Membership`. Le rôle se résout sur l'espace de la ressource visée, jamais sur `currentWorkspaceId` : un membre d'un espace qui vise une ressource d'un autre reçoit 404 (`tests/api/role-gates.test.ts`, cas « membre de W1 visant W2 → 404 »).
- Lecteur : lecture seule totale, aucune mutation, pas même sur ses propres pages privées (`tests/api/role-gates.test.ts`, cas « lecteur → 403 même sur sa page privée »).
- Éditeur : tout le contenu (pages, databases, propriétés, cartes, vues, sprints), mise à la corbeille et restauration, création et modification des sections et des templates, clôture de sprint, commentaires, dépôt de pièces jointes et d'images.
- Admin : tout l'irréversible, c'est-à-dire le `DELETE` d'une database, d'une propriété, d'une vue, d'un sprint, d'une section, d'un template ou de l'espace, et `?permanent=1` sur une page ou une carte. Plus la gestion des membres (inviter, changer un rôle, retirer, lister et révoquer les invitations, comptes SSO), l'écriture des règles de transition et `PATCH /api/config`. Deux lectures sont admin aussi : les invitations en attente (`GET /api/workspaces/[id]/invitations`, non testé) et l'état SSO des membres (`tests/api/idp-accounts.test.ts`). Garde : la table des cas de `tests/api/role-gates.test.ts`, 403 sous le rôle requis et sans effet de bord ; les gates des commentaires et des pièces jointes n'y figurent pas et sont tenus par `tests/api/comments.test.ts` et `tests/api/attachments.test.ts`. Exception connue : `DELETE /api/attachments/[id]`, retrait définitif d'une pièce jointe, est ouvert à l'éditeur (fiche Discovery « Rôle requis pour retirer une pièce jointe »).
- `hasRole` rend `false` pour une membership `null` et pour un rôle inconnu en base, sans lever. La traduction de `false` en 403 reste dans la route, comme celle de `null` en 404. Non testé directement.
- Il n'y a pas d'admin d'instance (ADR 0017). Les routes sans contexte d'espace approximent par `hasRoleInAnyWorkspace` : `POST /api/upload` exige éditeur dans au moins un espace, `PATCH /api/config` admin dans au moins un espace (`tests/api/role-gates.test.ts`).
- Le rôle admin d'un espace est auto-attribuable : `POST /api/workspaces` n'a pas de gate et fait de son auteur l'admin du nouvel espace. Ce rôle ne garde donc qu'une action dont l'effet reste dans l'espace ; une action sur le realm SSO partagé exige en plus `IDP_ADMIN_EMAILS` (ADR 0029, doctrine `auth-invitations`). Garde : `tests/api/idp-accounts.test.ts` (bloc « Escalade : le rôle admin d'un espace est auto-attribuable »).

## Où vivent les gates

- Rappel (invariant 5 du CLAUDE.md) : accès refusé → 404, puis rôle insuffisant → 403 `{ error: "Rôle insuffisant" }`.
- Le gate vit dans le handler, pas dans `src/proxy.ts` : Vitest importe les handlers sans passer par le proxy, et le pont MCP traverse le proxy sans cookie (ADR 0017).
- Tout `POST`, `PATCH`, `PUT` ou `DELETE` exporté sous `src/app/api` figure dans la table `DECLARED` de `tests/api/role-gates.test.ts`, gaté ou exempté ; un handler mutant non déclaré fait échouer le méta-test. Une nouvelle route mutante s'y déclare, et rejoint la table des cas si elle est gatée.
- Écritures exemptées de rôle, toutes déclarées dans `DECLARED`. Aucune ne touche au contenu d'un espace, et un lecteur serait cassé sans elles :
  - `POST /api/pages/[id]/visit` (Récents) et `POST /api/workspaces/[id]/switch` (préférence de session) ;
  - `POST /api/workspaces` : créer son espace, dont on devient admin ;
  - `PATCH /api/me` : son propre profil (doctrine `auth-invitations`) ;
  - `PATCH /api/notifications` : marquer ses notifications lues ;
  - `POST /api/invitations/[id]` : accepter ou refuser une invitation qui vise son adresse. L'autorité est l'invitation, pas un rôle dans un espace qu'on n'a pas encore rejoint ;
  - `DELETE /api/workspaces/[id]/members/[userId]` sur sa propre membership : quitter l'espace, sinon un invité y reste prisonnier. La garde « dernier admin » s'applique quand même (`tests/api/members.test.ts`).
- Routes publiques, sans session ni rôle : `/api/auth/*` et `POST /api/invitations/claim`. Leur garde est un flag d'env, un jeton ou un rate-limit (doctrines `api` et `auth-invitations`).

## Rôle côté client

- Sur une page, `src/app/pages/[id]/page.tsx` résout le rôle au SSR depuis la membership de l'espace de la page, et le passe en `readOnly`, `isAdmin` et `role` (le rôle brut sert aux règles de transition). Pas de flash d'UI éditable.
- Ailleurs (barre latérale, corbeille, modèles, réglages), le rôle vient de `GET /api/workspaces` (champ `role`) par `useWorkspace().isViewer/isAdmin`, pour l'espace actif. Un rôle absent (chargement) vaut lecteur, jamais éditeur. Non testé.
- L'UI masque ce que le rôle interdit, par confort ; le 403 du serveur reste l'autorité. Garde : `e2e/roles.spec.ts` (badge « Lecture seule », création masquée, et 403 du serveur pour le même geste).

## Pages privées

- Une page `visibility = "private"` n'est accessible qu'à son `ownerId`, même pour les autres membres de l'espace ; privée sans `ownerId`, elle n'est accessible à aucun humain. La visibilité est dénormalisée depuis la section racine (doctrine `modele`). Garde : `tests/api/access-isolation.test.ts`.
- La règle vit dans `lib/workspace.ts` et nulle part ailleurs (invariant 4 du CLAUDE.md) : `isPageAccessible(page, userId, isService)` pour un élément, `pageVisibilityFilter(userId, isService)` pour une liste (arbre, recherche, corbeille). Refus = 404.
- `pageVisibilityFilter` rend `undefined` pour un compte de service, c'est-à-dire aucune restriction : l'étaler dans le `where` avec `...(filtre ?? {})`, comme le font `GET /api/pages`, `/api/search` et `/api/trash`.
- Les `check*Access` appliquent la règle en cascade : une database, une propriété, une vue, un sprint ou une carte posés sur la page privée d'autrui sont inaccessibles, sinon un membre lirait la database posée sur la page privée d'un autre. Garde : `tests/api/access-isolation.test.ts` (cas « database sur page privée de A : A accède (non null), B refusé (null) »).
- Pour page, section, espace, corbeille et recherche, il n'existe pas de helper d'accès : `getMembership()`, puis `isPageAccessible` ou `pageVisibilityFilter`.
- Jamais de comparaison `visibility === "private"` hors de `lib/workspace.ts` : un test réécrit à la main échappe à l'exemption du compte de service. Passer `isService` explicitement, à chaque appel : l'argument est optionnel à défaut `false`, et un appel qui l'omet rend le compte de service aveugle sur cette route, sans aucune erreur (ADR 0025). Garde : `tests/api/service-account.test.ts` (cas « seul lib/workspace.ts compare visibility/ownerId à la main », « tout appel aux helpers de confidentialité passe son argument isService »).
- Où lire `isService` : `user.isService` (rendu par `getSession()`) dans une route ; `membership.user.isService` dans les `check*Access`, que `getMembership` remonte sans requête de plus.

## Ce que rendent les check*Access

- `checkDatabaseAccess` : `{ workspaceId, membership }`. `checkPropertyAccess`, `checkViewAccess` et `checkSprintAccess` : `{ workspaceId, membership, databaseId }` plus l'entité (`property`, `view`, `sprint`).
- `checkRecordAccess` : `{ workspaceId, membership, databaseId, record }` plus `page` (`id`, `workspaceId`, `visibility`, `ownerId`, `trashedAt`), la page hôte, qui décide qui peut être prévenu d'une assignation (doctrine `notifications`).
- `membership` vaut `{ role, user: { isService } }` : c'est lui qu'on passe à `hasRole`.
- Seuls `checkDatabaseAccess` et `checkRecordAccess` prennent `includeTrashed` ; les autres rendent `null` dès que la page hôte est en corbeille.

## Rattachement inter-espace

- Rappel (invariant 7 du CLAUDE.md). Le rôle est vérifié sur l'espace contrôlé : un id de rattachement pris dans un autre espace ferait écrire dans un espace où l'on n'a pas ce rôle.
- `POST /api/pages` : `parentId` et `sectionId` appartiennent au `workspaceId` du corps, et le parent passe `isPageAccessible` ; sinon 404. Sans le second contrôle, un éditeur plantait une sous-page privée sous la page privée d'un autre (ADR 0039). Gardes : `tests/api/role-gates.test.ts` (cas « POST /api/pages refuse un parent / une section d'un autre espace → 404 »), `tests/api/gardes-parent-et-rules.test.ts` (bloc « le parent doit être accessible, pas seulement du bon espace »).
- `patchNotesPageId` (`PATCH /api/databases/[id]`) : page du même espace et accessible, sinon 400 (`tests/api/database-patchnotes-mapping.test.ts`). Propriété `relation` : database cible accessible et du même espace, sinon 400 (`tests/api/relation-property.test.ts`).
- Exception connue, sans fiche à ce jour : le déplacement d'une page (`PATCH /api/pages/[id]` avec `parentId`, via `setPageSection`) vérifie l'espace du nouveau parent mais pas son accessibilité, et une page peut donc être rangée sous la page privée d'autrui. Non testé.

## Compte de service

- `User.isService` marque un compte de service ; le pont MCP en incarne un (doctrine `mcp`). Il voit les pages privées des espaces où il est membre, et seulement de ceux-là : la frontière d'espace tient. Sans cette exemption, l'automatisation reçoit 404 sur tout le privé, sans explication (ADR 0019). Garde : `tests/api/service-account.test.ts` (cas « l'exemption ne franchit pas la frontière d'espace »).
- L'exemption vaut aussi pour les listes : un compte exempté à l'unité mais filtré dans l'arbre verrait une arborescence amputée. Garde : `tests/api/service-account.test.ts` (cas « voit la page privée dans l'arbre », « retrouve la page privée dans la recherche »).
- Aucune route n'écrit `isService` : le compte se crée par `scripts/create-service-account.mjs`, idempotent (`tests/api/create-service-account.test.ts`). L'absence de route d'écriture n'est pas testée.
- Refus propres au compte de service, détaillés ailleurs : invitation (`POST /members`, 409), profil (`PATCH /api/me`, 409), connexion par email, actions SSO (409) dans la doctrine `auth-invitations` ; jamais destinataire d'une notification dans la doctrine `notifications`.

## Rattachement d'office des comptes de service

- `createWorkspaceWithDefaults(name, userId, { withServiceAccounts })` crée, dans une transaction, l'espace, la membership admin du créateur et les deux sections par défaut. Avec `withServiceAccounts: true`, il y rattache aussi tous les `User.isService`, sans quoi le pont MCP reste muet sur tout espace créé après lui (ADR 0034).
- L'option vaut `false` par défaut (invariant 11 du CLAUDE.md, même règle que `claimInvitations({ grant })`), et seul `POST /api/workspaces`, le geste « créer un espace », la passe. Les autres appelants (`POST /api/auth/register`, le callback OIDC, `POST /api/invitations/claim`) créent le « Mon espace » personnel d'un compte qui vient de naître : y rattacher un compte de service lui ferait lire l'espace personnel de toute personne qui s'inscrit. Garde : le méta-test de `tests/api/service-account-autojoin.test.ts` refuse tout second appelant ; c'est le nombre d'appelants qui garde, pas le défaut de l'argument.
- Rôle `admin`, pas `editor` (`SERVICE_ACCOUNT_ROLE`) : les outils MCP de suppression (`notes_delete_database|_property|_view|_sprint|_section|_template`) sont gatés admin et répondraient 403 dans les espaces neufs. Garde : `tests/api/service-account-autojoin.test.ts` (cas « rattache le compte de service, en admin »).
- Le créateur peut être lui-même un compte de service (`notes_create_workspace`) : sa membership est déjà posée, et la réémettre violerait l'unicité `(userId, workspaceId)`, donc ferait échouer la création. D'où le filtre `id: { not: userId }`. Garde : `tests/api/service-account-autojoin.test.ts` (cas « un compte de service qui crée un espace ne se rattache pas deux fois »).
- Ce rattachement n'émet aucune notification : `notify()` écarte les comptes de service.
- Rattacher un compte de service lui ouvre le privé de tous les membres de l'espace. Le rattrapage des espaces existants passe par `scripts/backfill-service-memberships.mjs`, en essai à blanc par défaut, qui chiffre ce qu'il ouvre avant d'écrire (doctrine `deploiement`).

## Membres : rôle et retrait

- `PATCH /api/workspaces/[id]/members/[userId]` change un rôle (admin) ; `DELETE` sur la même route retire un membre (admin, ou soi-même pour quitter). Les deux passent par `updateMemberRole` et `removeMember`, qui rendent une union sans lever : `not_found` (cible non membre) donne 404, `last_admin` 409. L'invitation d'un membre relève de la doctrine `auth-invitations`.
- Garde « dernier admin » : le comptage des admins et l'écriture partagent la même transaction, sinon deux rétrogradations concurrentes passeraient toutes deux le compte. Rétrograder ou retirer le dernier admin rend `last_admin`, soit 409, y compris quand il se retire lui-même. Garde : `tests/api/members.test.ts`.
- Un droit délégué ne survit pas à la perte du droit de déléguer : rétrograder un admin supprime, dans la transaction, les invitations qu'il a émises sur l'espace ; une démotion refusée n'en supprime aucune. Garde : `tests/api/invitations.test.ts` (bloc « Révocation : un droit délégué ne survit pas à la perte du droit de déléguer »).
- Retirer un membre supprime, dans la transaction : sa membership, les invitations qu'il a émises, celles qui visent son adresse sur l'espace (sinon l'invitation survivante rouvre l'accès à l'acceptation, ADR 0035) et ses notifications de l'espace (sinon la cloche reste un canal de lecture vers l'espace quitté). `membership_removed` est émise ensuite, après l'effacement. Gardes : `tests/api/invitations.test.ts` (cas « retirer le membre ne le fait pas revenir tout seul à la connexion suivante »), `tests/api/notify.test.ts` (bloc « removeMember : la cloche ne survit pas au retrait »).
- `updateMemberRole` émet `role_changed` (rôles avant et après) dans sa transaction.
- Les deux prennent un dernier argument `context` `{ actorId, workspaceName }`, à passer depuis la route : sans lui, la notification n'a ni auteur ni nom d'espace, et le filtre « jamais soi-même » de `notify()` ne sait pas qui agit. Exception connue : `src/app/api/workspaces/[id]/members/[userId]/route.ts` ne le passe pas ; les notifications sont anonymes, et un membre qui quitte l'espace ou change son propre rôle se notifie lui-même. `tests/api/notify.test.ts` appelle `removeMember` avec ce `context` et ne voit donc pas le défaut (fiche Discovery « Auteur absent des notifications de rôle et de retrait »).

## Règles de transition par colonne

### Modèle

- Une règle, rangée dans `DatabaseProperty.config.rules` à côté des `options` d'une propriété select ou multiselect, dit : pour poser l'option `toOptionId`, il faut l'un des rôles `roles` (hiérarchiques) ou être l'une des personnes `userIds` ; l'un ou l'autre suffit. La décision est dans `lib/permissionRules.ts` (`canTransition`, `deniedTransitions`, `selectableOptions`). Garde : `tests/unit/permissionRules.test.ts`.
- L'absence de règle vaut permission : c'est ce qui rend le mécanisme rétrocompatible avec les colonnes existantes, qui ne portent pas la clé. Garde : `tests/api/transition-rules.test.ts` (bloc « Non-régression : une propriété sans règles se comporte comme avant »).
- L'ordre d'évaluation de `canTransition` est figé : « aucune règle sur cette cible → permis » passe avant « pas d'identité → refus ». Inversé, il viderait tous les menus select dès que le rôle n'est pas transmis. Garde : `tests/unit/permissionRules.test.ts` (cas « aucune règle → permis, même sans identité »).
- Seule l'entrée dans une option est gouvernée : `from` est ignoré, sortir d'une colonne restreinte reste permis, « Sans valeur » (`null`) reste toujours atteignable, une valeur réémise à l'identique n'est pas une transition, et en multiselect seuls les ajouts comptent. Gardes : `tests/unit/permissionRules.test.ts`, `tests/api/transition-rules.test.ts`.
- Une règle sans rôle ni personne n'autorise personne (`tests/unit/permissionRules.test.ts`) ; `TransitionRulesEditor` la retire avant d'enregistrer.
- `userIds` n'est pas vérifié contre les memberships : un id qui n'est plus membre rend la règle plus stricte, jamais plus laxiste. Non testé.
- Pas d'exemption admin : un admin bloqué par une règle la modifie, acte explicite, écrit et réversible, au lieu de la contourner (ADR 0023). Gardes : `tests/unit/permissionRules.test.ts` et `tests/api/transition-rules.test.ts` (cas « un admin est soumis à la règle comme les autres »).
- `lib/permissionRules.ts` reste sans aucun import : il est consommé par des composants `"use client"` de `src/components/databases/` (`Cell`, `KanbanView`, `BulkActionBar`, `TransitionRulesEditor`…), et un import de `lib/workspace` tirerait `lib/prisma`, donc l'addon natif better-sqlite3, dans le bundle navigateur. Le rang des rôles y est redéclaré (`RULE_ROLE_RANK`). Garde : `tests/unit/permissionRules.test.ts` (cas « le module reste sans import », et « le rang de rôles local est en phase avec lib/workspace », qui compare la liste des rôles mais pas leur rang).
- Côté client, `selectableOptions` retire du menu les options verrouillées mais garde celles déjà posées sur la carte, sinon la valeur courante disparaîtrait et ne pourrait plus être retirée (`tests/unit/permissionRules.test.ts`). L'acteur (`{ userId, role }`) est construit par `DatabaseShell` avec le `role` résolu au SSR ; s'il manque, une colonne gouvernée est traitée comme verrouillée.
- Au kanban, une colonne dont l'option est refusée à l'acteur est verrouillée (cadenas, ni dépôt ni ajout de carte), avec la double garde `useDroppable({ disabled })` et `handleDragEnd` décrite dans la doctrine `vues`. `BulkActionBar` écarte les cartes dont la transition serait refusée et dit combien n'ont pas bougé, au lieu d'essuyer un 403 par carte. Non testé.

### Portes serveur

Cinq points de contrôle côté serveur : trois portes de transition et deux gates admin sur `rules`.

- Portes de transition, qui refusent en 403 `{ error: "Transition non autorisée", details: { denied: [{ propertyId, optionIds }] } }` :
  - `PATCH /api/records/[id]` : ne juge que les transitions réelles (propriétés présentes dans le diff des révisions), après le diff et avant toute écriture ; un refus ne laisse ni carte modifiée ni révision ;
  - `POST /api/databases/[id]/records` et `POST /api/records/[id]/duplicate`, par `checkCreationTransitions` (`lib/transitionGuard.ts`) : une création fait entrer chaque valeur posée, et une duplication produit le même résultat qu'une création dans la colonne.
  - Gardes : `tests/api/transition-rules.test.ts` (blocs « PATCH /records/[id] : la règle mord », « Les deux portes de création sont fermées »).
- Gates admin sur la clé `rules` ; les routes sont ouvertes à l'éditeur et le config s'écrit en entier, donc sans elles un éditeur se dé-restreindrait lui-même :
  - `PATCH /api/properties/[id]` juge la différence entre l'ancien et le nouveau tableau, pas la présence : le popover réémet `{...config}` à chaque renommage, et un éditeur doit pouvoir renommer une option ;
  - `POST /api/databases/[id]/properties` juge la présence d'un tableau non vide : à la création il n'y a rien à comparer, et poser des règles en créant la colonne est l'acte à gouverner (ADR 0042). Un tableau vide passe.
  - Gardes : `tests/api/transition-rules.test.ts` (bloc « PATCH /properties/[id] : qui peut écrire les règles »), `tests/api/gardes-parent-et-rules.test.ts` (bloc « les règles d'accès sont admin, à la création aussi »).

### Config et options

- Exception au remplacement total du config d'une propriété, limitée à `rules` : une clé `rules` absente reporte l'existant, parce que le MCP et le popover reconstruisent le config sans la connaître. Pour retirer une règle, envoyer un tableau explicite, vide ou réduit. Le reste du config, et tout `View.config`, suit le remplacement total (doctrine `vues`). Garde : `tests/api/transition-rules.test.ts` (cas « un config sans clé rules (cas MCP) conserve les règles existantes »).
- `validatePropertyConfig` refuse en 400 une règle sur une option inexistante et deux règles sur la même option (`tests/api/transition-rules.test.ts`).
- Une option citée par une règle rejoint `findReferencedOptionIds` et ne se retire pas seule : 400 avec un message qui dit où retirer la règle, puisque le MCP n'expose pas les règles et qu'un 400 muet serait sans issue. La retirer avec sa règle dans le même PATCH passe. Garde : `tests/api/transition-rules.test.ts` (bloc « Une option citée par une règle est protégée »).

### Écrans

- Un seul composant, deux écrans : `TransitionRulesEditor` est monté par `PropertyPopover` (en-tête de colonne, vue Tableau) et par `PageOptionsPanel` (barre latérale, toutes vues), qui est le seul chemin depuis un board sans vue Tableau. Ne pas dupliquer l'éditeur : une fonctionnalité sans porte d'UI reste inutilisée (ADR 0042). Garde : `e2e/page-options-panel.spec.ts` (cas « sur un board sans vue Tableau, les règles d'accès sont atteignables ») ; l'unicité du composant n'est pas testée.
- L'éditeur n'est proposé qu'aux admins et aux colonnes select ou multiselect ; le 403 du serveur reste l'autorité. `PageOptionsPanel` dit à un non-admin que les règles sont réservées aux administrateurs au lieu de se taire, et `isAdmin` y vaut `false` tant que le rôle charge.
