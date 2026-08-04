import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET } from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let workspaceId: string;
const uniq = String(Date.now());

function asMe() {
  mockGetSession.mockResolvedValue({ id: userId, email: "u", displayName: "U", currentWorkspaceId: workspaceId , isService: false});
}

function searchReq(params: Record<string, string>) {
  const u = new URL("http://localhost/api/search");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Request(u, { method: "GET" });
}

async function mkDbPage(visibility: "team" | "private", ownerId: string) {
  const page = await prisma.page.create({
    data: { title: "db", workspaceId, ownerId, visibility, position: 1000 },
  });
  const db = await prisma.database.create({ data: { pageId: page.id } });
  return { page, db };
}
const mkRecord = (databaseId: string, title: string) =>
  prisma.record.create({ data: { databaseId, title } });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`search-${uniq}@x.tld`);
  userId = seeded.user.id;
  workspaceId = seeded.workspace.id;
  asMe();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/search — records", () => {
  it("remonte un record team par titre, typé { kind: record } avec recordId + pageId hôte", async () => {
    asMe();
    const { page, db } = await mkDbPage("team", userId);
    const rec = await mkRecord(db.id, `PaiementTok${uniq}`);

    const res = await GET(searchReq({ q: `PaiementTok${uniq}`, workspaceId }));
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.find((d: { kind: string; id: string }) => d.kind === "record" && d.id === rec.id);
    expect(found).toBeTruthy();
    expect(found.pageId).toBe(page.id);
    expect(found.title).toBe(`PaiementTok${uniq}`);
  });

  it("respecte la visibilité de la page hôte : private non-owner absent, private owner présent", async () => {
    asMe();
    const other = await seedUserWithWorkspace(`search-other-${uniq}@x.tld`);
    // Page private DANS mon workspace mais possédée par un autre user.
    const otherPage = await prisma.page.create({
      data: { title: "priv", workspaceId, ownerId: other.user.id, visibility: "private", position: 1000 },
    });
    const otherDb = await prisma.database.create({ data: { pageId: otherPage.id } });
    const recOther = await mkRecord(otherDb.id, `SecretTok${uniq}`);
    // Page private possédée par moi.
    const { db: myDb } = await mkDbPage("private", userId);
    const recMine = await mkRecord(myDb.id, `SecretTok${uniq}`);

    const res = await GET(searchReq({ q: `SecretTok${uniq}`, workspaceId }));
    const data = await res.json();
    expect(data.some((d: { id: string }) => d.id === recOther.id)).toBe(false);
    expect(data.some((d: { id: string }) => d.id === recMine.id)).toBe(true);
  });

  it("401 sans session ; 404 si workspaceId sans membership", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await GET(searchReq({ q: "x", workspaceId }))).status).toBe(401);

    asMe();
    const stranger = await seedUserWithWorkspace(`search-stranger-${uniq}@x.tld`);
    const res = await GET(searchReq({ q: "x", workspaceId: stranger.workspace.id }));
    expect(res.status).toBe(404);
  });

  it("q vide → [] ; total borné à 12 même avec plus de records matchés", async () => {
    asMe();
    expect(await (await GET(searchReq({ q: "", workspaceId }))).json()).toEqual([]);

    const { db } = await mkDbPage("team", userId);
    const tok = `BoundTok${uniq}`;
    for (let i = 0; i < 15; i++) await mkRecord(db.id, `${tok}-${i}`);

    const res = await GET(searchReq({ q: tok, workspaceId }));
    const data = await res.json();
    expect(data.length).toBe(12);
    expect(data.every((d: { kind: string }) => d.kind === "record")).toBe(true);
  });
});
