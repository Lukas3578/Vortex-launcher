const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const main = read('src/main.js');
const renderer = read('src/renderer.js');
const html = read('src/index.html');
const css = read('src/styles.css');

const checks = [
  ['v0.9.17 package version', packageJson.version === '0.9.17'],
  ['v0.9.17 visible build', html.includes('BUILD 0.9.17') && html.includes('VORTEX CLIENT 0.9.17') && renderer.includes('Launcher 0.9.17 ready')],
  ['refreshable sign-in token', main.includes('auth: token.mclc(true)')],
  ['pre-launch session refresh', main.includes('const authorization = await refreshMinecraftAuthorization(account);') && main.includes('authorization, root: instance.root')],
  ['legacy session reauthentication', main.includes('one-time reauthentication') && main.includes('return (await signInToMinecraft()).auth')],
  ['renewed token persistence', main.includes('minecraft?.mclc?.(true)')],
  ['validated Modrinth icon host', main.includes("url.hostname === 'cdn.modrinth.com'")],
  ['bounded local icon cache', main.includes("const modImagesRoot") && main.includes('image.length > 3 * 1024 * 1024')],
  ['hash lookup for existing mods', main.includes('async function mapInstalledModrinthFile') && main.includes('/version_file/${hash}?algorithm=sha1')],
  ['installed views use cached artwork', renderer.includes('mod.iconData') && renderer.includes('installed-row-art')],
  ['English number formatting', !renderer.includes("toLocaleString('de-DE')") && renderer.includes("toLocaleString('en-GB')")],
  ['English CSS comments', !css.includes('Automatische Wartung') && !css.includes('Mehrfachkonto-Verwaltung')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (failed.length) process.exitCode = 1;
