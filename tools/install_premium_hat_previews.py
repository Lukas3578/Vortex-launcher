from pathlib import Path
from PIL import Image

root = Path('/home/ubuntu/Vortex-launcher')
source_dir = root / 'assets' / 'cosmetics' / 'generated'
target_dir = root / 'assets' / 'cosmetics' / 'previews'

assets = {
    'hat-vortex-cap-3d-reference.png': 'hat-vortex-cap.png',
    'hat-neon-halo-3d.png': 'hat-neon-halo.png',
    'hat-void-crown-3d.png': 'hat-void-crown.png',
    'hat-cyber-headphones-3d.png': 'hat-cyber-headphones.png',
    'hat-slime-antenna-3d.png': 'hat-slime-antenna.png',
}

for source_name, target_name in assets.items():
    source = source_dir / source_name
    target = target_dir / target_name
    image = Image.open(source).convert('RGBA')
    # Keep the generated voxel forms crisp when the launcher displays them at card scale.
    image = image.resize((128, 128), Image.Resampling.NEAREST)
    image.save(target, optimize=True)
    print(f'{source_name} -> {target_name}: {image.size}')
