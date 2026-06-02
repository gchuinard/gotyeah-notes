import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import RegisterForm from "./RegisterForm";

export default async function RegisterPage() {
  const user = await getSession();
  if (user) redirect("/");
  return <RegisterForm />;
}
