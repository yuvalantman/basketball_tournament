"use client";

import type { Locale } from "@/lib/i18n";

// Switching locale always does a full reload (not a client-side swap):
// app/layout.tsx resolves lang/dir server-side from the cookie, so a reload
// is what guarantees every page re-renders with the correct direction and
// translated copy in one consistent pass, with zero hydration mismatch risk.
export function LocaleToggle({ locale }: { locale: Locale }) {
  const next: Locale = locale === "he" ? "en" : "he";

  function switchLocale() {
    document.cookie = `locale=${next}; path=/; max-age=31536000`;
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] rounded-full px-2.5 py-1 transition"
    >
      {locale === "he" ? "EN" : "עברית"}
    </button>
  );
}
