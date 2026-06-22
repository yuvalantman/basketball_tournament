"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client (anon key, RLS-bound). Session is persisted in
// cookies so users stay logged in on their device across visits.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
