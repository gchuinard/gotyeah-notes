export type DebouncedSaver<T> = {
  /** (Ré)arme le timer avec le dernier payload ; le dernier programmé gagne. */
  schedule: (payload: T) => void;
  /** Envoie immédiatement le payload en attente (fermeture / démontage). No-op si rien en attente. */
  flush: () => void;
  /** Abandonne le timer sans envoyer. */
  cancel: () => void;
  /** true si un envoi est en attente. */
  hasPending: () => boolean;
};

/**
 * Enregistreur debouncé AVEC flush. Le cœur du correctif « fermer perd les
 * dernières frappes » : au lieu d'annuler le timer au démontage/à la fermeture,
 * on appelle flush() pour envoyer le dernier payload en attente.
 *
 * Framework-agnostique (pas de React) → testable en environnement node avec des
 * fake timers. `send` porte l'effet de bord (le fetch keepalive), injecté par
 * l'appelant.
 */
export function createDebouncedSaver<T>(
  delayMs: number,
  send: (payload: T) => void
): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPayload = false;
  let payload: T | undefined;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const fire = () => {
    clearTimer();
    if (!hasPayload) return;
    const p = payload as T;
    hasPayload = false;
    payload = undefined;
    send(p);
  };

  return {
    schedule(next: T) {
      payload = next;
      hasPayload = true;
      clearTimer();
      timer = setTimeout(fire, delayMs);
    },
    flush() {
      fire();
    },
    cancel() {
      clearTimer();
      hasPayload = false;
      payload = undefined;
    },
    hasPending() {
      return hasPayload;
    },
  };
}
