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
import { createDebouncedSaver, type DebouncedSaver } from "@/lib/client/debouncedSaver";
import { uploadFile } from "@/lib/client/upload";
import { pageLinkSchema, PageLinkMenu } from "@/lib/client/blocknoteSchema";
import { useDialog } from "@/contexts/DialogContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type Props = {
  pageId: string;
  initialContent: string;
  initialTitle: string;
  initialIcon?: string | null;
  onTitleChange?: (title: string) => void;
  readOnly?: boolean;
};

export default function Editor({
  pageId,
  initialContent,
  initialTitle,
  initialIcon,
  onTitleChange,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const themeMode = useThemeMode();
  const { confirm, alert } = useDialog();
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<string | null>(initialIcon ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [converting, setConverting] = useState(false);

  // Autosave debouncé (600 ms) avec flush au démontage : les champs (title/icon/
  // content) sont FUSIONNÉS dans un brouillon puis envoyés en un seul PATCH — deux
  // scheduleSave rapprochés ne s'écrasent donc plus. Editor est monté avec key=pageId
  // (page.tsx) → pageId stable pour cette instance, le flush au démontage vise la
  // bonne page en quittant.
  const draftRef = useRef<Record<string, unknown>>({});
  const saverRef = useRef<DebouncedSaver<Record<string, unknown>> | null>(null);
  if (!saverRef.current) {
    saverRef.current = createDebouncedSaver<Record<string, unknown>>(600, async (payload) => {
      draftRef.current = {};
      await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      // Le titre et l'icône s'affichent dans la sidebar et les récents : revalider
      // toutes les clés /api/pages* (scopées par workspaceId, d'où le matcher).
      if ("title" in payload || "icon" in payload) {
        mutate((key) => typeof key === "string" && key.startsWith("/api/pages"));
      }
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1200);
    });
  }

  const handleConvertToDatabase = async () => {
    // Action non destructive : bouton neutre « Convertir », pas un rouge « Supprimer ».
    const ok = await confirm({
      title: "Convertir cette page en database ?",
      message: "L'éditeur sera remplacé par une vue tableau.",
      confirmLabel: "Convertir",
    });
    if (!ok) return;

    setConverting(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        await alert({
          title: "Conversion impossible",
          message: (body as { error?: string }).error ?? `Erreur ${res.status}`,
          tone: "danger",
        });
        return;
      }
      router.refresh();
    } catch {
      await alert({
        title: "Conversion impossible",
        message: "Impossible de convertir la page.",
        tone: "danger",
      });
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
  const editor = useCreateBlockNote({ schema: pageLinkSchema, initialContent: parsed as any, dictionary: fr, uploadFile });

  const scheduleSave = (partial: Record<string, unknown>) => {
    // Ceinture + bretelles avec editable={!readOnly} : aucun PATCH ne part en
    // lecture seule (le flush au démontage devient un no-op, le brouillon reste vide).
    if (readOnly) return;
    setSaving("saving");
    draftRef.current = { ...draftRef.current, ...partial };
    saverRef.current!.schedule(draftRef.current);
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

  // Flush du PATCH en attente au démontage (navigation avant expiration du debounce).
  useEffect(() => {
    return () => {
      saverRef.current?.flush();
    };
  }, []);

  return (
    // La CSS de BlockNote impose `padding-inline: 54px` en dur sur `.bn-editor` et n'a
    // aucune media query (hors @media print) : 108px de gouttière sur un écran de 375px.
    <div className="max-w-3xl mx-auto py-6 px-3 sm:py-12 sm:px-6 text-[var(--text)] [&_.bn-editor]:px-3 sm:[&_.bn-editor]:px-[54px]">
      <div className="text-xs text-gray-400 h-4 mb-2">
        {saving === "saving" && "Enregistrement…"}
        {saving === "saved" && "Enregistré ✓"}
      </div>

      {/* Zone icône */}
      <div className="mb-3 relative">
        {readOnly ? (
          icon && <span className="text-5xl leading-none">{icon}</span>
        ) : icon ? (
          <div className="group inline-flex items-center gap-1">
            <button
              onClick={() => setPickerOpen(true)}
              className="text-5xl leading-none hover:opacity-80 transition-opacity"
              title="Changer l'icône"
            >
              {icon}
            </button>
            {/* Sans survol au doigt, ce ✕ n'a aucun autre chemin : visible d'emblée sous md.
                `pointer-events` suit l'opacité — invisible ne veut pas dire non cliquable. */}
            <button
              onClick={handleRemoveIcon}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 inline-flex items-center justify-center min-h-11 min-w-11 md:inline-block md:min-h-0 md:min-w-0 text-xs text-gray-400 hover:text-gray-600 transition-opacity px-1"
              title="Supprimer l'icône"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center min-h-11 md:inline-block md:min-h-0 text-sm text-gray-400 hover:text-gray-600 transition-colors"
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
      {!readOnly && (
        <div className="mb-3">
          <button
            onClick={handleConvertToDatabase}
            disabled={converting}
            className="flex items-center gap-1.5 min-h-11 md:min-h-0 text-sm text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <Table2 size={14} />
            {converting ? "Conversion…" : "Convertir en database"}
          </button>
        </div>
      )}

      <input
        value={title}
        readOnly={readOnly}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v);
          onTitleChange?.(v);
          scheduleSave({ title: v });
        }}
        placeholder="Sans titre"
        className="w-full text-3xl sm:text-4xl font-bold outline-none mb-6 bg-transparent text-[var(--text)] placeholder:text-[var(--text-muted)]"
      />

      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme={themeMode}
        onChange={() => {
          scheduleSave({ content: JSON.stringify(editor.document) });
        }}
      >
        <PageLinkMenu editor={editor} workspaceId={wsId} />
      </BlockNoteView>
    </div>
  );
}
