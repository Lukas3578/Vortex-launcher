from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "assets" / "cosmetics" / "previews"
for stem in ("cape-nebula-mark", "cape-void-rune", "hat-vortex-cap"):
    source = root / f"{stem}-v2.png"
    target = root / f"{stem}.png"
    if source.exists():
        image = Image.open(source).convert("RGBA")
        image = image.resize((128, 128), Image.Resampling.LANCZOS)
        image.save(target)
