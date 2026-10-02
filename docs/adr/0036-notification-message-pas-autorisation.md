# 0036 : La notification est un message, jamais une autorisation

- Date : 2026-08-08
- Référence : PR #65 (modèle `ecad902` du 2026-08-07, `6804a6f`, `3d2068a`, doctrine `ff28fbf`) ; `record_assigned` par `5385dc8` (PR #66)
- Statut : acceptée

## Contexte
L'acceptation des invitations (0035) exige de prévenir l'invité dans l'application, d'où une cloche dans l'en-tête et un modèle `Notification`.
Une notification porte un texte et parfois un bouton « Accepter » : si elle copiait l'autorité ou le rendu, une copie périmée mentirait, par exemple « éditeur » sur un bouton qui accorde « lecteur » après une ré-invitation.

## Décision
L'autorité reste à `WorkspaceInvitation` et à `Membership` ; la notification stocke des références résolues à la lecture, jamais le rôle offert ni le texte rendu. Un type absent de `NOTIFICATION_TYPES` dégrade en ligne générique.
`@@unique([userId, invitationId])` : ré-inviter fait un upsert sur la même ligne au lieu d'empiler des cartes « Accepter ».
La purge de 90 j est paresseuse, à l'ouverture du panneau et scopée au destinataire, jamais sur le compteur `?count=1`, le GET le plus chaud de l'app.

## Conséquences
Un retour arrière du code laisse en base des types qu'il ne connaît plus : la cloche les affiche sans planter.
Aucun email ne double la cloche : le budget destinataire de 5/h est partagé avec les invitations (0026), que des messages de courtoisie feraient passer en `throttled`.
Qui n'ouvre jamais son panneau n'est jamais purgé : le compteur applique donc le même filtre d'âge que la liste, sans compter sur la purge.
