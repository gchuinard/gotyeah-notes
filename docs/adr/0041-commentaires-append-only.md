# 0041 : Commentaires de carte append-only, en texte brut, sans notification

- Date : 2026-08-09
- Référence : commit `7f3f5c1` (PR #75), « décisions de Gautier du 09/08 »
- Statut : acceptée

## Contexte
Le corps d'une carte (`content`, `sectionsBody`) s'écrit en remplacement total : une remarque posée dedans risque d'être effacée par la prochaine écriture, le piège des « Notes de Gautier ».
Il fallait un fil où chaque message a sa ligne, que le pont MCP puisse aussi lire et écrire : la session IA suivante en est le lecteur.

## Décision
`RecordComment` est append-only : ni `PATCH` ni `DELETE`, ni `updatedAt` ni `deletedAt`, ni dans l'API, ni à l'écran, ni au MCP (`update` et `delete` y sont des `Gap`) ; `tests/api/comments.test.ts` fige les deux absences.
Corps en texte brut de `MAX_BODY` (4000) caractères au plus, pas en BlockNote : un corps de blocs n'a pas d'aperçu lisible et le MCP écrit ce champ ; éditeur pour publier, lecteur pour lire.
Publier n'émet aucune notification : le message porterait un extrait du texte, et prévenir quelqu'un qui ne peut pas ouvrir la carte le lui divulguerait (le piège de 0037, fermé ici au lieu d'être contourné).

## Conséquences
Disparaissent « qui a le droit de modifier », la modale de confirmation et la mention « modifié » ; un message publié reste tel quel.
L'écran insère la ligne rendue par le serveur au lieu de relire le fil : un second `mutate()` rapproché était dédupliqué par SWR, et la réponse d'un fil append-only est la vérité.
Le GET est borné à `TAKE` (200) messages sans pagination, et rien ne signale la troncature : à reprendre si un fil approche ce volume.
