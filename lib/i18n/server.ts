import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, makeT, type Locale } from "./index";

// For Server Components (page.tsx files) that need translated text but
// aren't Client Components — reads the same cookie app/layout.tsx already
// reads, so it's always consistent with what LocaleProvider resolved for
// this request.
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  return LOCALES.includes(cookieLocale as Locale) ? (cookieLocale as Locale) : DEFAULT_LOCALE;
}

export async function getServerT() {
  const locale = await getServerLocale();
  return { locale, t: makeT(locale) };
}
