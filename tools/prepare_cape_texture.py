from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "assets/cosmetics/generated/nebula-cape-art.png"
out = ROOT / "assets/cosmetics/capes/nebula-mark.png"

img = Image.open(source).convert("RGBA")
p = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = p[x, y]
        # Remove the temporary chroma background and any green fringe.
        if g > 145 and g > r * 1.35 and g > b * 1.20:
            p[x, y] = (0, 0, 0, 0)

alpha = img.getchannel("A")
bbox = alpha.getbbox()
if bbox is None:
    raise RuntimeError("Generated cape has no visible pixels")
art = img.crop(bbox)
# Keep the full subject without distortion; the visible cape target is 10x16 pixels.
art.thumbnail((10, 16), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (10, 16), (0, 0, 0, 0))
x = (10 - art.width) // 2
y = (16 - art.height) // 2
canvas.alpha_composite(art, (x, y))
# Minecraft's vanilla cape model samples the first 10x16 region of a 64x64 atlas.
texture = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
texture.alpha_composite(canvas, (0, 0))
texture.save(out)
