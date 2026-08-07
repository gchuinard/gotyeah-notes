import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock PARTIEL : le module exporte aussi hashToken/createSession, dont dépendent
// des chemins réels — un mock total les remplacerait par undefined.
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getSession: vi.fn(),
}));

import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PATCH as mePATCH } from "@/app/api/me/route";
import { seedUserWithWorkspace } from "../helpers/seed";

const mockGetSession = vi.mocked(getSession);

let userId: string;
let userEmail: string;
let serviceId: string;

const as = (id: string, email: string, isService = false) =>
  mockGetSession.mockResolvedValue({
    id,
    email,
    displayName: "X",
    currentWorkspaceId: null,
    isService,
  });

const patch = (body: unknown) =>
  mePATCH(
    new Request("http://localhost/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeAll(async () => {
  const seeded = await seedUserWithWorkspace(`profil-${Date.now()}@x.tld`);
  userId = seeded.user.id;
  userEmail = seeded.user.email;

  const svc = await prisma.user.create({
    data: {
      email: `profil-svc-${Date.now()}@gotyeah.local`,
      firstName: "IA",
      lastName: "",
      displayName: "IA",
      passwordHash: "x",
      isService: true,
    },
  });
  serviceId = svc.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/me — on ne modifie que soi-même", () => {
  it("401 sans session", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await patch({ displayName: "x" })).status).toBe(401);
  });

  it("met à jour le nom affiché, le prénom et le nom", async () => {
    as(userId, userEmail);
    const res = await patch({ displayName: "Ada L.", firstName: "Ada", lastName: "Lovelace" });
    expect(res.status).toBe(200);

    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u).toMatchObject({ displayName: "Ada L.", firstName: "Ada", lastName: "Lovelace" });
  });

  it("⚠️ l'EMAIL n'est jamais modifiable, même envoyé explicitement", async () => {
    // C'est la clé de liaison avec l'IdP : le callback OIDC retrouve la personne
    // par son adresse. La changer depuis notes la ferait, à la connexion
    // suivante, soit refuser (OIDC_ALLOW_SIGNUP=false), soit provisionner comme
    // un NOUVEAU compte — sans ses espaces ni ses pages privées.
    as(userId, userEmail);
    const res = await patch({ displayName: "Ada", email: "pirate@ailleurs.tld" });
    expect(res.status).toBe(200);

    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u!.email).toBe(userEmail);
  });

  it("refuse un nom affiché vide : il est le SEUL nom visible des autres", async () => {
    as(userId, userEmail);
    expect((await patch({ displayName: "   " })).status).toBe(400);
    expect((await patch({ displayName: "x".repeat(61) })).status).toBe(400);
  });

  it("refuse un corps sans aucun champ connu", async () => {
    as(userId, userEmail);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ isService: true })).status).toBe(400);
  });

  it("⚠️ 409 sur un compte de SERVICE : il n'a pas d'écran de profil", async () => {
    // Il ne se connecte jamais par l'interface, mais le pont MCP passe par
    // getSession() comme tout le monde — la garde ne peut pas reposer sur
    // l'absence d'UI.
    as(serviceId, "ia@gotyeah.local", true);
    const res = await patch({ displayName: "Pirate" });
    expect(res.status).toBe(409);

    const svc = await prisma.user.findUnique({ where: { id: serviceId } });
    expect(svc!.displayName).toBe("IA");
  });

  it("le prénom et le nom peuvent légitimement être vidés", async () => {
    // Ils ne servent qu'au provisioning IdP ; notes n'affiche que displayName.
    as(userId, userEmail);
    expect((await patch({ firstName: "", lastName: "" })).status).toBe(200);
    const u = await prisma.user.findUnique({ where: { id: userId } });
    expect(u).toMatchObject({ firstName: "", lastName: "" });
  });
});
