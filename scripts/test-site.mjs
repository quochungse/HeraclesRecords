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
// 5-10. Installers, the version, em dashes in the build, internal links,
//    link-preview cards, the sitemap, the structured data and the domain:
//    see each check below.

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

// 5. The home page offers the installers of one release (four, or five once a
//    release ships the deb), and every page states that version in its footer
//    (release data from GitHub at build).
const home = readFileSync(join(dist, "index.html"), "utf8");
const downloads = [
  ...new Set(home.match(/href="https:\/\/github\.com\/quochungse\/HeraclesRecords\/releases\/download\/[^"]+"/g)),
].map((href) => href.match(/download\/(v[^/]+)\/([^"]+)"/));
assert.ok([4, 5].includes(downloads.length), `index.html links ${downloads.length} installers, not 4 or 5`);
const tags = new Set(downloads.map((match) => match[1]));
assert.equal(tags.size, 1, `index.html links installers of ${[...tags].join(", ")}`);
const [tag] = tags;
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  assert.ok(html.includes(`Version ${tag.slice(1)} ·`), `${relative(dist, page)} does not state version ${tag.slice(1)}`);
}

for (const file of walk(src)) {
  const text = readFileSync(file, "utf8");
  const line = text.split("\n").findIndex((row) => row.includes("—"));
  assert.equal(line, -1, `em dash in ${relative(root, file)}:${line + 1}`);
}

// 6. Nor in what the pages draw: text read from the app (labour stages) and
//    from CHANGELOG.md is put in the site's style when it is rendered.
for (const page of pages) {
  const text = readFileSync(page, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  const at = text.indexOf("—");
  assert.equal(at, -1, `em dash in ${relative(dist, page)}: …${text.slice(Math.max(0, at - 60), at + 20)}…`);
}

// 7. Every link to a page of the site lands on a page in the build, the way
//    GitHub Pages resolves it: /coach serves coach.html, /guide/ guide/index.html.
function resolves(path) {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]);
  const candidates = clean.endsWith("/")
    ? [join(dist, clean, "index.html")]
    : [join(dist, clean), join(dist, `${clean}.html`), join(dist, clean, "index.html")];
  return candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  for (const [, href] of html.matchAll(/href="(\/(?!_astro\/)[^"]*)"/g)) {
    assert.ok(resolves(href), `${relative(dist, page)} links ${href}, which is not in the build`);
  }
}
assert.ok(existsSync(join(dist, "changelog.xml")), "the release feed changelog.xml is missing");

// 8. Every page names a link-preview card that is in the build (site/public/og,
//    rendered by `npm run site:og`).
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  const card = html.match(/<meta property="og:image" content="https:\/\/[^/]+(\/og\/[^"]+\.jpg)"/)?.[1];
  assert.ok(card, `${relative(dist, page)} has no og:image`);
  assert.ok(existsSync(join(dist, card)), `${relative(dist, page)} names ${card}, which is not in the build`);
}

// 9. The sitemap lists every page but 404, and nothing that is not a page.
const sitemap = readFileSync(join(dist, "sitemap.xml"), "utf8");
const listed = [...sitemap.matchAll(/<loc>https:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((match) => match[1]);
for (const path of listed) assert.ok(resolves(path), `sitemap.xml lists ${path}, which is not in the build`);
const servedAs = (page) => {
  const path = `/${relative(dist, page).replace(/\\/g, "/")}`;
  return path === "/privacy.html" ? path : path.replace(/index\.html$/, "").replace(/\.html$/, "");
};
for (const page of pages.filter((page) => !page.endsWith("404.html"))) {
  assert.ok(listed.includes(servedAs(page)), `sitemap.xml leaves out ${servedAs(page)}`);
}
assert.match(readFileSync(join(dist, "robots.txt"), "utf8"), /Sitemap: https:\/\/.+\/sitemap\.xml/);

// 11. The custom domain is stated once each in three places and they agree:
//     CNAME (what GitHub Pages serves the site at; github.io redirects there),
//     the canonical and card addresses, and the sitemap line in robots.txt.
const cname = readFileSync(join(dist, "CNAME"), "utf8").trim();
const homeCanonical = home.match(/<link rel="canonical" href="https:\/\/([^/"]+)/)?.[1];
assert.equal(homeCanonical, cname, `CNAME says ${cname}, the pages' canonical address says ${homeCanonical}`);
assert.match(readFileSync(join(dist, "robots.txt"), "utf8"), new RegExp(`Sitemap: https://${cname.replace(/\./g, "\\.")}/sitemap\\.xml`));

// 10. The home and download pages describe the app as structured data, with
//     the version the page offers.
for (const file of ["index.html", "download.html"]) {
  const block = readFileSync(join(dist, file), "utf8").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(block, `${file} has no JSON-LD`);
  const data = JSON.parse(block);
  assert.equal(data["@type"], "SoftwareApplication");
  assert.equal(data.softwareVersion, tag.slice(1), `${file}'s JSON-LD states ${data.softwareVersion}`);
}

console.log(`site: ${pages.length} pages checked`);
