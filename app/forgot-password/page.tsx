"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Label, Spinner } from "@/components/ui";
import { requestPasswordReset } from "@/app/actions/auth";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await requestPasswordReset(username);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone((res.data as { message: string }).message);
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto w-full">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{t("auth.resetPasswordTitle")}</h1>
        <p className="text-[var(--muted)] mt-1">{t("auth.resetPasswordSubtitle")}</p>
      </div>

      {done ? (
        <p className="text-center text-green-400">{done}</p>
      ) : (
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

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Spinner /> : t("auth.sendResetLink")}
          </Button>
        </form>
      )}

      <p className="text-center text-[var(--muted)] mt-6 text-sm">{t("auth.noRecoveryEmailYet")}</p>
      <p className="text-center mt-4">
        <Link href="/login" className="text-[var(--primary)] font-semibold text-sm">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </main>
  );
}
