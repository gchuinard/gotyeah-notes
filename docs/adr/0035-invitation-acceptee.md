# 0035 : L'invitation s'accepte : ajouter quelqu'un le lui propose

- Date : 2026-08-08
- Référence : PR #65 (`ecad902` et `0e483ac` du 2026-08-07, `6804a6f`, `3d2068a` et `ff28fbf` du 2026-08-08)
- Statut : acceptée

## Contexte
`POST /api/workspaces/[id]/members` créait une Membership immédiate pour toute adresse ayant déjà un compte : on entrait dans un espace sans l'avoir demandé.
Ce comportement était aussi le tremplin de l'escalade du 07/08 (0029) : créer un espace sans gate puis y ajouter sa cible de force suffisait à s'en décerner l'admin.

## Décision
`POST /members` ne crée plus jamais de Membership : il pose une invitation, avec une notification actionnable si le compte existe ou un lien de connexion de 7 j sinon, et répond `invited`. La Membership naît de l'acceptation, par la cloche ou par l'écran public `/invitation`, gardé par le jeton.
`claimInvitations(userId, email, { grant })` a `grant` à `false` par défaut ; seul le callback OIDC d'un compte qui vient de naître passe `true`. `consumeMagicLink` ne crée plus de compte : sur une adresse invitée sans compte, il renvoie `needs_acceptance`.
Un refus laisse `declinedAt`, que `hasPendingInvitation` exclut, et `removeMember` supprime aussi les invitations qui visent la personne.

## Conséquences
Le défaut sûr est celui qui n'accorde rien : un appelant qui oublie l'option laisse l'invitation en attente au lieu d'ouvrir une porte en silence.
L'aperçu de `/invitation` ne rend que des libellés, jamais le rôle offert ni un id, et répond uniformément sur tout échec pour ne pas devenir un oracle.
Le claim tourne sur quatre points d'appel (login, deux branches OIDC, une de `consumeMagicLink`), et les deux branches OIDC n'ont aucun test de route.
