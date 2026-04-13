"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText } from "lucide-react";

type Result = { id: string; title: string; icon: string | null };

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data);
      setSelected(0);
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const navigate = (id: string) => {
    router.push(`/pages/${id}`);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden ring-1 ring-black/10 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <Search size={16} className="text-gray-400 shrink-0" />
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
                navigate(results[selected].id);
              }
            }}
            placeholder="Rechercher une page…"
            className="flex-1 text-sm outline-none bg-transparent text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
          />
          <kbd className="hidden sm:block text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-400 px-1.5 py-0.5 rounded">
            Esc
          </kbd>
        </div>

        {/* Résultats */}
        {results.length > 0 && (
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li
                key={r.id}
                onClick={() => navigate(r.id)}
                onMouseEnter={() => setSelected(i)}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  i === selected
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-200"
                }`}
              >
                {r.icon ? (
                  <span className="text-base leading-none shrink-0">{r.icon}</span>
                ) : (
                  <FileText size={14} className="text-gray-400 shrink-0" />
                )}
                <span className="truncate">{r.title || "Sans titre"}</span>
              </li>
            ))}
          </ul>
        )}

        {query.trim() && results.length === 0 && (
          <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500 text-center">
            Aucun résultat pour « {query} »
          </p>
        )}

        {!query && (
          <p className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 text-center">
            Tape pour rechercher dans tes pages
          </p>
        )}
      </div>
    </div>
  );
}
