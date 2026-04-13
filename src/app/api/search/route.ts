import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length < 1) return NextResponse.json([]);

  const pages = await prisma.page.findMany({
    where: {
      OR: [
        { title: { contains: q } },
        { content: { contains: q } },
      ],
    },
    select: { id: true, title: true, icon: true, parentId: true },
    take: 12,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(pages);
}
