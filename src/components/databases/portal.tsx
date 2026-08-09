"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// Renders children in a fixed portal anchored below `anchor` — above it when the
// space below is too short. Fires onClose when the user clicks outside both
// anchor and content.

/** Marge minimale gardée entre le panneau et les bords du viewport. */
const MARGIN = 8;
/** Écart entre le déclencheur et le panneau. */
const GAP = 2;
/** Hauteur plancher : mieux vaut un panneau qui déborde un peu qu'un panneau plat. */
const MIN_AVAILABLE = 120;

type Props = {
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  minWidth?: number;
  className?: string;
  /**
   * Ferme sur Échap. ⚠️ OPT-IN, défaut FALSE, et ce défaut est délibéré : les
   * sept consommateurs historiques gèrent DÉJÀ Échap eux-mêmes (Cell le fait à
   * six endroits, pour annuler une édition en cours). L'activer ici pour tout le
   * monde ferait traiter la touche deux fois, avec deux intentions différentes.
   * Les nouveaux panneaux le demandent explicitement.
   */
  closeOnEscape?: boolean;
};

export default function Portal({
  anchor,
  onClose,
  children,
  minWidth = 160,
  className = "bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 overflow-y-auto max-h-72",
  closeOnEscape = false,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    zIndex: 1000,
    visibility: "hidden",
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = anchor.current;
    const content = contentRef.current;
    if (!el || !content) return;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    // Le clavier virtuel rétrécit le viewport VISUEL, jamais `innerHeight` : sans
    // visualViewport, un panneau jugé « tenant » atterrit sous le clavier.
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight);

    // En `position: fixed`, ce qui dépasse ne produit AUCUN scroll : sans plafond,
    // un panneau `minWidth={400}` sur un écran de 375 perd ses 33px de droite — et
    // avec eux le bouton de suppression du filtre, définitivement inatteignable.
    const maxWidth = Math.max(vw - MARGIN * 2, 0);
    const width = Math.min(Math.max(rect.width, minWidth), maxWidth);

    // Plafond de hauteur RETIRÉ avant de mesurer : la hauteur de référence est
    // celle que dictent les classes du consommateur (max-h-96, max-h-72…), pas
    // celle d'un calcul précédent — sinon le panneau, une fois rétréci, ne
    // pourrait plus jamais regrandir.
    // ⚠️ maxHeight/overflowY sont pilotés EN IMPÉRATIF et n'entrent jamais dans
    // l'objet `style` de React : celui-ci ne réécrit que les clés qu'il voit
    // changer, il ne remettrait donc pas une valeur qu'on vient d'effacer ici.
    content.style.maxHeight = "";
    content.style.overflowY = "";
    // Mesurer À LA LARGEUR DÉFINITIVE : la hauteur d'un contenu qui passe de 2 à 4
    // lignes une fois plafonné n'a rien à voir avec celle mesurée pleine largeur.
    content.style.minWidth = `${width}px`;
    content.style.maxWidth = `${maxWidth}px`;
    const box = content.getBoundingClientRect();

    const spaceBelow = viewBottom - rect.bottom - GAP - MARGIN;
    const spaceAbove = rect.top - viewTop - GAP - MARGIN;
    const flip = box.height > spaceBelow && spaceAbove > spaceBelow;
    const available = Math.max(flip ? spaceAbove : spaceBelow, MIN_AVAILABLE);

    // Plafond posé SEULEMENT s'il contraint : un panneau qui tient déjà garde le
    // rendu de ses classes au pixel près. Quand il contraint, il prime sur elles
    // (y compris sur `overflow-visible`) — c'est l'effet recherché : hors du
    // viewport, ce contenu n'était atteignable par aucun scroll.
    if (box.height > available) {
      content.style.maxHeight = `${available}px`;
      content.style.overflowY = "auto";
    }

    setStyle({
      position: "fixed",
      top: flip
        ? Math.max(viewTop + MARGIN, rect.top - GAP - Math.min(box.height, available))
        : rect.bottom + GAP,
      left: Math.max(MARGIN, Math.min(rect.left, vw - MARGIN - box.width)),
      minWidth: width,
      maxWidth,
      zIndex: 1000,
      visibility: "visible",
    });
  }, [anchor, minWidth]);

  useEffect(() => {
    if (!mounted) return;
    place();
    const vv = window.visualViewport;
    // ⚠️ Aucun listener de scroll fenêtre ici, ni pour repositionner ni pour
    // fermer : sur iOS, donner le focus à un champ du portail (Cell monte un
    // <input autoFocus>) déclenche un scroll — le menu se refermerait tout seul.
    window.addEventListener("resize", place);
    window.addEventListener("orientationchange", place);
    // Le clavier virtuel s'ouvre APRÈS le calcul de position : ces deux-là sont
    // les seuls événements qui le signalent.
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("orientationchange", place);
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
    };
  }, [mounted, place]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        anchor.current?.contains(e.target as Node) ||
        contentRef.current?.contains(e.target as Node)
      ) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchor, onClose]);

  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOnEscape, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div ref={contentRef} style={style} className={className}>
      {children}
    </div>,
    document.body
  );
}
