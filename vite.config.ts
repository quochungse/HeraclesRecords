import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The packaged page's Content-Security-Policy, as a meta tag written into the
 * built index.html only — the dev server runs inline scripts and a websocket
 * of its own, and a policy in the source would break it.
 *
 * What it buys is the script line: nothing runs that did not ship in the
 * bundle, so a string that ever reached the DOM cannot become code. The rest is
 * as wide as the app needs. Images come from many hosts (map tiles, COROS
 * avatars), so `img-src` takes any https — and plain http, because an image
 * runs nothing; MapLibre and the Draco decoder start workers from blobs; the
 * decoder needs `wasm-unsafe-eval`; React writes inline styles.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https: data: blob:",
  "media-src 'self' data: blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "heracles-content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend"
      }
    ]
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Electron preparation and TypeScript builds write hundreds of generated
    // files while the renderer is running. Watching those outputs can trigger
    // a reload during dependency optimization, leaving the browser with stale
    // hashed React URLs and Vite's "Outdated Optimize Dep" 504 response.
    watch: {
      ignored: [
        "**/bin/**",
        "**/dist/**",
        "**/dist-electron/**",
        "**/dist-harness/**"
      ]
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "three-vendor",
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
              maxSize: 450 * 1024,
            },
            {
              name: "map-vendor",
              test: /node_modules[\\/]leaflet[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
