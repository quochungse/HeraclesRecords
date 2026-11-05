"""Build src/assets/share/wreath.webp, the share image's mark, from build/icon.png.

The app icon is a gold laurel on a black rounded square. A share image carries
the laurel alone, so the black ground is keyed out to transparency (alpha from
the brightness of the gold, colour divided back out so the edges keep their
gold on a light ground) and the frame inside the square's rim is cropped off.
Run again when the icon changes: npm run share-wreath:generate
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "icon.png"
TARGET = ROOT / "src" / "assets" / "share" / "wreath.webp"
SIZE = 256
# Brightness, out of 255, below which a pixel is the black ground and above
# which it is wholly the laurel; between, it is the laurel's soft edge.
GROUND, FULL = 24, 110


def main() -> None:
    icon = Image.open(SOURCE).convert("RGBA")
    flat = Image.new("RGBA", icon.size, (0, 0, 0, 255))
    flat.alpha_composite(icon)
    rgb = np.asarray(flat.convert("RGB")).astype(float)
    side = icon.size[0]
    # Everything outside an inset rounded square is the tile's rim, not the laurel.
    inset = round(side * 80 / 1024)
    keep = Image.new("L", icon.size, 0)
    ImageDraw.Draw(keep).rounded_rectangle(
        (inset, inset, side - inset, side - inset), radius=round(side * 140 / 1024), fill=255
    )
    alpha = np.clip((rgb.max(axis=2) - GROUND) / (FULL - GROUND), 0, 1) * (np.asarray(keep) > 0)
    colour = np.where(alpha[..., None] > 0, np.clip(rgb / np.maximum(alpha, 1e-3)[..., None], 0, 255), 0)
    image = Image.fromarray(np.dstack([colour, alpha * 255]).astype("uint8"), "RGBA")
    ys, xs = np.where(alpha > 0.05)
    half = (max(xs.max() - xs.min(), ys.max() - ys.min()) + 12) // 2
    cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
    image = image.crop((cx - half, cy - half, cx + half, cy + half)).resize((SIZE, SIZE), Image.LANCZOS)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    image.save(TARGET, "WEBP", quality=90, method=6)
    print(f"wrote {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
