# 0018 : Assignés = membres de l'espace, filtre « Moi » par jeton

- Date : 2026-08-04
- Référence : commits `7281cef` (PR #45) et `a5ba994` (PR #46)
- Statut : acceptée

## Contexte
L'assignation passait par des colonnes texte ou select ; une liste de personnes figée dans le config d'un select se périme à chaque arrivée ou départ.
Un filtre « Moi » ne pouvait pas stocker un userId : `View.config` est en base et partagé par tous les membres, il montrerait à chacun les cartes de son auteur.

## Décision
Le type `user` stocke un tableau d'ids de membres de l'espace hôte, validé par `validateUserValues` sur le patch entrant seulement.
Le kanban se groupe par assigné à partir de graines injectées (les membres) ; la carte d'un membre parti tombe dans une colonne « Membre retiré », qui n'accepte pas de dépôt.
« Moi » est le jeton `@me` (`CURRENT_USER_TOKEN`), résolu à la lecture et pour le seul type `user`, côté client comme dans `GET /api/databases/[id]/records?filter=`.

## Conséquences
Valider le résultat du merge gèlerait les cartes d'un membre parti ; mais toute écriture réémet le tableau entier, donc chaque porte d'écriture retire d'abord les ids inconnus (`withoutUnknownIds`), sans quoi la carte deviendrait indéplaçable.
Sans identité, le jeton reste tel quel et la vue est vide plutôt que complète.
Un board n'affiche jamais l'email des membres, seulement leur `displayName`.
