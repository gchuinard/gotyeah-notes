import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

// Mock PARTIEL : seul getSession est simulé. Le module exporte aussi hashToken
// et createSession, dont dépendent des chemins réels (ex. les jetons de
// connexion par email) — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { GET as getPage } from "@/app/api/pages/[id]/route";
import { GET as listPages } from "@/app/api/pages/route";
import { GET as getDatabase, PATCH as patchDatabase } from "@/app/api/databases/[id]/route";
import { POST as createDatabase } from "@/app/api/databases/route";
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
const jsonReq = (body: unknown, method = "POST") =>
  new Request("http://x/", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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

describe("POST /api/databases — conversion d'une page privée", () => {
  async function pagePrivee(title: string) {
    return prisma.page.create({
      data: { title, workspaceId, ownerId: owner.id, visibility: "private", position: 1000 },
    });
  }

  it("un membre non-propriétaire reçoit 404, le compte de service convertit", async () => {
    const refusee = await pagePrivee("À convertir (refus)");
    asOutsider();
    expect(
      (await createDatabase(jsonReq({ pageId: refusee.id }))).status
    ).toBe(404);

    const acceptee = await pagePrivee("À convertir (service)");
    asService();
    expect((await createDatabase(jsonReq({ pageId: acceptee.id }))).status).toBe(201);
  });
});

describe("PATCH /api/databases/[id] — mapping « Patch notes » vers une page privée", () => {
  it("un membre non-propriétaire reçoit 400, le compte de service mappe", async () => {
    // La database vit sur une page d'ÉQUIPE : sans ça le 404 d'accès masquerait
    // le contrôle qu'on veut tester.
    const hote = await prisma.page.create({
      data: { title: "Board équipe", workspaceId, ownerId: owner.id, visibility: "team", position: 2000 },
    });
    const db = await prisma.database.create({ data: { pageId: hote.id } });
    const cible = await prisma.page.create({
      data: { title: "📓 Patch notes", workspaceId, ownerId: owner.id, visibility: "private", position: 3000 },
    });

    asOutsider();
    const refus = await patchDatabase(
      jsonReq({ patchNotesPageId: cible.id }, "PATCH"),
      withId(db.id)
    );
    expect(refus.status).toBe(400);

    asService();
    const ok = await patchDatabase(
      jsonReq({ patchNotesPageId: cible.id }, "PATCH"),
      withId(db.id)
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).patchNotesPageId).toBe(cible.id);
  });
});

describe("Garde anti-dérive : aucun test de confidentialité en dur", () => {
  it("tout appel aux helpers de confidentialité passe son argument isService", () => {
    // Le garde ci-dessous n'attrape que les tests RÉÉCRITS à la main. Il est aveugle
    // à l'omission la plus facile : appeler le bon helper en oubliant son dernier
    // argument, qui vaut `false` par défaut — le compte de service redevient alors
    // un membre ordinaire, en silence. C'est ce qui est arrivé aux deux routes de
    // app/api/databases/ au lot C.
    const ARITE_MINIMALE = { isPageAccessible: 3, pageVisibilityFilter: 2 };
    const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() });
    const fautifs: string[] = [];

    for (const f of files) {
      if (f.replace(/\\/g, "/").endsWith("src/lib/workspace.ts")) continue;
      const src = readFileSync(f, "utf8");
      for (const [, nom, args] of src.matchAll(
        /\b(isPageAccessible|pageVisibilityFilter)\(((?:[^()]|\([^()]*\))*)\)/g
      )) {
        // Neutralise les parenthèses internes pour ne compter que les virgules
        // de premier niveau (`opts.isService ?? false` en contient parfois).
        const arite = args.replace(/\([^()]*\)/g, "").split(",").length;
        const attendue = ARITE_MINIMALE[nom as keyof typeof ARITE_MINIMALE];
        if (arite < attendue) fautifs.push(`${f} → ${nom}(${args.trim()})`);
      }
    }
    expect(fautifs).toEqual([]);
  });

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
