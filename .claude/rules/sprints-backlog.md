---
paths:
  - "src/app/api/{sprints,databases/*/sprints}/**/*"
  - "src/components/databases/{BacklogView,KanbanView}.tsx"
  - "src/lib/{db,pages,templates}.ts"
---

# Les sprints et le backlog : invariants

- Une database a au plus un sprint `active` : le `PATCH` qui pose `state: "active"` contrôle et écrit dans la même `$transaction` (409), rien ne le porte en base ; démarrer par le `PATCH`, jamais par le `POST`, qui accepte `state: "active"` sans contrôle.
- `nextPosition("sprint", { databaseId }, tx)` dans la transaction du `POST` ; `Record.sprintId` à `null` = backlog (`onDelete: SetNull`) ; supprimer un sprint est définitif et admin.
- `releaseNotes` n'est écrit que par la clôture (aucun schéma de route ne l'accepte) et une seule fois : une seconde clôture ne régénère ni n'ajoute rien.
- Clôture en une transaction, dans cet ordre : sprint, renvoi des non terminées au backlog, `releaseNotes`, ajout à la page « Patch notes » ; une réconciliation impossible ou un contenu illisible = rollback et 422.
- Sans `statusPropertyId` ni `doneStatusOptionId`, rien ne retourne au backlog et toutes les cartes sont listées livrées : chaque client envoie le statut de sa propre vue.
- `appendReleaseNotesToContent` rend `corrupt` sur un contenu illisible, jamais un écrasement ; le bloc porte l'id `release-notes-<sprintId>` (marqueur d'idempotence) ; `appendReleaseNotesToPage` ne lève jamais (`no_page` sinon).
- `patchNotesPageId` est une référence libre, sans relation Prisma : page du même espace et accessible (`isPageAccessible` avec `isService`), sinon 400 ; `null` retire le mapping.
- Un sprint d'une autre database = 400 ; points, statut et épic sont des propriétés ordinaires câblées par id dans `View.config` ; `sprintScope` d'une vue kanban absent = kanban classique.

Détail et gardes : `docs/doctrine/sprints-backlog.md`.
