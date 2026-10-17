import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  let apiOrigin = "";
  try {
    apiOrigin = env.VITE_API_URL ? new URL(env.VITE_API_URL).origin : "";
  } catch {
    // no valid API URL configured: nothing extra to exclude
  }

  return {
    test: { environment: "jsdom" },
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icons/apple-touch-icon-180.png"],
        manifest: {
          name: "WortTap",
          short_name: "WortTap",
          description: "Tap any word on a photographed German page.",
          display: "standalone",
          start_url: "/",
          theme_color: "#2563eb",
          background_color: "#fafafa",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "icons/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // App shell only; the API is never cached.
          globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
          navigateFallback: "index.html",
          // A RegExp, not a closure: it is serialized into the service worker, where a captured
          // variable like `apiOrigin` would not exist.
          runtimeCaching: apiOrigin
            ? (["GET", "POST"] as const).map((method) => ({
                urlPattern: new RegExp(`^${escapeRegExp(apiOrigin)}/`),
                handler: "NetworkOnly" as const,
                method,
              }))
            : [],
        },
      }),
    ],
  };
});
