"""Build build/icon.icns from a square PNG source.

The macOS path (scripts/generate-icons.mjs) shells out to sips and iconutil.
Neither exists off macOS, so this writes the ICNS container directly: it emits
the same nine chunks iconutil does (TOC plus ic07-ic14), each holding an
optimised PNG.
"""
from __future__ import annotations

import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

# (chunk type, pixel size) — mirrors what `iconutil -c icns` produces.
CHUNKS = [
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
]


def _png(source: Image.Image, size: int) -> bytes:
    resized = source.resize((size, size), Image.LANCZOS)
    buffer = BytesIO()
    resized.save(buffer, format="PNG", optimize=True, compress_level=9)
    return buffer.getvalue()


def build_icns(source_path: Path, target_path: Path) -> None:
    source = Image.open(source_path).convert("RGBA")
    if source.width != source.height:
        raise SystemExit(f"Icon source must be square, got {source.width}x{source.height}")

    payloads = [(kind, _png(source, size)) for kind, size in CHUNKS]

    # The table of contents lists every following chunk's type and total length.
    toc_body = b"".join(kind + struct.pack(">I", len(data) + 8) for kind, data in payloads)
    toc = b"TOC " + struct.pack(">I", len(toc_body) + 8) + toc_body
    body = toc + b"".join(
        kind + struct.pack(">I", len(data) + 8) + data for kind, data in payloads
    )

    target_path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    build_dir = Path(__file__).resolve().parent.parent / "build"
    source_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else build_dir / "icon.png"
    if not source_path.exists():
        raise SystemExit(f"Icon source not found: {source_path}")

    icns_path = build_dir / "icon.icns"
    build_icns(source_path, icns_path)
    print(f"Generated {icns_path} ({icns_path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
