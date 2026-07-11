import { describe, it, expect } from "vitest";
import { isSafeUploadName, extForType, mimeForName, extractUploadRefs } from "@/lib/uploads";

describe("uploads — helpers purs", () => {
  it("isSafeUploadName : accepte [A-Za-z0-9_-].ext, rejette le path-traversal", () => {
    expect(isSafeUploadName("abc123.png")).toBe(true);
    expect(isSafeUploadName("a-b_c.webp")).toBe(true);
    expect(isSafeUploadName("../etc/passwd")).toBe(false);
    expect(isSafeUploadName("a/b.png")).toBe(false);
    expect(isSafeUploadName("a.png/../x")).toBe(false);
    expect(isSafeUploadName("no-extension")).toBe(false);
    expect(isSafeUploadName("space .png")).toBe(false);
  });

  it("extForType : images connues → ext, sinon null", () => {
    expect(extForType("image/png")).toBe("png");
    expect(extForType("image/jpeg")).toBe("jpg");
    expect(extForType("image/svg+xml")).toBe("svg");
    expect(extForType("application/pdf")).toBeNull();
    expect(extForType("text/html")).toBeNull();
  });

  it("mimeForName : dérive le content-type de l'extension", () => {
    expect(mimeForName("x.png")).toBe("image/png");
    expect(mimeForName("x.jpg")).toBe("image/jpeg");
    expect(mimeForName("x.bin")).toBe("application/octet-stream");
  });

  it("extractUploadRefs : capture les /api/files/<name> d'un texte", () => {
    const content = JSON.stringify([
      { type: "image", props: { url: "/api/files/aaa.png" } },
      { type: "paragraph", content: "voir /api/files/bbb-1.webp et /api/files/aaa.png" },
    ]);
    expect(extractUploadRefs(content)).toEqual(new Set(["aaa.png", "bbb-1.webp"]));
    expect(extractUploadRefs(null)).toEqual(new Set());
    expect(extractUploadRefs("aucune image ici")).toEqual(new Set());
  });
});
