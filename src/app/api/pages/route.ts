import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const pages = await prisma.page.findMany({
    orderBy: [{ position: "asc" }],
    select: { id: true, title: true, icon: true, parentId: true, position: true },
  });
  return NextResponse.json(pages);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { parentId = null, title = "Sans titre" } = body;

  const last = await prisma.page.findFirst({
    where: { parentId },
    orderBy: { position: "desc" },
  });
  const position = (last?.position ?? 0) + 1;

  const page = await prisma.page.create({
    data: { title, parentId, position },
  });
  return NextResponse.json(page);
}
