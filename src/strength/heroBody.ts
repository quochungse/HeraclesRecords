import { BufferAttribute, BufferGeometry } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { FigureSex } from "../training/body/physique";
import type { MuscleId } from "./muscles";

/**
 * The Strength hero's body, baked offline from the app's Z-Anatomy atlas.
 *
 * What was baked, so nothing here has to do it at load:
 *  - the superficial muscles only, grouped into the training groups (the abductors
 *    split off the glutes by their range in `hero.json`), the
 *    external oblique's medial aponeurosis trimmed, the intact right half kept
 *    (the page mirrors it);
 *  - the man's muscles thickened as a gym-goer's, each away from the bone under
 *    it; the woman's body reshaped to a fit woman's proportions, toned, with a
 *    bust of her own (her file alone carries it);
 *  - the skull and jaw taken out of the skeleton, a clay head for each in their
 *    place, its eyes (their front halves) in the same index list.
 *
 * Positions are int16 in the atlas's own frame (origin + q × step), padded to
 * four for meshopt's vertex codec, so the registration frame the old GLBs used
 * still places them. Each array is meshopt-coded and every file gzipped over
 * that: together they take the body from 3.0 MB to 1.4 MB.
 */
const HERO_URL = "./assets/anatomy/hero/";

/** [byte offset, byte length, element count] of one coded array in a file. */
type Block = [number, number, number];

interface HeroManifest {
  version: number;
  step: number;
  origin: [number, number, number];
  half: number;
  groups: MuscleId[];
  ranges: [number, number][];
  shared: Record<"mIdx" | "sIdx" | "cIdx", Block>;
  male: Record<string, Block>;
  female: Record<string, Block>;
}

export interface HeroBody {
  /** One geometry per training group, all sharing the mirrored vertices. */
  muscles: Map<MuscleId, BufferGeometry>;
  connective: BufferGeometry;
  skeleton: BufferGeometry;
  head: BufferGeometry;
  /** Her bust, drawn with the chest group; absent on him. */
  bust: BufferGeometry | null;
}

/** A gzipped file, read whole; a server that already decoded it is fine too. */
async function readBinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return bytes;
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function indices(file: Uint8Array, [offset, length, count]: Block): Uint32Array {
  const target = new Uint32Array(count);
  MeshoptDecoder.decodeIndexBuffer(
    new Uint8Array(target.buffer),
    count,
    4,
    file.subarray(offset, offset + length)
  );
  return target;
}

function positions(
  file: Uint8Array,
  [offset, length, count]: Block,
  manifest: HeroManifest,
  mirror: boolean
): Float32Array {
  const quantized = new Int16Array(count * 4);
  MeshoptDecoder.decodeVertexBuffer(
    new Uint8Array(quantized.buffer),
    count,
    8,
    file.subarray(offset, offset + length)
  );
  const [ox, oy, oz] = manifest.origin;
  const step = manifest.step;
  const out = new Float32Array(count * (mirror ? 6 : 3));
  for (let index = 0; index < count; index++) {
    const x = quantized[4 * index] * step + ox;
    const y = quantized[4 * index + 1] * step + oy;
    const z = quantized[4 * index + 2] * step + oz;
    out[3 * index] = x;
    out[3 * index + 1] = y;
    out[3 * index + 2] = z;
    if (mirror) {
      const mirrored = 3 * (index + count);
      out[mirrored] = -x;
      out[mirrored + 1] = y;
      out[mirrored + 2] = z;
    }
  }
  return out;
}

/** The half's triangles and their mirror image, wound back the right way round. */
function mirrored(half: Uint32Array, vertexCount: number): Uint32Array {
  const out = new Uint32Array(half.length * 2);
  out.set(half);
  for (let index = 0; index < half.length; index += 3) {
    out[half.length + index] = half[index] + vertexCount;
    out[half.length + index + 1] = half[index + 2] + vertexCount;
    out[half.length + index + 2] = half[index + 1] + vertexCount;
  }
  return out;
}

function geometry(position: Float32Array, index: Uint32Array): BufferGeometry {
  const built = new BufferGeometry();
  built.setAttribute("position", new BufferAttribute(position, 3));
  built.setIndex(new BufferAttribute(index, 1));
  built.computeVertexNormals();
  built.computeBoundingBox();
  built.computeBoundingSphere();
  return built;
}

export async function loadHeroBody(
  sex: FigureSex,
  onProgress: (progress: number | null) => void
): Promise<HeroBody> {
  const manifestResponse = await fetch(`${HERO_URL}hero.json`);
  if (!manifestResponse.ok) {
    throw new Error(`hero.json: ${manifestResponse.status}`);
  }
  const manifest = (await manifestResponse.json()) as HeroManifest;
  let done = 0;
  const track = <T,>(promise: Promise<T>) =>
    promise.then((value) => {
      done += 1;
      onProgress(done / 2);
      return value;
    });
  const [shared, own] = await Promise.all([
    track(readBinary(`${HERO_URL}shared.bin.gz`)),
    track(readBinary(`${HERO_URL}${sex}.bin.gz`)),
    MeshoptDecoder.ready
  ]);
  const blocks = manifest[sex];
  const half = manifest.half;

  // Every muscle shares one vertex buffer and one set of normals, worked out
  // over the whole surface so neighbouring groups shade as one body.
  const halfIndex = indices(shared, manifest.shared.mIdx);
  const body = geometry(positions(own, blocks.mPos, manifest, true), mirrored(halfIndex, half));
  const position = body.getAttribute("position");
  const normal = body.getAttribute("normal");
  body.setIndex(null);
  body.dispose();
  const muscles = new Map<MuscleId, BufferGeometry>();
  manifest.groups.forEach((group, groupIndex) => {
    const [start, end] = manifest.ranges[groupIndex];
    if (end <= start) {
      return;
    }
    const part = new BufferGeometry();
    part.setAttribute("position", position);
    part.setAttribute("normal", normal);
    part.setIndex(new BufferAttribute(mirrored(halfIndex.subarray(3 * start, 3 * end), half), 1));
    part.computeBoundingBox();
    part.computeBoundingSphere();
    muscles.set(group, part);
  });

  const connective = geometry(
    positions(own, blocks.cPos, manifest, false),
    indices(shared, manifest.shared.cIdx)
  );
  const skeleton = geometry(
    positions(own, blocks.sPos, manifest, false),
    indices(shared, manifest.shared.sIdx)
  );
  const head = geometry(positions(own, blocks.hPos, manifest, false), indices(own, blocks.hIdx));
  const bust =
    blocks.bPos && blocks.bIdx
      ? geometry(
          positions(own, blocks.bPos, manifest, true),
          mirrored(indices(own, blocks.bIdx), blocks.bPos[2])
        )
      : null;
  onProgress(null);
  return { muscles, connective, skeleton, head, bust };
}
