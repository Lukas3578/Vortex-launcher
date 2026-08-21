from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = ROOT / "assets" / "cosmetics" / "previews"
TEXTURES = ROOT / "assets" / "cosmetics" / "capes"

# The generated standalone art has a dark background and the cape centered vertically.
# The visible vanilla cape face is intentionally packed into the small 10x16 face area
# used by PlayerCapeModel; the remaining atlas stays transparent/black as required by
# the vanilla cape UV layout.
SOURCES = {
    "vortex-crest": PREVIEWS / "cape-astral-circuit-v3.png",
    "nebula-mark": PREVIEWS / "cape-frost-rift-v3.png",
    "void-rune": PREVIEWS / "cape-solar-ember-v3.png",
}

for cape_id, source_path in SOURCES.items():
    source = Image.open(source_path).convert("RGBA")
    # Crop away the large presentation background while preserving the full cape.
    crop = source.crop((250, 220, 1290, 2180))
    crop = ImageOps.fit(crop, (10, 16), method=Image.Resampling.LANCZOS, centering=(0.5, 0.52))
    crop = crop.resize((10, 16), Image.Resampling.NEAREST)

    atlas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    # Vanilla PlayerCapeModel uses the 10x16 face at UV 0,0.
    atlas.paste(crop, (0, 0))
    # Keep a subtle opaque edge and bottom detail in the adjacent pixels used by
    # cape sides in the model, without changing the face UV region.
    for y in range(16):
        atlas.putpixel((10, y), crop.getpixel((9, y)))
        atlas.putpixel((11, y), crop.getpixel((9, y)))
    for x in range(10):
        atlas.putpixel((x, 16), crop.getpixel((x, 15)))
        atlas.putpixel((x, 17), crop.getpixel((x, 15)))
    atlas.save(TEXTURES / f"{cape_id}.png")
    preview = ImageOps.contain(source, (128, 128), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (128, 128), (12, 14, 20, 255))
    canvas.alpha_composite(preview, ((128 - preview.width) // 2, (128 - preview.height) // 2))
    canvas.save(PREVIEWS / f"cape-{cape_id}.png")
