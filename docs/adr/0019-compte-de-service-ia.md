# 0019 : Le pont MCP incarne un compte de service « IA »

- Date : 2026-08-05
- Référence : PR #48 (`3d8445b`, `c538cac`), suite en PR #49 (`7b6ba1d`) ; côté hub, commit `7d55e6e` (PR gotyeah-mcp #6)
- Statut : acceptée

## Contexte
Le pont MCP incarnait l'email du porteur du jeton claude.ai : l'Historique attribuait à Gautier les écritures de l'IA.
Un compte distinct aurait reçu 404 sur le Board, Discovery et les autres boards, tous posés sur des pages privées.

## Décision
`NOTES_ACT_AS_EMAIL=ia@gotyeah.local` fixe l'identité du pont pour tous les outils `notes_*`.
Ce compte porte `User.isService`, seule exemption à la confidentialité : il voit les pages privées des espaces dont il est membre, jamais au-delà, via `isPageAccessible` et `pageVisibilityFilter`.
C'est le choix de Gautier (QCM du 05/08), plutôt que de basculer ces pages en section équipe.

## Conséquences
L'Historique attribue ces écritures à « IA ». Le compte se crée par `scripts/create-service-account.mjs`, aucune route n'écrit `isService`, et il doit figurer dans `MCP_ACT_AS_ALLOWLIST`, sinon le pont répond 401.
Toute membership de ce compte ouvre le privé de tous les membres de l'espace : d'où les bornes du rattachement d'office (cf. 0034).
Deux appels sur seize ont oublié l'exemption et l'ont rendu muet sur les routes databases (cf. 0025) ; `service-account.test.ts` en garde désormais l'arité.
