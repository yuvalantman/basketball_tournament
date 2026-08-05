import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getGamedaysForGroup, getGroup, getMyProfile, getMyRatedSet, getRoster } from "@/lib/data";
import { getPlayerCards } from "@/app/actions/stats";
import { GroupRealtimeRefresh } from "@/components/RealtimeRefresh";
import { GroupView } from "./GroupView";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const group = await getGroup(id);
  if (!group) notFound();

  const isManager = group.creator_id === profile.id;

  const [roster, ratedSet, playerCards, gamedays] = await Promise.all([
    getRoster(id),
    getMyRatedSet(id),
    getPlayerCards(id),
    getGamedaysForGroup(id),
  ]);

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-28 pt-5">
      <header className="flex items-center justify-between mb-4">
        <Link href="/home" className="text-[var(--muted)] text-sm" prefetch>
          ← Home
        </Link>
        <h1 className="font-bold truncate max-w-[60%]">{group.name}</h1>
        <span className="w-12" />
      </header>

      <GroupRealtimeRefresh groupId={id} />

      <GroupView
        group={group}
        isManager={isManager}
        myUserId={profile.id}
        roster={roster}
        ratedIds={[...ratedSet]}
        playerCards={playerCards ?? []}
        gamedays={gamedays}
      />
    </main>
  );
}
