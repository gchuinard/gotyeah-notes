---
paths:
  - "src/lib/{notifications,notify}.ts"
  - "src/app/api/notifications/**/*"
  - "src/components/NotificationBell.tsx"
---

# La cloche : invariants

- Une notification est un message, jamais une autorisation : un accès se décide par `getMembership()` et une invitation par sa ligne `WorkspaceInvitation`, jamais par la présence d'une notification ; son `workspaceId` ne prouve aucune appartenance.
- On écrit par `notify(client, inputs)` avec le `tx` de la transaction qui produit l'événement ; `notify()` ne lève jamais (échec journalisé `[notify-failed]`, le geste métier passe). Seule exception : `record_assigned`.
- Deux filtres : jamais l'acteur lui-même, jamais un compte de service (acteur possible, destinataire jamais) ; `record_assigned` les redéclare dans la route, toute évolution de `notify()` s'y reporte.
- Le payload stocke des champs et des références, jamais la phrase rendue (`notificationMessage` la rend à la lecture) ; jamais le rôle offert par une invitation, lu sur l'invitation.
- Ajouter un type : l'ajouter à `NOTIFICATION_TYPES` et au `switch` de `notificationMessage`, pas ailleurs ; un type inconnu dégrade en ligne générique, il ne plante jamais.
- `record_assigned` : entrants seulement (`addedAssignees`), coalescence de 2 min par `shouldCoalesceAssignment`, et seulement si le destinataire peut ouvrir la page hôte (`isPageAccessible(access.page, uid, false)`, `uid` le destinataire).
- `lib/notifications.ts` reste pur, sans import d'exécution, donc importable côté client ; `lib/notify.ts` écrit par Prisma, serveur seulement.
- `GET ?count=1` ne joint ni n'écrit rien ; la purge (90 j) ne va que sur la liste, jamais sur le compteur ni par un cron ; la cloche n'a pas de `refreshInterval`.
- Un commentaire de carte n'émet aucune notification, et aucun email ne double la cloche (`RECIPIENT_BUDGET` est partagé avec les invitations).

Détail et gardes : `docs/doctrine/notifications.md`.
