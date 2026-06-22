import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile, getMyTournaments } from "@/lib/data";
import { Avatar, Badge, Card } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { STATUS_LABELS } from "@/lib/constants";
import { HomeActions } from "./HomeActions";

export default async function HomePage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");
  const tournaments = await getMyTournaments();

  return (
    <main className="max-w-md mx-auto w-full px-4 pb-24 pt-6">
      <header className="flex items-center justify-between mb-6">
        <Link href="/profile" className="flex items-center gap-3">
          <Avatar src={profile.photo_url} name={profile.display_name} size={44} />
          <div>
            <div className="font-semibold leading-tight">{profile.display_name}</div>
            <div className="text-xs text-[var(--muted)]">@{profile.username}</div>
          </div>
        </Link>
        <LogoutButton />
      </header>

      <HomeActions />

      <h2 className="text-sm font-semibold text-[var(--muted)] mt-8 mb-3 uppercase tracking-wide">
        Your tournaments
      </h2>

      {tournaments.length === 0 ? (
        <Card className="text-center text-[var(--muted)] py-8">
          No tournaments yet. Create one or join with a code.
        </Card>
      ) : (
        <div className="space-y-3">
          {tournaments.map((t) => (
            <Link key={t.id} href={`/tournament/${t.id}`}>
              <Card className="flex items-center justify-between hover:border-[var(--primary)] transition">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">
                    Code <span className="font-mono tracking-widest">{t.code}</span>
                  </div>
                </div>
                <Badge>{STATUS_LABELS[t.status]}</Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
