import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { purgeOrphanUploads } from "@/lib/uploads";
import { POST as uploadPOST } from "@/app/api/upload/route";
import { GET as fileGET } from "@/app/api/files/[name]/route";
import { GET as configGET, PATCH as configPATCH } from "@/app/api/config/route";

const mockGetSession = vi.mocked(getSession);
let userId: string;
let workspaceId: string;
let tmpDir: string;

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

function uploadReq(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return new Request("http://localhost/api/upload", { method: "POST", body: fd });
}
const nameParams = (name: string) => ({ params: Promise.resolve({ name }) });

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "uploads-test-"));
  process.env.UPLOAD_DIR = tmpDir;
  const seeded = await seedUserWithWorkspace(`upload-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
  await prisma.$disconnect();
});

describe("/api/config — réglage global + purge paresseuse", () => {
  it("GET crée le singleton (défaut 10 Mo) ; PATCH le change et le persiste", async () => {
    asMe();
    let res = await configGET();
    expect((await res.json()).uploadMaxMb).toBe(10);

    res = await configPATCH(new Request("http://localhost/api/config", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadMaxMb: 25 }),
    }));
    expect((await res.json()).uploadMaxMb).toBe(25);

    res = await configGET();
    expect((await res.json()).uploadMaxMb).toBe(25);
  });

  it("PATCH borne la valeur (1..200) → 400 hors bornes", async () => {
    asMe();
    const bad = await configPATCH(new Request("http://localhost/api/config", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadMaxMb: 0 }),
    }));
    expect(bad.status).toBe(400);
  });

  it("401 sans session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await configGET()).status).toBe(401);
  });
});

describe("/api/upload — écriture, type, taille", () => {
  it("upload une image → écrit le fichier et renvoie /api/files/<uuid>.png", async () => {
    asMe();
    await configPATCH(new Request("http://localhost/api/config", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadMaxMb: 10 }),
    }));
    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });
    const res = await uploadPOST(uploadReq(file));
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(/^\/api\/files\/[A-Za-z0-9-]+\.png$/);
    const name = url.split("/").pop()!;
    expect((await fs.readFile(path.join(tmpDir, name))).length).toBe(4);
  });

  it("type non image → 415", async () => {
    asMe();
    const file = new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" });
    expect((await uploadPOST(uploadReq(file))).status).toBe(415);
  });

  it("dépasse la taille max → 413", async () => {
    asMe();
    await configPATCH(new Request("http://localhost/api/config", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadMaxMb: 1 }),
    }));
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.png", { type: "image/png" });
    expect((await uploadPOST(uploadReq(big))).status).toBe(413);
  });

  it("401 sans session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    expect((await uploadPOST(uploadReq(file))).status).toBe(401);
  });
});

describe("/api/files/[name] — service + anti path-traversal", () => {
  it("sert un fichier existant avec le bon content-type", async () => {
    asMe();
    await fs.writeFile(path.join(tmpDir, "served.png"), Buffer.from([9, 9, 9]));
    const res = await fileGET(new Request("http://localhost/api/files/served.png"), nameParams("served.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("nom invalide (traversal) → 400 ; fichier absent → 404", async () => {
    asMe();
    expect((await fileGET(new Request("http://localhost/api/files/x"), nameParams("../../etc/passwd"))).status).toBe(400);
    expect((await fileGET(new Request("http://localhost/api/files/x"), nameParams("nope.png"))).status).toBe(404);
  });

  it("401 sans session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await fileGET(new Request("http://localhost/api/files/x"), nameParams("served.png"))).status).toBe(401);
  });
});

describe("purgeOrphanUploads — orphelins > 30 j seulement", () => {
  it("garde le référencé et le récent, supprime l'orphelin ancien", async () => {
    asMe();
    const old = new Date(Date.now() - 40 * 86400000);
    // 3 fichiers
    for (const n of ["ref-old.png", "orphan-old.png", "orphan-new.png"]) {
      await fs.writeFile(path.join(tmpDir, n), Buffer.from([1]));
    }
    await fs.utimes(path.join(tmpDir, "ref-old.png"), old, old);
    await fs.utimes(path.join(tmpDir, "orphan-old.png"), old, old);
    // orphan-new reste récent (maintenant)

    // ref-old est référencé dans le content d'une page
    const page = await prisma.page.create({
      data: {
        title: "p", workspaceId, ownerId: userId, visibility: "team", position: 1000,
        content: JSON.stringify([{ type: "image", props: { url: "/api/files/ref-old.png" } }]),
      },
    });

    const purged = await purgeOrphanUploads();
    expect(purged).toBe(1); // seul orphan-old

    const remaining = await fs.readdir(tmpDir);
    expect(remaining).toContain("ref-old.png");   // référencé → gardé
    expect(remaining).toContain("orphan-new.png"); // récent → gardé
    expect(remaining).not.toContain("orphan-old.png"); // orphelin ancien → purgé

    await prisma.page.delete({ where: { id: page.id } });
  });
});
