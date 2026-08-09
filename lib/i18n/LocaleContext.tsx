"use client";

import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type TFunction } from "./index";

const LocaleContext = createContext<{ locale: Locale; t: TFunction } | null>(null);

// The active locale is resolved server-side (from a cookie, see
// app/layout.tsx) and passed in here as a prop — this provider never
// switches locale itself client-side. Switching always goes through
// LocaleToggle, which sets the cookie and reloads the page, so every server
// component re-renders with the right lang/dir from the start (no flash of
// wrong direction, no client/server hydration mismatch).
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
