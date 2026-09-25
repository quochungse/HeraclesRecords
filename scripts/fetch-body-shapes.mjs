/**
 * Regenerates `src/calendar/bodyShapes.ts` from the `react-native-body-highlighter`
 * package (MIT).
 *
 * The exercise picker draws a human figure beside each Body part and Muscle
 * filter. The figure is that package's artwork — a body outline per view plus a
 * fill path per muscle group — and this script is how it gets into the repo.
 *
 * **The output is committed, and a build never runs this.** Same rule as
 * `fonts:fetch`: the app must build and run with no network, so the path data
 * lives in a source file rather than in `node_modules`. The package is not a
 * dependency of this project; it is pulled here, read, and thrown away.
 *
 * Run: npm run body-shapes:fetch
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = "react-native-body-highlighter";
const VERSION = "3.2.0";
const OUT = join(ROOT, "src", "calendar", "bodyShapes.ts");

/**
 * The slugs the picker needs, and nothing else.
 *
 * The package draws a whole body from its parts — hands, knees, hair — but the
 * figure here is the outline filled solid with one muscle group lit on top, so
 * every other slug would be bytes the renderer never paints. Both views are
 * taken for each slug that has both: a body part lights whichever view shows
 * more of it, so "Arms" needs triceps from the front and "Legs" needs
 * adductors from the back.
 */
const WANTED = [
  "chest",
  "upper-back",
  "trapezius",
  "lower-back",
  "deltoids",
  "biceps",
  "triceps",
  "forearm",
  "abs",
  "obliques",
  "gluteal",
  "quadriceps",
  "hamstring",
  "adductors",
  "calves",
  "neck"
];

const workDir = mkdtempSync(join(tmpdir(), "body-shapes-"));

function cleanup() {
  rmSync(workDir, { recursive: true, force: true });
}

try {
  console.log(`fetching ${PACKAGE}@${VERSION}…`);
  execFileSync("npm", ["pack", `${PACKAGE}@${VERSION}`, "--silent"], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "inherit"]
  });
  const tarball = readdirSync(workDir).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");
  execFileSync("tar", ["xzf", tarball], { cwd: workDir, stdio: "inherit" });

  const pkg = join(workDir, "package");
  const require = createRequire(join(pkg, "index.js"));
  const front = require("./dist/assets/bodyFront.js").bodyFront;
  const back = require("./dist/assets/bodyBack.js").bodyBack;
  const license = readFileSync(join(pkg, "LICENSE"), "utf8").trim();

  /*
   * The body outline is drawn by the wrapper component rather than filed under
   * a slug, so it is read out of the JSX by its accessibility label. Stroked
   * there; filled here, which is what turns it into a silhouette.
   */
  const wrapper = readFileSync(join(pkg, "dist", "components", "SvgMaleWrapper.js"), "utf8");
  const outlineOf = (side) => {
    const marker = `accessibilityLabel="male-body-outline-${side}"`;
    const at = wrapper.indexOf(marker);
    if (at < 0) throw new Error(`no outline for the ${side} view`);
    const open = wrapper.lastIndexOf(' d="', at);
    const close = wrapper.indexOf('"', open + 4);
    if (open < 0 || close < 0) throw new Error(`could not read the ${side} outline path`);
    return wrapper.slice(open + 4, close);
  };

  const shapesOf = (list) => {
    const out = {};
    for (const entry of list) {
      if (!WANTED.includes(entry.slug)) continue;
      const paths = [...(entry.path?.left ?? []), ...(entry.path?.right ?? [])];
      if (paths.length > 0) out[entry.slug] = paths;
    }
    return out;
  };

  const shapes = { front: shapesOf(front), back: shapesOf(back) };
  const missing = WANTED.filter(
    (slug) => !shapes.front[slug] && !shapes.back[slug]
  );
  if (missing.length > 0) {
    throw new Error(`the package no longer carries: ${missing.join(", ")}`);
  }

  const banner = `/**
 * Human-figure artwork for the exercise picker's Body part and Muscle filters.
 *
 * **Generated. Do not edit — run \`npm run body-shapes:fetch\`.**
 *
 * Taken from ${PACKAGE}@${VERSION}, which is not a dependency of this
 * project: the paths are copied in so the app builds and runs with no network,
 * the same reason the three typefaces are committed under src/assets/fonts.
 * Only the sixteen muscle groups this app files exercises under are kept, plus
 * the body outline for each view — the figure is that outline filled solid
 * with one group lit on top, so the package's other slugs (hands, knees, hair)
 * would be bytes nothing paints.
 *
 * Upstream: https://github.com/HichamELBSI/react-native-body-highlighter
 *
 * ---------------------------------------------------------------------------
${license.split("\n").map((line) => ` * ${line}`.trimEnd()).join("\n")}
 * ---------------------------------------------------------------------------
 */

export type BodyView = "front" | "back";

/** The package's own frames. The back view is offset one body to the right. */
export const BODY_VIEW_BOX: Readonly<Record<BodyView, string>> = {
  front: "0 0 724 1448",
  back: "724 0 724 1448"
};

/** The silhouette. Stroked upstream; filled here. */
export const BODY_OUTLINE: Readonly<Record<BodyView, string>> = {
  front: ${JSON.stringify(outlineOf("front"))},
  back: ${JSON.stringify(outlineOf("back"))}
};

/** Fill paths per muscle slug, per view. A slug is absent from a view it has none on. */
export const BODY_SHAPES: Readonly<Record<BodyView, Readonly<Record<string, readonly string[]>>>> = ${JSON.stringify(shapes, null, 2)};
`;

  writeFileSync(OUT, banner);
  const bytes = Buffer.byteLength(banner);
  const counts = Object.entries(shapes)
    .map(([view, slugs]) => `${view} ${Object.keys(slugs).length}`)
    .join(", ");
  console.log(`wrote src/calendar/bodyShapes.ts — ${counts} slugs, ${(bytes / 1024).toFixed(1)} kB`);
} finally {
  cleanup();
}
