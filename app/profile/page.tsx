import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyProfile } from "@/lib/data";
import { getServerT } from "@/lib/i18n/server";
import { ProfileEditor } from "./ProfileEditor";

export default async function ProfilePage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");
  const { t } = await getServerT();

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-24 pt-6">
      <header className="flex items-center justify-between mb-6">
        <Link href="/home" className="text-[var(--muted)]">
          {t("common.back")}
        </Link>
        <h1 className="font-bold">{t("profile.yourProfile")}</h1>
        <span className="w-12" />
      </header>
      <ProfileEditor profile={profile} />
    </main>
  );
}
