# 0043 : Un seul fetcher SWR, qui lève une HttpError

- Date : 2026-08-09
- Référence : commit `163df30` (PR #79), daté du 2026-08-12 ; l'ancien CLAUDE.md, modifié par ce même commit, écrit « unifié le 09/08 »
- Statut : acceptée

## Contexte
Le projet définissait 19 fetchers SWR, dont 11 sans test de `res.ok` : sur un 401 ou un 404 à corps JSON (session expirée, carte mise en corbeille), `data` recevait `{ error }`, que SWR traite comme une donnée valide.
Le défaut `= []` ne s'appliquait pas à un objet, `data.map(…)` levait en rendu, et faute d'`error.tsx` ou d'ErrorBoundary dans `src/app`, le GlobalError de Next remplaçait le root layout : `WorkspaceContext` faisait tomber toute l'application à l'expiration de session.

## Décision
Un seul `fetcher`, dans `lib/client/fetcher.ts`, lève une `HttpError` qui porte `.status` et ne lit jamais le corps de l'erreur ; `loadErrorMessage(err)` rend une phrase, jamais un code nu.
`noRetryOn4xx` s'applique aux clés qui peuvent légitimement répondre 4xx : on réessaie une panne, pas un refus.
L'ordre de rendu est erreur, chargement, vide, liste ; dans un contexte monté en permanence, l'écran d'échec se déclenche sur `error && data === undefined`, jamais sur `error` seul.

## Conséquences
Un « Aucun élément » affiché après un échec se lirait comme une suppression, et SWR efface l'erreur au premier `mutate()` réussi : d'où l'ordre imposé. Un échec de revalidation garde la liste précédente au lieu de faire clignoter l'écran.
`blocknoteSchema` dépendait du comportement fautif (un lien mort dégrade en libellé « page », c'est voulu) : `noRetryOn4xx` rend sa bascule sûre. Garde : `tests/unit/fetcher.test.ts`.
Exceptions connues : `membersFetcher` dans `SettingsPage`, et des clés (records et sprints des vues, `useWorkspaceMembers`, `NotificationBell`) sans `noRetryOn4xx` (fiche « Fin de l'unification du fetcher (membersFetcher, noRetryOn4xx) »).
