import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardActions, { withStopPropagation } from "@/components/databases/CardActions";

/**
 * Environnement de test = node (pas de jsdom). On rend le composant en HTML via
 * react-dom/server pour vérifier sa STRUCTURE, et on teste la LOGIQUE de clic
 * (stopPropagation + action) via le helper pur `withStopPropagation`.
 */

const noop = () => {};

function render(props: {
  onDuplicate?: () => void;
  onDelete?: () => void;
  className?: string;
}) {
  return renderToStaticMarkup(
    React.createElement(CardActions, {
      onDuplicate: props.onDuplicate ?? noop,
      onDelete: props.onDelete ?? noop,
      className: props.className,
    })
  );
}

describe("CardActions — structure", () => {
  it("rend exactement 2 boutons", () => {
    const html = render({});
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons).toHaveLength(2);
  });

  it("expose les libellés/aria Dupliquer et Supprimer", () => {
    const html = render({});
    expect(html).toContain('aria-label="Dupliquer"');
    expect(html).toContain('aria-label="Supprimer"');
  });

  it("rend les icônes Copy et Trash2", () => {
    const html = render({});
    expect(html).toContain("lucide-copy");
    expect(html).toContain("lucide-trash2");
  });

  it("reste masqué hors survol (opacity-0 group-hover)", () => {
    const html = render({});
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-hover:opacity-100");
  });

  it("applique la className de positionnement passée par l'appelant", () => {
    const html = render({ className: "absolute top-1.5 right-1.5" });
    expect(html).toContain("absolute top-1.5 right-1.5");
  });

  it("ne réintroduit aucun bouton de menu ⋯ (MoreHorizontal)", () => {
    const html = render({});
    expect(html).not.toContain("lucide-more-horizontal");
    expect(html).not.toContain("lucide-ellipsis");
  });
});

describe("withStopPropagation", () => {
  it("appelle l'action fournie", () => {
    const action = vi.fn();
    const handler = withStopPropagation(action);
    handler({ stopPropagation: () => {} } as unknown as React.MouseEvent);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("stoppe la propagation de l'événement (n'ouvre pas la carte / le drag parent)", () => {
    const action = vi.fn();
    const stop = vi.fn();
    const handler = withStopPropagation(action);
    handler({ stopPropagation: stop } as unknown as React.MouseEvent);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("dupliquer et supprimer sont deux actions distinctes", () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    withStopPropagation(onDuplicate)({ stopPropagation: () => {} } as unknown as React.MouseEvent);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("CardActions — suppression optionnelle", () => {
  it("sans onDelete, seul le bouton Dupliquer est rendu", () => {
    const html = renderToStaticMarkup(
      React.createElement(CardActions, { onDuplicate: noop })
    );
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Dupliquer"');
    expect(html).not.toContain('aria-label="Supprimer"');
  });

  it("avec onDelete, les deux boutons reviennent (kanban, backlog, table)", () => {
    const html = renderToStaticMarkup(
      React.createElement(CardActions, { onDuplicate: noop, onDelete: noop })
    );
    expect((html.match(/<button/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-label="Supprimer"');
  });
});
