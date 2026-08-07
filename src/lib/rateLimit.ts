/**
 * Limiteur d'échecs en mémoire (par IP+email), pour freiner le brute-force et
 * l'énumération sur /api/auth/login. Volontairement simple (une Map, mono-instance) :
 * on compte les ÉCHECS dans une fenêtre glissante ; au-delà du seuil, l'appel est
 * rejeté AVANT bcrypt. Un succès efface le compteur.
 *
 * En mémoire → réinitialisé au redémarrage (acceptable). Pas de dépendance externe.
 */
import { createHash } from "node:crypto";

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

/**
 * Budget par DESTINATAIRE. Le budget ci-dessus plafonne ce qu'un acteur envoie ;
 * celui-ci plafonne ce qu'une ADRESSE reçoit, tous acteurs confondus.
 *
 * ⚠️ Sans lui, `POST /api/workspaces` étant volontairement exempté de rôle, tout
 * titulaire d'un compte pouvait créer autant d'espaces qu'il voulait — au nom
 * qu'il choisissait, ce nom figurant dans le SUJET du message — et viser la même
 * adresse depuis chacun. 20/h par acteur ne borne rien quand les acteurs et les
 * espaces sont gratuits.
 *
 * 5/h : on n'invite pas légitimement la même personne cinq fois en une heure,
 * et « Renvoyer » reste utilisable plusieurs fois d'affilée.
 */
export const RECIPIENT_BUDGET: RateBudget = { windowMs: 60 * 60 * 1000, max: 5 };

/**
 * Clé du budget par destinataire. VIT ICI, et pas dans la route qui l'a
 * introduite : toute porte capable de déclencher un envoi vers une adresse doit
 * consommer le MÊME compteur. Deux définitions du même hachage divergeraient un
 * jour, et le plafond ne plafonnerait plus rien — chaque route aurait le sien.
 *
 * ⚠️ L'adresse est HACHÉE : ces compteurs vivent en mémoire, mais rien n'oblige
 * à y stocker en clair l'adresse de quelqu'un qui n'a rien demandé — même règle
 * que « pas d'email dans les journaux ».
 */
export const recipientKey = (email: string) =>
  `to:${createHash("sha256").update(email).digest("hex").slice(0, 32)}`;

/**
 * Teste puis consomme le budget d'une adresse. `false` = ne pas envoyer.
 * Partagé par l'invitation et le provisioning IdP : l'email d'activation est
 * émis par Keycloak, donc il échappe à `lib/mailer.ts` — sans ce passage, un
 * bouton re-cliquable rouvrirait le canal que ce budget vient de fermer.
 */
export function recipientAllowed(email: string, now = Date.now()): boolean {
  const key = recipientKey(email);
  if (tooManyFailures(key, now, RECIPIENT_BUDGET)) return false;
  recordFailure(key, now, RECIPIENT_BUDGET);
  return true;
}

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
