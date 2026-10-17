const KEY = "readmate.token";

// Kept in memory too, so a blocked/failing localStorage still works for the current session.
let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

/** Trims and stores the token; returns it, or null (nothing saved) if it is empty. */
export function saveToken(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  memoryToken = token;
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // memory fallback above
  }
  return token;
}

export function clearToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
