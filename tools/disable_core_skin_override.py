from pathlib import Path
import json
import zipfile

jar_path = Path('/home/ubuntu/Vortex-launcher/assets/modpacks/1.21.11/vortexclient-2.29.9-cosmetics.jar')
entry_name = 'vortexclient.client.mixins.json'

with zipfile.ZipFile(jar_path, 'r') as source:
    entries = {info.filename: source.read(info.filename) for info in source.infolist()}

config = json.loads(entries[entry_name].decode('utf-8'))
for key in ('client', 'mixins', 'server'):
    if isinstance(config.get(key), list):
        config[key] = [name for name in config[key] if name != 'SkinOverrideMixin']
entries[entry_name] = (json.dumps(config, indent=2) + '\n').encode('utf-8')

with zipfile.ZipFile(jar_path, 'w', compression=zipfile.ZIP_DEFLATED) as target:
    for name, data in entries.items():
        target.writestr(name, data)

print(f'Patched {jar_path.name}: SkinOverrideMixin disabled')
print('SkinOverrideMixin present:', b'SkinOverrideMixin' in entries[entry_name])
