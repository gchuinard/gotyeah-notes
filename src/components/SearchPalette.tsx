"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Search, FileText, Rows3 } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { searchResultPathSegments, truncatePathEnd, type FlatPage } from "@/lib/tree";

type Result =
  | { kind: "page"; id: string; title: string; icon: string | null; parentId: string | null }
  | { kind: "record"; id: string; pageId: string; title: string; icon: string | null };

type Section = { id: string; name: string; icon: string | null };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Budget de caractères de la 2e ligne (chemin) : la palette est en max-w-lg.
// Le rendu applique aussi `truncate` (ellipse CSS) comme garde-fou visuel.
const PATH_MAX_CHARS = 52;

function hrefFor(r: Result): string {
  return r.kind === "record" ? `/pages/${r.pageId}?r=${r.id}` : `/pages/${r.id}`;
}

function pathLineFor(r: Result, pages: FlatPage[], sections: Section[]): string {
  const segments = searchResultPathSegments(
    pages,
    sections,
    r.kind === "record" ? { kind: "record", pageId: r.pageId } : { kind: "page", id: r.id }
  );
  return truncatePathEnd(segments, PATH_MAX_CHARS);
}

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const wsId = activeWorkspace?.id ?? null;

  // Mêmes clés SWR que Breadcrumb.tsx / la sidebar → cache dédupliqué, aucune
  // requête supplémentaire déclenchée par la palette pour calculer les chemins.
  const { data: pages = [] } = useSWR<FlatPage[]>(wsId ? `/api/pages?workspaceId=${wsId}` : null, fetcher);
  const { data: sections = [] } = useSWR<Section[]>(wsId ? `/api/sections?workspaceId=${wsId}` : null, fetcher);

  // Cmd+K / Ctrl+K + événement custom depuis la sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const openHandler = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("open-search", openHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("open-search", openHandler);
    };
  }, []);

  // Focus à l'ouverture
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Recherche avec debounce
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q: query });
      if (activeWorkspace) params.set("workspaceId", activeWorkspace.id);
      const res = await fetch(`/api/search?${params.toString()}`);
      const data = await res.json();
      setResults(data);
      setSelected(0);
    }, 150);
    return () => clearTimeout(t);
  }, [query, activeWorkspace]);

  const navigate = (r: Result) => {
    router.push(hrefFor(r));
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-[var(--bg)] rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <Search size={16} className="text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              }
              if (e.key === "Enter" && results[selected]) {
                navigate(results[selected]);
              }
            }}
            placeholder="Rechercher une page ou une fiche…"
            className="flex-1 text-sm outline-none bg-transparent text-[var(--text)] placeholder:text-[var(--text-muted)]"
          />
          <kbd className="hidden sm:block text-xs text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded">
            Esc
          </kbd>
        </div>

        {/* Résultats */}
        {results.length > 0 && (
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((r, i) => {
              const path = pathLineFor(r, pages, sections);
              return (
                <li
                  key={`${r.kind}-${r.id}`}
                  onClick={() => navigate(r)}
                  onMouseEnter={() => setSelected(i)}
                  className={`flex items-start gap-3 px-4 py-2 cursor-pointer text-sm transition-colors ${
                    i === selected
                      ? "bg-[var(--surface-active)] text-[var(--text)]"
                      : "hover:bg-[var(--surface-hover)] text-[var(--text)]"
                  }`}
                >
                  {r.icon ? (
                    <span className="text-base leading-none shrink-0 mt-0.5">{r.icon}</span>
                  ) : r.kind === "record" ? (
                    <Rows3 size={14} className="text-[var(--text-muted)] shrink-0 mt-1" />
                  ) : (
                    <FileText size={14} className="text-[var(--text-muted)] shrink-0 mt-1" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{r.title || "Sans titre"}</span>
                    {path && (
                      <span className="block truncate text-xs text-[var(--text-muted)]">{path}</span>
                    )}
                  </div>
                  {r.kind === "record" && (
                    <span className="shrink-0 mt-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded">
                      fiche
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {query.trim() && results.length === 0 && (
          <p className="px-4 py-4 text-sm text-[var(--text-muted)] text-center">
            Aucun résultat pour « {query} »
          </p>
        )}

        {!query && (
          <p className="px-4 py-3 text-xs text-[var(--text-muted)] text-center">
            Tape pour rechercher dans tes pages et tes fiches
          </p>
        )}
      </div>
    </div>
  );
}
