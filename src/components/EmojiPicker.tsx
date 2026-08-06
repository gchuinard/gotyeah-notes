"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import data from "@emoji-mart/data";

// Chargé dynamiquement pour éviter les erreurs SSR
const Picker = dynamic(() => import("@emoji-mart/react"), { ssr: false });

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

/** Même bascule que la variante `md:` de Tailwind — mais emoji-mart rend un
 *  custom element à SHADOW DOM : aucune classe ne franchit cette frontière,
 *  la grille et la taille des cibles ne se règlent que par ses props. */
const COMPACT_QUERY = "(max-width: 767px)";

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 8 colonnes sur la largeur disponible (≈ 351px sur un écran de 375) donnent des
  // cibles d'environ 44px, contre 36px à la grille par défaut. `autoFocus` part au
  // passage : au doigt, il fait monter le clavier par-dessus la grille — on laisse
  // choisir avant de chercher.
  const compactProps = compact
    ? { dynamicWidth: true, perLine: 8, autoFocus: false }
    : { autoFocus: true };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 md:bg-transparent flex items-center justify-center p-3 md:block md:p-0"
      onClick={onClose}
    >
      <div className="w-full max-w-md md:w-auto md:max-w-none" onClick={(e) => e.stopPropagation()}>
        <Picker
          data={data}
          locale="fr"
          onEmojiSelect={(e: { native: string }) => {
            onSelect(e.native);
            onClose();
          }}
          previewPosition="none"
          skinTonePosition="none"
          {...compactProps}
        />
      </div>
    </div>
  );
}
