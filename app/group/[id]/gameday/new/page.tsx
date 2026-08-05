import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getGroup, getMyProfile, getRoster } from "@/lib/data";
import { getMissingRatingsBanner } from "@/app/actions/stats";
import { NewGamedayForm } from "./NewGamedayForm";

export default async function NewGamedayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const group = await getGroup(id);
  if (!group) notFound();

  const roster = await getRoster(id);
  const missing = await getMissingRatingsBanner(
    id,
    roster.map((p) => p.id),
  );

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-28 pt-5">
      <header className="flex items-center justify-between mb-4">
        <Link href={`/group/${id}`} className="text-[var(--muted)] text-sm">
          ← {group.name}
        </Link>
        <h1 className="font-bold">New gameday</h1>
        <span className="w-12" />
      </header>

      <NewGamedayForm
        groupId={id}
        sport={group.sport}
        myUserId={profile.id}
        roster={roster}
        missingByUserId={Object.fromEntries((missing?.items ?? []).map((m) => [m.userId, m]))}
      />
    </main>
  );
}
