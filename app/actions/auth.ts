"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUsername, usernameToEmail } from "@/lib/username";
import type { ActionResult } from "./_shared";

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Resolves which email a username should sign in with: a real email if the
// account has one on file, otherwise the legacy synthetic one (unchanged
// behavior for every account created before this feature existed). The
// client calls this before supabase.auth.signInWithPassword — the browser
// itself never has permission to read the profiles table pre-login (RLS
// requires an authenticated caller), so this small lookup has to happen
// server-side with the admin client.
export async function resolveLoginEmail(usernameInput: string): Promise<ActionResult> {
  try {
    const username = normalizeUsername(usernameInput);
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("email")
      .eq("username", username)
      .maybeSingle();
    if (!data) return { ok: false, error: "Wrong username or password." };
    return { ok: true, data: { email: data.email || usernameToEmail(username) } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Sends a password-reset link to the account's real email, if it has one.
// Always returns the same generic message regardless of whether the
// username exists or has an email on file, so this can't be used to probe
// which usernames are registered.
export async function requestPasswordReset(usernameInput: string): Promise<ActionResult> {
  try {
    const username = normalizeUsername(usernameInput);
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("email")
      .eq("username", username)
      .maybeSingle();

    if (data?.email) {
      await admin.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${siteUrl()}/reset-password`,
      });
    }

    return {
      ok: true,
      data: {
        message:
          "If that account has a recovery email on file, a reset link is on its way. Check your inbox (and spam folder).",
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
