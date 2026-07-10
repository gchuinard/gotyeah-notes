"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { initialFocus, type DialogRequest } from "@/lib/client/dialogController";

type Props = {
  request: DialogRequest;
  /** true = confirmé, false = annulé (Échap, overlay, bouton Annuler). */
  onSettle: (confirmed: boolean) => void;
};

export default function Dialog({ request, onSettle }: Props) {
  const [mounted, setMounted] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => setMounted(true), []);

  // Échap + piège de focus.
  //
  // Le listener est posé en phase CAPTURE sur `document` : le DOM dispatche TOUTE
  // la capture avant TOUTE la bulle, donc on passe avant le handler Échap de
  // RecordPanel (document, bulle) et celui de SearchPalette (window, bulle).
  // stopImmediatePropagation les empêche alors de recevoir l'événement : annuler
  // le dialogue ne referme pas le panneau et n'ouvre pas la palette.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onSettle(false);
        return;
      }
      // Un modal doit aussi confisquer les raccourcis globaux : sans ça, Cmd/Ctrl+K
      // ouvre la palette de recherche DERRIÈRE l'overlay et lui vole le focus.
      // On ne coupe QUE ce raccourci : couper tout empêcherait Entrée/Espace
      // d'atteindre le bouton focus et de l'activer.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        const focusables = [cancelRef.current, confirmRef.current].filter(
          (b): b is HTMLButtonElement => b !== null
        );
        if (focusables.length === 0) return;
        e.preventDefault();
        const idx = focusables.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === focusables.length - 1 ? 0 : idx + 1);
        focusables[next].focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Rendre le focus à l'élément d'origine (éditeur, input, bouton du menu…).
      restoreFocusRef.current?.focus?.();
    };
  }, [onSettle]);

  // Focus initial : jamais sur un bouton destructif.
  //
  // `mounted` est INDISPENSABLE dans les deps : au premier rendu il vaut false, on
  // retourne null, et les refs des boutons sont donc nulles. Sans lui, l'effet ne
  // re-tournerait jamais après le montage du portail (`request` est inchangé) et
  // AUCUN bouton ne recevrait le focus — la garantie « Entrée ne détruit pas »
  // serait silencieusement inopérante.
  useEffect(() => {
    if (!mounted) return;
    const target = initialFocus(request) === "cancel" ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [request, mounted]);

  if (!mounted) return null;

  const isDanger = request.tone === "danger";
  const isConfirm = request.kind === "confirm";
  const confirmLabel = request.confirmLabel ?? (isConfirm ? "Confirmer" : "OK");

  return createPortal(
    // z-[2000] : la couche la plus haute du repo est le Portal ancré (zIndex 1000,
    // utilisé par les menus ⋯ des cartes et les dropdowns). Plusieurs confirmations
    // sont déclenchées DEPUIS ces menus — sous 1000, le dialogue passerait dessous.
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSettle(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.message ? messageId : undefined}
        className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl w-80 max-w-full p-5 flex flex-col gap-4"
      >
        <h2 id={titleId} className="text-sm font-semibold text-[var(--text)]">
          {request.title}
        </h2>

        {request.message && (
          <p id={messageId} className="text-sm text-[var(--text-muted)] whitespace-pre-line">
            {request.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {isConfirm && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => onSettle(false)}
              className="px-3 py-1.5 text-sm rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)]"
            >
              {request.cancelLabel ?? "Annuler"}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onSettle(true)}
            className={[
              "px-3 py-1.5 text-sm rounded text-white transition-opacity",
              isDanger ? "bg-red-500 hover:bg-red-600" : "bg-[var(--accent)] hover:opacity-90",
            ].join(" ")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
