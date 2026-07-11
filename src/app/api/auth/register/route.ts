import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { createWorkspaceWithDefaults } from "@/lib/workspace";
import { registrationEnabled, normalizeEmail } from "@/lib/oidc";

export async function POST(req: Request) {
  // Inscription DÉCOUPLÉE du login legacy et du provisioning OIDC : off par défaut.
  if (!registrationEnabled()) {
    return NextResponse.json(
      { error: "Inscription désactivée." },
      { status: 403 },
    );
  }
  const { firstName, lastName, displayName, email, password } =
    await req.json().catch(() => ({}));

  if (!firstName || !lastName || !displayName || !email || !password) {
    return NextResponse.json({ error: "Tous les champs sont requis" }, { status: 400 });
  }
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return NextResponse.json({ error: "Le mot de passe ne respecte pas les critères" }, { status: 400 });
  }

  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    return NextResponse.json({ error: "Cet email est déjà utilisé" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { firstName, lastName, displayName, email: normalized, passwordHash },
  });

  const workspace = await createWorkspaceWithDefaults("Mon espace", user.id);

  const token = await createSession(user.id, workspace.id);

  const res = NextResponse.json({ id: user.id, email: user.email, displayName: user.displayName });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
