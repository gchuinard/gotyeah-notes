---
paths:
  - "src/lib/{session,oidc,magicLink,invitations,rateLimit,mailer,invitationEmail,keycloak}.ts"
  - "src/app/api/{auth,invitations,me,workspaces}/**/*"
  - "src/app/{login,register,invitation,settings}/**/*"
---

# Connexion, invitations, comptes SSO : invariants

- Le jeton de session ne vit qu'en cookie (`httpOnly`, `sameSite: "lax"`, `secure` en prod, 30 j) ; la base ne garde que `sha256(token)` (`Session.id`, `LoginToken.id`) ; toute route qui ouvre une session répète ces options.
- Anti-énumération : le login exécute toujours `bcrypt.compare` (hash factice), même 401 et même message, rate-limit avant bcrypt ; `POST /api/auth/magic` répond toujours la même chose.
- `REGISTRATION=off` sur toute instance qui invite (l'acceptation se fait sur la seule égalité d'email) : `register` ne réclame jamais d'invitation.
- Callback OIDC : refuse `email_verified === false` ; à `OIDC_ALLOW_SIGNUP=false`, un compte ne naît que sur invitation vivante ; `grant: true` n'est passé que par la branche « compte neuf ».
- `claimInvitations(…, { grant })` vaut `grant: false` par défaut ; sur un chemin d'authentification, toujours `claimInvitationsSafely` (un claim raté n'empêche jamais de se connecter).
- Le lien de connexion est à usage unique : jeton supprimé par `deleteMany` compté à 1, avant l'expiration et avant toute écriture ; sa consommation ne crée aucun compte, seule l'acceptation par `/api/invitations/claim` en crée un.
- Inviter n'ajoute jamais personne : l'autorité est la ligne `WorkspaceInvitation`, jamais la notification ; aucun jeton d'invitation dans un email ; l'invitation s'écrit avant l'email, dont l'échec est remonté (`emailSent`), jamais caché.
- Comptes SSO : jamais de suppression (suspendre = `enabled: false` puis logout) ; `lib/keycloak.ts` ne lève jamais ; création en `emailVerified: false` ; l'email n'est modifiable que depuis l'IdP. Emails : liens d'`appBaseUrl()` (jamais `Host`), toute chaîne libre par `escapeHtml`.

Détail et gardes : `docs/doctrine/auth-invitations.md`.
