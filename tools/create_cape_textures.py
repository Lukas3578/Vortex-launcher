from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "assets" / "cosmetics" / "capes"
OUT.mkdir(parents=True, exist_ok=True)

palettes = {
    "nebula-mark": ((12, 18, 48), (38, 140, 255), (177, 64, 255), (240, 245, 255)),
    "void-rune": ((10, 8, 24), (95, 35, 180), (224, 55, 190), (255, 220, 255)),
    "vortex-crest": ((8, 28, 28), (20, 190, 160), (70, 245, 220), (235, 255, 245)),
}

for name, (base, accent, highlight, white) in palettes.items():
    img = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Classic cape body occupies the 10x16 region used by the client renderer.
    for y in range(16):
        t = y / 15
        c = tuple(round(base[i] * (1 - t) + accent[i] * t * 0.45) for i in range(3)) + (255,)
        d.line((1, y + 1, 10, y + 1), fill=c)
    # Pixel-art border and center emblem.
    d.rectangle((1, 1, 10, 16), outline=highlight + (255,))
    d.line((2, 3, 9, 3), fill=white + (255,))
    d.line((2, 14, 9, 14), fill=accent + (255,))
    d.point((5, 6), fill=highlight + (255,))
    d.point((4, 7), fill=highlight + (255,))
    d.point((5, 7), fill=white + (255,))
    d.point((6, 7), fill=highlight + (255,))
    d.point((5, 8), fill=highlight + (255,))
    if name == "nebula-mark":
        d.point((3, 11), fill=white + (255,))
        d.point((8, 10), fill=white + (255,))
    elif name == "void-rune":
        d.line((3, 10, 7, 12), fill=highlight + (255,))
        d.line((7, 10, 3, 12), fill=highlight + (255,))
    else:
        d.line((3, 11, 5, 13), fill=white + (255,))
        d.line((5, 13, 8, 10), fill=white + (255,))
    img.save(OUT / f"{name}.png")
