/**
 * Downloads the three families the app is set in — Inter, Space Grotesk and
 * Source Serif 4 — into src/assets/fonts, and writes src/fonts.css with the
 * same @font-face blocks pointing at those files.
 *
 * `npm run fonts:fetch`. It is not part of a build: the files are committed, so
 * a build never needs the network, which is the whole point of having them.
 * Google is asked for variable faces (one file covers a weight range) and for
 * three subsets — latin, latin-ext and vietnamese. Vietnamese is not optional:
 * an athlete's activity names and the coach's answers are written in it, and
 * without that subset every diacritic falls back to a system face mid-sentence.
 *
 * Re-run it when a family, a weight range or a subset changes, then look at the
 * diff: the URLs Google serves are versioned, so a re-run can bring a new cut
 * of a face as well as the change you asked for.
 */
import { writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SUBSETS = new Set(["latin", "latin-ext", "vietnamese"]);
const FAMILIES = [
  ["Inter", "Inter:wght@300..700", "inter"],
  ["Space Grotesk", "Space+Grotesk:wght@500..700", "space-grotesk"],
  ["Source Serif 4", "Source+Serif+4:opsz,wght@8..60,400..600", "source-serif-4"],
];
const blocks = [];
for (const [family, query, slug] of FAMILIES) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`, { headers: { "User-Agent": UA } })).text();
  for (const m of css.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face \{[^}]+\})/g)) {
    const [, subset, block] = m;
    if (!SUBSETS.has(subset)) continue;
    const url = block.match(/url\((https:[^)]+)\)/)[1];
    const file = `${slug}-${subset}.woff2`;
    const bytes = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
    writeFileSync(`src/assets/fonts/${file}`, bytes);
    blocks.push({ subset, family, kb: Math.round(bytes.length / 1024), css: block.replace(/url\(https:[^)]+\)/, `url("./assets/fonts/${file}")`).replace(/\n\s+/g, "\n  ") });
  }
}
const header = `/*
 * The app's three faces, carried in the build rather than fetched.
 *
 * index.html used to <link> these from fonts.googleapis.com, which means a
 * desktop app that has just been installed on a machine with no network draws
 * its whole interface in a system fallback — and that every launch asks Google
 * for a stylesheet. The files below are the same ones that link resolved to
 * (variable weights, so one file covers the range), cut to the subsets this app
 * can produce: latin, latin-ext and vietnamese, the last because an athlete's
 * own activity names and the coach's answers are written in it.
 *
 * Re-fetch with scripts/fetch-fonts.mjs if a family or a subset has to change.
 */
`;
writeFileSync("src/fonts.css", header + blocks.map((b) => `\n/* ${b.family} — ${b.subset}, ${b.kb} kB */\n${b.css}\n`).join(""));
console.log(blocks.map((b) => `${b.family} ${b.subset} ${b.kb}kB`).join("\n"));
console.log("total", blocks.reduce((n, b) => n + b.kb, 0), "kB");
