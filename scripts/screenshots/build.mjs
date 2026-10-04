import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  configFile: false, root: here, mode: "production", base: "./",
  plugins: [react()], publicDir: path.join(here, "../../public"),
  build: { outDir: path.join(here, "dist"), emptyOutDir: true, minify: false, sourcemap: false, chunkSizeWarningLimit: 99999 },
  logLevel: "warn"
});
console.log("built");
