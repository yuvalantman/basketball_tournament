"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";
import { SPORT_IDS, SPORT_LABELS, type SportId } from "@/lib/sports";
import { createGroup, joinGroup } from "@/app/actions/group";

export function HomeActions() {
  const [mode, setMode] = useState<"none" | "create" | "join">("none");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" onClick={() => setMode(mode === "create" ? "none" : "create")}>
          + New group
        </Button>
        <Button size="lg" variant="secondary" onClick={() => setMode(mode === "join" ? "none" : "join")}>
          Join by code
        </Button>
      </div>
      {mode === "create" && <CreateForm />}
      {mode === "join" && <JoinForm />}
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sport, setSport] = useState<SportId>("basketball");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await createGroup({ name, sport });
    if (res.ok) {
      const id = (res.data as { id: string }).id;
      router.push(`/group/${id}`);
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-4 mt-1">
      <div>
        <Label>Group name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friday Night Hoops" />
      </div>

      <div>
        <Label>Sport (can&apos;t be changed later)</Label>
        <div className="grid grid-cols-3 gap-2">
          {SPORT_IDS.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className={`rounded-xl py-3 text-sm font-semibold border transition ${
                sport === s
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                  : "bg-[var(--surface-2)] border-[var(--border)]"
              }`}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
        {loading ? <Spinner /> : "Create group"}
      </Button>
    </Card>
  );
}

function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await joinGroup(code);
    if (res.ok) {
      const id = (res.data as { id: string }).id;
      router.push(`/group/${id}`);
    } else {
      setError(res.error);
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-3 mt-1">
      <Label>Enter group code</Label>
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCDE"
        className="font-mono tracking-[0.3em] text-center text-lg uppercase"
        maxLength={6}
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <Button className="w-full" size="lg" onClick={submit} disabled={loading}>
        {loading ? <Spinner /> : "Join"}
      </Button>
    </Card>
  );
}
