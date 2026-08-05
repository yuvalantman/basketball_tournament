import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getGamedayDetail, getGroup, getMyProfile, getRoster } from "@/lib/data";
import { GamedayRealtimeRefresh } from "@/components/RealtimeRefresh";
import { GamedayView } from "./GamedayView";

export default async function GamedayPage({ params }: { params: Promise<{ id: string; gid: string }> }) {
  const { id, gid } = await params;
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const group = await getGroup(id);
  if (!group) notFound();

  const detail = await getGamedayDetail(gid);
  if (!detail || detail.gameday.group_id !== id) notFound();

  const roster = await getRoster(id);

  const isManager = detail.gameday.creator_id === profile.id || group.creator_id === profile.id;

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-28 pt-5">
      <header className="flex items-center justify-between mb-1">
        <Link href={`/group/${id}`} className="text-[var(--muted)] text-sm" prefetch>
          ← {group.name}
        </Link>
        <span className="w-12" />
      </header>
      <h1 className="font-bold text-xl mb-4">{detail.gameday.name}</h1>

      <GamedayRealtimeRefresh gamedayId={gid} />

      <GamedayView
        group={group}
        detail={detail}
        roster={roster}
        myUserId={profile.id}
        isManager={isManager}
      />
    </main>
  );
}
