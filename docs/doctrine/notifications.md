# Doctrine : Notifications (cloche)

Périmètre : le modèle `Notification`, son écriture (`notify()`, `record_assigned`), sa lecture et sa purge (`/api/notifications`), le composant `NotificationBell`.
Invariants courts : `.claude/rules/notifications.md` · Décisions datées : `docs/adr/`

## Principe

- Une notification est un message, jamais une autorisation. L'autorité d'une invitation reste `WorkspaceInvitation`, celle d'un accès reste `Membership` : lire, purger ou ne jamais afficher une notification ne change aucun droit (ADR 0036). Non testé en tant que tel.
- Accepter ou refuser depuis la cloche passe par `POST /api/invitations/[id]`, qui revérifie l'invitation (adresse, refus, péremption) ; utiliser l'invitation, pas la notification, pour décider (doctrine `auth-invitations`).
- Le `workspaceId` d'une notification ne prouve aucune appartenance : une invitation vise justement un espace dont on n'est pas encore membre. Pour un accès, utiliser `getMembership()`, pas la présence d'une notification. Non testé.
- Rappel (invariant 12 du CLAUDE.md) : l'événement s'écrit d'abord, la notification suit dans la même transaction, et son échec n'annule rien. Exception connue : `record_assigned` s'écrit sans l'enveloppe de `notify()`, donc une erreur à son écriture fait échouer tout le `PATCH` des records (rollback). Écart signalé, sans fiche à ce jour.

## Fichiers

- `src/lib/notifications.ts` : logique pure (types, payload, phrases, purge, coalescence, entrants). Aucun import d'exécution, seul un `import type` de `./workspace` : il reste importable côté client. Non testé.
- `src/lib/notify.ts` : l'écriture, via Prisma, donc serveur uniquement.
- `src/app/api/notifications/route.ts` : `GET` (liste ou `?count=1`) et `PATCH` (tout marquer lu).
- `src/components/NotificationBell.tsx` : la cloche, montée par `Header`.

## Modèle et vie d'une ligne

- `readAt` : `null` = non lu, même grammaire que `trashedAt`. `PATCH /api/notifications` marque tout comme lu en un `updateMany` ; il n'existe pas de marquage unitaire.
- Pas d'`updatedAt`, mais une ligne n'est pas immuable : l'upsert d'une ré-invitation et la coalescence de `record_assigned` réécrivent `payload`, `readAt` (remis à `null`) et `createdAt` ; `removeMember` supprime les notifications de l'espace quitté ; la purge supprime au-delà de 90 j.
- Relations : destinataire (`userId`) et `workspaceId` en Cascade. `actorId` en SetNull : l'affichage retombe sur l'instantané `actorName`, puis sur « Quelqu'un ». `invitationId` en Cascade, seule relation vers une cible parce que c'est la seule qui porte un bouton donnant un accès : révoquer, consommer ou purger l'invitation fait disparaître la carte « Accepter ».
- `@@unique([userId, invitationId])` : une notification liée à une invitation s'écrit par upsert, sinon chaque relance empilerait une carte « Accepter ». `notify()` bascule seul sur l'upsert dès qu'un `invitationId` est fourni. Les NULL restant distincts en SQLite, les autres types ne sont pas contraints. Non testé (`tests/api/invitations.test.ts` vérifie l'unicité de l'invitation, pas celle de la notification).
- `type` est une `String`, pas un enum Prisma (comme `Membership.role`). La liste fait foi dans `NOTIFICATION_TYPES` ; le commentaire de `prisma/schema.prisma` au-dessus du champ n'est pas une source.

## Types et émetteurs

- `workspace_invitation` : au compte existant invité, par `POST /api/workspaces/[id]/members`, avec `invitationId` (upsert).
- `workspace_joined` : à la personne qui accepte, par `POST /api/invitations/[id]` (l'émetteur n'est pas prévenu sur ce chemin) ; et à l'émetteur de chaque invitation acceptée par `POST /api/invitations/claim`. Écart signalé, sans fiche à ce jour : `notificationMessage` rend ce type à la deuxième personne (« Tu as rejoint… »), phrase fausse pour l'émetteur.
- `invitation_declined` : à l'émetteur, par `POST /api/invitations/[id]`. Le refus par jeton (`/api/invitations/claim`) ne notifie personne (doctrine `auth-invitations`).
- `role_changed` : au membre, par `updateMemberRole`, avec `roleBefore`/`roleAfter`.
- `membership_removed` : au membre retiré, par `removeMember`. Ses notifications de l'espace sont effacées dans la même transaction, sinon la cloche resterait un canal de lecture (titres de cartes, noms d'acteurs) vers un espace qu'il ne peut plus ouvrir ; `membership_removed` est émise après cet effacement, sinon elle serait effacée avec elles. Garde : `tests/api/notify.test.ts` (cas « efface les notifications de cet espace, et garde celle du retrait »).
- `record_assigned` : à chaque assigné ajouté, par `PATCH /api/records/[id]` (section dédiée).
- Émission par la route : `workspace_invitation` gardée par `tests/api/invitations.test.ts` (cas « un compte existant est invité, jamais ajouté d'office ») ; `invitation_declined` par `e2e/invitation-accept.spec.ts` (cas « refuser ne fait entrer nulle part, et l'admin l'apprend ») ; `role_changed` et `workspace_joined` : non testé.
- `updateMemberRole` et `removeMember` prennent un `context { actorId, workspaceName }` qui nomme l'auteur et arme le filtre « jamais soi-même » : la route doit le passer. Exception connue : `src/app/api/workspaces/[id]/members/[userId]/route.ts` ne le passe pas ; la notification est anonyme, et quitter un espace ou changer son propre rôle se notifie à soi-même. `tests/api/notify.test.ts` passe ce `context`, il ne voit donc pas le défaut (fiche Discovery « Auteur absent des notifications de rôle et de retrait »).
- Ajouter un type : l'ajouter à `NOTIFICATION_TYPES` et au `switch` de `notificationMessage`, pas ailleurs.
- Un type inconnu dégrade en ligne générique (« Nouvel événement dans … »), jamais ne plante : un retour arrière du code laisse en base des lignes déjà écrites. Même contrat pour le payload : `parseNotificationPayload` rend `{}` sur un JSON illisible. Garde : `tests/unit/notifications.test.ts` (cas « type inconnu » et « JSON illisible »).

## Contenu : des références, jamais le texte rendu

- Le payload (`NotificationPayload`) porte des libellés instantanés et des références libres ; la phrase se rend à la lecture par `notificationMessage`. Stocker un champ, pas une phrase : une phrase figée ne se re-rend pas et fige un `displayName` qui doit rester vivant. Même doctrine que `RecordRevision`, qui ne copie que ce qui n'existe nulle part ailleurs.
- À l'affichage, le nom lu en base (relations `workspace` et `actor`) prime sur l'instantané, qui ne sert que de repli quand la cible a disparu. Garde : `tests/unit/notifications.test.ts` (bloc « Message : rendu à la lecture »).
- Le titre d'une carte (`recordTitle`) reste l'instantané de l'émission : la lecture ne relit pas la carte.
- Jamais le rôle offert par une invitation : ré-inviter change le rôle sur la même ligne d'invitation, et une copie périmée afficherait « éditeur » sur un bouton qui accorde « lecteur ». Le `GET` le lit sur l'invitation (`invitationRole`). Exception assumée : `roleBefore`/`roleAfter` de `role_changed`, faits passés d'un changement déjà appliqué. Le type `NotificationPayload` n'a pas de champ pour le rôle offert ; l'affichage après une ré-invitation à un autre rôle : non testé.

## Écrire : `notify()`

- Passer par `notify(client, inputs)`, pas par `prisma.notification.create`. Seule exception : `record_assigned`.
- Appeler `notify()` avec le `tx` de la transaction qui produit l'événement, jamais après : hors transaction, une notification survivrait à un rollback et annoncerait un fait qui n'a pas eu lieu. Son client est typé structurellement et accepte le client global comme le `tx`. Non testé.
- `notify()` ne lève jamais : un échec est journalisé (`[notify-failed]`) et rend 0, le geste métier passe. Garde : `tests/api/notify.test.ts` (cas « ne lève jamais »).
- Deux filtres : jamais l'acteur lui-même (`userId !== actorId`, qui n'agit que si `actorId` est fourni), sinon changer son propre rôle ou quitter un espace s'annoncerait à soi-même ; jamais un compte de service (`isService`), qui n'a pas de cloche : ses lignes s'accumuleraient sans lecteur. Les comptes de service sont écartés en une seule requête, quel que soit le nombre de destinataires. Garde : `tests/api/notify.test.ts`.
- Un compte de service peut être acteur (le pont MCP qui passe la main), jamais destinataire. Garde : `tests/api/notify-assignees.test.ts`.
- Le rattachement d'office d'un compte de service (`createWorkspaceWithDefaults`) ne notifie personne : acte système.

## `record_assigned` (le « Main à » du Dev Loop)

- Écrit dans la transaction de `PATCH /api/records/[id]`, à partir du diff de révisions déjà calculé, pour toute propriété de type `user` modifiée, pas seulement « Main à ».
- Seul ce PATCH notifie : créer (`POST /api/databases/[id]/records`) ou dupliquer une carte déjà assignée ne prévient personne, par l'écran comme par le MCP. Non testé.
- Entrants seulement, via `addedAssignees(before, after)` : notifier sur « la propriété a changé » préviendrait tout le monde à chaque retrait ou réordonnancement. Garde : `tests/api/notify-assignees.test.ts` (cas « retirer quelqu'un ne notifie personne », « réémettre la même valeur ne renotifie pas »).
- Coalescence, via `shouldCoalesceAssignment` : si la dernière `record_assigned` du destinataire dans le même espace vient du même acteur depuis moins de `ASSIGNMENT_COALESCE_MS` (2 min), elle est réécrite (`count` incrémenté, titre et `recordId` retirés, `readAt` à `null`, `createdAt` rafraîchi, donc la fenêtre glisse à chaque fusion). Motif : `BulkActionBar` envoie un PATCH indépendant par carte, et le serveur ne peut pas savoir que trente PATCH sont un seul clic. Garde : `tests/api/notify-assignees.test.ts` (bloc « Avalanche ») et `tests/unit/notifications.test.ts`.
- Confidentialité : notifier seulement si le destinataire peut ouvrir la page hôte, `isPageAccessible(access.page, uid, false)` avec `uid` le destinataire, jamais `user.id` l'acteur. Le message porte le titre de la carte : prévenir quelqu'un d'une page qu'il ne peut pas ouvrir lui divulguerait ce titre et le laisserait devant un 404. `false` en troisième argument : le destinataire est évalué comme un humain, l'exemption de service sert à lire, pas à recevoir. `access.page` vient de `checkRecordAccess`. Garde : `tests/api/notify-assignees.test.ts` (bloc « Confidentialité ») (ADR 0037).
- Sur une page privée, la seule notification légitime vient d'un compte de service qui assigne le propriétaire : tout autre acteur y prend un 404, et le propriétaire ne se notifie pas lui-même. Garde : même fichier (cas « le propriétaire reste prévenu sur sa propre page privée »).
- L'écriture ne passe pas par `notify()`, la coalescence exigeant de lire la dernière ligne : les filtres « jamais soi-même » et « jamais un compte de service » sont redéclarés dans la route. Toute évolution des filtres de `notify()` se reporte là. Garde : `tests/api/notify-assignees.test.ts`.
- Payload : `actorName`, `recordTitle`, `recordId`, `pageId`. Pas de `workspaceName`, résolu à la lecture par la relation. `pageId` et `recordId` sont stockés mais ni rendus par le `GET` ni utilisés par la cloche.

## Lire, compter, purger : `/api/notifications`

- `GET ?count=1` rend `{ unread }`. C'est la requête la plus fréquente de l'application (la cloche est dans `Header`, revalidée à chaque montage et retour de focus) : elle ne joint rien et n'écrit rien.
- `GET` sans paramètre rend la liste, libellés résolus : c'est l'ouverture du panneau, geste délibéré, donc le seul endroit de la purge.
- Purge paresseuse : les notifications de plus de `NOTIFICATION_PURGE_DAYS` (90 j), lues ou non, sont supprimées au `GET` de la liste, scopées au destinataire ; jamais sur le compteur, jamais par un cron. Son échec est avalé, la liste s'affiche quand même (ADR 0007). Garde : `tests/unit/notifications.test.ts` pour le seuil ; la route : non testé.
- 90 j dépasse les 30 j de la corbeille : on ne purge jamais une notification dont la cible est encore restaurable. Garde : `tests/unit/notifications.test.ts`.
- Le filtre d'âge est l'autorité, la purge n'est que du ménage : le compteur applique le même `createdAt >= cutoff` que la liste, sinon le badge compterait des lignes que le panneau ne montre pas chez qui ne l'ouvre jamais. Non testé.
- `actionable` (boutons Accepter/Refuser) se calcule à la lecture par `isInvitationActionable` : invitation présente, non refusée, non périmée. Ne pas se fier à la disparition de la ligne d'invitation, qui n'est purgée qu'au claim de son adresse. Garde : `tests/unit/notifications.test.ts` (bloc « Actionnable »).
- La liste rend au plus les `LIMIT` (50) plus récentes, sans pagination ; le compteur compte toutes les non-lues de moins de 90 j, et « Tout marquer lu » les couvre toutes. Non testé.
- `PATCH /api/notifications` est un geste sur soi : aucun gate de rôle, exemption déclarée dans `tests/api/role-gates.test.ts`.

## Ce qui ne notifie pas

- Un commentaire de carte n'émet aucune notification : le message porterait un extrait du texte, et prévenir quelqu'un qui ne peut pas ouvrir la carte le lui divulguerait. Garde : `tests/api/comments.test.ts` (cas « publier n'écrit aucune notification ») (ADR 0041).
- Aucun email en plus de la cloche pour ses événements : `RECIPIENT_BUDGET` (5/h) est partagé avec les invitations, et trois messages de courtoisie feraient partir l'invitation légitime en `throttled`. Seule l'invitation envoie un email (doctrine `auth-invitations`) (ADR 0036). Non testé.
- Pas d'outil MCP pour la cloche : `notes_entities.py` (dépôt `gotyeah-mcp`) ne la déclare pas, et le pont incarne un compte de service, qui ne reçoit rien (doctrine `mcp`).

## Composant `NotificationBell`

- Deux clés SWR : le compteur (`/api/notifications?count=1`) en permanence, la liste (`/api/notifications`) seulement panneau ouvert (clé `null` sinon).
- Pas de `refreshInterval` : l'information n'est jamais urgente et se paie sur le Pi. Utiliser la revalidation au retour de focus de SWR, pas un polling.
- Pastille seulement s'il y a des non-lues (« 9+ » au-delà de 9), jamais un badge « 0 » : un badge permanent apprend à ignorer la cloche.
- Le rôle proposé s'affiche depuis `invitationRole`, et seulement si `actionable`. Garde : `e2e/invitation-accept.spec.ts` (pastille « 1 », « Rôle proposé : éditeur », puis acceptation).
- Le panneau ne lit pas l'erreur SWR de la liste : un chargement en échec reste affiché « Chargement… », contre l'ordre « erreur, puis chargement, puis vide, puis liste » (doctrine `ui`). Écart signalé, sans fiche à ce jour.
- Après une acceptation : revalider `/api/workspaces` et appeler `router.refresh()`, sinon le nouvel espace n'apparaît ni dans le sélecteur ni dans la page rendue au SSR.
- Les deux clés passent par le `fetcher` unique. Exception connue : elles n'ont pas `noRetryOn4xx`, donc une session expirée fait relancer le compteur en boucle (fiche Discovery « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).

## Tester

- Viser un destinataire neuf à chaque cas (`seedMember` dans le test) : un destinataire déjà notifié plus haut dans le fichier laisse la coalescence de 2 min absorber la nouvelle ligne, et le compteur reste inchangé pour une raison sans rapport avec la garde testée (ADR 0037).
- Une garde de confidentialité se teste dans les deux sens, un cas bloqué et un cas qui passe : sinon une garde qui refuse tout le monde passe aussi. Modèle : `tests/api/notify-assignees.test.ts`.
- Tester une émission par la route, pas seulement par le helper : un test qui appelle `removeMember` avec son `context` ne prouve pas que la route le passe.
