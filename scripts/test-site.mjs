// Checks the website build in site/dist (run `npm run site:build` first, or
// `npm run test:site`, which does both). .github/workflows/site.yml runs this
// before every deploy.
//
// 1. /privacy.html exists at that exact path. Google's OAuth consent screen
//    links to it; a build that wrote privacy/index.html instead would leave
//    Drive sync pointing at a 404.
// 2. .nojekyll is published. GitHub Pages runs Jekyll otherwise, and Jekyll
//    drops every directory starting with an underscore, which is where Astro
//    puts every stylesheet, font and image (_astro/).
// 3. Every page links its assets from _astro/ and each one is in the build.
// 4. No em dash in the site's own copy: the README's rule, kept for the site.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "site", "dist");
const src = join(root, "site", "src");

assert.ok(existsSync(dist), "site/dist is missing: run `npm run site:build` first");

for (const file of ["index.html", "privacy.html", "404.html", ".nojekyll"]) {
  assert.ok(existsSync(join(dist, file)), `site/dist/${file} is missing`);
}
assert.ok(!existsSync(join(dist, "privacy", "index.html")), "privacy must be privacy.html, not privacy/index.html");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = walk(dist).filter((file) => file.endsWith(".html"));
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const assets = [...html.matchAll(/(?:href|src)="\/(_astro\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length > 0, `${relative(dist, page)} links no _astro asset`);
  for (const asset of assets) {
    assert.ok(existsSync(join(dist, asset)), `${relative(dist, page)} links a missing ${asset}`);
  }
}

for (const file of walk(src)) {
  const text = readFileSync(file, "utf8");
  const line = text.split("\n").findIndex((row) => row.includes("—"));
  assert.equal(line, -1, `em dash in ${relative(root, file)}:${line + 1}`);
}

console.log(`site: ${pages.length} pages checked`);
