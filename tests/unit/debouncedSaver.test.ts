import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDebouncedSaver } from "@/lib/client/debouncedSaver";

describe("createDebouncedSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("n'envoie qu'après le délai (debounce)", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.schedule("a");
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("le dernier payload programmé gagne (un seul envoi)", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.schedule("a");
    vi.advanceTimersByTime(200);
    saver.schedule("b");
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("flush envoie immédiatement le payload en attente, sans double envoi", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.schedule("x");
    saver.flush();
    expect(send).toHaveBeenCalledExactlyOnceWith("x");
    // Le timer initial ne doit pas re-déclencher.
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("flush sans rien en attente est un no-op", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("flush après expiration (déjà envoyé) ne renvoie pas", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.schedule("x");
    vi.advanceTimersByTime(500);
    expect(send).toHaveBeenCalledTimes(1);
    saver.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancel abandonne l'envoi en attente", () => {
    const send = vi.fn();
    const saver = createDebouncedSaver<string>(500, send);
    saver.schedule("x");
    saver.cancel();
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    expect(saver.hasPending()).toBe(false);
  });

  it("hasPending reflète l'état en attente", () => {
    const saver = createDebouncedSaver<number>(500, vi.fn());
    expect(saver.hasPending()).toBe(false);
    saver.schedule(1);
    expect(saver.hasPending()).toBe(true);
    saver.flush();
    expect(saver.hasPending()).toBe(false);
  });
});
