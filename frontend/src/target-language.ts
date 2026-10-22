import { DEFAULT_TARGET, isTargetCode } from "./languages";

const KEY = "readmate.targetLanguage";

// Kept in memory too, so a blocked/failing localStorage still works for the current session.
let memory = DEFAULT_TARGET;
// After a failed save, storage no longer reflects the choice; memory is the source of truth.
let saveFailed = false;

export function getTargetLanguage(): string {
  if (saveFailed) return memory;
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
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}
