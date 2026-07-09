import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  isPageAccessible,
  checkDatabaseAccess,
  checkPropertyAccess,
  checkRecordAccess,
  checkViewAccess,
  checkSprintAccess,
} from "@/lib/workspace";
import { seedUserWithWorkspace } from "../helpers/seed";

// Crée une page + sa database + une property/view/record/sprint, en une passe.
async function makeDbStack(
  workspaceId: string,
  ownerId: string | null,
  visibility: "team" | "private"
) {
  const page = await prisma.page.create({
    data: { title: "Page test", workspaceId, ownerId, visibility, position: 1000 },
  });
  const database = await prisma.database.create({ data: { pageId: page.id } });
  const property = await prisma.databaseProperty.create({
    data: { databaseId: database.id, name: "Titre", type: "title", position: 1000, config: JSON.stringify({ type: "title" }) },
  });
  const view = await prisma.view.create({
    data: { databaseId: database.id, name: "Vue", type: "table", position: 1000, config: "{}" },
  });
  const record = await prisma.record.create({
    data: { databaseId: database.id, title: "Record", position: 1000, properties: "{}" },
  });
  const sprint = await prisma.sprint.create({
    data: { databaseId: database.id, name: "Sprint", state: "future", position: 1000 },
  });
  return { page, database, property, view, record, sprint };
}

describe("isPageAccessible", () => {
  it("refuse une page privée à un non-propriétaire, accepte le reste", () => {
    expect(isPageAccessible({ visibility: "private", ownerId: "A" }, "A")).toBe(true);
    expect(isPageAccessible({ visibility: "private", ownerId: "A" }, "B")).toBe(false);
    expect(isPageAccessible({ visibility: "private", ownerId: null }, "A")).toBe(false);
    expect(isPageAccessible({ visibility: "team", ownerId: "A" }, "B")).toBe(true);
  });
});

describe("check*Access — isolation des databases sur pages privées", () => {
  let A: string;
  let B: string;
  let workspaceId: string;

  beforeAll(async () => {
    const seeded = await seedUserWithWorkspace(`owner-${Date.now()}@x.tld`);
    A = seeded.user.id;
    workspaceId = seeded.workspace.id;
    const b = await prisma.user.create({
      data: { email: `member-${Date.now()}@x.tld`, firstName: "B", lastName: "B", displayName: "B", passwordHash: "x" },
    });
    B = b.id;
    await prisma.membership.create({ data: { userId: B, workspaceId, role: "admin" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("database sur page PRIVÉE de A : A accède (non null), B refusé (null) sur les 5 helpers", async () => {
    const s = await makeDbStack(workspaceId, A, "private");

    expect(await checkDatabaseAccess(s.database.id, A)).not.toBeNull();
    expect(await checkPropertyAccess(s.property.id, A)).not.toBeNull();
    expect(await checkRecordAccess(s.record.id, A)).not.toBeNull();
    expect(await checkViewAccess(s.view.id, A)).not.toBeNull();
    expect(await checkSprintAccess(s.sprint.id, A)).not.toBeNull();

    expect(await checkDatabaseAccess(s.database.id, B)).toBeNull();
    expect(await checkPropertyAccess(s.property.id, B)).toBeNull();
    expect(await checkRecordAccess(s.record.id, B)).toBeNull();
    expect(await checkViewAccess(s.view.id, B)).toBeNull();
    expect(await checkSprintAccess(s.sprint.id, B)).toBeNull();
  });

  it("database sur page TEAM : B (membre) accède", async () => {
    const s = await makeDbStack(workspaceId, A, "team");
    expect(await checkDatabaseAccess(s.database.id, B)).not.toBeNull();
    expect(await checkRecordAccess(s.record.id, B)).not.toBeNull();
  });

  it("database sur page privée ownerId=null : refusée même au propriétaire supposé", async () => {
    const s = await makeDbStack(workspaceId, null, "private");
    expect(await checkDatabaseAccess(s.database.id, A)).toBeNull();
    expect(await checkDatabaseAccess(s.database.id, B)).toBeNull();
  });
});
