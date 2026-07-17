import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectCheckbox } from "@/components/databases/SelectCheckbox";

/**
 * Env de test = node (pas de jsdom). On rend en HTML via react-dom/server pour
 * vérifier la STRUCTURE (rond + coche + aria) de la case de multi-sélection.
 */
const noop = () => {};

function render(props: { selected?: boolean; label?: string; className?: string }) {
  return renderToStaticMarkup(
    React.createElement(SelectCheckbox, {
      selected: props.selected ?? false,
      onToggle: noop,
      label: props.label ?? "Sélectionner",
      className: props.className,
    })
  );
}

describe("SelectCheckbox — structure", () => {
  it("rend un bouton role=checkbox avec le libellé fourni", () => {
    const html = render({ label: "Sélectionner la carte" });
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-label="Sélectionner la carte"');
    expect(html).toContain("<button");
  });

  it("est RONDE (rounded-full) et non carrée", () => {
    const html = render({});
    expect(html).toContain("rounded-full");
    expect(html).not.toContain("rounded-sm");
  });

  it("cochée : aria-checked=true + coche (lucide-check) + fond accent", () => {
    const html = render({ selected: true });
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("lucide-check");
    expect(html).toContain("bg-[var(--accent)]");
  });

  it("décochée : aria-checked=false + pas de coche", () => {
    const html = render({ selected: false });
    expect(html).toContain('aria-checked="false"');
    expect(html).not.toContain("lucide-check");
  });

  it("garde une cible tappable ≥ 24px (h-6 w-6) même avec un rond visuel de 16px", () => {
    const html = render({});
    expect(html).toContain("h-6 w-6"); // hitbox
    expect(html).toContain("h-4 w-4"); // rond visuel
  });

  it("applique la className de visibilité/positionnement de l'appelant", () => {
    const html = render({ className: "hidden group-hover:grid" });
    expect(html).toContain("hidden group-hover:grid");
  });
});
