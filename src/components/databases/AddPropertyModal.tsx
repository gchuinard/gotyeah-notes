"use client";
import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import type { ParsedDatabaseProperty } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

type PropertyType = Exclude<ParsedDatabaseProperty["type"], "title">;

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "text",        label: "Texte" },
  { value: "number",      label: "Nombre" },
  { value: "checkbox",    label: "Case à cocher" },
  { value: "select",      label: "Sélection" },
  { value: "multiselect", label: "Multi-sélection" },
  { value: "date",        label: "Date" },
  { value: "url",         label: "URL" },
  { value: "email",       label: "Email" },
];

type Props = {
  databaseId: string;
  onCreated: (property: ParsedDatabaseProperty) => void;
  onClose: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddPropertyModal({ databaseId, onCreated, onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Le nom est requis."); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/databases/${databaseId}/properties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, type }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Erreur ${res.status}`);
        return;
      }
      const created: ParsedDatabaseProperty = await res.json();
      onCreated(created);
    } catch {
      setError("Impossible de créer la propriété.");
    } finally {
      setSaving(false);
    }
  };

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-xl w-80 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-[var(--text)]">Nouvelle propriété</span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Nom</label>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom de la propriété"
              className="w-full text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PropertyType)}
              className="w-full text-sm bg-[var(--surface)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-sm px-3 py-1.5 rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Création…" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
