# 0015 : Classement des changements par rayon d'impact T1/T2/T3

- Date : 2026-07-17
- Référence : décision prise dans notes (process Dev Loop), non retrouvée dans git ; consignée par le commit `92b19cd` (PR #37, 2026-07-18), état mis à jour par `2e62c97` (2026-08-05)
- Statut : acceptée

## Contexte
Un push sur `main` part en production (hors changements limités aux `.md`) : d'où la règle « jamais de push sur `main` sans go explicite de Gautier ».
L'intention était d'ouvrir une voie rapide aux changements sans risque : un T1 auto-mergé et déployé sans recette.

## Décision
Chaque ticket est classé par rayon d'impact, pas par taille : T3 = auth, paiement, migration ou suppression de données, irréversible, sécurité ; T1 = UI, copie, doc, ajout isolé, sans surface données ni sécurité ; T2 = tout le reste.
Le classement vit sur la carte (propriété `Risque`), à côté d'un statut « Déployé T1 / à contrôler » sur les boards.

## Conséquences
Aucun circuit par tier n'est écrit : l'exception T1 est inactive, et une étiquette T1 ne dispense de rien, sinon on déploierait sur la foi d'une couleur.
La règle en vigueur reste « jamais de push sur `main` sans go », avec pour seule dérogation l'auto-merge des petits correctifs low-risk à CI verte.
Activer T1 suppose de décider d'abord les circuits par tier, dans un ticket du Board.
