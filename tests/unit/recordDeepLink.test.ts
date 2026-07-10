import { describe, it, expect } from "vitest";
import { recordDeepLinkHref } from "@/lib/client/useRecordDeepLink";

describe("recordDeepLinkHref", () => {
  it("ajoute ?r en préservant les autres params (?v)", () => {
    expect(recordDeepLinkHref("/pages/p", "v=view1", "rec1")).toBe("/pages/p?v=view1&r=rec1");
  });

  it("remplace un ?r existant", () => {
    expect(recordDeepLinkHref("/pages/p", "v=view1&r=old", "rec2")).toBe("/pages/p?v=view1&r=rec2");
  });

  it("retire ?r en conservant ?v", () => {
    expect(recordDeepLinkHref("/pages/p", "v=view1&r=old", null)).toBe("/pages/p?v=view1");
  });

  it("ajoute ?r depuis une URL sans query", () => {
    expect(recordDeepLinkHref("/pages/p", "", "rec1")).toBe("/pages/p?r=rec1");
  });

  it("retomber sur le pathname nu quand ?r était le seul param", () => {
    expect(recordDeepLinkHref("/pages/p", "r=old", null)).toBe("/pages/p");
  });
});
