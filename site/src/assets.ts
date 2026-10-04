// What the site draws from the app's own files, so nothing here is a copy that
// can drift: the README's screenshots (docs/readme) and the labour emblems the
// Hall of Records draws (src/assets/labours).

import type { ImageMetadata } from "astro";

const shots = import.meta.glob<{ default: ImageMetadata }>("../../docs/readme/*.webp", { eager: true });
const emblems = import.meta.glob<{ default: ImageMetadata }>("../../src/assets/labours/*.webp", { eager: true });

function pick(files: Record<string, { default: ImageMetadata }>, name: string, where: string): ImageMetadata {
  const key = Object.keys(files).find((path) => path.endsWith(`/${name}.webp`));
  if (!key) throw new Error(`No ${name}.webp in ${where}`);
  return files[key].default;
}

/** A screenshot by its file name without the extension: shot("04-run"). */
export const shot = (name: string) => pick(shots, name, "docs/readme");

/** A labour's emblem by its id: emblem("lion"). */
export const emblem = (id: string) => pick(emblems, id, "src/assets/labours");

/**
 * Text taken from the app's own strings, in the site's style: the site's copy
 * carries no em dash (test:site), and a few of the app's strings do.
 */
export const plain = (text: string) =>
  text.replace(new RegExp(`\\s+${String.fromCharCode(0x2014)}\\s+`, "g"), ", ");

/** 1.10.0 after 1.9.0: compares the numeric parts of two versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(pa.length, pb.length); index += 1) {
    const diff = (pa[index] ?? 0) - (pb[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
