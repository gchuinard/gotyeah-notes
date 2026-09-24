import type { Metadata } from "next";
import Link from "next/link";
import { Home, LayoutTemplate } from "lucide-react";

export const metadata: Metadata = {
  title: "Page introuvable · Notes",
  robots: { index: false, follow: false },
};

// 404 de l'app : adresse inconnue ET tous les notFound() de /pages/[id] (page absente,
// en corbeille, espace dont on n'est pas membre, page privée d'autrui). Le texte est le
// même dans tous ces cas et ne tranche pas entre « absente » et « pas accessible » :
// trancher révélerait que la page existe (règle « 404, jamais 403 » du projet).
//
// Connecté, la page s'affiche DANS l'AppShell (sidebar + header) : `h-full` et non
// `h-dvh`, sinon elle réclamerait toute la fenêtre sous le Header et ferait défiler <main>.
// Les liens sont neutres (--surface/--text) plutôt qu'en `bg-[var(--accent)] text-white` :
// sur plusieurs thèmes (light, dark, rose) ce couple descend sous 4,5:1.
export default function NotFound() {
  const linkClass =
    "flex items-center justify-center gap-2 px-4 py-2.5 sm:py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-4 px-6 py-10 text-center">
      <span className="text-5xl" aria-hidden="true">
        🧭
      </span>
      <h1 className="text-xl font-semibold text-[var(--text)]">Page introuvable</h1>
      <p className="text-sm text-[var(--text-muted)] max-w-sm">
        Cette page n&apos;existe pas ou ne t&apos;est pas accessible. Si elle vient d&apos;être
        supprimée, elle t&apos;attend peut-être dans la corbeille.
      </p>
      <nav
        aria-label="Sorties"
        className="flex flex-col sm:flex-row gap-2 mt-2 w-full max-w-sm sm:w-auto"
      >
        <Link href="/" className={linkClass}>
          <Home size={14} className="text-[var(--accent)]" aria-hidden="true" />
          Retour à l&apos;accueil
        </Link>
        <Link href="/templates" className={linkClass}>
          <LayoutTemplate size={14} className="text-[var(--accent)]" aria-hidden="true" />
          Modèles
        </Link>
      </nav>
      <p className="text-xs text-[var(--text-muted)]">
        Pour retrouver une page par son titre :{" "}
        <kbd className="px-1 rounded border border-[var(--border)] bg-[var(--surface)] font-sans">
          Ctrl
        </kbd>{" "}
        +{" "}
        <kbd className="px-1 rounded border border-[var(--border)] bg-[var(--surface)] font-sans">
          K
        </kbd>
      </p>
    </div>
  );
}
