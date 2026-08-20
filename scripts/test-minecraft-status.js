const { getMinecraftServerStatus } = require('../src/minecraft-status');

async function main() {
  const result = await getMinecraftServerStatus('mc.vortexpvp.eu');
  console.log(JSON.stringify({
    online: result.online,
    description: result.description,
    hasFavicon: result.hasFavicon,
    players: result.players,
    version: result.version,
    latency: result.latency,
    error: result.error || null
  }, null, 2));
  if (!result.online || !result.hasFavicon) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
