"use client";
import { useState } from "react";
import useSWR from "swr";
import { Plus, Trash2, ArrowLeft, X } from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useDialog } from "@/contexts/DialogContext";
import { SELECT_COLORS } from "@/lib/propertyColors";
import { fetcher, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = { id?: string; label: string };
type Column = { name: string; type: string; config: Record<string, unknown> };
type Template = {
  id: string;
  name: string;
  builtin: boolean;
  kanbanGroupProperty: string | null;
  columns: Column[];
  sections: { id: string; label: string }[];
};

type ColForm = { name: string; type: string; optionsCsv: string };
type Form = {
  id?: string;
  name: string;
  sections: Section[];
  columns: ColForm[];
  kanbanGroupProperty: string;
};

const COLUMN_TYPES = ["text", "number", "select", "multiselect", "date", "checkbox", "url", "email", "user"];
// Palette partagée (lib/propertyColors) : une couleur hors palette serait refusée
// par la validation serveur, rendant les options d'une DB scaffoldée non éditables.
const OPTION_COLORS: readonly string[] = SELECT_COLORS;

const rid = () => crypto.randomUUID().slice(0, 8);

function buildConfig(col: ColForm): Record<string, unknown> {
  if (col.type === "select" || col.type === "multiselect") {
    const options = col.optionsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name, i) => ({ id: rid(), name, color: OPTION_COLORS[i % OPTION_COLORS.length] }));
    return { type: col.type, options };
  }
  if (col.type === "number") return { type: col.type, format: "decimal" };
  if (col.type === "date") return { type: col.type, includeTime: false };
  return { type: col.type };
}

function configToCsv(config: Record<string, unknown>): string {
  const opts = (config?.options as { name: string }[] | undefined) ?? [];
  return opts.map((o) => o.name).join(", ");
}

// ─── Manager ──────────────────────────────────────────────────────────────────

export default function TemplatesManager() {
  const { activeWorkspace, isViewer, isAdmin } = useWorkspace();
  const { confirm } = useDialog();
  const wsId = activeWorkspace?.id ?? null;
  const key = wsId ? `/api/templates?workspaceId=${wsId}` : null;
  // `loadError` est l'échec de LECTURE de la liste ; `error` plus bas reste celui
  // des MUTATIONS. Deux causes distinctes, deux messages — les confondre ferait
  // qu'un enregistrement raté effacerait la bannière d'un chargement mort.
  const { data: templates = [], error: loadError, mutate } = useSWR<Template[]>(key, fetcher, noRetryOn4xx);

  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  // Les refus serveur (403 rôle insuffisant, 400 builtin…) étaient avalés : le
  // formulaire restait ouvert sans un mot. On les affiche.
  const [error, setError] = useState<string | null>(null);

  const startNew = () =>
    setForm({ name: "", sections: [{ label: "" }], columns: [], kanbanGroupProperty: "" });

  // Un template fourni s'ouvre en DUPLICATION (pas d'id → l'enregistrement crée
  // une copie éditable dans le workspace).
  const startEdit = (t: Template) =>
    setForm({
      id: t.builtin ? undefined : t.id,
      name: t.builtin ? `${t.name} (copie)` : t.name,
      sections: t.sections.map((s) => ({ id: t.builtin ? undefined : s.id, label: s.label })),
      columns: t.columns.map((c) => ({ name: c.name, type: c.type, optionsCsv: configToCsv(c.config) })),
      kanbanGroupProperty: t.kanbanGroupProperty ?? "",
    });

  const save = async () => {
    if (!form || !wsId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const columns = form.columns
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name.trim(), type: c.type, config: buildConfig(c) }));
      const sections = form.sections
        .filter((s) => s.label.trim())
        .map((s) => ({ id: s.id, label: s.label.trim() }));
      const colNames = new Set(columns.map((c) => c.name));
      const body = {
        name: form.name.trim() || "Sans nom",
        columns,
        sections,
        kanbanGroupProperty: colNames.has(form.kanbanGroupProperty) ? form.kanbanGroupProperty : null,
      };
      const url = form.id ? `/api/templates/${form.id}` : "/api/templates";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form.id ? body : { ...body, workspaceId: wsId }),
      });
      if (res.ok) {
        mutate();
        setForm(null);
        return;
      }
      const b = await res.json().catch(() => ({}));
      setError((b as { error?: string }).error ?? `Erreur ${res.status}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Supprimer ce modèle ?",
      message: "Cette action est irréversible.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      mutate();
      return;
    }
    const b = await res.json().catch(() => ({}));
    setError((b as { error?: string }).error ?? `Erreur ${res.status}`);
  };

  // ── Éditeur ────────────────────────────────────────────────────────────────
  if (form) {
    const setSection = (i: number, label: string) =>
      setForm((f) => f && { ...f, sections: f.sections.map((s, j) => (j === i ? { ...s, label } : s)) });
    const setCol = (i: number, patch: Partial<ColForm>) =>
      setForm((f) => f && { ...f, columns: f.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

    return (
      <div className="max-w-2xl mx-auto px-4 py-6 sm:px-8 sm:py-8 text-[var(--text)]">
        <button
          onClick={() => setForm(null)}
          className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-4 py-2 md:py-0"
        >
          <ArrowLeft size={15} /> Retour
        </button>

        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Nom du modèle"
          className="w-full text-2xl font-bold bg-transparent outline-none border-b border-[var(--border)] pb-2 mb-6 placeholder:text-[var(--text-muted)]"
        />

        {/* Sections */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-1">Sections du corps</h3>
          <p className="text-xs text-[var(--text-muted)] mb-2">
            Libellés fixes (non modifiables dans les cartes), dans l&apos;ordre.
          </p>
          {form.sections.map((s, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5">
              <input
                value={s.label}
                onChange={(e) => setSection(i, e.target.value)}
                placeholder="Libellé de section"
                className="flex-1 min-w-0 px-3 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] outline-none text-base sm:text-sm"
              />
              <button
                onClick={() => setForm({ ...form, sections: form.sections.filter((_, j) => j !== i) })}
                aria-label="Supprimer la section"
                className="shrink-0 flex h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] md:h-auto md:w-auto md:p-1.5"
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setForm({ ...form, sections: [...form.sections, { label: "" }] })}
            className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mt-1 py-2 md:py-0"
          >
            <Plus size={14} /> Ajouter une section
          </button>
        </div>

        {/* Colonnes */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-1">Colonnes</h3>
          <p className="text-xs text-[var(--text-muted)] mb-2">
            Pour select/multiselect, options séparées par des virgules.
          </p>
          {form.columns.map((c, i) => (
            // La ligne dépassait la largeur d'un mobile sans conteneur scrollable
            // au-dessus : le document débordait et le × sortait de l'écran. On
            // renvoie les options sur leur propre ligne au lieu de comprimer.
            <div key={i} className="flex flex-wrap items-center gap-2 mb-1.5">
              <input
                value={c.name}
                onChange={(e) => setCol(i, { name: e.target.value })}
                placeholder="Nom"
                className="w-36 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] outline-none text-base sm:text-sm"
              />
              <select
                value={c.type}
                onChange={(e) => setCol(i, { type: e.target.value })}
                className="min-w-0 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] outline-none text-base sm:text-sm"
              >
                {COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              {(c.type === "select" || c.type === "multiselect") && (
                <input
                  value={c.optionsCsv}
                  onChange={(e) => setCol(i, { optionsCsv: e.target.value })}
                  placeholder="Option A, Option B…"
                  className="grow min-w-0 order-1 basis-full sm:order-none sm:basis-0 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] outline-none text-base sm:text-sm"
                />
              )}
              <button
                onClick={() => setForm({ ...form, columns: form.columns.filter((_, j) => j !== i) })}
                aria-label="Supprimer la colonne"
                className="shrink-0 flex h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] md:h-auto md:w-auto md:p-1.5"
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setForm({ ...form, columns: [...form.columns, { name: "", type: "text", optionsCsv: "" }] })}
            className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mt-1 py-2 md:py-0"
          >
            <Plus size={14} /> Ajouter une colonne
          </button>
        </div>

        {/* Kanban */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold mb-2">Regroupement kanban</h3>
          <select
            value={form.kanbanGroupProperty}
            onChange={(e) => setForm({ ...form, kanbanGroupProperty: e.target.value })}
            className="max-w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] outline-none text-base sm:text-sm"
          >
            <option value="">Aucune vue kanban</option>
            {form.columns
              .filter((c) => c.type === "select" && c.name.trim())
              .map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2.5 md:py-2 rounded bg-[var(--accent)] text-white text-sm disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            onClick={() => setForm(null)}
            className="px-4 py-2.5 md:py-2 rounded border border-[var(--border)] text-sm"
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  // ── Liste ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:px-8 sm:py-8 text-[var(--text)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Modèles</h1>
        {/* Créer / modifier un modèle = éditeur ; supprimer = admin (définitif). */}
        {!isViewer && (
          <button
            onClick={startNew}
            className="flex items-center gap-1 px-3 py-2.5 md:py-1.5 rounded bg-[var(--accent)] text-white text-sm"
          >
            <Plus size={15} /> Nouveau modèle
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {/* ⚠️ L'échec de LECTURE prime sur la liste : afficher zéro ligne quand rien
          n'a pu être chargé se lirait « il n'y a aucun modèle », et on cliquerait
          « Nouveau modèle » pour recréer ce qui existe déjà. */}
      {loadError ? (
        <p className="text-sm text-red-500">{loadErrorMessage(loadError)}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 rounded border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {t.name}
                  {t.builtin && <span className="ml-2 text-xs text-[var(--text-muted)]">fourni</span>}
                </div>
                <div className="text-xs text-[var(--text-muted)] truncate">
                  {t.columns.length} colonne(s) · {t.sections.length} section(s)
                </div>
              </div>
              {!t.builtin && !isViewer && (
                <button
                  onClick={() => startEdit(t)}
                  className="shrink-0 py-2 md:py-0 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Éditer
                </button>
              )}
              {!t.builtin && isAdmin && (
                <button
                  onClick={() => remove(t.id)}
                  className="shrink-0 flex h-10 w-10 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] md:h-auto md:w-auto md:p-1.5"
                  title="Supprimer le modèle (définitif)"
                >
                  <Trash2 size={15} />
                </button>
              )}
              {t.builtin && !isViewer && (
                <button
                  onClick={() => startEdit(t)}
                  className="shrink-0 py-2 md:py-0 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                  title="Voir (lecture seule — enregistrer créera une copie)"
                >
                  Voir
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
