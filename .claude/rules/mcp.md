---
paths:
  - "src/lib/session.ts"
  - "src/proxy.ts"
  - "scripts/create-service-account.mjs"
---

# Le pont MCP : invariants

- Les outils `notes_*` vivent dans le dépôt `gotyeah-mcp`, jamais dans `gotyeah_sonar` ; `notes_entities.py` dit ce que le MCP couvre : ne jamais conclure « la fonctionnalité n'existe pas » faute d'outil.
- Côté notes, le pont tient dans deux fichiers : `src/proxy.ts` laisse passer (présence des deux en-têtes), `src/lib/session.ts` valide ; toute future auth par en-têtes suit ce partage.
- `X-MCP-Secret` se compare en temps constant à `MCP_SHARED_SECRET` ; vide, le pont est coupé et n'ajoute aucune surface ; l'email passe par `normalizeEmail` et doit désigner un User existant : le pont ne crée jamais de compte.
- Toute nouvelle incarnation s'ajoute à `MCP_ACT_AS_ALLOWLIST` au moment où on la crée, sinon 401 sans explication ; la valeur se lit dans le conteneur, jamais dans le dépôt.
- Aucun en-tête CORS qui autorise `x-mcp-secret` ou `x-act-as-email` : la dispense d'anti-CSRF suppose qu'un navigateur ne peut pas les poser en cross-site.
- Le pont passe par `getSession()` comme un humain : une garde ne repose jamais sur l'absence d'écran (`PATCH /api/me` refuse un compte de service en 409) ; aucune route ne prend `?userId=`.
- Le compte « IA » est un compte de service créé par `scripts/create-service-account.mjs`, jamais par une route ; rattaché d'office, en admin, aux espaces créés par `POST /api/workspaces`, jamais au « Mon espace » d'une inscription ; il lit les pages privées de ses espaces et ne reçoit aucune notification.
- Une description d'outil de suppression dit où va l'objet et comment le récupérer, ou qu'il n'y a pas de retour (seuls `Page` et `Record` ont une corbeille) ; `content` s'écrit en remplacement total, MCP compris, `sections_body` est la porte d'une carte sectionnée.
- Déployer un outil : push `main` de `gotyeah-mcp`, conteneur redéployé, puis rafraîchissement du connecteur claude.ai ; jamais le HEAD git du Pi (rsync), ce qui fait foi est le code dans le conteneur.

Détail et gardes : `docs/doctrine/mcp.md`.
