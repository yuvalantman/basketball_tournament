"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Spinner } from "@/components/ui";
import { resolveLoginEmail } from "@/app/actions/auth";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/home";
  const { t } = useLocale();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const resolved = await resolveLoginEmail(username);
    if (!resolved.ok) {
      setError(resolved.error);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: (resolved.data as { email: string }).email,
      password,
    });
    if (error) {
      setError(t("auth.wrongCredentials"));
      setLoading(false);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto w-full">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon.svg" alt="" width={72} height={72} className="mx-auto mb-2 rounded-2xl" />
        <h1 className="text-3xl font-extrabold tracking-tight">Picked Up</h1>
        <p className="text-[var(--muted)] mt-1">{t("brand.tagline")}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="username">{t("auth.username")}</Label>
          <Input
            id="username"
            autoCapitalize="none"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("auth.usernamePlaceholder")}
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label htmlFor="password" className="mb-0">
              {t("auth.password")}
            </Label>
            <Link href="/forgot-password" className="text-xs text-[var(--primary)] font-medium">
              {t("auth.forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            required
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? <Spinner /> : t("auth.logIn")}
        </Button>
      </form>

      <p className="text-center text-[var(--muted)] mt-6">
        {t("auth.newHere")}{" "}
        <Link href="/signup" className="text-[var(--primary)] font-semibold">
          {t("auth.createAccount")}
        </Link>
      </p>
    </main>
  );
}
