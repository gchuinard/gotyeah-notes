# 0028 : Glisser-déposer : capteurs souris et tactile

- Date : 2026-08-06
- Référence : commit `2805f85` (PR #55)
- Statut : acceptée

## Contexte
Les glisser-déposer utilisaient `PointerSensor` avec une distance d'activation. Au doigt, le navigateur revendiquait le geste pour le défilement et émettait `pointercancel` : le drag ne s'armait quasiment jamais, sans être franchement désactivé.
Le lot qui rend l'application utilisable sur téléphone l'a relevé et a changé la convention.

## Décision
`MouseSensor` (`distance: 6`) et `TouchSensor` (`delay: 250, tolerance: 6`) partout : sidebar, table, kanban, backlog, options select. Le délai distingue l'appui long (« je déplace ») du glissement (« je défile »).
Exception : les onglets de vues de `DatabaseShell` gardent `MouseSensor` seul, leurs listeners couvrant tout l'onglet dans une bande `overflow-x-auto`.
Pas de `touch-none` sur les lignes de l'arbre de la sidebar, qui couvrent presque toute sa surface.

## Conséquences
Au doigt, déplacer demande un appui de 250 ms ; les onglets de vues ne se réordonnent qu'à la souris, sinon les vues 4 et 5 deviendraient inatteignables.
`touch-action: none` sur l'arbre interdirait de faire défiler la liste ; le `TouchSensor` pose lui-même son listener non passif une fois le drag armé.
Les valeurs sont des littéraux répétés dans six composants, sans constante partagée, et ce comportement n'est couvert par aucun test.
