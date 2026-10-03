# 0014 : Clôture de sprint transactionnelle avec notes de version

- Date : 2026-07-17
- Référence : commits `a919329` (PR #31) et `e00579a` (PR #32) du 2026-07-16, `a9e7927` et `2b2eab9` (PR #33) du 2026-07-17
- Statut : acceptée

## Contexte
Clore un sprint renvoyait déjà ses issues non terminées au backlog, sans rien garder de ce qui avait été livré.
Les notes de version devaient atterrir sur une page « Patch notes » choisie par database, sans jamais l'écraser ni y laisser un bloc tronqué.

## Décision
`PATCH /api/sprints/[id] {state:"completed"}` fait tout dans une transaction : passage à `completed`, renvoi des issues non terminées au backlog, génération de `Sprint.releaseNotes` une seule fois (re-clôture idempotente), puis ajout d'un bloc daté à la page mappée par `Database.patchNotesPageId`. Des issues listées non terminées ou une page au JSON illisible annulent tout en 422 ; sans page mappée, la clôture passe avec le flag `patchNotesAppend`.
`patchNotesPageId` est une référence libre, sans relation Prisma, vérifiée à l'écriture et à l'ajout : même espace, page non trashée et accessible à l'acteur.

## Conséquences
`releaseNotes` est en lecture seule dans l'UI (panneau du backlog). Une page devenue inaccessible à l'acteur après le mapping n'est plus alimentée (`no_page`).
Aucun écran ne pose `patchNotesPageId` : l'API, donc `notes_set_patch_notes_page`, est le seul chemin, et la fonctionnalité est restée inerte jusqu'au 05/08 (cf. 0042).
