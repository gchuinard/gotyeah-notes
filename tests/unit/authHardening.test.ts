import { describe, it, expect, beforeEach } from "vitest";
import { normalizeEmail, planEmailNormalization } from "@/lib/oidc";
import {
  tooManyFailures, recordFailure, clearFailures, retryAfterSeconds,
  _resetRateLimit, RATE_LIMIT_MAX_FAILURES,
} from "@/lib/rateLimit";

describe("normalizeEmail", () => {
  it("trim + minuscules", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeEmail("a@b.c")).toBe("a@b.c");
  });
});

describe("planEmailNormalization", () => {
  it("ne change rien si déjà normalisé", () => {
    const r = planEmailNormalization([{ id: "1", email: "a@b.c" }]);
    expect(r.updates).toEqual([]);
    expect(r.collisions).toEqual([]);
  });
  it("liste les emails à normaliser (casse/espaces)", () => {
    const r = planEmailNormalization([{ id: "1", email: "A@B.C " }, { id: "2", email: "x@y.z" }]);
    expect(r.updates).toEqual([{ id: "1", email: "a@b.c" }]);
    expect(r.collisions).toEqual([]);
  });
  it("détecte les collisions de casse SANS fusionner", () => {
    const r = planEmailNormalization([{ id: "1", email: "User@X.com" }, { id: "2", email: "user@x.com" }]);
    expect(r.collisions).toEqual(["user@x.com"]);
    // aucune update proposée pour un email en collision (à trancher à la main)
    expect(r.updates.find((u) => u.email === "user@x.com")).toBeUndefined();
  });
});

describe("rateLimit (échecs par clé IP+email)", () => {
  beforeEach(() => _resetRateLimit());

  it("sous le seuil → non limité ; au seuil → limité ; clear → réinitialisé", () => {
    const k = "1.2.3.4|a@b.c";
    expect(tooManyFailures(k)).toBe(false);
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) recordFailure(k);
    expect(tooManyFailures(k)).toBe(true);
    expect(retryAfterSeconds(k)).toBeGreaterThan(0);
    clearFailures(k);
    expect(tooManyFailures(k)).toBe(false);
  });

  it("la fenêtre expire (now avancé) → compteur remis à zéro", () => {
    const k = "ip|e";
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) recordFailure(k, t0);
    expect(tooManyFailures(k, t0)).toBe(true);
    // 16 min plus tard (> fenêtre 15 min)
    expect(tooManyFailures(k, t0 + 16 * 60 * 1000)).toBe(false);
  });

  it("les clés sont indépendantes", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) recordFailure("ipA|e");
    expect(tooManyFailures("ipA|e")).toBe(true);
    expect(tooManyFailures("ipB|e")).toBe(false);
  });
});
