"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isValidUsername, normalizeUsername } from "@/lib/username";
import { Button, Input, Label, Spinner, Avatar } from "@/components/ui";
import { GENDER_LABELS, GENDER_LABELS_HE, type Gender } from "@/lib/constants";
import { useLocale } from "@/lib/i18n/LocaleContext";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function SignupPage() {
  const router = useRouter();
  const { t, locale } = useLocale();
  const genderLabels = locale === "he" ? GENDER_LABELS_HE : GENDER_LABELS;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidUsername(username)) {
      setError(t("auth.usernameFormatError"));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t("auth.emailFormatError"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    if (!gender) {
      setError(t("auth.genderRequired"));
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const uname = normalizeUsername(username);
    const realEmail = email.trim().toLowerCase();

    // 1. Create the auth user with the REAL email — you still log in with
    // just your username (see /login's resolver), this email exists so
    // "forgot password" has somewhere to send a reset link.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: realEmail,
      password,
    });
    if (signUpError || !signUpData.user) {
      setError(
        signUpError?.message?.includes("already")
          ? t("auth.emailAlreadyRegistered")
          : signUpError?.message ?? t("auth.signupFailed"),
      );
      setLoading(false);
      return;
    }
    const userId = signUpData.user.id;

    // Ensure we have a session (in case auto-confirm left us signed out).
    if (!signUpData.session) {
      await supabase.auth.signInWithPassword({
        email: realEmail,
        password,
      });
    }

    // 2. Upload photo (optional) to avatars/<uid>/...
    let photoUrl: string | null = null;
    if (photo) {
      const ext = photo.name.split(".").pop() || "jpg";
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, photo, { upsert: true });
      if (!upErr) {
        photoUrl = supabase.storage.from("avatars").getPublicUrl(path)
          .data.publicUrl;
      }
    }

    // 3. Create the profile row.
    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      username: uname,
      display_name: displayName.trim() || uname,
      email: realEmail,
      gender,
      height_cm: heightCm ? Number(heightCm) : null,
      weight_kg: weightKg ? Number(weightKg) : null,
      photo_url: photoUrl,
    });
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    router.push("/home");
    router.refresh();
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 max-w-md mx-auto w-full py-10">
      <h1 className="text-2xl font-extrabold mb-1">{t("auth.createPlayer")}</h1>
      <p className="text-[var(--muted)] mb-6">{t("auth.createPlayerSubtitle")}</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar src={photoPreview} name={displayName || username || "?"} size={72} />
          <label className="cursor-pointer">
            <span className="inline-block rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-4 py-2.5 text-sm">
              {photo ? t("auth.changePhoto") : t("auth.addPhoto")}
            </span>
            <input
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={onPhotoChange}
            />
          </label>
        </div>

        <div>
          <Label htmlFor="username">{t("auth.username")}</Label>
          <Input
            id="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="kobe24"
            required
          />
        </div>
        <div>
          <Label htmlFor="displayName">{t("auth.displayName")}</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Kobe B."
          />
        </div>
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
          <p className="text-xs text-[var(--muted)] mt-1">{t("auth.emailHint")}</p>
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordHint")}
            required
          />
        </div>
        <div>
          <Label>{t("auth.gender")}</Label>
          <div className="flex gap-2">
            {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold border transition ${
                  gender === g
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--surface-2)] border-[var(--border)]"
                }`}
              >
                {genderLabels[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="height">{t("auth.heightCm")}</Label>
            <Input
              id="height"
              type="number"
              inputMode="numeric"
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              placeholder="185"
            />
          </div>
          <div>
            <Label htmlFor="weight">{t("auth.weightKg")}</Label>
            <Input
              id="weight"
              type="number"
              inputMode="numeric"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="80"
            />
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? <Spinner /> : t("auth.signUpAndPlay")}
        </Button>
      </form>

      <p className="text-center text-[var(--muted)] mt-6">
        {t("auth.alreadyHaveAccount")}{" "}
        <Link href="/login" className="text-[var(--primary)] font-semibold">
          {t("auth.logIn")}
        </Link>
      </p>
    </main>
  );
}
