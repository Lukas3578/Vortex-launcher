from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "assets" / "cosmetics" / "generated"
TEXTURES = ROOT / "assets" / "cosmetics" / "capes"
PREVIEWS = ROOT / "assets" / "cosmetics" / "previews"

# Bounds of each complete, flat cape rectangle inside the 2560×1440 generation.
DESIGNS = {
    "nebula-mark": {
        "source": GENERATED / "nebula-full-pattern-presentation.png",
        "bounds": (60, 100, 2500, 1195),
        "preview_background": (55, 16, 92, 255),
        "minimum_visible": (32, 10, 55),
    },
    "void-rune": {
        "source": GENERATED / "void-full-pattern-presentation.png",
        "bounds": (70, 102, 2490, 1205),
        "preview_background": (20, 21, 26, 255),
        "minimum_visible": (11, 12, 18),
    },
}


def normalize(surface, minimum):
    """Keep every texture pixel opaque; Void may be black-looking but never transparent."""
    image = surface.convert("RGBA")
    out = Image.new("RGBA", image.size)
    min_r, min_g, min_b = minimum
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, _ = image.getpixel((x, y))
            # Lift only fully empty generation pixels into a very dark patterned tone.
            if r < min_r and g < min_g and b < min_b:
                variation = ((x * 5 + y * 3) % 4) * 4
                out.putpixel((x, y), (min_r + variation, min_g + variation, min_b + variation, 255))
            else:
                out.putpixel((x, y), (r, g, b, 255))
    return out


for cape_id, spec in DESIGNS.items():
    source = Image.open(spec["source"]).convert("RGBA")
    full = source.crop(spec["bounds"])
    full_texture = normalize(full.resize((64, 32), Image.Resampling.NEAREST), spec["minimum_visible"])
    full_texture.save(GENERATED / f"{cape_id}-full-pattern-64x32.png")

    # Minecraft's cape cuboid accesses several UV rectangles. Fill all 4,096 atlas
    # pixels by tiling the same 10×16 motif, so front, back, side strips and edges
    # are all patterned during cape motion.
    face = normalize(full_texture.resize((10, 16), Image.Resampling.BOX), spec["minimum_visible"])
    atlas = Image.new("RGBA", (64, 64), (0, 0, 0, 255))
    for y in range(64):
        for x in range(64):
            atlas.putpixel((x, y), face.getpixel((x % face.width, y % face.height)))
    # Conventional broad cape faces contain the primary motif in normal/mirrored form.
    atlas.paste(face, (1, 1))
    atlas.paste(face.transpose(Image.Transpose.FLIP_LEFT_RIGHT), (12, 1))
    atlas.save(TEXTURES / f"{cape_id}.png")

    preview = full_texture.resize((128, 64), Image.Resampling.NEAREST)
    card = Image.new("RGBA", (128, 128), spec["preview_background"])
    card.paste(preview, (0, 32))
    card.save(PREVIEWS / f"cape-{cape_id}.png")
    print(f"Created {cape_id} Minecraft atlas and launcher preview.")
