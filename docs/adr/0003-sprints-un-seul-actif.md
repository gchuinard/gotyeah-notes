# 0003 : Sprints en modèle Prisma, un seul actif par database

- Date : 2026-06-30
- Référence : commits `1308a4a` et `6a35c6c` (2026-06-30) ; la vérification dans la transaction date du 2026-07-10 (`e6d83cd`, PR #14)
- Statut : acceptée

## Contexte
La vue backlog façon Jira demandait des sprints, et le board scrum devait montrer le sprint en cours sans changer le kanban classique.
La règle « un seul sprint actif par database » n'était d'abord vérifiée que par un `findFirst` avant l'update : deux démarrages concurrents (UI et MCP) pouvaient passer tous les deux.

## Décision
`Sprint` est un modèle par database ; `Record.sprintId` y rattache une carte, `null` vaut backlog, et `onDelete: SetNull` renvoie les cartes au backlog quand on supprime un sprint.
Démarrer un sprint cherche un autre sprint `active` et écrit dans la même `$transaction` ; le conflit lève une erreur typée, traduite en 409. Le kanban se scope par `View.config.sprintScope` (`active`, `all` ou un id de sprint).

## Conséquences
Supprimer un sprint ne détruit aucune carte, et le statut reste l'axe commun du backlog et du board.
L'unicité repose sur la transaction, pas sur la base : l'index unique partiel sur `Sprint(databaseId)` limité à `state = 'active'` a été laissé hors du lot, faute de migrations versionnées à l'époque, et n'existe toujours pas.
