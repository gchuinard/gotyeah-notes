# 0026 : Plafond d'envoi par adresse destinataire

- Date : 2026-08-06
- Référence : commit `52d7a18` (date d'auteur 2026-08-06, date de commit 2026-08-07), fusionné par la PR #59 le 2026-08-07 ; clé déplacée dans `lib/rateLimit.ts` par `3dc9a2b` (PR #60), réservation puis restitution par `52f4562` (PR #62)
- Statut : acceptée

## Contexte
Le budget `invites:<userId>` (20/h) plafonnait ce qu'un acteur envoie, pas ce qu'une adresse reçoit. Or `POST /api/workspaces` est exempté de rôle : tout titulaire d'un compte pouvait créer des espaces au nom de son choix, repris dans le sujet d'un email signé par le domaine, et viser la même adresse depuis chacun.
Un plafond par acteur ne borne rien quand créer un compte et un espace est gratuit.

## Décision
`RECIPIENT_BUDGET` (5/h, clé `to:<sha256(email)>`) borne ce qu'une adresse reçoit, tous acteurs confondus ; clé et compteur sont définis une seule fois dans `lib/rateLimit.ts`, pour que toute porte d'envoi consomme le même.
Sur une invitation, il retient l'email et jamais l'écriture, sans changer le code HTTP : l'admin le voit par `emailReason: "throttled"`, alors qu'un 429 ferait de la route un oracle (« cette adresse a déjà été visée »).
Le provisioning IdP (`create`) réserve le jeton avant l'appel Keycloak et le rend si aucun email n'est parti ; là, le plafond refuse l'action en 429, car l'admin voit déjà ce membre et son adresse.

## Conséquences
Le compteur est partagé entre les portes : c'est pourquoi aucun email ne double la cloche (0036). L'adresse est hachée, comme aucune adresse n'entre dans les journaux.
Le budget vit en mémoire et repart à zéro à chaque redéploiement : l'abus devient impraticable, pas impossible.
Exception connue : `POST /api/auth/magic` ne consomme pas `to:<hash>`, seulement sa clé `magic:<ip>|<email>`.
