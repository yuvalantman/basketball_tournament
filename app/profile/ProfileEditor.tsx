"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Button, Card, Input, Label, Spinner } from "@/components/ui";
import { cmToFeet } from "@/lib/constants";
import type { Profile } from "@/lib/types";

export function ProfileEditor({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.display_name);
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

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim() || profile.username,
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
            Change photo
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
        </label>
      </div>

      <div>
        <Label>Username</Label>
        <Input value={`@${profile.username}`} disabled />
      </div>
      <div>
        <Label>Display name</Label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Height (cm){heightCm ? ` · ${cmToFeet(Number(heightCm))}` : ""}</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
        </div>
        <div>
          <Label>Weight (kg)</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {saved && <p className="text-green-400 text-sm">Saved!</p>}
      <Button className="w-full" size="lg" onClick={save} disabled={saving}>
        {saving ? <Spinner /> : "Save profile"}
      </Button>
    </Card>
  );
}
