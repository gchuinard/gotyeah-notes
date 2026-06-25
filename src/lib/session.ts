import { cookies } from "next/headers";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "session_token";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  currentWorkspaceId: string | null;
};

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: token },
    select: {
      expiresAt: true,
      currentWorkspaceId: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  });

  if (!session || session.expiresAt < new Date()) return null;

  let currentWorkspaceId = session.currentWorkspaceId;
  if (!currentWorkspaceId) {
    const membership = await prisma.membership.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    currentWorkspaceId = membership?.workspaceId ?? null;
  }

  return { ...session.user, currentWorkspaceId };
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await prisma.session.create({
    data: {
      id: token,
      userId,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    },
  });
  return token;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { id: token } });
}
