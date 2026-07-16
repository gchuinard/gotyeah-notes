"use client";
/**
 * Schéma BlockNote partagé par les deux éditeurs (page + RecordPanel) : ajoute un
 * inline content custom « pageLink » (lien interne @page) au schéma par défaut, et
 * le menu de suggestion déclenché sur « @ ».
 *
 * - `pageLink` ne stocke que `{ pageId }` ; le titre est résolu à l'AFFICHAGE
 *   (SWR sur `/api/pages/[id]`, fallback « page »). Cliquer navigue vers la page.
 * - `PageLinkMenu` liste les pages via `/api/search` (scopé au workspace) ; choisir
 *   une page insère un `pageLink`.
 *
 * Facteur commun : importer `pageLinkSchema` + `PageLinkMenu` dans chaque éditeur
 * plutôt que dupliquer la définition.
 */
import { useCallback } from "react";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
  type DefaultStyleSchema,
} from "@blocknote/core";
import {
  createReactInlineContentSpec,
  SuggestionMenuController,
  type DefaultReactSuggestionItem,
  type ReactCustomInlineContentRenderProps,
} from "@blocknote/react";
import type { SearchResult } from "@/app/api/search/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Inline content atomique (content "none") : ne porte que l'id de la page.
const pageLinkConfig = {
  type: "pageLink" as const,
  propSchema: { pageId: { default: "" } },
  content: "none" as const,
};

type PageMeta = { title?: string; icon?: string | null };

function PageLinkComponent(
  props: ReactCustomInlineContentRenderProps<typeof pageLinkConfig, DefaultStyleSchema>,
) {
  const router = useRouter();
  const { pageId } = props.inlineContent.props;
  // Titre résolu à l'affichage. Sur 404 la réponse est `{ error }` → pas de title
  // → fallback « page ». Même fetcher (json inconditionnel) que le reste de l'app,
  // donc pas de tempête de retries SWR.
  const { data } = useSWR<PageMeta>(pageId ? `/api/pages/${pageId}` : null, fetcher);
  const title = data?.title?.trim() || "page";

  return (
    <span
      role="link"
      title={title}
      contentEditable={false}
      onClick={() => {
        if (pageId) router.push(`/pages/${pageId}`);
      }}
      className="inline-flex items-center gap-1 px-1 rounded cursor-pointer text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors"
    >
      {data?.icon ? (
        <span className="leading-none">{data.icon}</span>
      ) : (
        <FileText size={13} className="shrink-0" />
      )}
      <span className="underline decoration-[var(--border)] underline-offset-2">{title}</span>
    </span>
  );
}

const PageLinkSpec = createReactInlineContentSpec(pageLinkConfig, {
  render: PageLinkComponent,
});

export const pageLinkSchema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageLink: PageLinkSpec,
  },
});

export type PageLinkEditor = typeof pageLinkSchema.BlockNoteEditor;

/**
 * Menu « @ » à placer en enfant du `<BlockNoteView>` (s'ajoute à l'UI par défaut,
 * ne la remplace pas). Insère un `pageLink` sur sélection d'une page.
 */
export function PageLinkMenu({
  editor,
  workspaceId,
}: {
  editor: PageLinkEditor;
  workspaceId: string | null;
}) {
  const getItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      const q = query.trim();
      if (!q) return []; // /api/search exige q >= 1 ; le menu reste ouvert (pas de close-on-empty).
      const params = new URLSearchParams({ q });
      if (workspaceId) params.set("workspaceId", workspaceId);
      let results: SearchResult[] = [];
      try {
        const res = await fetch(`/api/search?${params.toString()}`);
        if (!res.ok) return [];
        results = (await res.json()) as SearchResult[];
      } catch {
        return [];
      }
      return results
        .filter((r): r is Extract<SearchResult, { kind: "page" }> => r.kind === "page")
        .map((page) => ({
          title: page.title?.trim() || "Sans titre",
          icon: page.icon ? (
            <span className="text-base leading-none">{page.icon}</span>
          ) : (
            <FileText size={16} />
          ),
          onItemClick: () => {
            editor.insertInlineContent([
              { type: "pageLink", props: { pageId: page.id } },
              " ",
            ]);
          },
        }));
    },
    [editor, workspaceId],
  );

  return <SuggestionMenuController triggerCharacter="@" getItems={getItems} />;
}
