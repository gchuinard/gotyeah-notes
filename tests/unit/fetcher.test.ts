import { describe, it, expect, vi, afterEach } from "vitest";
import { fetcher, HttpError, loadErrorMessage, noRetryOn4xx } from "@/lib/client/fetcher";

/**
 * Le fetcher SWR partagé. Ce qui est figé ici n'est pas « il sait lire du JSON »
 * mais « il REFUSE une réponse d'erreur » — c'est la seule raison pour laquelle
 * ce module existe, et c'est ce qu'une réécriture distraite retirerait.
 */

const mockFetch = (init: { ok: boolean; status: number; body?: unknown }) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: init.ok,
      status: init.status,
      json: async () => init.body,
    }))
  );

describe("fetcher (SWR)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rend le JSON quand la réponse est OK", async () => {
    mockFetch({ ok: true, status: 200, body: [{ id: "a" }] });
    await expect(fetcher("/api/x")).resolves.toEqual([{ id: "a" }]);
  });

  it("⚠️ LÈVE sur 404 au lieu de rendre le corps d'erreur comme une donnée", async () => {
    // Le cœur du sujet : sans ce refus, SWR remplirait `data` avec
    // { error: "Not found" } et un composant attendant un tableau casserait.
    mockFetch({ ok: false, status: 404, body: { error: "Not found" } });
    await expect(fetcher("/api/x")).rejects.toThrow("HTTP 404");
  });

  it("lève aussi sur 500, et le statut est dans le message", async () => {
    mockFetch({ ok: false, status: 500, body: { error: "boom" } });
    await expect(fetcher("/api/x")).rejects.toThrow("HTTP 500");
  });

  it("ne consomme JAMAIS le corps d'une réponse en échec", async () => {
    // Lire le JSON d'une erreur puis lever donnerait le même résultat visible,
    // mais gaspillerait le parse — et surtout invitait à « récupérer » ce corps,
    // ce qui est exactement le défaut qu'on ferme.
    const json = vi.fn(async () => ({ error: "Not found" }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json })));
    await expect(fetcher("/api/x")).rejects.toThrow();
    expect(json).not.toHaveBeenCalled();
  });

  it("l'erreur PORTE son statut : le message seul obligerait à le re-parser", async () => {
    mockFetch({ ok: false, status: 403, body: {} });
    await expect(fetcher("/api/x")).rejects.toBeInstanceOf(HttpError);
    await expect(fetcher("/api/x")).rejects.toMatchObject({ status: 403 });
  });
});

describe("loadErrorMessage", () => {
  it("traduit les statuts en phrases, jamais un code nu", () => {
    expect(loadErrorMessage(new HttpError(401))).toContain("Session expirée");
    expect(loadErrorMessage(new HttpError(403))).toContain("Accès refusé");
    expect(loadErrorMessage(new HttpError(404))).toContain("Introuvable");
  });

  it("une panne réseau (pas d'HttpError) parle de connexion", () => {
    expect(loadErrorMessage(new TypeError("Failed to fetch"))).toContain("connexion");
    expect(loadErrorMessage(undefined)).toContain("connexion");
  });
});

describe("noRetryOn4xx", () => {
  const call = (err: unknown, retryCount = 0) => {
    const revalidate = vi.fn();
    noRetryOn4xx.onErrorRetry(err, "/api/x", null, revalidate, { retryCount });
    return revalidate;
  };

  it("⚠️ ne réessaie JAMAIS un 4xx : on réessaie une panne, pas un refus", () => {
    vi.useFakeTimers();
    for (const status of [400, 401, 403, 404, 429]) {
      const revalidate = call(new HttpError(status));
      vi.runAllTimers();
      expect(revalidate).not.toHaveBeenCalled();
    }
    vi.useRealTimers();
  });

  it("réessaie un 500 et une panne réseau, mais s'arrête à 3 tentatives", () => {
    vi.useFakeTimers();
    const retried = call(new HttpError(500));
    vi.runAllTimers();
    expect(retried).toHaveBeenCalledOnce();

    const abandonne = call(new HttpError(500), 3);
    vi.runAllTimers();
    expect(abandonne).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
