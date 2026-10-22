import { DEFAULT_TARGET, isTargetCode } from "./languages";

const KEY = "readmate.targetLanguage";

// Kept in memory too, so a blocked/failing localStorage still works for the current session.
let memory = DEFAULT_TARGET;

export function getTargetLanguage(): string {
  try {
    const stored = localStorage.getItem(KEY);
    return isTargetCode(stored) ? stored : DEFAULT_TARGET;
  } catch {
    return memory;
  }
}

export function setTargetLanguage(code: string): void {
  if (!isTargetCode(code)) return;
  memory = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // memory fallback above
  }
}
