import { en } from "./locales/en";
import { he } from "./locales/he";

export type Locale = "en" | "he";
export const LOCALES: Locale[] = ["en", "he"];
export const DEFAULT_LOCALE: Locale = "en";

export const dictionaries: Record<Locale, typeof en> = { en, he };

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "he" ? "rtl" : "ltr";
}

type Dict = typeof en;
// Every leaf value in the dictionary as a dotted path, e.g. "group.tabPlayers".
type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? DotPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];
export type TranslationKey = DotPaths<Dict>;

function resolve(dict: Dict, path: string): string | undefined {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = dict;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

// Simple {varName} interpolation — no ICU/plural-rule engine. Pluralized
// strings use explicit _one/_other keys in the dictionary (see pluralKey)
// since English and Hebrew pluralize very differently (Hebrew often changes
// the word itself, not just the numeral), so a generic rule wouldn't help.
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `{${key}}`));
}

export function makeT(locale: Locale) {
  const dict = dictionaries[locale];
  return function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const raw = resolve(dict, key) ?? resolve(dictionaries[DEFAULT_LOCALE], key) ?? key;
    return interpolate(raw, vars);
  };
}

export type TFunction = ReturnType<typeof makeT>;

// Picks "<base>_one" for count === 1, "<base>_other" otherwise. Use with
// keys that have both variants defined in the dictionary, e.g.
// t(pluralKey(count, "players.playersCount"), { n: count }).
export function pluralKey(count: number, base: string): TranslationKey {
  return `${base}_${count === 1 ? "one" : "other"}` as TranslationKey;
}
