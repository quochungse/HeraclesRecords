import glob, sys
from PIL import Image, ImageDraw
W, H, R = int(sys.argv[2]) if len(sys.argv) > 2 else 1512, 0, 11
import os
files = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames", "*.png")))
first = Image.open(files[0]); H = round(first.height * W / first.width)
s = W / 1512
mask = Image.new("L", (W * 4, H * 4), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, W * 4 - 1, H * 4 - 1), radius=R * s * 4, fill=255)
mask = mask.resize((W, H), Image.LANCZOS)
frames = []
for f in files:
    im = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=R * s, outline=(255, 255, 255, 40), width=1)
    im = im.convert("RGBA"); im.putalpha(mask)
    frames.append(im)
dur = [700] + [40] * (len(frames) - 2) + [3200]
frames[0].save(sys.argv[1], save_all=True, append_images=frames[1:], duration=dur, loop=0, quality=int(sys.argv[3]) if len(sys.argv) > 3 else 80, method=6, minimize_size=True, allow_mixed=True)
import os; print(sys.argv[1], W, H, len(frames), round(os.path.getsize(sys.argv[1]) / 1024), "KB")
