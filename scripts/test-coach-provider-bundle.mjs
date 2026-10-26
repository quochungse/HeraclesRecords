// Verify the production import graph, since renderer behaviour alone cannot
// detect a helper import accidentally pulling the entire provider panel back
// into startup, Coach, or its conversation AI sheet.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(dist, ".vite/manifest.json"), "utf8"));
const panel = "src/chat/CoachModelsPanel.tsx";
assert.equal(manifest[panel]?.isDynamicEntry, true, "provider management must have a dynamic chunk");

function staticImports(entry, seen = new Set()) {
  assert.ok(manifest[entry], `missing build entry: ${entry}`);
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const dependency of manifest[entry].imports ?? []) staticImports(dependency, seen);
  return seen;
}

for (const entry of ["index.html", "src/chat/ChatView.tsx", "src/chat/CoachConversationSettings.tsx"]) {
  const eager = staticImports(entry);
  assert.equal(eager.has(panel), false, `${entry} must not load provider management eagerly`);
  for (const key of eager) {
    const source = fs.readFileSync(path.join(dist, manifest[key].file), "utf8");
    assert.equal(source.includes("chatgpt-account-card"), false,
      `${entry}: provider code must not be hoisted into a shared eager chunk`);
  }
}

const chunks = [...staticImports("index.html")].map((key) => {
  const source = fs.readFileSync(path.join(dist, manifest[key].file));
  return { file: manifest[key].file, bytes: source.length, gzip: gzipSync(source).length };
});
const bytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
const gzip = chunks.reduce((sum, chunk) => sum + chunk.gzip, 0);
console.log(`coach provider bundle OK — ${chunks.length} initial JS chunks, ${bytes} bytes (${gzip} gzip); provider panel deferred`);
