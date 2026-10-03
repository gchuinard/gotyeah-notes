# 0044 : Kanban : le clic simple ouvre la carte, le double-clic renomme le titre

- Date : 2026-08-09
- Référence : commit `c4a2de7` (PR #77) ; l'édition inline au clic simple venait de `1eb86a1` (2026-07-16)
- Statut : acceptée

## Contexte
Viser le titre d'une carte kanban pour l'ouvrir la faisait entrer en édition inline sans l'avoir demandé, alors que partout ailleurs sur la carte le clic l'ouvre.
Un double-clic émet deux `click` avant le `dblclick` : en laissant le premier agir, le panneau s'ouvrirait et le renommage démarrerait derrière lui.

## Décision
Le clic simple ouvre la carte, le double-clic renomme le titre. Sur le titre seulement, l'ouverture est reportée de `DOUBLE_CLICK_DELAY_MS` (300 ms), et l'arbitrage tient dans un seul handler grâce à `e.detail`, qui compte le second clic du geste avant le `dblclick`.
Partout ailleurs sur la carte l'ouverture reste immédiate, et en lecture seule il n'y a pas de report, faute de renommage à départager.

## Conséquences
Compromis assumé : trop court, un double-clic lent ouvre la carte ; trop long, ouvrir une carte par son titre devient mou.
Deux branches, deux tests (`e2e/kanban-title-dblclick.spec.ts`) : sans celui du clic simple, on retirerait un jour le report et le titre deviendrait une zone morte. `kanban-inline-edit.spec.ts` est passé au double-clic.
L'input porte `data-card-title-input`, car un sélecteur `input[value='…']` cesse de correspondre dès la première frappe.
