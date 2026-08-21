from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "assets" / "cosmetics" / "capes"
for path in root.glob("*.png"):
    image = Image.open(path).convert("RGBA")
    if image.size == (64, 64):
        continue
    if image.size != (64, 32):
        raise RuntimeError(f"Unexpected texture size for {path}: {image.size}")
    atlas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    atlas.alpha_composite(image, (0, 0))
    atlas.save(path)
