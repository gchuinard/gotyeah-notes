import { describe, it, expect } from "vitest";
import { intermediatePosition } from "@/lib/client/reorder";

describe("intermediatePosition — position intermédiaire (gap-based ordering)", () => {
  it("AC2 : entre deux voisines → moyenne (p_prev + p_next) / 2", () => {
    expect(intermediatePosition(1000, 2000)).toBe(1500);
    expect(intermediatePosition(1000, 3000)).toBe(2000);
    // valeur strictement encadrée par les deux voisins
    const p = intermediatePosition(1000, 1001);
    expect(p).toBeGreaterThan(1000);
    expect(p).toBeLessThan(1001);
  });

  it("AC3 : drop en tête (pas de voisin gauche) → valeur < 1re position", () => {
    expect(intermediatePosition(null, 1000)).toBe(500);
    const p = intermediatePosition(null, 3000);
    expect(p).toBeLessThan(3000);
  });

  it("AC3 : drop en fin (pas de voisin droit) → valeur > dernière position", () => {
    expect(intermediatePosition(3000, null)).toBe(4000);
    const p = intermediatePosition(3000, null);
    expect(p).toBeGreaterThan(3000);
  });

  it("gap personnalisable pour le drop en fin / liste vide", () => {
    expect(intermediatePosition(3000, null, 500)).toBe(3500);
    expect(intermediatePosition(null, null, 500)).toBe(500);
  });

  it("liste réduite au seul élément déplacé (aucun voisin) → gap par défaut 1000", () => {
    expect(intermediatePosition(null, null)).toBe(1000);
  });
});
