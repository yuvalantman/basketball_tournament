import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request so the cookie-based
// session stays valid and users remain logged in on their device.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login" || path === "/signup";
  // /reset-password is reached via an emailed recovery link — the recovery
  // token lives in the URL fragment, which browsers never send to the
  // server, so this middleware can't see it and would otherwise treat the
  // visitor as logged-out and bounce them to /login before the client JS
  // gets a chance to exchange that fragment for a session.
  // /api/cron/* routes have their own CRON_SECRET bearer-token check and are
  // hit by Vercel Cron with no browser session cookie at all — never gate
  // them behind the login redirect.
  const isPublic =
    isAuthPage ||
    path === "/" ||
    path === "/forgot-password" ||
    path === "/reset-password" ||
    path.startsWith("/manifest") ||
    path.startsWith("/api/cron");

  // Gate the app behind auth: unauthenticated users go to /login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Logged-in users shouldn't sit on the auth pages.
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
