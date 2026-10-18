/** First 7 characters of the commit the bundle was built from; "dev" for local builds. */
export function shortSha(raw: string | undefined): string {
  const sha = raw?.trim();
  return sha ? sha.slice(0, 7) : "dev";
}

// Set by CI as VITE_BUILD_SHA (the full commit SHA); Vite inlines it at build time.
export const BUILD_SHA = shortSha(import.meta.env.VITE_BUILD_SHA);
