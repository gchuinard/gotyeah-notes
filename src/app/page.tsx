import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function Home() {
  const first = await prisma.page.findFirst({ orderBy: { createdAt: "asc" } });
  if (first) redirect(`/pages/${first.id}`);
  return (
    <div className="p-12 text-gray-500 text-sm">
      Crée ta première page depuis la sidebar ←
    </div>
  );
}
