/**
 * Bundles the renderer harness (scripts/renderer-harness) into dist-harness/,
 * so the Electron driver can load it off disk with no dev server running.
 *
 * Built in **development** mode deliberately. The production React build drops
 * the warnings that say a component is looping, keying badly or setting state
 * after unmount — and "read the console, not just the DOM" is the lesson this
 * harness exists to act on (section 11).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// `vite build` stamps NODE_ENV=production before it resolves the config, and
// that — not `mode` — is what decides `import.meta.env.DEV` and which React
// build the bare `react-dom/client` import resolves to.
process.env.NODE_ENV = "development";

await build({
  configFile: false,
  root: path.join(repoRoot, "scripts", "renderer-harness"),
  mode: "development",
  // file:// in the hidden window, so every asset URL has to be relative.
  base: "./",
  plugins: [react()],
  define: { "process.env.NODE_ENV": '"development"' },
  build: {
    outDir: path.join(repoRoot, "dist-harness"),
    emptyOutDir: true,
    minify: false,
    // A readable stack in a failing assertion is worth more than a small file.
    sourcemap: true
  },
  logLevel: "warn"
});

console.log("renderer harness built");
