import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client. SERVER ONLY — bypasses RLS, so it must never
// be imported into client code. Used for privileged aggregate computation
// (peer-rating averages, team balancing, brackets) where we deliberately read
// rows that RLS hides from clients, then return only the allowed fields.
//
// The `server-only` import above makes the build fail if this ever gets
// pulled into a client bundle.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
