import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyProfile } from "@/lib/data";
import { ProfileEditor } from "./ProfileEditor";

export default async function ProfilePage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-24 pt-6">
      <header className="flex items-center justify-between mb-6">
        <Link href="/home" className="text-[var(--muted)]">
          ← Back
        </Link>
        <h1 className="font-bold">Your profile</h1>
        <span className="w-12" />
      </header>
      <ProfileEditor profile={profile} />
    </main>
  );
}
