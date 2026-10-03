# 0042 : Post-mortem : une fonctionnalité sans porte n'existe pas

- Date : 2026-08-09
- Référence : commit `c472776` (PR #73) pour la porte d'UI ; commit `4a19506` (PR #71, 2026-08-08) pour la garde à la création de colonne
- Statut : acceptée

## Contexte
Les règles de transition, livrées le 05/08 (PR #51), n'avaient qu'un point de montage : l'en-tête de colonne de la vue Tableau. Sur un board qui n'a qu'un kanban, elles étaient inatteignables, et le 09/08 aucune des 306 colonnes de la prod n'en portait (compte fait en prod, non vérifiable depuis le dépôt).
Même famille : les notes de version de sprint, livrées mi-juillet, sont restées inertes jusqu'au 05/08, `patchNotesPageId` valant `null` sur les 20 boards faute d'écran pour le poser.
Côté serveur, `POST /api/databases/[id]/properties` n'était pas gaté sur `rules`, alors que la doctrine disait la clé « gatée admin » : vrai du PATCH seulement, si bien qu'un éditeur créait une colonne dont les règles étaient déjà les siennes.

## Décision
`TransitionRulesEditor` est extrait de `PropertyPopover` et monté aussi par `PageOptionsPanel`, ouvert depuis l'arbre de la barre latérale pour toutes les vues ; l'éditeur n'est pas dupliqué, deux copies d'un écran de permissions divergeraient.
La création de colonne exige le rôle admin dès qu'elle porte un tableau `rules` non vide, là où le PATCH juge la différence (`tests/api/gardes-parent-et-rules.test.ts`).

## Conséquences
Une fonctionnalité a une porte atteignable depuis toutes les vues où elle sert ; une clé ajoutée au config sans l'écran qui la pose n'existe pas pour l'utilisateur.
Chaque porte d'écriture d'une clé gouvernée porte la garde, pas seulement celle qu'on avait en tête.
`patchNotesPageId` n'a toujours aucun écran : l'API, donc `notes_set_patch_notes_page`, reste le seul chemin (doctrine `sprints-backlog`).
