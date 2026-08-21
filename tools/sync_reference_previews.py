from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
previews = root / 'assets' / 'cosmetics' / 'previews'
for cape_id in ('vortex-crest', 'nebula-mark', 'void-rune'):
    source = previews / f'cape-{cape_id}-final.png'
    target = previews / f'cape-{cape_id}.png'
    image = Image.open(source).convert('RGBA')
    image.thumbnail((128, 128), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (128, 128), (13, 18, 27, 255))
    canvas.alpha_composite(image, ((128 - image.width) // 2, (128 - image.height) // 2))
    canvas.save(target)
