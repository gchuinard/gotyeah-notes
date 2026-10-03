# 0010 : Dialogues maison en Promise, sans dialogue natif

- Date : 2026-07-10
- Référence : commit `b38408f`, PR #13
- Statut : acceptée

## Contexte
L'app ouvrait 16 dialogues natifs du navigateur (9 `confirm`, 7 `alert`), hors de la charte, et un `ConfirmModal` maison sans Échap ni gestion du focus, utilisé à deux endroits.
Playwright rejette d'office les `confirm()` natifs : aucun flux « supprimer depuis l'UI » n'était testable en E2E.

## Décision
Un seul système : `useDialog()` (`contexts/DialogContext.tsx`) fournit `confirm()` et `alert()`, qui renvoient une Promise, rendus par une modale accessible unique (`components/ui/Dialog.tsx` : portail, piège de focus, `role=dialog`).
La plomberie est une logique pure (`lib/client/dialogController.ts`) qui sérialise les demandes rapprochées ; un ton `danger` distingue le destructif, et Échap est capté en phase capture pour ne fermer que la modale.

## Conséquences
`window.confirm` et `alert` sont proscrits ; le remplaçant étant asynchrone, chaque appel s'attend avec `await`.
Les suppressions par l'UI sont désormais couvertes en E2E, et le focus initial sur « Annuler » d'un dialogue `danger` garantit qu'Entrée ne détruit rien.
