import { cookies, headers } from "next/headers";
import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "session_token";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Le token de session vit en clair dans le cookie mais n'est JAMAIS stocké en clair :
 * on n'enregistre que son sha256 (Session.id = hashToken(token)). Une fuite de la table
 * Session ne permet donc pas de forger une session. ⚠️ Ce changement de stockage
 * invalide les sessions émises avant lui (déconnexion unique — décision assumée au cadrage).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  currentWorkspaceId: string | null;
};

async function firstWorkspaceId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  return membership?.workspaceId ?? null;
}

async function userFromSessionToken(token: string): Promise<SessionUser | null> {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    select: {
      expiresAt: true,
      currentWorkspaceId: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { id } }); // purge à la volée
    return null;
  }

  const currentWorkspaceId =
    session.currentWorkspaceId ?? (await firstWorkspaceId(session.user.id));
  return { ...session.user, currentWorkspaceId };
}

/**
 * Appel de confiance du serveur MCP (pont OIDC). Le MCP distant, déjà authentifié
 * par l'IdP Pocket ID, agit au nom d'un utilisateur via deux en-têtes :
 *   X-MCP-Secret    secret partagé (== MCP_SHARED_SECRET), comparé en temps constant
 *   X-Act-As-Email  email vérifié par l'IdP → mappé sur un User EXISTANT (sinon null)
 * Entièrement désactivé tant que MCP_SHARED_SECRET n'est pas défini → aucune surface
 * supplémentaire en l'absence de configuration.
 */
async function getServiceUser(): Promise<SessionUser | null> {
  const secret = process.env.MCP_SHARED_SECRET;
  if (!secret) return null;

  const h = await headers();
  const provided = h.get("x-mcp-secret");
  const email = h.get("x-act-as-email");
  if (!provided || !email) return null;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const user = await prisma.user.findUnique({
    where: { email: email.trim() },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) return null;

  return { ...user, currentWorkspaceId: await firstWorkspaceId(user.id) };
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const user = await userFromSessionToken(token);
    if (user) return user;
  }
  return getServiceUser();
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function createSession(
  userId: string,
  currentWorkspaceId: string | null = null
): Promise<string> {
  const token = crypto.randomUUID();
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      currentWorkspaceId,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    },
  });
  // Purge opportuniste des sessions expirées (à chaque login ; peu coûteux via @@index([expiresAt])).
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return token;
}

/** Met à jour le workspace courant d'une session, à partir de son token clair (haché en interne). */
export async function setSessionWorkspace(token: string, workspaceId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: hashToken(token) },
    data: { currentWorkspaceId: workspaceId },
  });
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
