// Runs under Electron because this repo's Node is built without Amaro and
// cannot strip types; activityChannels imports i18n and runSurface without an
// extension, so the resolver hook comes along too.
//
// The channel chart wears COROS's hues, which crowd the warm half of the wheel
// (red, orange, amber, lime, green), so whether two lines drawn together can be
// told apart rests on lightness — and on nothing but a claim in a comment until
// this suite. It holds the pairs `activityChannels.ts` says it holds, in both
// themes: OKLab ΔE (×100) of at least 15 to normal vision and 8 under protan
// and deutan simulation (Machado, Oliveira & Fernandes 2009, severity 1), and
// every stroke at 3:1 against the panel it is drawn on.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { activityChannelColors } = await import(
  `${pathToFileURL(path.join(repoRoot, "src", "training", "activityChannels.ts")).href}?cacheBust=${Date.now()}`
);

const NORMAL_MIN = 15;
const CVD_MIN = 8;
const CONTRAST_MIN = 3;

// The lightest ground a line sits on in each theme: a dark panel lifted by its
// glass, and paper's white card.
const PANEL = { dark: "#1c2024", paper: "#ffffff" };

const LINE_CHANNELS = [
  "pace",
  "adjustedPace",
  "speed",
  "hr",
  "cadence",
  "power",
  "strideLength",
  "groundTime",
  "verticalOscillation",
  "verticalRatio",
  "verticalSpeed"
];

// Heart rate sits beside every channel; the rest are the pairs a chart can
// open on or be switched to on one sport. Pace and speed share a colour and
// are never offered together, so each pair of pace's is speed's too.
const HELD_PAIRS = [
  ...LINE_CHANNELS.filter((key) => key !== "hr").map((key) => ["hr", key]),
  ["pace", "adjustedPace"],
  ["pace", "power"],
  ["pace", "cadence"],
  ["pace", "verticalSpeed"],
  ["speed", "power"],
  ["speed", "cadence"],
  ["speed", "verticalSpeed"],
  ["adjustedPace", "power"],
  ["adjustedPace", "verticalSpeed"],
  ["power", "cadence"],
  ["power", "verticalSpeed"],
  ["cadence", "verticalSpeed"],
  // Stride ratio is the one form figure read beside how fast the run went.
  ["verticalRatio", "pace"],
  ["verticalRatio", "adjustedPace"],
  ["verticalRatio", "power"],
  ["verticalRatio", "cadence"],
  ["verticalRatio", "strideLength"],
  ["verticalRatio", "verticalSpeed"]
];

const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998]
];
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881]
];

function linearRgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is a six-digit hex colour`);
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

function simulate(matrix, rgb) {
  return matrix.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
}

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function deltaE(a, b) {
  const [x, y] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function contrast(a, b) {
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const [hi, lo] = [luminance(linearRgb(a)), luminance(linearRgb(b))].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

for (const theme of ["dark", "paper"]) {
  const palette = activityChannelColors(theme);

  for (const key of LINE_CHANNELS) {
    const ratio = contrast(palette[key].stroke, PANEL[theme]);
    assert.ok(
      ratio >= CONTRAST_MIN,
      `${theme}: ${key} (${palette[key].stroke}) reads at ${ratio.toFixed(2)}:1 on ${PANEL[theme]}, under ${CONTRAST_MIN}:1`
    );
  }

  assert.equal(palette.speed.stroke, palette.pace.stroke, `${theme}: speed wears pace's colour`);

  for (const [a, b] of HELD_PAIRS) {
    const [x, y] = [linearRgb(palette[a].stroke), linearRgb(palette[b].stroke)];
    const seen = {
      normal: deltaE(x, y),
      protan: deltaE(simulate(PROTAN, x), simulate(PROTAN, y)),
      deutan: deltaE(simulate(DEUTAN, x), simulate(DEUTAN, y))
    };
    const figures = `normal ${seen.normal.toFixed(1)}, protan ${seen.protan.toFixed(1)}, deutan ${seen.deutan.toFixed(1)}`;
    assert.ok(seen.normal >= NORMAL_MIN, `${theme}: ${a} and ${b} sit too close (${figures})`);
    assert.ok(seen.protan >= CVD_MIN, `${theme}: ${a} and ${b} merge under protan simulation (${figures})`);
    assert.ok(seen.deutan >= CVD_MIN, `${theme}: ${a} and ${b} merge under deutan simulation (${figures})`);
  }
}

console.log("activity channel colour tests passed");
