import data from "./languages.json";

export interface Language {
  code: string;
  english: string;
  native: string;
  dir: "ltr" | "rtl";
  mode: "translate" | "explain";
}

// JSON imports lose literal types; scripts/sync_languages.py guarantees the dir and mode values.
export const LANGUAGES: readonly Language[] = data.languages as Language[];
export const DEFAULT_TARGET: string = data.default;

export const isTargetCode = (x: unknown): x is string => LANGUAGES.some((l) => l.code === x);

export function languageFor(code: string | undefined): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES.find((l) => l.code === DEFAULT_TARGET)!;
}
