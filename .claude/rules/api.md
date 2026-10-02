---
paths:
  - "src/app/api/**/*"
  - "src/proxy.ts"
  - "tests/api/**/*"
  - "tests/helpers/**/*"
---

# Les routes API : invariants

- Un handler s'écrit `export async function GET|POST|PATCH|DELETE(req, { params })`, avec `params: Promise<…>` : le méta-test de `role-gates.test.ts` ne reconnaît pas `export const POST = …`.
- Refus dans l'ordre : 401 « Non authentifié », 404 « Not found », 403 « Rôle insuffisant », puis 400, 409, 422 ; la validation du corps peut précéder l'accès, mais rien ne s'écrit avant le dernier refus, compteurs de rate-limit compris.
- Tout `POST`, `PATCH`, `PUT` ou `DELETE` exporté se déclare dans `DECLARED` de `tests/api/role-gates.test.ts` ; le gate `hasRole` vit dans le handler, jamais dans `proxy.ts`.
- `PUBLIC_PATHS` est un préfixe : toute route créée sous `/api/auth` ou `/api/invitations/claim` est publique d'office et porte sa propre garde ; le proxy laisse passer une auth par en-têtes, `lib/session.ts` la valide.
- Corps lu par `await req.json().catch(() => null)` puis `safeParse` zod : échec = 400 `{ error: "Validation failed", details }`, jamais 500. Succès = l'objet nu, jamais `{ data }`.
- Aucune route ne lit `?userId=` ni `?email=` pour désigner l'appelant ; `?workspaceId=` ne fait que désigner l'espace, dont `getMembership` vérifie l'appartenance (404).
- Un contrôle d'état et l'écriture qu'il protège partagent la même `$transaction` ; `nextPosition` s'y appelle avec `tx`.
- Un test d'API appelle le handler directement, mocke `getSession` en partiel (`importOriginal`), crée ses propres données (emails uniques) et remet le rate-limit à zéro (`_resetRateLimit()`).

Détail et gardes : `docs/doctrine/api.md`.
