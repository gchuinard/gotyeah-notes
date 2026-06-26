import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Home() {
  const user = await getSession();
  if (!user) redirect("/login");

  return (
    <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] gap-2">
      <span className="text-4xl">👋</span>
      <p className="text-sm">Sélectionne une page ou crée-en une nouvelle.</p>
    </div>
  );
}
