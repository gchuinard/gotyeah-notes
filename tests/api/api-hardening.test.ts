import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";
import { POST as sectionsPOST } from "@/app/api/sections/route";
import { PATCH as sectionPATCH } from "@/app/api/sections/[id]/route";

const mockGetSession = vi.mocked(getSession);
let userId: string;
let workspaceId: string;

function mkReq(method: string, headers: Record<string, string>) {
  return new NextRequest("https://notes.x/api/pages", { method, headers });
}

describe("proxy — anti-CSRF par Origin sur les mutations /api/*", () => {
  it("POST cross-origin → 403", () => {
    const res = proxy(mkReq("POST", { origin: "https://evil.com", host: "notes.x" }));
    expect(res.status).toBe(403);
  });

  it("POST same-origin → PAS bloqué par l'Origin (poursuit vers l'auth → 401 sans cookie)", () => {
    const res = proxy(mkReq("POST", { origin: "https://notes.x", host: "notes.x" }));
    expect(res.status).toBe(401); // pas 403 : l'Origin est OK, c'est l'auth qui manque
  });

  it("POST pont MCP (x-mcp-secret + x-act-as-email), sans Origin → laissé passer", () => {
    const res = proxy(mkReq("POST", {
      host: "notes.x", "x-mcp-secret": "s", "x-act-as-email": "a@b.c",
    }));
    // NextResponse.next() n'a pas de statut d'erreur
    expect(res.status).toBe(200);
  });

  it("GET cross-origin → PAS bloqué par l'Origin (lecture ; auth → 401 sans cookie)", () => {
    const res = proxy(mkReq("GET", { origin: "https://evil.com", host: "notes.x" }));
    expect(res.status).toBe(401);
  });
});

describe("sections — zod (plus de 500 sur body malformé)", () => {
  beforeAll(async () => {
    const s = await seedUserWithWorkspace(`apihard-${Date.now()}@x.tld`);
    userId = s.user.id;
    workspaceId = s.workspace.id;
    mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("POST body vide/malformé → 400 (zod), pas 500", async () => {
    const req = new Request("http://localhost/api/sections", {
      method: "POST", headers: { "content-type": "application/json" }, body: "pas-du-json",
    });
    expect((await sectionsPOST(req)).status).toBe(400);
  });

  it("PATCH body vide → 400 structuré, pas 500", async () => {
    const section = await prisma.section.create({
      data: { name: "S", type: "team", position: 0, workspaceId },
    });
    const req = new Request(`http://localhost/api/sections/${section.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: "",
    });
    const res = await sectionPATCH(req, { params: Promise.resolve({ id: section.id }) });
    expect(res.status).toBe(400);
  });

  it("PATCH valide → 200", async () => {
    const section = await prisma.section.create({
      data: { name: "S2", type: "team", position: 0, workspaceId },
    });
    const req = new Request(`http://localhost/api/sections/${section.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renommée" }),
    });
    const res = await sectionPATCH(req, { params: Promise.resolve({ id: section.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renommée");
  });
});
