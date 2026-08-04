import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

vi.mock("@/lib/session", () => ({ getSession: vi.fn() }));

import { getSession } from "@/lib/session";
import { GET as getPage } from "@/app/api/pages/[id]/route";
import { GET as listPages } from "@/app/api/pages/route";
import { GET as getDatabase } from "@/app/api/databases/[id]/route";
import { GET as search } from "@/app/api/search/route";
import { prisma } from "@/lib/prisma";
import { isPageAccessible, pageVisibilityFilter } from "@/lib/workspace";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let owner: { id: string };
let workspaceId: string;
let service: { id: string };
let outsider: { id: string };
let privatePageId: string;
let privateDbId: string;

/** Le compte de service, membre de l'espace. */
const asService = () =>
  mockGetSession.mockResolvedValue({
    id: service.id,
    email: "ia@gotyeah.local",
    displayName: "IA",
    currentWorkspaceId: workspaceId,
    isService: true,
  });

/** Un humain membre de l'espace, mais qui n'est pas le propriétaire de la page. */
const asOutsider = () =>
  mockGetSession.mockResolvedValue({
    id: outsider.id,
    email: "autre@x.tld",
    displayName: "Autre",
    currentWorkspaceId: workspaceId,
    isService: false,
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string) => new Request(url, { method: "GET" });

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`svc-owner-${Date.now()}@x.tld`);
  owner = seeded.user;
  workspaceId = seeded.workspace.id;

  const mk = async (email: string, isService: boolean, role: string) => {
    const u = await prisma.user.create({
      data: {
        email,
        firstName: "T",
        lastName: "U",
        displayName: isService ? "IA" : "Autre",
        passwordHash: "x",
        isService,
      },
    });
    await prisma.membership.create({ data: { userId: u.id, workspaceId, role } });
    return u;
  };
  service = await mk(`ia-${Date.now()}@gotyeah.local`, true, "admin");
  outsider = await mk(`autre-${Date.now()}@x.tld`, false, "admin");

  // Page PRIVÉE appartenant au propriétaire, avec une database posée dessus.
  const page = await prisma.page.create({
    data: {
      title: "Board privé",
      workspaceId,
      ownerId: owner.id,
      visibility: "private",
      position: 1000,
    },
  });
  privatePageId = page.id;
  privateDbId = (await prisma.database.create({ data: { pageId: page.id } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("isPageAccessible — le helper", () => {
  const privatePage = { visibility: "private", ownerId: "u1" };

  it("un humain non-propriétaire reste bloqué (non-régression)", () => {
    expect(isPageAccessible(privatePage, "u2")).toBe(false);
    expect(isPageAccessible(privatePage, "u2", false)).toBe(false);
  });

  it("le propriétaire passe, service ou non", () => {
    expect(isPageAccessible(privatePage, "u1")).toBe(true);
  });

  it("un compte de service passe sur une page privée d'autrui", () => {
    expect(isPageAccessible(privatePage, "u2", true)).toBe(true);
  });

  it("une page d'équipe reste ouverte à tous", () => {
    expect(isPageAccessible({ visibility: "team", ownerId: "u1" }, "u2")).toBe(true);
  });
});

describe("pageVisibilityFilter — le pendant pour les LISTES", () => {
  it("un humain reçoit la clause OR habituelle", () => {
    expect(pageVisibilityFilter("u1")).toEqual({
      OR: [{ visibility: "team" }, { visibility: "private", ownerId: "u1" }],
    });
  });

  it("un compte de service ne reçoit AUCUNE restriction", () => {
    // undefined et non `{}` : l'appelant l'étale, un `OR: undefined` serait refusé.
    expect(pageVisibilityFilter("u1", true)).toBeUndefined();
  });
});

describe("Compte de service — accès réel aux routes", () => {
  it("lit une page privée d'autrui dans SON espace, là où un autre membre reçoit 404", async () => {
    asOutsider();
    expect((await getPage(req("http://x/"), withId(privatePageId))).status).toBe(404);

    asService();
    const res = await getPage(req("http://x/"), withId(privatePageId));
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Board privé");
  });

  it("accède à la database posée sur cette page privée", async () => {
    asOutsider();
    expect((await getDatabase(req("http://x/"), withId(privateDbId))).status).toBe(404);

    asService();
    expect((await getDatabase(req("http://x/"), withId(privateDbId))).status).toBe(200);
  });

  it("voit la page privée dans l'ARBRE — sans ça l'automatisation serait à moitié aveugle", async () => {
    asOutsider();
    const sans = await (await listPages(req(`http://x/api/pages?workspaceId=${workspaceId}`))).json();
    expect(sans.some((p: { id: string }) => p.id === privatePageId)).toBe(false);

    asService();
    const avec = await (await listPages(req(`http://x/api/pages?workspaceId=${workspaceId}`))).json();
    expect(avec.some((p: { id: string }) => p.id === privatePageId)).toBe(true);
  });

  it("retrouve la page privée dans la RECHERCHE", async () => {
    asService();
    const res = await search(req("http://x/api/search?q=Board%20priv"));
    const data = await res.json();
    const pages = (data.pages ?? data) as { id: string }[];
    expect(pages.some((p) => p.id === privatePageId)).toBe(true);
  });

  it("l'exemption NE FRANCHIT PAS la frontière d'espace : 404 hors de ses memberships", async () => {
    const autre = await seedUserWithWorkspace(`ailleurs-${Date.now()}@x.tld`);
    const pageAilleurs = await prisma.page.create({
      data: {
        title: "Ailleurs",
        workspaceId: autre.workspace.id,
        ownerId: autre.user.id,
        visibility: "private",
        position: 1000,
      },
    });

    asService();
    expect((await getPage(req("http://x/"), withId(pageAilleurs.id))).status).toBe(404);
  });
});

describe("Garde anti-dérive : aucun test de confidentialité en dur", () => {
  it("seul lib/workspace.ts compare visibility/ownerId à la main", () => {
    const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() });
    const coupables = files.filter((f) => {
      if (f.replace(/\\/g, "/").endsWith("src/lib/workspace.ts")) return false;
      const src = readFileSync(f, "utf8");
      return /visibility\s*===\s*"private"/.test(src);
    });
    // Un test réécrit à la main échapperait à l'exemption « compte de service »
    // et rendrait l'automatisation muette sur cette route précise.
    expect(coupables).toEqual([]);
  });
});
