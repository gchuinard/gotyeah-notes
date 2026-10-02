# 0037 : Post-mortem : la garde de record_assigned testait l'acteur

- Date : 2026-08-08
- Référence : commit `e81767f` (PR #72) ; défaut livré le matin même par `5385dc8` (PR #66)
- Statut : acceptée

## Contexte
La notification `record_assigned`, écrite dans la transaction de `PATCH /api/records/[id]`, porte le titre de la carte : sa garde de confidentialité devait se taire quand le destinataire ne peut pas ouvrir la page hôte privée.
Elle testait `user.id`, l'acteur, qui vient d'écrire sur la carte : le propriétaire d'une page privée qui y assignait un tiers lui envoyait le titre d'une carte qu'il ne peut pas ouvrir, et sur la page privée de quelqu'un d'autre, plus personne n'était prévenu, pas même son propriétaire.
Son test passait quand même : il réutilisait un destinataire déjà notifié plus haut dans le fichier, dont la coalescence de 2 min absorbait la nouvelle ligne, et le compteur restait inchangé pour une raison sans rapport avec la garde.

## Décision
La garde évalue le destinataire : `isPageAccessible(access.page, uid, false)`, avec `false` parce qu'on juge un humain (l'exemption du compte de service sert à lire, pas à recevoir).
Le filtre « jamais un compte de service » de `notify()`, qui manquait, est redéclaré dans la route à côté de « jamais soi-même », en une requête.
Les nouveaux cas de `tests/api/notify-assignees.test.ts` visent un destinataire neuf et ont été vus rouges sur l'ancien code.

## Conséquences
Une garde de notification porte sur le destinataire, jamais sur l'acteur ; le commentaire au-dessus du code décrivait l'intention correcte, et c'est lui qui rassurait.
Un test de notification vise un destinataire neuf, sinon la coalescence le rend vide (doctrine `notifications`).
Le même piège a fait décider qu'un commentaire de carte n'émet aucune notification (0041).
