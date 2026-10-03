# 0017 : Rôles appliqués dans chaque handler, sans admin d'instance

- Date : 2026-08-03
- Référence : commits `d65079a`, `5e2f1f8` et `fce6a9c` du 2026-08-03, PR #43 fusionnée le 2026-08-04 (`42e426a`)
- Statut : acceptée

## Contexte
Les rôles de `Membership` (admin, editor, viewer) n'étaient pas appliqués par les routes de contenu, et `PATCH /api/config` n'exigeait qu'une session : tout connecté changeait le quota de l'instance.
Vitest importe les handlers directement et le pont MCP traverse le proxy sans cookie : une garde posée dans le proxy ne couvrirait ni l'un ni l'autre.

## Décision
Chaque handler mutant vérifie le rôle par `hasRole` (admin ⊇ editor ⊇ viewer), après le contrôle d'accès : 404, puis 403 « Rôle insuffisant ». Lecteur = lecture seule totale ; éditeur = le contenu, la corbeille et la restauration ; admin = l'irréversible, les membres et la config.
Les routes sans espace (`POST /api/upload`, `PATCH /api/config`) passent par `hasRoleInAnyWorkspace`, faute d'admin d'instance.

## Conséquences
`tests/api/role-gates.test.ts` refuse tout handler mutant absent de sa table `DECLARED`, qui liste aussi les écritures exemptées (visite, switch, création de son espace, son profil…).
`hasRoleInAnyWorkspace` est une approximation v1 assumée : l'admin de n'importe quel espace règle le quota de toute l'instance.
Exception connue à « admin = irréversible » : le retrait d'une pièce jointe est ouvert à l'éditeur (fiche F6).
Côté client, un rôle inconnu vaut lecteur ; l'UI n'est que du confort, le 403 du serveur fait foi.
