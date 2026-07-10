export type DialogTone = "danger" | "default";

export type DialogRequest = {
  kind: "confirm" | "alert";
  /** La question ou le constat, ex. « Supprimer cette vue ? ». */
  title: string;
  /** La conséquence. Les retours à la ligne sont rendus (whitespace-pre-line). */
  message?: string;
  /** Défaut : « Confirmer » (confirm) ou « OK » (alert). */
  confirmLabel?: string;
  /** Défaut : « Annuler ». Ignoré pour une alerte (bouton unique). */
  cancelLabel?: string;
  /** « danger » = action destructive (bouton rouge, focus initial sur Annuler). */
  tone?: DialogTone;
};

type Entry = { request: DialogRequest; resolve: (confirmed: boolean) => void };

export type DialogController = {
  /** Empile une demande et rend une promesse résolue au choix de l'utilisateur. */
  push: (request: DialogRequest) => Promise<boolean>;
  /** Règle la demande courante et passe à la suivante. */
  settle: (confirmed: boolean) => void;
  current: () => DialogRequest | null;
  pending: () => number;
};

/**
 * Plomberie promesse/file d'attente d'un dialogue modal, SANS React ni DOM
 * (donc testable en environnement node, où le repo n'a ni jsdom ni RTL).
 *
 * `window.confirm` est synchrone et bloquant ; son remplaçant ne peut pas l'être.
 * On rend donc une promesse, et on SÉRIALISE les demandes : deux appels rapprochés
 * ne s'écrasent pas, le second s'affiche quand le premier est réglé.
 */
export function createDialogController(
  onChange: (current: DialogRequest | null) => void
): DialogController {
  const queue: Entry[] = [];
  const head = () => (queue.length > 0 ? queue[0].request : null);
  const emit = () => onChange(head());

  return {
    push(request) {
      return new Promise<boolean>((resolve) => {
        queue.push({ request, resolve });
        emit();
      });
    },
    settle(confirmed) {
      const entry = queue.shift();
      emit();
      entry?.resolve(confirmed);
    },
    current: head,
    pending: () => queue.length,
  };
}

/**
 * Bouton qui reçoit le focus à l'ouverture. Sur une action destructive on vise
 * « Annuler » : une frappe d'Entrée réflexe ne doit jamais détruire.
 */
export function initialFocus(request: DialogRequest): "confirm" | "cancel" {
  if (request.kind === "alert") return "confirm";
  return request.tone === "danger" ? "cancel" : "confirm";
}
