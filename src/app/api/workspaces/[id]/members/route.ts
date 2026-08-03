import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getMembership, hasRole } from "@/lib/workspace";
import { normalizeEmail } from "@/lib/oidc";

const addMemberSchema = z.object({
  email: z.string().email(),
  // Moindre privilège : lecteur par défaut, l'admin élève explicitement.
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

const memberSelect = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { email: true, displayName: true } },
} as const;

type MemberRow = {
  userId: string;
  role: string;
  createdAt: Date;
  user: { email: string; displayName: string };
};

const toMember = (m: MemberRow) => ({
  userId: m.userId,
  role: m.role,
  email: m.user.email,
  displayName: m.user.displayName,
  createdAt: m.createdAt,
});

/** Liste des membres de l'espace — ouverte à tout membre (afficher qui est là). */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const members = await prisma.membership.findMany({
    where: { workspaceId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(members.map(toMember));
}

/** Ajout d'un compte EXISTANT par email (pas d'envoi d'email en v1) — admin. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!hasRole(membership, "admin")) {
    return NextResponse.json({ error: "Rôle insuffisant" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  // L'appelant est un admin authentifié : erreur explicite, pas d'anti-énumération ici.
  if (!target) {
    return NextResponse.json(
      { error: "Utilisateur introuvable — le compte doit d'abord exister (connexion GotYeah)." },
      { status: 404 }
    );
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: target.id, workspaceId } },
    select: { userId: true },
  });
  if (existing) {
    return NextResponse.json({ error: "Déjà membre de cet espace" }, { status: 409 });
  }

  // role TOUJOURS explicite : Membership.role a @default("admin") en schéma —
  // un create qui l'omettrait fabriquerait un admin silencieux.
  const created = await prisma.membership.create({
    data: { userId: target.id, workspaceId, role: parsed.data.role },
    select: memberSelect,
  });
  return NextResponse.json(toMember(created));
}
