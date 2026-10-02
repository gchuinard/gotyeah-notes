# 0006 : Post-mortem : base de dev et d'E2E hors du dépôt

- Date : 2026-07-09
- Référence : commit `daaac4b`, PR #1 (harnais E2E dans `os.tmpdir()`) ; l'astuce `DATABASE_URL` hors du dossier projet est dans `.env.example` depuis `c852026` (2026-06-26)
- Statut : acceptée

## Contexte
Au glisser-déposer d'une page vers le haut dans la sidebar, le serveur de dev coupait la requête (ECONNRESET, NetworkError côté client) alors que la donnée était bien écrite ; le symptôme est noté dès `26fead6` (2026-06-02).
Cause retenue, d'abord notée comme simple hypothèse : better-sqlite3 écrit `dev.db-wal` dans le dossier projet, que `next dev` surveille, d'où un Fast Refresh en plein PATCH.

## Décision
La base de dev vit hors du dépôt, via le `DATABASE_URL` du `.env` local (astuce documentée dans `.env.example`).
Le harnais E2E crée sa base jetable dans `os.tmpdir()` (`tests/e2e-server.mjs`), dont il supprime aussi les fichiers `-wal` et `-shm` à chaque lancement.

## Conséquences
La mitigation n'a jamais été re-testée : le point est mitigé, pas prouvé disparu. Si le symptôme revient, vérifier d'abord que `DATABASE_URL` ne pointe pas dans le dépôt.
La valeur d'exemple de `.env.example` (`file:./dev.db`) pointe encore dans le dépôt : la mitigation dépend du `.env` de chacun.
Leçon : un correctif appliqué sans re-test se documente comme mitigation, jamais comme correction.
