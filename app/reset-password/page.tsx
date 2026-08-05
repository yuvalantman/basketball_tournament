"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Spinner } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Clicking the emailed reset link lands here with a recovery token in
    // the URL; the browser client exchanges it for a temporary session and
    // fires this specific event. If nothing arrives after a few seconds
    // (bad/expired link), tell the user instead of leaving a blank form.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    const timer = setTimeout(() => {
      setReady((r) => {
        if (!r) setExpired(true);
        return r;
      });
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/home");
      router.refresh();
    }, 1500);
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto w-full">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">Set a new password</h1>
      </div>

      {expired && !ready ? (
        <p className="text-center text-[var(--muted)]">
          This reset link is invalid or has expired. Request a new one from the{" "}
          <a href="/forgot-password" className="text-[var(--primary)] font-semibold">
            forgot password
          </a>{" "}
          page.
        </p>
      ) : done ? (
        <p className="text-center text-green-400">Password updated — taking you home…</p>
      ) : !ready ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="at least 6 characters"
              required
            />
          </div>
          <div>
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={saving}>
            {saving ? <Spinner /> : "Save new password"}
          </Button>
        </form>
      )}
    </main>
  );
}
