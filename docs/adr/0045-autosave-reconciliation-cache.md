# 0045 : Post-mortem : corps de carte périmé à la réouverture, puis détruit

- Date : 2026-08-09
- Référence : commit `5af5101` (PR #78), daté du 2026-08-12 ; l'ancien CLAUDE.md, modifié par ce même commit, écrit « corrigé le 09/08 »
- Statut : acceptée

## Contexte
Rapporté en production : « ça ne s'enregistre pas toujours », alors qu'un Ctrl+R ramenait le texte. La sauvegarde marchait ; c'était le cache SWR : les deux savers du corps étaient les seuls chemins d'écriture du `RecordPanel` à ne pas le réconcilier.
Le panneau resème ses éditeurs depuis ce cache à chaque montage (`initialContent` lu une fois, `sections` dans un `useState`, `key={record.id}` dans les cinq vues) : rouvrir sans recharger réaffichait le corps d'avant la saisie.
Retaper renvoyait ensuite ce corps périmé en remplacement total, toutes sections comprises, Notes de Gautier incluses, et la coalescence de 2 min des révisions fusionnait l'aller et le retour : le texte perdu n'existait plus nulle part.

## Décision
Après un PATCH accepté, les savers réconcilient le cache localement (`globalMutate(key, updater, { revalidate: false })`), jamais par un refetch de la clé records, qui rend tous les corps et pèserait sur le Pi ; un échec ne touche pas au cache.
Le panneau affiche son état (`data-save-state`), avec un échec rouge et persistant, et `pagehide` envoie les saisies en attente (`keepalive: true`), fermer l'onglet ne démontant pas React.

## Conséquences
Le symptôme trompe : si un rechargement rend le texte, le fautif est le cache, et « fiabiliser l'autosave » passerait à côté.
Le spec existant rouvrait la carte après un `page.goto()`, qui vide le cache SWR : il était structurellement aveugle au défaut. Un test d'autosave rouvre sans recharger et se voit rouge sur l'ancien code (`e2e/autosave.spec.ts`).
`Editor.tsx` (pages) n'a reçu ni l'état d'échec ni le flush sur `pagehide` (fiche « Autosave des pages : état d'échec visible et flush sur pagehide »).
