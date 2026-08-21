from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/cosmetics/generated/vortex-astral-full-pattern-presentation.png"
TEXTURES = ROOT / "assets/cosmetics/capes"
PREVIEWS = ROOT / "assets/cosmetics/previews"
GENERATED = ROOT / "assets/cosmetics/generated"

# Rectangle containing the complete flat cape from the generated presentation.
CAPE_BOUNDS = (137, 219, 2383, 1194)
DARK_PALETTE = ((15, 35, 112, 255), (20, 47, 137, 255), (31, 41, 130, 255), (38, 33, 118, 255))
CAPE_IDS = ("vortex-crest", "nebula-mark", "void-rune")


def pattern_fill(pixel, x, y):
    r, g, b, a = pixel
    # No visually black or empty regions are allowed inside the in-game cape face.
    if a < 200 or max(r, g, b) < 55:
        tone = DARK_PALETTE[((x // 2) + (y // 3) + (x // 7)) % len(DARK_PALETTE)]
        return tone
    return (r, g, b, 255)


def make_opaque_pattern(surface):
    output = surface.convert("RGBA")
    for y in range(output.height):
        for x in range(output.width):
            output.putpixel((x, y), pattern_fill(output.getpixel((x, y)), x, y))
    return output


source = Image.open(SOURCE).convert("RGBA")
full = source.crop(CAPE_BOUNDS)
# This file is the full, inspectable 64×32 art version of the same cape design.
full_texture = full.resize((64, 32), Image.Resampling.NEAREST)
full_texture = make_opaque_pattern(full_texture)
full_texture.save(GENERATED / "vortex-astral-full-pattern-64x32.png")

# The fixed vanilla-style renderer maps the cape's visible back face to a 10×16 UV area
# in a 64×64 atlas. The complete design is compressed deliberately so the cyan vortex
# remains visible from distance while every pixel is patterned rather than black.
front = full_texture.resize((10, 16), Image.Resampling.BOX).convert("RGBA")
front = make_opaque_pattern(front)

for cape_id in CAPE_IDS:
    # The Minecraft cuboid can address multiple UV rectangles for its front, back,
    # both narrow sides, top and bottom. Fill the COMPLETE 64×64 atlas with the
    # same opaque Astral Vortex tile first, then every possible renderer UV lookup
    # has colored pixels rather than a transparent/black fallback.
    atlas = Image.new("RGBA", (64, 64), (0, 0, 0, 255))
    for y in range(64):
        for x in range(64):
            atlas.putpixel((x, y), front.getpixel((x % front.width, y % front.height)))

    # Preserve a coherent primary motif on the conventional front/back cape faces.
    atlas.paste(front, (1, 1))
    atlas.paste(front.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (12, 1))
    atlas.save(TEXTURES / f"{cape_id}.png")

    # Launcher card: a square, fully patterned preview without a black cape surface.
    preview = full_texture.resize((128, 64), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (128, 128), (25, 45, 126, 255))
    canvas.paste(preview, (0, 32))
    canvas.save(PREVIEWS / f"cape-{cape_id}.png")

print("Generated full-pattern Minecraft atlases and launcher previews.")
