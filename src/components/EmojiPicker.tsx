"use client";
import dynamic from "next/dynamic";
import data from "@emoji-mart/data";

// Chargé dynamiquement pour éviter les erreurs SSR
const Picker = dynamic(() => import("@emoji-mart/react"), { ssr: false });

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export default function EmojiPicker({ onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <Picker
          data={data}
          locale="fr"
          onEmojiSelect={(e: { native: string }) => {
            onSelect(e.native);
            onClose();
          }}
          autoFocus
          previewPosition="none"
          skinTonePosition="none"
        />
      </div>
    </div>
  );
}
