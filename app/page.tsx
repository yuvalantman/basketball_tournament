import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/supabase/server";

export default async function RootPage() {
  const userId = await getCurrentUserId();
  redirect(userId ? "/home" : "/login");
}
