import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMembership, isPageAccessible } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import EditorClient from "@/components/EditorClient";
import VisitRecorder from "@/components/VisitRecorder";
import DatabaseShell from "@/components/databases/DatabaseShell";

export default async function PageView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSession();
  if (!user) notFound();

  const page = await prisma.page.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      content: true,
      icon: true,
      workspaceId: true,
      visibility: true,
      ownerId: true,
      trashedAt: true,
    },
  });
  if (!page || page.trashedAt) notFound(); // page en corbeille → 404

  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) notFound();
  if (!isPageAccessible(page, user.id, user.isService)) notFound();

  const database = await prisma.database.findUnique({
    where: { pageId: id },
    select: { id: true },
  });

  // Rôle résolu au SSR (membership déjà en main) → pas de flash d'UI éditable.
  const readOnly = membership.role === "viewer";
  const isAdmin = membership.role === "admin";

  return (
    <>
      <VisitRecorder pageId={page.id} />
      {database ? (
        <DatabaseShell
          databaseId={database.id}
          readOnly={readOnly}
          isAdmin={isAdmin}
          currentUserId={user.id}
          // Le rôle BRUT, en plus des deux booléens : les règles de transition
          // ciblent des rôles, et « editor » vs « viewer » est indistinguable
          // depuis readOnly/isAdmin seuls. Résolu au SSR — pas de flash.
          role={membership.role}
        />
      ) : (
        <EditorClient
          key={page.id}
          pageId={page.id}
          initialContent={page.content}
          initialTitle={page.title}
          initialIcon={page.icon}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
