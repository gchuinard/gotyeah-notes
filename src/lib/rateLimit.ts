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

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Vrai si `key` a dépassé le seuil d'échecs dans la fenêtre courante. */
export function tooManyFailures(key: string, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return false;
  return b.count >= MAX_FAILURES;
}

/** Enregistre un échec pour `key` (démarre/rafraîchit sa fenêtre). Purge au passage
 *  les fenêtres expirées si la Map grossit (borne mémoire sur instance exposée). */
export function recordFailure(key: string, now = Date.now()): void {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
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
