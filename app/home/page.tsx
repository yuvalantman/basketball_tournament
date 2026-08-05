import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/data";
import { getMyGroups, type GroupSummary } from "@/app/actions/group";
import { Avatar, Badge, Card } from "@/components/ui";
import { LogoutButton } from "@/components/LogoutButton";
import { SPORT_LABELS } from "@/lib/sports";
import { HomeActions } from "./HomeActions";

export default async function HomePage() {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");

  const res = await getMyGroups();
  const groups: GroupSummary[] = res.ok ? ((res.data as { groups: GroupSummary[] }).groups ?? []) : [];

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
        Your groups
      </h2>

      {groups.length === 0 ? (
        <Card className="text-center text-[var(--muted)] py-8">
          No groups yet. Create one or join with a code.
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Link key={g.id} href={`/group/${g.id}`} prefetch>
              <Card className="flex items-center justify-between hover:border-[var(--primary)] transition">
                <div>
                  <div className="font-semibold">{g.name}</div>
                  <div className="text-xs text-[var(--muted)] mt-0.5">
                    {g.memberCount} member{g.memberCount !== 1 ? "s" : ""} · Code{" "}
                    <span className="font-mono tracking-widest">{g.code}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge>{SPORT_LABELS[g.sport]}</Badge>
                  {g.isManager && <Badge className="bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]">You manage this</Badge>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
