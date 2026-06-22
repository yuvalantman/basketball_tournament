import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  getGames,
  getMyProfile,
  getMyRatedSet,
  getRestrictions,
  getRoster,
  getTeams,
  getTournament,
} from "@/lib/data";
import { getPlayerStats } from "@/app/actions/stats";
import { RealtimeRefresh } from "@/components/RealtimeRefresh";
import { TournamentView } from "./TournamentView";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const tournament = await getTournament(id);
  if (!tournament) notFound();

  const isCreator = tournament.creator_id === profile.id;

  const [roster, restrictions, teams, games, ratedSet, playerStats] =
    await Promise.all([
      getRoster(id),
      isCreator ? getRestrictions(id) : Promise.resolve([]),
      getTeams(id),
      getGames(id),
      getMyRatedSet(id),
      getPlayerStats(id),
    ]);

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-28 pt-5">
      <header className="flex items-center justify-between mb-4">
        <Link href="/home" className="text-[var(--muted)] text-sm">
          ← Home
        </Link>
        <h1 className="font-bold truncate max-w-[60%]">{tournament.name}</h1>
        <span className="w-12" />
      </header>

      <RealtimeRefresh tournamentId={id} />

      <TournamentView
        tournament={tournament}
        isCreator={isCreator}
        myUserId={profile.id}
        roster={roster}
        restrictions={restrictions}
        teams={teams}
        games={games}
        ratedIds={[...ratedSet]}
        playerStats={playerStats ?? []}
      />
    </main>
  );
}
