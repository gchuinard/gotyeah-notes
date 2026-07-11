import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import { _resetRateLimit, RATE_LIMIT_MAX_FAILURES } from "@/lib/rateLimit";

const PW = "Abcdef1!ghij";
let email: string;

beforeAll(async () => {
  email = `known-${Date.now()}@x.tld`;
  await prisma.user.create({
    data: { email, firstName: "a", lastName: "b", displayName: "c", passwordHash: await bcrypt.hash(PW, 12) },
  });
});
beforeEach(() => _resetRateLimit());
afterAll(async () => { await prisma.$disconnect(); });

function loginReq(e: string, p: string, ip = "9.9.9.9") {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: e, password: p }),
  });
}

describe("POST /api/auth/login — durcissement", () => {
  it("bon mot de passe → 200 + cookie de session", async () => {
    const res = await loginPOST(loginReq(email, PW));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token=");
  });

  it("email inconnu ET mauvais mot de passe → même 401, même message (anti-énumération)", async () => {
    const unknown = await loginPOST(loginReq(`nobody-${Date.now()}@x.tld`, "whatever"));
    const wrong = await loginPOST(loginReq(email, "mauvais"));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("email en casse mixte → résout le même compte (normalisation)", async () => {
    const res = await loginPOST(loginReq(email.toUpperCase(), PW));
    expect(res.status).toBe(200);
  });

  it("trop d'échecs sur la même clé IP+email → 429 (avant bcrypt), Retry-After présent", async () => {
    const ip = "5.5.5.5";
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES; i++) {
      expect((await loginPOST(loginReq(email, "faux", ip))).status).toBe(401);
    }
    const blocked = await loginPOST(loginReq(email, "faux", ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // une autre IP n'est pas bloquée
    expect((await loginPOST(loginReq(email, "faux", "6.6.6.6"))).status).toBe(401);
  });

  it("un login réussi efface le compteur d'échecs", async () => {
    const ip = "7.7.7.7";
    for (let i = 0; i < RATE_LIMIT_MAX_FAILURES - 1; i++) await loginPOST(loginReq(email, "faux", ip));
    expect((await loginPOST(loginReq(email, PW, ip))).status).toBe(200); // succès → reset
    // après reset, on peut à nouveau échouer sans être immédiatement bloqué
    expect((await loginPOST(loginReq(email, "faux", ip))).status).toBe(401);
  });
});

describe("POST /api/auth/register — inscription off par défaut", () => {
  it("REGISTRATION non défini → 403, aucun User créé", async () => {
    delete process.env.REGISTRATION;
    const before = await prisma.user.count();
    const res = await registerPOST(new Request("http://localhost/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "a", lastName: "b", displayName: "c", email: `new-${Date.now()}@x.tld`, password: PW }),
    }));
    expect(res.status).toBe(403);
    expect(await prisma.user.count()).toBe(before);
  });

  it("REGISTRATION=on → 201 + email normalisé", async () => {
    process.env.REGISTRATION = "on";
    const e = `New-${Date.now()}@X.TLD`;
    const res = await registerPOST(new Request("http://localhost/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: "a", lastName: "b", displayName: "c", email: e, password: PW }),
    }));
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { email: e.trim().toLowerCase() } })).not.toBeNull();
    delete process.env.REGISTRATION;
  });
});
