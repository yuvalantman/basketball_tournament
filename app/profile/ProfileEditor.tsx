"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { cmToFeet, GENDER_LABELS, GENDER_LABELS_HE, type Gender } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { useLocale } from "@/lib/i18n/LocaleContext";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function ProfileEditor({ profile }: { profile: Profile }) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const genderLabels = locale === "he" ? GENDER_LABELS_HE : GENDER_LABELS;
  const [displayName, setDisplayName] = useState(profile.display_name);
  const [email, setEmail] = useState(profile.email ?? "");
  const [gender, setGender] = useState<Gender | null>(profile.gender);
  const [heightCm, setHeightCm] = useState(profile.height_cm?.toString() ?? "");
  const [weightKg, setWeightKg] = useState(profile.weight_kg?.toString() ?? "");
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photo_url);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();

    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setError(t("profile.emailInvalid"));
      setSaving(false);
      return;
    }

    let photoUrl = profile.photo_url;
    if (photo) {
      const ext = photo.name.split(".").pop() || "jpg";
      const path = `${profile.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, photo, { upsert: true });
      if (!upErr)
        photoUrl = supabase.storage.from("avatars").getPublicUrl(path).data
          .publicUrl;
    }

    // Adding/changing a real email here also becomes this account's actual
    // sign-in email (needed for "forgot password" to have somewhere to send
    // a reset link) — updateUser keeps auth.users in sync with profiles.
    if (cleanEmail && cleanEmail !== (profile.email ?? "")) {
      const { error: emailErr } = await supabase.auth.updateUser({ email: cleanEmail });
      if (emailErr) {
        setError(emailErr.message);
        setSaving(false);
        return;
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim() || profile.username,
        email: cleanEmail || null,
        gender,
        height_cm: heightCm ? Number(heightCm) : null,
        weight_kg: weightKg ? Number(weightKg) : null,
        photo_url: photoUrl,
      })
      .eq("id", profile.id);

    if (error) setError(error.message);
    else {
      setSaved(true);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar src={photoPreview} name={displayName} size={80} />
        <label className="cursor-pointer">
          <span className="inline-block rounded-xl bg-[var(--surface-2)] border border-[var(--border)] px-4 py-2.5 text-sm">
            {t("profile.changePhoto")}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
        </label>
      </div>

      <div>
        <Label>{t("profile.username")}</Label>
        <Input value={`@${profile.username}`} disabled />
      </div>
      <div>
        <Label>{t("profile.email")}</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <p className="text-xs text-[var(--muted)] mt-1">
          {profile.email ? t("profile.emailHintHas") : t("profile.emailHintMissing")}
        </p>
      </div>
      <div>
        <Label>{t("profile.displayName")}</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div>
        <Label>{t("profile.gender")}</Label>
        <div className="flex gap-2">
          {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
            <button
              key={g}
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
          <Label>{t("profile.heightCm")}{heightCm ? ` · ${cmToFeet(Number(heightCm))}` : ""}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("profile.weightKg")}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {saved && <p className="text-green-400 text-sm">{t("common.saved")}</p>}
      <Button className="w-full" size="lg" onClick={save} disabled={saving}>
        {saving ? <Spinner /> : t("profile.saveProfile")}
      </Button>
    </Card>
  );
}
