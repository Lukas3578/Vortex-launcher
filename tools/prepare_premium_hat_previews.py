from pathlib import Path
from PIL import Image

ROOT = Path('/home/ubuntu/Vortex-launcher')
SOURCE = ROOT / 'assets/cosmetics/generated'
TARGET = ROOT / 'assets/cosmetics/previews'
TARGET.mkdir(parents=True, exist_ok=True)

MAPPING = {
    'premium-vortex-cap-reference.png': 'hat-vortex-cap.png',
    'premium-neon-halo-reference.png': 'hat-neon-halo.png',
    'premium-void-crown-reference.png': 'hat-void-crown.png',
    'premium-cyber-headphones-reference.png': 'hat-cyber-headphones.png',
    'premium-slime-antenna-reference.png': 'hat-slime-antenna.png',
}

for source_name, target_name in MAPPING.items():
    source = SOURCE / source_name
    destination = TARGET / target_name
    with Image.open(source) as image:
        preview = image.convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
        preview.save(destination, optimize=True)
        print(f'{destination.name}: {preview.size}')
