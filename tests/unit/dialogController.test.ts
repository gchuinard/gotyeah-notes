import { describe, it, expect, vi } from "vitest";
import {
  createDialogController,
  initialFocus,
  type DialogRequest,
} from "@/lib/client/dialogController";

const confirmReq = (title = "Supprimer ?", tone?: "danger" | "default"): DialogRequest => ({
  kind: "confirm",
  title,
  ...(tone && { tone }),
});
const alertReq = (title = "Échec"): DialogRequest => ({ kind: "alert", title });

/** Laisse tourner les microtâches pour observer l'état d'une promesse. */
const settled = async <T,>(p: Promise<T>) => {
  let done = false;
  void p.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe("createDialogController", () => {
  it("expose la demande courante et ne résout pas avant le choix", async () => {
    const onChange = vi.fn();
    const c = createDialogController(onChange);

    const p = c.push(confirmReq("Supprimer la vue ?"));
    expect(c.current()?.title).toBe("Supprimer la vue ?");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Supprimer la vue ?" }));
    expect(await settled(p)).toBe(false);
  });

  it("settle(true) résout à true ; settle(false) à false", async () => {
    const c = createDialogController(vi.fn());

    const yes = c.push(confirmReq());
    c.settle(true);
    await expect(yes).resolves.toBe(true);

    const no = c.push(confirmReq());
    c.settle(false);
    await expect(no).resolves.toBe(false);
  });

  it("remet la demande courante à null quand la file se vide", () => {
    const onChange = vi.fn();
    const c = createDialogController(onChange);
    c.push(confirmReq());
    c.settle(true);
    expect(c.current()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("SÉRIALISE deux demandes rapprochées au lieu de les écraser", async () => {
    const c = createDialogController(vi.fn());

    const first = c.push(confirmReq("Première"));
    const second = c.push(confirmReq("Seconde"));
    expect(c.pending()).toBe(2);
    // La seconde n'est pas affichée tant que la première n'est pas réglée.
    expect(c.current()?.title).toBe("Première");

    c.settle(true);
    await expect(first).resolves.toBe(true);
    expect(c.current()?.title).toBe("Seconde");
    expect(await settled(second)).toBe(false);

    c.settle(false);
    await expect(second).resolves.toBe(false);
    expect(c.current()).toBeNull();
  });

  it("une alerte se résout aussi (bouton unique)", async () => {
    const c = createDialogController(vi.fn());
    const p = c.push(alertReq());
    c.settle(true);
    await expect(p).resolves.toBe(true);
  });

  it("settle sans demande en attente ne jette pas", () => {
    const c = createDialogController(vi.fn());
    expect(() => c.settle(true)).not.toThrow();
    expect(c.current()).toBeNull();
  });
});

describe("initialFocus", () => {
  it("action destructive → focus sur Annuler (une Entrée réflexe ne détruit pas)", () => {
    expect(initialFocus(confirmReq("Supprimer ?", "danger"))).toBe("cancel");
  });

  it("action neutre → focus sur le bouton de confirmation", () => {
    expect(initialFocus(confirmReq("Convertir ?"))).toBe("confirm");
    expect(initialFocus(confirmReq("Convertir ?", "default"))).toBe("confirm");
  });

  it("alerte → focus sur OK (pas de bouton Annuler)", () => {
    expect(initialFocus(alertReq())).toBe("confirm");
  });
});
