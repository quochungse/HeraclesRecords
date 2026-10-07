// The site's icons at fixed addresses (/favicon.ico, /favicon-192.png,
// /apple-touch-icon.png), cut from the app's own icon at build time. Google's
// favicon crawler wants a stable URL and a square a multiple of 48px, and asks
// /favicon.ico when a page names nothing it can use; a hashed _astro/ file at
// 64px met neither. Read through process.cwd() for the reason release.mjs says:
// this runs from a bundled chunk, where import.meta.url points elsewhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const source = () => readFileSync(join(process.cwd(), "..", "build", "icon-256.png"));

export const iconPng = (size: number) =>
  sharp(source()).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An ICO holding PNG frames, which every browser and Google read. */
export async function faviconIco(sizes = [16, 32, 48]): Promise<Buffer> {
  const frames = await Promise.all(sizes.map(iconPng));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(sizes[index] % 256, entry);
    header.writeUInt8(sizes[index] % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  return Buffer.concat([header, ...frames]);
}
