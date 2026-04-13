import { prisma } from "@/lib/prisma";
import EditorClient from "@/components/EditorClient";
import { notFound } from "next/navigation";

export default async function PageView({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page) notFound();

  return (
    <EditorClient
      pageId={page.id}
      initialContent={page.content}
      initialTitle={page.title}
      initialIcon={page.icon}
    />
  );
}
