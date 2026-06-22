// Username <-> synthetic email mapping.
//
// Supabase Auth wants an email; our users only ever type a username + password.
// We deterministically derive a never-delivered email from the username so we
// get Supabase's secure session handling for free. The domain is configurable
// and irrelevant — no mail is ever sent to it.

const DOMAIN = process.env.NEXT_PUBLIC_APP_EMAIL_DOMAIN || "hoops.local";

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${DOMAIN}`;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9_]{3,20}$/.test(normalizeUsername(username));
}
