/**
 * Limiteur d'échecs en mémoire (par IP+email), pour freiner le brute-force et
 * l'énumération sur /api/auth/login. Volontairement simple (une Map, mono-instance) :
 * on compte les ÉCHECS dans une fenêtre glissante ; au-delà du seuil, l'appel est
 * rejeté AVANT bcrypt. Un succès efface le compteur.
 *
 * En mémoire → réinitialisé au redémarrage (acceptable). Pas de dépendance externe.
 */
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_FAILURES = 8;

/**
 * Budget d'une famille de clés. Le défaut est celui du login (8 échecs / 15 min).
 *
 * ⚠️ Toutes les familles partagent la MÊME Map : le préfixe de clé est ce qui les
 * sépare (`ip:email` pour le login, `members:<id>`, `invites:<id>`). Un budget
 * distinct ne cloisonne QUE le seuil, pas le stockage — d'où l'obligation de
 * préfixer, sinon deux familles se pénalisent mutuellement.
 */
export type RateBudget = { windowMs: number; max: number };
const DEFAULT_BUDGET: RateBudget = { windowMs: WINDOW_MS, max: MAX_FAILURES };

/**
 * Budget des INVITATIONS. Séparé du login à dessein : depuis que POST /members
 * accepte un email sans compte, inviter un vrai collègue est un SUCCÈS nominal.
 * Le compter dans un compteur d'échecs ferait qu'inviter une équipe de 10
 * déclencherait un 429 accusant l'admin de sonder des comptes inexistants —
 * le compteur ne mesurerait plus ce que son module dit mesurer.
 */
export const INVITE_BUDGET: RateBudget = { windowMs: 60 * 60 * 1000, max: 20 };

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Vrai si `key` a dépassé le seuil de sa fenêtre courante. */
export function tooManyFailures(
  key: string,
  now = Date.now(),
  budget: RateBudget = DEFAULT_BUDGET
): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return false;
  return b.count >= budget.max;
}

/** Enregistre un coup pour `key` (démarre/rafraîchit sa fenêtre). Purge au passage
 *  les fenêtres expirées si la Map grossit (borne mémoire sur instance exposée). */
export function recordFailure(
  key: string,
  now = Date.now(),
  budget: RateBudget = DEFAULT_BUDGET
): void {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + budget.windowMs });
  } else {
    b.count += 1;
  }
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
}

/** Efface le compteur d'une clé (à appeler après un login réussi). */
export function clearFailures(key: string): void {
  buckets.delete(key);
}

/** Secondes restantes avant réouverture (pour l'en-tête Retry-After). */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return 0;
  return Math.ceil((b.resetAt - now) / 1000);
}

/** Réinitialise tout (tests uniquement). */
export function _resetRateLimit(): void {
  buckets.clear();
}

export const RATE_LIMIT_MAX_FAILURES = MAX_FAILURES;
