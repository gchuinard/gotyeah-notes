"use client";
import { useCreateBlockNote } from "@blocknote/react";
import { fr } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Table2 } from "lucide-react";
import EmojiPicker from "@/components/EmojiPicker";
import { useThemeMode } from "@/lib/client/useThemeMode";

type Props = {
  pageId: string;
  initialContent: string;
  initialTitle: string;
  initialIcon?: string | null;
  onTitleChange?: (title: string) => void;
};

export default function Editor({
  pageId,
  initialContent,
  initialTitle,
  initialIcon,
  onTitleChange,
}: Props) {
  const router = useRouter();
  const themeMode = useThemeMode();
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<string | null>(initialIcon ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [converting, setConverting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleConvertToDatabase = async () => {
    if (!window.confirm("Convertir cette page en database ?\nL'éditeur sera remplacé par une vue tableau.")) return;
    setConverting(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert((body as { error?: string }).error ?? `Erreur ${res.status}`);
        return;
      }
      router.refresh();
    } catch {
      alert("Impossible de convertir la page.");
    } finally {
      setConverting(false);
    }
  };

  let parsed: unknown = undefined;
  try {
    const arr = JSON.parse(initialContent);
    if (Array.isArray(arr) && arr.length > 0) parsed = arr;
  } catch {
    // contenu vide ou invalide
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useCreateBlockNote({ initialContent: parsed as any, dictionary: fr });

  const scheduleSave = (payload: Record<string, unknown>) => {
    setSaving("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // Le titre et l'icône s'affichent dans la sidebar et les récents : revalider
      // toutes les clés /api/pages* (scopées par workspaceId, d'où le matcher).
      if ("title" in payload || "icon" in payload) {
        mutate((key) => typeof key === "string" && key.startsWith("/api/pages"));
      }
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1200);
    }, 600);
  };

  const handleEmojiSelect = (emoji: string) => {
    setIcon(emoji);
    scheduleSave({ icon: emoji });
  };

  const handleRemoveIcon = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIcon(null);
    scheduleSave({ icon: null });
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-12 px-6 text-[var(--text)]">
      <div className="text-xs text-gray-400 h-4 mb-2">
        {saving === "saving" && "Enregistrement…"}
        {saving === "saved" && "Enregistré ✓"}
      </div>

      {/* Zone icône */}
      <div className="mb-3 relative">
        {icon ? (
          <div className="group inline-flex items-center gap-1">
            <button
              onClick={() => setPickerOpen(true)}
              className="text-5xl leading-none hover:opacity-80 transition-opacity"
              title="Changer l'icône"
            >
              {icon}
            </button>
            <button
              onClick={handleRemoveIcon}
              className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-gray-600 transition-opacity px-1"
              title="Supprimer l'icône"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPickerOpen(true)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            + Ajouter une icône
          </button>
        )}

        {pickerOpen && (
          <div className="absolute top-full left-0 mt-1 z-50">
            <EmojiPicker
              onSelect={handleEmojiSelect}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}
      </div>

      {/* Convertir en database */}
      <div className="mb-3">
        <button
          onClick={handleConvertToDatabase}
          disabled={converting}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
        >
          <Table2 size={14} />
          {converting ? "Conversion…" : "Convertir en database"}
        </button>
      </div>

      <input
        value={title}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v);
          onTitleChange?.(v);
          scheduleSave({ title: v });
        }}
        placeholder="Sans titre"
        className="w-full text-4xl font-bold outline-none mb-6 bg-transparent text-[var(--text)] placeholder:text-[var(--text-muted)]"
      />

      <BlockNoteView
        editor={editor}
        theme={themeMode}
        onChange={() => {
          scheduleSave({ content: JSON.stringify(editor.document) });
        }}
      />
    </div>
  );
}
