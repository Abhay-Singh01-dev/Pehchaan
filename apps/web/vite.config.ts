import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Pehchaan frontend build.
// - The service worker is our own (src/sw.ts, injectManifest): it precaches the app shell, icons and self-hosted
//   fonts (B14), and handles Web Push and notification taps (backend spec 11.5, FC-8).
// - Relay traffic never goes through the service worker cache (the simulated relay is a BroadcastChannel; the real
//   relay is a WebSocket, which service workers never see; the two signed POSTs are not cached).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/*.png", "fonts/*.woff2"],
      manifest: {
        id: "/",
        name: "Pehchaan",
        short_name: "Pehchaan",
        description: "Check it's really them. Two-factor authentication for humans.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0A0E1F",
        theme_color: "#0A0E1F",
        lang: "en",
        categories: ["security", "lifestyle", "utilities"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // Everything is self-hosted: there is no runtime caching of third-party resources.
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5180,
    strictPort: false,
    // Local development (backend spec 18.12): /relay goes to the relay on :8080, so the app and the relay share
    // one origin. The relay's RELAY_HOST must be this server's host (apps/relay/.env.development).
    proxy: {
      "/relay": {
        target: "http://127.0.0.1:8080",
        ws: true,
        rewrite: (path) => path.replace(/^\/relay/, ""),
      },
    },
  },
  preview: { port: 4180 },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});
