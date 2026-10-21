const KEY = "readmate.devMode";

// Kept in memory too, so a blocked/failing localStorage still works for the current session.
let memory = false;
const subscribers = new Set<(on: boolean) => void>();

export function getDevMode(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return memory;
  }
}

export function setDevMode(on: boolean): void {
  memory = on;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // memory fallback above
  }
  subscribers.forEach((fn) => fn(on));
}

export function subscribeDevMode(fn: (on: boolean) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
