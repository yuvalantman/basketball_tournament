import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client bound to the request's auth cookies (anon key,
// RLS enforced). Use this in Server Components / Server Actions to read the
// logged-in user and run RLS-bound queries.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore, the middleware
            // refreshes the session cookie.
          }
        },
      },
    },
  );
}

// auth.getUser() makes a real network round trip to Supabase Auth every time
// (unlike getSession()). Several data-fetching functions independently need
// "who's logged in" during the same request — cache() dedupes those down to
// one actual call per request/action instead of one per caller. Note: this
// only dedupes WITHIN one render pass or one server action invocation — a
// server action and the page re-render it triggers via router.refresh() are
// separate request lifecycles, so getUser() still legitimately fires once
// per phase; the win is collapsing the ~3-5x redundant calls within each.
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});

// Returns the currently logged-in user's id, or null.
export async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await getCachedUser();
  return user?.id ?? null;
}
