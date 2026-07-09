import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMembership } from "@/lib/workspace";
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
    },
  });
  if (!page) notFound();

  const membership = await getMembership(user.id, page.workspaceId);
  if (!membership) notFound();
  if (page.visibility === "private" && page.ownerId !== user.id) notFound();

  const database = await prisma.database.findUnique({
    where: { pageId: id },
    select: { id: true },
  });

  return (
    <>
      <VisitRecorder pageId={page.id} />
      {database ? (
        <DatabaseShell databaseId={database.id} />
      ) : (
        <EditorClient
          key={page.id}
          pageId={page.id}
          initialContent={page.content}
          initialTitle={page.title}
          initialIcon={page.icon}
        />
      )}
    </>
  );
}
