"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usernameToEmail, isValidUsername, normalizeUsername } from "@/lib/username";
import { Button, Input, Label, Spinner, Avatar } from "@/components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
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
      setError("Username must be 3–20 chars: letters, numbers, underscore.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const uname = normalizeUsername(username);

    // 1. Create the auth user (synthetic email from username).
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: usernameToEmail(uname),
      password,
    });
    if (signUpError || !signUpData.user) {
      setError(
        signUpError?.message?.includes("already")
          ? "That username is taken."
          : signUpError?.message ?? "Could not sign up.",
      );
      setLoading(false);
      return;
    }
    const userId = signUpData.user.id;

    // Ensure we have a session (in case auto-confirm left us signed out).
    if (!signUpData.session) {
      await supabase.auth.signInWithPassword({
        email: usernameToEmail(uname),
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
      <h1 className="text-2xl font-extrabold mb-1">Create your player</h1>
      <p className="text-[var(--muted)] mb-6">
        Your photo &amp; stats show up when teammates rate you.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar src={photoPreview} name={displayName || username || "?"} size={72} />
          <label className="cursor-pointer">
            <span className="inline-block rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-4 py-2.5 text-sm">
              {photo ? "Change photo" : "Add photo"}
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
          <Label htmlFor="username">Username</Label>
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
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Kobe B."
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="height">Height (cm)</Label>
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
            <Label htmlFor="weight">Weight (kg)</Label>
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
          {loading ? <Spinner /> : "Sign up & play"}
        </Button>
      </form>

      <p className="text-center text-[var(--muted)] mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-[var(--primary)] font-semibold">
          Log in
        </Link>
      </p>
    </main>
  );
}
