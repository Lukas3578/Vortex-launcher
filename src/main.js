const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { Client } = require('minecraft-launcher-core');
const { Auth, tokenUtils } = require('msmc');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createAiStudio } = require('./ai-studio');
const { getMinecraftServerStatus } = require('./minecraft-status');

const execFileAsync = promisify(execFile);

const FIXED_MEMORY = { min: '2G', max: '4G' };
const SUPPORTED_VERSIONS = ['1.21.11', '26.1.1', '26.1.2', '26.2'];
const COSMETICS_MOD_VERSION = '1.21.11';
const HATS = ['none', 'vortex-cap', 'neon-halo', 'void-crown', 'cyber-headphones', 'slime-antenna'];
const EMBLEMS = ['none', 'vortex-crest', 'nebula-mark', 'void-rune'];
const BUNDLED_TEXTURED_CAPES = new Set(EMBLEMS.filter(id => id !== 'none'));
let mainWindow;
const minecraftProcesses = new Map();
let account = null;
let accounts = [];
let updateState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: null, progress: 0, error: null };
let instanceMaintenanceTimer = null;
let instanceMaintenanceRunning = false;
let updateCheckTimer = null;
let updateCheckInFlight = false;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
let lastMaintenance = { checkedAt: null, repairedVersions: [] };
const serverStatusCache = new Map();
const serverStatusPending = new Map();
const SERVER_STATUS_CACHE_MS = 90 * 1000;

const dataRoot = path.join(app.getPath('appData'), 'Vortex Client');
const instancesRoot = path.join(dataRoot, 'instances');
const accountFile = path.join(dataRoot, 'account.json');
const stateFile = path.join(dataRoot, 'launcher-state.json');
const customVersionsFile = path.join(dataRoot, 'minecraft-versions.json');
const newsFile = path.join(dataRoot, 'release-news.json');
const serversFile = path.join(dataRoot, 'servers.json');
const profileImagesRoot = path.join(dataRoot, 'profile-images');
const modImagesRoot = path.join(dataRoot, 'mod-images');
const aiStudio = createAiStudio({ dataRoot, instanceRoot, supportedVersions: SUPPORTED_VERSIONS, safeStorage });

const OFFICIAL_SERVER = Object.freeze({ id: 'official-vortexpvp', name: 'VortexPvP', address: 'mc.vortexpvp.eu', official: true });

const RELEASE_NEWS = [
  {
    version: '0.9.69',
    title: 'Universal Minecraft Versions',
    summary: 'Use any Minecraft release with automatic Fabric provisioning and metadata-driven Modrinth pack instances.',
    items: [
      'The version selector now accepts valid Minecraft releases beyond the bundled Vortex Client versions.',
      'Versions without a Vortex core mod launch as clean Fabric instances instead of being blocked.',
      'Imported and downloaded MRPACK files read dependencies.minecraft and provision their exact release automatically.',
      'Every modpack remains isolated under instances/modpacks with its own launchable game directory.'
    ]
  },
  {
    version: '0.9.64',
    title: 'Launcher Stability Update',
    summary: 'Fixed startup rendering, restored Community and made fullscreen controls reliable.',
    items: [
      'The Community section is visible again and now contains presets and macros only.',
      'F11 and Escape are handled directly by the Electron window for reliable fullscreen control.',
      'The footer now shows the actual installed launcher version dynamically.',
      'Removed AI-button lookups and stale containers that could stop all category content from loading.'
    ]
  },
  {
    version: '0.9.63',
    title: 'Loading Restored',
    summary: 'The launcher content pipeline is working again across every category.',
    items: [
      'Fixed the refresh crash caused by removed Community Skin elements.',
      'Instance cards no longer reference the removed Cosmetics status row.',
      'Servers, mods, resource packs and installed content now render again after startup.',
      'Removed stale UI lookups so category navigation remains stable.'
    ]
  },
  {
    version: '0.9.62',
    title: 'Focused Launcher Navigation',
    summary: 'A cleaner launcher with only the workflows you actually need.',
    items: [
      'Removed the F11 fullscreen label from the header while keeping F11 and Escape fully functional.',
      'Removed AI Studio and Community Skins completely from the visible launcher navigation.',
      'Removed the old 3D Cosmetics status row from every instance card.',
      'Resource Pack search cards now use the same Modrinth artwork presentation as Mod Installer cards.'
    ]
  },
  {
    version: '0.9.61',
    title: 'Vortex 2.0 Motion Pass',
    summary: 'A deeper visual pass brings richer motion and more polished detail to every category.',
    items: [
      'Server and Bedrock heroes now have layered lighting, sweep effects and responsive hover depth.',
      'Instances, mods, resource packs and community cards animate in with clearer hierarchy and staggered timing.',
      'AI Studio, Cosmetics, Accounts and activity panels receive richer focus states, glow and tactile feedback.',
      'Global card spotlights, smoother scrolling, responsive refinements and keyboard-friendly controls are included.'
    ]
  },
  {
    version: '0.9.60',
    title: 'Vortex 2.0 Experience',
    summary: 'Every launcher category now feels more consistent, responsive and alive.',
    items: [
      'Improved Overview, Servers, Bedrock, Instances, Mods, Resource Packs, AI Studio, Community and Cosmetics layouts.',
      'Added interactive card spotlights, staggered content animations, smoother scrolling and stronger focus states.',
      'Press Enter inside a Modrinth search to search instantly; Ctrl + Shift + R refreshes the launcher state.',
      'Upgraded shared panels, empty states, status badges, search bars and responsive wide-screen behavior.'
    ]
  },
  {
    version: '0.9.59',
    title: 'Account Switcher Refresh',
    summary: 'Switch accounts with a cleaner, brighter and more polished account menu.',
    items: [
      'Active account cards now have clearer selection states and better account hierarchy.',
      'Improved avatar presentation with depth, glow and smoother hover interactions.',
      'Profile image actions and Add account are easier to discover and use.',
      'The popup has improved spacing, contrast, focus and glass styling.'
    ]
  },
  {
    version: '0.9.56',
    title: 'Photon Launcher Experience',
    summary: 'The Vortex launcher is now smoother, sharper and faster to control.',
    items: [
      'Photon redesign with glass surfaces, richer depth, cleaner hierarchy and responsive layouts.',
      'Smooth page transitions, hover motion, ambient hero animation and reduced-motion accessibility support.',
      'Quick Actions with Ctrl + K for instant launch, navigation, mod management and folder access.',
      'Automatic invalid Minecraft session detection with guided Microsoft reauthentication.'
    ]
  },
  {
    version: '0.9.55',
    title: 'Photon Launcher Experience',
    summary: 'A faster, smoother and more focused Vortex launcher experience with a refreshed visual system and instant command control.',
    items: [
      'Introduces the Photon visual redesign with glass surfaces, richer depth, improved hierarchy and responsive layouts.',
      'Adds smooth page transitions, hover motion, ambient hero animation and reduced-motion accessibility support.',
      'Adds Quick Actions with Ctrl + K for instant launch, navigation, mod management and folder access.',
      'Keeps all existing Minecraft, server, mod, resource pack, AI Studio and Community workflows intact.'
    ]
  },
  {
    version: '0.9.54',
    title: 'Skin Studio Heading Cleanup',
    summary: 'The requested Skin Studio heading was removed, leaving a cleaner compact editor header without changing any tool or skin workflow.',
    items: [
      'Removes the exact heading “Paint your Minecraft character.” from the Skin Studio.',
      'Keeps the compact Vortex Skin Studio label, 64×64 hint, helper text and every existing editor function.',
      'Adds a complete project handover prompt documenting the technical, cosmetic, UI, build and original-skin protections completed in this session.'
    ]
  },
  {
    version: '0.9.50',
    title: 'Original Minecraft Skin Hard Fix',
    summary: 'Cosmetics can no longer access, discover or replace a local player skin. Launcher-only previews and the Minecraft account skin are now fully separated.',
    items: [
      'Removes SkinOverrideMixin bytecode and its registration from the bundled Cosmetics Core JAR.',
      'Moves all Skin Studio, import and Community previews into a launcher-only config folder outside the Cosmetics Core path.',
      'Deletes every legacy PNG skin in the Core-owned skins folder and clears all known old skin-path settings on every instance repair.',
      'Updates parallel instances from the repaired base instance so no old Core JAR or legacy skin profile can survive a second-account launch.',
      'Keeps hats, capes and local launcher previews while the signed-in Microsoft/Minecraft skin stays authoritative in game.'
    ]
  },
  {
    version: '0.9.49',
    title: 'Addon Build Stability Fix',
    summary: 'The fixed Cape and Hat renderer addon now builds successfully both locally and on GitHub Actions without depending on an optional internal cosmetics class.',
    items: [
      'Removes the missing WearableCosmetics dependency that caused compile failures in the Addon GitHub Actions workflow.',
      'Adds a small addon-owned local cosmetic selection reader for the current player and selected 3D hat.',
      'Keeps the embedded cape renderer, premium 3D hats and all existing cosmetic choices intact.',
      'Bundles the verified addon JAR produced by the successful CI-compatible build into the launcher.'
    ]
  },
  {
    version: '0.9.48',
    title: 'Minimal Skin Studio Composition',
    summary: 'The Skin Studio was refined again into a single connected, restrained Minecraft editor: fewer containers, a compact application header and a clearer work-first layout.',
    items: [
      'Replaces the card-heavy design with one connected three-part editor workspace: Pixel Editor, 3D Preview and Properties / Export.',
      'Uses the requested dark Vortex palette with blue and cyan only as restrained interactive accents.',
      'Reduces the header to a compact application label and supporting text, with a subtle 64×64 indicator.',
      'Simplifies the sidebar, removes unnecessary decorative elements and makes active navigation a subtle cyan line.',
      'Keeps the existing drawing, preview, rotation, local save, import and Community publishing functionality unchanged.'
    ]
  },
  {
    version: '0.9.47',
    title: 'Premium Skin Studio Redesign',
    summary: 'The Skin Studio was rebuilt into a denser, more professional Vortex creation workspace with premium cards, stronger hierarchy and clearer active tools.',
    items: [
      'Redesigned the full Skin Studio into a modern premium gaming workspace with refined glass panels, clean gradients and consistent spacing.',
      'Uses the available window width more effectively, reducing empty space while keeping the Canvas, 3D Preview and output workflow clear.',
      'Upgraded the sidebar with clearer grouped navigation, stronger hover states, a refined active page state and a premium Vortex Core card.',
      'Makes the Pixel Canvas the visual focus with deeper framing, cleaner guide lines, improved colour controls and selected-swatch feedback.',
      'Improved the 3D character stage, rotation slider, output workflow, field styling, status surface and primary save/publish actions.',
      'Keeps every existing Skin Studio, local preview and Community publishing function unchanged.'
    ]
  },
  {
    version: '0.9.46',
    title: 'Skin Studio Visual Fix',
    summary: 'The Skin Studio now starts with a complete Vortex character, has a cleaner pixel atlas and shows a larger coherent Minecraft player preview instead of fragmented textures.',
    items: [
      'Rebuilt the starter 64×64 skin so every Minecraft head, body, arm and leg face is deliberately filled and readable.',
      'Refined the 3D stage: the player is larger, better centered, visually connected and easier to inspect while rotating.',
      'Reduced the dense pixel-grid noise and added clear 8×8 section guides for a more understandable skin atlas.',
      'The output card now displays the editable Vortex starter skin rather than a generic launcher logo when no local preview exists.',
      'The eraser now restores the calm atlas base colour instead of leaving black visual holes.'
    ]
  },
  {
    version: '0.9.45',
    title: 'Skin Studio and Community Skins',
    summary: 'Create a real 64×64 Minecraft skin pixel by pixel, inspect it on a rotatable 3D character and publish the design directly to the Vortex Community.',
    items: [
      'Adds the Skin Studio: pixel canvas, brush sizes, colour palette, fill tool, eraser and a starter design.',
      'Adds a live rotatable 3D Minecraft player preview that uses the same 64×64 skin texture.',
      'Stores studio skins only as local launcher previews; the signed-in Microsoft/Minecraft skin is never changed.',
      'Adds authenticated Community publishing for skin designs with title, description and public or unlisted visibility.',
      'Adds a Community Skins gallery with preview, local PNG download and one-click opening in the Skin Studio.',
      'Adds server-side PNG, size and exact 64×64 validation for every Community skin upload.'
    ]
  },
  {
    version: '0.9.44',
    title: 'Premium 3D headwear collection',
    summary: 'Every Vortex hat was rebuilt as a detailed Minecraft 3D cosmetic with richer geometry, handcrafted opaque pixel textures and new premium launcher previews.',
    items: [
      'Vortex Cap: tiered cyber crown, wide reactor visor, side clasps, rear strap and an illuminated Vortex core.',
      'Neon Halo: segmented floating circlet with a front energy reactor and individually modeled side nodes.',
      'Void Crown: five obsidian spires, metal brackets and a luminous amethyst centerpiece.',
      'Cyber Headphones: layered headband, separate yokes, two deep earcups, illuminated sound cores and a boom mic.',
      'Slime Antenna: slime-tech cap, twin sockets, multi-section antennae and bright crystal tips.',
      'All five texture atlases are fully opaque 64×64 pixel art; no white or transparent atlas fragments are used.'
    ]
  },
  {
    version: '0.9.43',
    title: 'Original Minecraft skin restored',
    summary: 'The legacy Cosmetics skin override has been disabled. Hats and capes now stay as separate 3D cosmetics while your signed-in Minecraft skin remains original.',
    items: [
      'Disables the legacy Cosmetics Core SkinOverrideMixin in the bundled Minecraft mod.',
      'Clears old baseSkin and generatedSkin profile entries at instance maintenance and before launch.',
      'Keeps imported 64×64 skin files as local launcher previews only; they are never applied to the signed-in Minecraft account.',
      'Retains hats and capes as separate 3D cosmetics without recoloring the player body.'
    ]
  },
  {
    version: '0.9.20',
    title: 'Vanilla cape correction',
    summary: 'The three Vortex capes were rebuilt around a clean vanilla cape silhouette with large, readable in-game motifs.',
    items: [
      'Removed the decorative technical cape frame and returned the renderer to a single slim vanilla-style moving cape surface.',
      'Reworked Vortex Crest, Nebula Mark and Void Rune with one bold central symbol per cape, dark cloth material and clean edge binding.',
      'Updated the 1.21.11 Cosmetics bundle to 2.29.8 and replaced the launcher previews with simple in-game cape views.'
    ]
  },
  {
    version: '0.9.19',
    title: 'Vortex Cosmetics collection redesigned',
    summary: 'Every built-in Vortex cape and 3D hat now has a cohesive, high-contrast Minecraft pixel-art redesign.',
    items: [
      'Rebuilt Vortex Crest, Nebula Mark and Void Rune as bespoke woven 64×64 cape textures with bold readable emblems and matching 128×128 previews.',
      'Redesigned every 3D hat material: Vortex Cap, Neon Halo, Void Crown, Cyber Headphones and Slime Antenna now use premium Vortex textures with stronger lighting, seams, alloy trim and signature accents.',
      'Updated the 1.21.11 Vortex Cosmetics bundle to 2.29.7 while retaining the animated 3D cape, Elytra and head-following hat renderers.'
    ]
  },
  {
    version: '0.9.18',
    title: 'Simple Voice Chat is no longer removed',
    summary: 'Simple Voice Chat can now remain in every Vortex Fabric instance after installation.',
    items: [
      'Removed the obsolete maintenance rule that deleted files with voice-chat names.',
      'Simple Voice Chat and other compatible Fabric mods now stay in the instance mods folder after download and during automatic maintenance.'
    ]
  },
  {
    version: '0.9.17',
    title: 'Session, mod artwork & cosmetics repair',
    summary: 'Java sessions are refreshed before launch, installed Modrinth mods now show cached artwork, and the full Vortex 3D cosmetics renderer is restored.',
    items: [
      'Minecraft Microsoft sessions are refreshed before every Java launch; legacy accounts without a refresh token are guided through one reauthentication.',
      'Installed Modrinth mods are matched by file hash and display locally cached project artwork in both mod views.',
      'The launcher UI and runtime strings were checked again for English consistency, including number formatting.',
      'The 1.21.11 Vortex Cosmetics bundle restores 3D hats, animated capes and Elytra rendering. An active Vortex cape now locally replaces the visible vanilla cape instead of drawing both.'
    ]
  },
  {
    version: '0.9.16',
    title: 'Minecraft Bedrock mode',
    summary: 'Vortex can now detect and launch Minecraft for Windows directly from a dedicated Bedrock page.',
    items: [
      'The new Bedrock page checks whether Minecraft for Windows is installed and shows its installed version.',
      'A direct launcher action opens Bedrock using its registered Windows protocol.',
      'Bedrock remains separated from Java: Fabric, Vortex Client JARs, Java mods, Java resource packs and Java Cosmetics are not applied to Bedrock.'
    ]
  },
  {
    version: '0.9.15',
    title: 'Vortex Client JAR refresh',
    summary: 'The supplied Vortex Client Fabric JARs are now verified and bundled with their matching Minecraft instances.',
    items: [
      'Minecraft 1.21.11 now bundles the supplied Vortex Client 2.28.3 Fabric JAR.',
      'The supplied 26.1.1, 26.1.2 and 26.2 JARs were verified as byte-identical to the matching bundles already included in the launcher.',
      'Every Vortex JAR is protected by instance maintenance and restored automatically when it is removed or changed.'
    ]
  },
  {
    version: '0.9.14',
    title: 'Smoother Logs & Full English UI',
    summary: 'The launcher interface and runtime messages are now consistently English, with a more readable system timeline.',
    items: [
      'The refreshed system timeline shows timestamps with seconds, smooth scrolling and clear status colours.',
      'Repeated messages are grouped with a counter to keep launch details readable.',
      'Navigation, dialogs, status text, update messages, server messages and AI Studio text are now in English.',
      'The current Cosmetics implementation remains unchanged; no Cosmetics were transferred from the older launcher.'
    ]
  },
  {
    version: '0.9.13',
    title: 'Server cards fixed',
    summary: 'Server favicons now appear subtly; the annoying large letter placeholder has been removed.',
    items: [
      'The real Minecraft server favicon is now displayed small in the top-right corner of the card.',
      'The large letter placeholder and its CSS rule have been completely removed.',
      'Servers without a favicon now show only the calm, neutral card background.'
    ]
  },
  {
    version: '0.9.12',
    title: 'Real server data & website cape',
    summary: 'The server gallery now reads directly from Minecraft; a confirmed website login unlocks the Vortex Member Cape.',
    items: [
      'Server cards load the real Minecraft favicon, the MOTD, the version, and the current player count directly from each server.',
      'Custom descriptions and local server images have been removed: visible data can no longer be manually edited.',
      'Minecraft SRV entries are respected so domains using a different server port are displayed correctly.',
      'After logging in with a Vortex website account, the exclusive Vortex Member Cape is securely unlocked and installed locally for your instances.'
    ]
  },
  {
    version: '0.9.11',
    title: 'Visual server gallery',
    summary: 'Server cards now show images and descriptions instead of just an IP address.',
    items: [
      'VortexPvP receives its own local Vortex banner in the style of the official website.',
      'Custom server cards show name, IP, description, and an optionally chosen local image.',
      'Server images are stored locally in the Vortex data folder only and can be changed at any time.',
      'The server library has been redesigned into a clear visual card gallery.'
    ]
  },
  {
    version: '0.9.10',
    title: 'Server library & direct-join',
    summary: 'Manage servers and join directly using your Vortex instance.',
    items: [
      'New server page to save, select, and remove your own Minecraft servers.',
      'Direct multiplayer start: one click on "Join" launches Minecraft with the selected server IP.',
      'mc.vortexpvp.eu is always visible as the official VortexPvP server and remains permanently available.',
      'Reworked game page with a quick VortexPvP join button and clearer launch states.'
    ]
  },
  {
    version: '0.9.9',
    title: 'News & profile update',
    summary: 'After each launcher update you now see what\'s new in one place.',
    items: [
      'New "What\'s new in this version" view with all changes since your last update.',
      'Reworked account card in the top-right with Microsoft avatar and personal profile image.',
      'Profile image can be selected locally, changed, or removed.',
      'Clearer update communication with a simple update-and-restart flow.'
    ]
  }
];

const JAVA_RUNTIME_DOWNLOAD_URLS = Object.freeze({
  8: 'https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jre/hotspot/normal/eclipse',
  17: 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse',
  21: 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse',
  25: 'https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse'
});
const javaRuntimeInstallPromises = new Map();
const BEDROCK_PACKAGE_NAME = 'Microsoft.MinecraftUWP';
const BEDROCK_URI = 'minecraft://';

function assetsRoot() { return path.join(app.getAppPath(), 'assets'); }
function windowsPowerShellPath() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
async function getBedrockState() {
  if (process.platform !== 'win32') return { supported: false, installed: false, message: 'Minecraft Bedrock can only be started by Vortex on Windows.' };
  const command = `$ErrorActionPreference = 'SilentlyContinue'; Get-AppxPackage -Name '${BEDROCK_PACKAGE_NAME}' | Select-Object -First 1 Name, PackageFullName, PackageFamilyName, Version, InstallLocation | ConvertTo-Json -Compress`;
  try {
    const result = await execFileAsync(windowsPowerShellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 });
    const raw = String(result.stdout || '').trim();
    if (!raw) return { supported: true, installed: false, message: 'Minecraft for Windows was not found.' };
    const packageInfo = JSON.parse(raw);
    if (!packageInfo || packageInfo.Name !== BEDROCK_PACKAGE_NAME) return { supported: true, installed: false, message: 'Minecraft for Windows was not found.' };
    return { supported: true, installed: true, packageFamilyName: String(packageInfo.PackageFamilyName || ''), version: String(packageInfo.Version || ''), message: 'Minecraft for Windows is ready to launch.' };
  } catch (_) {
    return { supported: true, installed: false, message: 'Minecraft for Windows could not be detected.' };
  }
}
async function launchBedrock() {
  const state = await getBedrockState();
  if (!state.supported) return { ok: false, ...state };
  if (!state.installed) return { ok: false, ...state, error: 'Install Minecraft for Windows before launching Bedrock.' };
  try {
    await shell.openExternal(BEDROCK_URI);
    send('status', { type: 'success', message: 'Minecraft Bedrock launch request sent.' });
    return { ok: true, ...state };
  } catch (error) {
    return { ok: false, ...state, error: `Minecraft Bedrock could not be started: ${error.message || error}` };
  }
}
function requiresJava25(version) { return /^26\./.test(String(version || '')); }
function requiredJavaMajor(version) {
  const value = String(version || '').trim().replace(/^v/i, '');
  if (requiresJava25(value)) return 25;
  const match = value.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!match) return 21;
  const minor = Number(match[1]);
  const patch = Number(match[2] || 0);
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}
// minecraft-launcher-core first calls the supplied path with `-version`.
// Therefore Windows must use java.exe rather than the silent javaw.exe.
function javaExecutable(home) { return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'); }
function javaConsoleExecutable(home) { return javaExecutable(home); }
function javaRuntimeRoot(major) { return path.join(dataRoot, 'runtime', `java-${major}`); }
function localJavaHomes(root) {
  const homes = [];
  if (!root || !exists(root)) return homes;
  if (exists(javaExecutable(root))) homes.push(root);
  try { for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) { const candidate = path.join(root, entry.name); if (exists(javaExecutable(candidate))) homes.push(candidate); } } catch (_) {}
  return homes;
}
async function javaMajorVersion(home) {
  const binary = javaConsoleExecutable(home);
  if (!exists(binary)) return null;
  try {
    const result = await execFileAsync(binary, ['-version'], { windowsHide: true, timeout: 10000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/version\s+"(?:1\.)?(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  } catch (_) { return null; }
}
async function findJavaHome(requiredMajor) {
  const roots = [
    javaRuntimeRoot(requiredMajor),
    process.env.JAVA_HOME || '',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
    path.join(process.env['ProgramW6432'] || 'C:\\Program Files', 'Microsoft')
  ];
  const seen = new Set();
  for (const root of roots) for (const home of localJavaHomes(root)) {
    if (seen.has(home)) continue;
    seen.add(home);
    if ((await javaMajorVersion(home)) >= requiredMajor) return home;
  }
  return null;
}
async function installPortableJava(requiredMajor) {
  if (process.platform !== 'win32') throw new Error(`Minecraft requires Java ${requiredMajor}. Automatic Java runtime provisioning is available in the Windows launcher.`);
  const existing = await findJavaHome(requiredMajor);
  if (existing) return existing;
  const pending = javaRuntimeInstallPromises.get(requiredMajor);
  if (pending) return pending;
  const provision = (async () => {
    send('status', { type: 'info', message: `Preparing the built-in Java ${requiredMajor} runtime …` });
    const runtimeRoot = javaRuntimeRoot(requiredMajor);
    const archive = path.join(runtimeRoot, `java-${requiredMajor}.zip`);
    const downloadUrl = JAVA_RUNTIME_DOWNLOAD_URLS[requiredMajor];
    if (!downloadUrl) throw new Error(`No automatic Java runtime is configured for Java ${requiredMajor}.`);
    ensureDir(runtimeRoot);
    const response = await fetch(downloadUrl, { redirect: 'follow', signal: AbortSignal.timeout(300000), headers: { 'User-Agent': MODRINTH_USER_AGENT } });
    if (!response.ok) throw new Error(`The built-in Java runtime could not be downloaded (HTTP ${response.status}). Check your connection and try again.`);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 10 * 1024 * 1024 || data.length > 500 * 1024 * 1024) throw new Error('The downloaded Java runtime is invalid or too large.');
    fs.writeFileSync(archive, data);
    try {
      const powershell = windowsPowerShellPath();
      const escapedArchive = archive.replace(/'/g, "''");
      const escapedRoot = runtimeRoot.replace(/'/g, "''");
      await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedRoot}' -Force`], { windowsHide: true, timeout: 180000 });
    } finally { try { fs.rmSync(archive, { force: true }); } catch (_) {} }
    const installed = await findJavaHome(requiredMajor);
    if (!installed) throw new Error('The built-in Java runtime could not be verified after installation. Restart the launcher and try again.');
    send('status', { type: 'success', message: `Built-in Java ${requiredMajor} is ready for Minecraft.` });
    return installed;
  })();
  javaRuntimeInstallPromises.set(requiredMajor, provision);
  try { return await provision; } finally { javaRuntimeInstallPromises.delete(requiredMajor); }
}
async function javaPathForVersion(version) {
  const requiredMajor = requiredJavaMajor(version);
  const home = await findJavaHome(requiredMajor) || await installPortableJava(requiredMajor);
  const binary = javaExecutable(home);
  if (!exists(binary)) throw new Error(`Java ${requiredMajor} could not be prepared. Restart the launcher and try again.`);
  send('log', `Minecraft ${version} is using Java ${await javaMajorVersion(home) || requiredMajor}: ${binary}`);
  return binary;
}
function instanceRoot(version) { return path.join(instancesRoot, version); }
function modsRoot(version) { return path.join(instanceRoot(version), 'mods'); }
function resourcePacksRoot(version) { return path.join(instanceRoot(version), 'resourcepacks'); }
function vortexConfigRoot(version) { return path.join(instanceRoot(version), 'config', 'vortexclient'); }
function skinsRoot(version) { return path.join(vortexConfigRoot(version), 'skins'); }
// Studio and imported skins are launcher-only previews. They must never be stored where
// the Cosmetics Core can discover and apply a local skin replacement.
function previewSkinsRoot(version) { return path.join(instanceRoot(version), 'config', 'vortexlauncher', 'skin-previews'); }
function previewProfileFile(version) { return path.join(instanceRoot(version), 'config', 'vortexlauncher', 'skin-preview.json'); }
function profileFile(version) { return path.join(vortexConfigRoot(version), 'launcher-cosmetics.json'); }
function isValidMinecraftVersion(version) {
  const value = String(version || '').trim().replace(/^v/i, '');
  return /^(?:1\.[0-9]+(?:\.[0-9]+)?|[2-9][0-9](?:\.[0-9]+){1,2})$/.test(value);
}
function customMinecraftVersions() {
  const stored = loadJson(customVersionsFile, []);
  return Array.isArray(stored) ? stored.filter(isValidMinecraftVersion).map(value => String(value).replace(/^v/i, '')) : [];
}
function availableMinecraftVersions() {
  return [...new Set([...SUPPORTED_VERSIONS, ...customMinecraftVersions()])].filter(isValidMinecraftVersion).sort(compareVersions).reverse();
}
function registerMinecraftVersion(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '');
  if (!isValidMinecraftVersion(normalized)) return null;
  writeJson(customVersionsFile, [...new Set([...customMinecraftVersions(), normalized])].sort(compareVersions).reverse());
  return normalized;
}
function sanitizeVersion(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '');
  return isValidMinecraftVersion(normalized) && availableMinecraftVersions().includes(normalized) ? normalized : null;
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function exists(file) { return fs.existsSync(file); }
function launchLogPath() { return path.join(dataRoot, 'launch.log'); }
function crashLogPath() { return path.join(dataRoot, 'crash.log'); }
function appendPersistentLog(file, message) { try { ensureDir(dataRoot); const line = `[${new Date().toISOString()}] ${String(message).replace(/[\r\n]+/g, ' ').slice(0, 4000)}\n`; fs.appendFileSync(file, line, 'utf8'); if (fs.statSync(file).size > 2 * 1024 * 1024) { const recent = fs.readFileSync(file).subarray(-1024 * 1024); fs.writeFileSync(file, recent); } } catch (_) {} }
function send(channel, payload) { if (channel === 'log') appendPersistentLog(launchLogPath(), payload); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
function loadJson(file, fallback) { try { return exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch (_) { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }
function versionParts(value) { return String(value || '').replace(/^v/i, '').split('.').map(part => Number.parseInt(part, 10) || 0); }
function compareVersions(left, right) { const a = versionParts(left); const b = versionParts(right); for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const delta = (a[index] || 0) - (b[index] || 0); if (delta) return delta; } return 0; }
function releaseNewsState() { const state = loadJson(newsFile, {}); return { lastSeenVersion: typeof state.lastSeenVersion === 'string' ? state.lastSeenVersion : null }; }
function unreadReleaseNews() {
  const currentVersion = app.getVersion();
  const state = releaseNewsState();
  const available = RELEASE_NEWS.filter(note => compareVersions(note.version, currentVersion) <= 0).sort((a, b) => compareVersions(a.version, b.version));
  const notes = state.lastSeenVersion ? available.filter(note => compareVersions(note.version, state.lastSeenVersion) > 0) : available.filter(note => compareVersions(note.version, currentVersion) === 0);
  return { currentVersion, notes };
}
function markReleaseNewsSeen() { writeJson(newsFile, { schemaVersion: 1, lastSeenVersion: app.getVersion(), seenAt: new Date().toISOString() }); return unreadReleaseNews(); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function safeFileName(value) { return String(value || 'skin').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '') || 'skin'; }
function websiteCapeChoiceFile() { return path.join(dataRoot, 'website-cape-choice.json'); }
function websiteCapeConfigPath(version) { return path.join(instanceRoot(version), 'config', 'vortex-client', 'cosmetics.json'); }
function bundledCapeAsset(capeId) { return BUNDLED_TEXTURED_CAPES.has(capeId) ? path.join(assetsRoot(), 'cosmetics', 'capes', `${capeId}.png`) : null; }
function installBundledCape(version, capeId) { const source = bundledCapeAsset(capeId); if (!source || !exists(source)) return false; const target = path.join(instanceRoot(version), 'config', 'vortex-client', 'capes', `${capeId}.png`); ensureDir(path.dirname(target)); fs.copyFileSync(source, target); return true; }
function isCapeId(value) { return /^[a-z0-9_-]{1,48}$/i.test(String(value || '')); }
function normalizeWebsiteCapeEntitlements(data) {
  const seen = new Set();
  return (Array.isArray(data?.capes) ? data.capes : []).map(entry => ({
    id: String(entry?.id || ''),
    name: String(entry?.name || '').trim().slice(0, 60),
    description: String(entry?.description || '').trim().slice(0, 180),
    texturePath: String(entry?.texturePath || ''),
    previewPath: String(entry?.previewPath || '')
  })).filter(entry => isCapeId(entry.id) && entry.name && entry.texturePath === `/api/capes/${entry.id}/texture` && entry.previewPath === `/api/capes/${entry.id}/preview` && !seen.has(entry.id) && Boolean(seen.add(entry.id))).slice(0, 20);
}
async function loadWebsiteCapeEntitlements() {
  const result = await communityFetch('/api/capes/launcher');
  const capes = normalizeWebsiteCapeEntitlements(result);
  return Promise.all(capes.map(async cape => ({ ...cape, preview: `data:image/png;base64,${(await downloadWebsiteCape(cape, true)).toString('base64')}` })));
}
function validateWebsiteCapePng(bytes, preview = false) {  if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > (preview ? 1024 * 1024 : 256 * 1024)) throw new Error('The cape file has an invalid size.');
  let image;
  try { image = PNG.sync.read(bytes); } catch (_) { throw new Error('The website did not provide a valid PNG cape file.'); }
  if (preview ? (image.width < 64 || image.height < 64 || image.width > 512 || image.height > 512) : (image.width !== 64 || image.height !== 64)) throw new Error(preview ? 'The cape preview has an invalid format.' : 'The cape must be a 64×64 PNG.');
  return bytes;
}
async function downloadWebsiteCape(cape, preview = false) {
  const route = preview ? cape.previewPath : cape.texturePath;
  return validateWebsiteCapePng(await communityBinaryFetch(route), preview);
}
function installWebsiteCape(capeId, bytes) {
  if (!isCapeId(capeId)) throw new Error('Invalid cape ID.');
  let written = 0;
  const choice = { cape: capeId, updatedAt: new Date().toISOString(), source: 'website-account' };
  for (const version of SUPPORTED_VERSIONS) {
    const target = path.join(instanceRoot(version), 'config', 'vortex-client', 'capes', `${capeId}.png`);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, bytes);
    writeJson(websiteCapeConfigPath(version), choice);
    written += 1;
  }
  writeJson(websiteCapeChoiceFile(), choice);
  return { choice, written };
}
function clearWebsiteCape() {
  const choice = { cape: null, updatedAt: new Date().toISOString(), source: 'website-account' };
  writeJson(websiteCapeChoiceFile(), choice);
  for (const version of SUPPORTED_VERSIONS) { ensureDir(path.dirname(websiteCapeConfigPath(version))); writeJson(websiteCapeConfigPath(version), choice); }
  return choice;
}
function applyWebsiteCapeChoice(version) { const stored = loadJson(websiteCapeChoiceFile(), null); const legacyEmblem = loadState().emblem; const fallbackCape = BUNDLED_TEXTURED_CAPES.has(legacyEmblem) ? legacyEmblem : null; const choice = stored && (stored.cape === null || isCapeId(stored.cape)) ? stored : { cape: fallbackCape, updatedAt: new Date().toISOString(), source: 'bodyfit-migration' }; if (!stored) writeJson(websiteCapeChoiceFile(), choice); try { if (choice.cape) installBundledCape(version, choice.cape); const target = websiteCapeConfigPath(version); ensureDir(path.dirname(target)); writeJson(target, choice); } catch (_) {} }
const MODRINTH_API = 'https://api.modrinth.com/v2';
const COMMUNITY_BASE_URL = 'https://vortex-client.onrender.com';
const MODRINTH_USER_AGENT = 'Lukas3578/Vortex-launcher/0.9.54 (github.com/Lukas3578/Vortex-launcher)';
function modrinthHeaders() { return { Accept: 'application/json', 'User-Agent': MODRINTH_USER_AGENT }; }
function validModrinthVersion(version) { return sanitizeVersion(version); }
async function modrinthJson(url) {
  const response = await fetch(url, { headers: modrinthHeaders(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Modrinth responded with ${response.status}.`);
  return response.json();
}
function selectPrimaryFile(files = [], extension) { return files.find(file => file.primary && file.filename.toLowerCase().endsWith(extension)) || files.find(file => file.filename.toLowerCase().endsWith(extension)); }
function selectPrimaryJar(files = []) { return selectPrimaryFile(files, '.jar'); }
function selectPrimaryZip(files = []) { return selectPrimaryFile(files, '.zip'); }
async function getCompatibleModVersion(projectId, gameVersion) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify(['fabric']), limit: '20' });
  const versions = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const selected = selectCompatibleModVersion(versions, gameVersion);
  if (!selected) return null;
  const file = selectPrimaryJar(selected.files);
  return { versionId: selected.id, versionNumber: selected.version_number, versionType: selected.version_type, fileName: file.filename, downloadUrl: file.url, size: file.size, sha512: file.hashes?.sha512 || null };
}
const MODRINTH_UNUSABLE_STATUSES = new Set(['archived', 'draft', 'scheduled', 'unknown']);
const MODRINTH_CHANNELS = ['release', 'beta', 'alpha'];
function installedProjectsFile(version) { return path.join(instanceRoot(version), 'vortex-installed-projects.json'); }
function installedProjectMap(version) { return loadJson(installedProjectsFile(version), {}); }
function modSourcesFile(version) { return path.join(instanceRoot(version), 'vortex-mod-sources.json'); }
function modSourceMap(version) { const value = loadJson(modSourcesFile(version), {}); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function normalizedModFileName(fileName) { return path.basename(String(fileName || '')).replace(/\.disabled$/i, ''); }
function sourceLabelFor(source, fallback = 'Local file') { return ({ modrinth: 'Modrinth', 'modrinth-profile': 'Modrinth profile', external: 'External file', vortex: 'Vortex managed' })[String(source || '')] || fallback; }
function modSourceForFile(version, fileName) { return modSourceMap(version)[normalizedModFileName(fileName)] || null; }
function setModSource(version, fileName, source, details = {}) { const file = normalizedModFileName(fileName); if (!/^\S+\.jar$/i.test(file)) return; const sources = modSourceMap(version); sources[file] = { source: String(source || 'external'), label: String(details.label || sourceLabelFor(source)), profileName: String(details.profileName || '').slice(0, 80), importedAt: new Date().toISOString() }; writeJson(modSourcesFile(version), sources); }
function removeModSourceForFile(version, fileName) { const sources = modSourceMap(version); const file = normalizedModFileName(fileName); if (Object.prototype.hasOwnProperty.call(sources, file)) { delete sources[file]; writeJson(modSourcesFile(version), sources); } }
function projectRecordFileName(record) { return typeof record === 'string' ? record : String(record?.fileName || ''); }
function isProjectInstalled(version, projectId) { return Boolean(installedProjectMap(version)[projectId]); }
const projectMetadataCache = new Map();
async function getProjectMetadata(projectId) {
  const key = String(projectId || '');
  if (!key) return null;
  if (projectMetadataCache.has(key)) return projectMetadataCache.get(key);
  try {
    const project = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(key)}`);
    const iconUrl = validModrinthIconUrl(project.icon_url) ? project.icon_url : null;
    const metadata = { projectId: key, title: project.title || '', author: project.author || '', iconUrl, iconData: iconUrl ? await cachedModIconData(key, iconUrl) : null };
    projectMetadataCache.set(key, metadata);
    return metadata;
  } catch (_) { projectMetadataCache.set(key, null); return null; }
}
function mappedProjectForFile(version, fileName) {
  const baseName = String(fileName || '').replace(/\.disabled$/i, '');
  for (const [projectId, record] of Object.entries(installedProjectMap(version))) {
    if (projectRecordFileName(record) === baseName) return { projectId, record };
  }
  return null;
}
function removeProjectMappingForFile(version, fileName) {
  removeModSourceForFile(version, fileName);
  const projects = installedProjectMap(version);
  const baseName = String(fileName || '').replace(/\.disabled$/i, '');
  let changed = false;
  for (const [projectId, record] of Object.entries(projects)) {
    if (projectRecordFileName(record) === baseName) { delete projects[projectId]; changed = true; }
  }
  if (changed) writeJson(installedProjectsFile(version), projects);
}
function sha1ForModFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || !stat.size || stat.size > 100 * 1024 * 1024) return null;
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch (_) { return null; }
}
async function mapInstalledModrinthFile(version, fileName) {
  const baseName = String(fileName || '').replace(/\.disabled$/i, '');
  const known = mappedProjectForFile(version, baseName);
  if (known) return known;
  const hash = sha1ForModFile(path.join(modsRoot(version), baseName));
  if (!hash) return null;
  try {
    const release = await modrinthJson(`${MODRINTH_API}/version_file/${hash}?algorithm=sha1`);
    const projectId = String(release?.project_id || '');
    if (!projectId) return null;
    const metadata = await getProjectMetadata(projectId);
    const projects = installedProjectMap(version);
    for (const [knownProjectId, record] of Object.entries(projects)) if (projectRecordFileName(record) === baseName && knownProjectId !== projectId) delete projects[knownProjectId];
    projects[projectId] = { fileName: baseName, title: metadata?.title || '', author: metadata?.author || '', iconUrl: metadata?.iconUrl || null };
    writeJson(installedProjectsFile(version), projects);
    return { projectId, record: projects[projectId] };
  } catch (_) { return null; }
}
function selectCompatibleModVersion(versions, gameVersion) {
  const usable = (versions || []).filter(entry => Array.isArray(entry.game_versions) && entry.game_versions.includes(gameVersion) && Array.isArray(entry.loaders) && entry.loaders.includes('fabric') && !MODRINTH_UNUSABLE_STATUSES.has(entry.status) && selectPrimaryJar(entry.files));
  for (const channel of MODRINTH_CHANNELS) {
    const candidates = usable.filter(entry => entry.version_type === channel);
    if (candidates.length) return candidates.reduce((latest, entry) => new Date(entry.date_published || 0) > new Date(latest.date_published || 0) ? entry : latest);
  }
  return usable[0] || null;
}
async function resolveModInstall(projectId, gameVersion) {
  const selected = new Map(); const queued = [String(projectId)]; const visited = new Set(); const missing = []; const conflicts = [];
  while (queued.length) {
    const next = queued.shift(); if (visited.has(next)) continue; visited.add(next);
    try {
      const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify(['fabric']), limit: '20' });
      const versions = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(next)}/version?${params}`);
      const version = selectCompatibleModVersion(versions, gameVersion);
      if (!version) { missing.push(next); continue; }
      selected.set(next, version);
      for (const dependency of version.dependencies || []) {
        if (dependency.dependency_type === 'required' && dependency.project_id) queued.push(dependency.project_id);
        if (dependency.dependency_type === 'incompatible' && dependency.project_id) conflicts.push(dependency.project_id);
      }
    } catch (_) { missing.push(next); }
  }
  return { versions: [...selected.entries()].map(([projectId, version]) => ({ projectId, version })), missing, conflicts };
}
async function installModrinthProject(projectId, gameVersion) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  if (!normalizedVersion || !projectId) throw new Error('Invalid mod or Minecraft version.');
  const plan = await resolveModInstall(projectId, normalizedVersion);
  if (!plan.versions.length) throw new Error(`No suitable Fabric version was found for Minecraft ${normalizedVersion}.`);
  const targetDir = modsRoot(normalizedVersion); ensureDir(targetDir);
  const projects = installedProjectMap(normalizedVersion); const installed = []; const present = [];
  for (const entry of plan.versions) {
    const file = selectPrimaryJar(entry.version.files);
    if (!file || !/^https:\/\//i.test(file.url) || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.jar$/i.test(file.filename)) { plan.missing.push(entry.projectId); continue; }
    if (file.size > 100 * 1024 * 1024) { plan.missing.push(entry.projectId); continue; }
    const target = path.join(targetDir, file.filename);
    if (exists(target)) { present.push(file.filename); const metadata = await getProjectMetadata(entry.projectId);
    projects[entry.projectId] = { fileName: file.filename, title: metadata?.title || '', author: metadata?.author || '', iconUrl: metadata?.iconUrl || null }; continue; }
    const response = await fetch(file.url, { headers: { 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) { plan.missing.push(entry.projectId); continue; }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 100 * 1024 * 1024) { plan.missing.push(entry.projectId); continue; }
    if (file.hashes?.sha512) { const digest = crypto.createHash('sha512').update(buffer).digest('hex'); if (digest.toLowerCase() !== file.hashes.sha512.toLowerCase()) { plan.missing.push(entry.projectId); continue; } }
    fs.writeFileSync(target, buffer); const metadata = await getProjectMetadata(entry.projectId);
    projects[entry.projectId] = { fileName: file.filename, title: metadata?.title || '', author: metadata?.author || '', iconUrl: metadata?.iconUrl || null }; installed.push(file.filename);
  }
  writeJson(installedProjectsFile(normalizedVersion), projects);
  if (!installed.length && !present.length) throw new Error('No mod file could be installed.');
  return { ok: true, version: normalizedVersion, installed, present, missing: [...new Set(plan.missing)], conflicts: [...new Set(plan.conflicts)] };
}
async function searchModrinth(query, gameVersion, page = 0) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  const normalizedQuery = String(query || '').trim().slice(0, 80);
  const normalizedPage = Math.max(0, Math.min(99, Number(page) || 0));
  if (!normalizedVersion) throw new Error('This Minecraft version is not supported.');
  if (normalizedQuery.length < 2) return { results: [], page: normalizedPage, pageSize: 12, total: 0, hasNext: false };
  const facets = JSON.stringify([['project_type:mod'], [`versions:${normalizedVersion}`], ['categories:fabric']]);
  const params = new URLSearchParams({ query: normalizedQuery, facets, limit: '18', offset: String(normalizedPage * 18), index: 'relevance' });
  const result = await modrinthJson(`${MODRINTH_API}/search?${params}`);
  const suggestions = await Promise.all(result.hits.map(async hit => {
    try {
      const compatible = await getCompatibleModVersion(hit.project_id, normalizedVersion);
      if (!compatible) return null;
      return { projectId: hit.project_id, slug: hit.slug, title: hit.title, author: hit.author || '', description: hit.description || 'No description available.', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, categories: hit.display_categories || hit.categories || [], clientSide: hit.client_side || 'unknown', serverSide: hit.server_side || 'unknown', modType: hit.client_side === 'required' || hit.client_side === 'optional' ? 'Client-side' : hit.server_side === 'required' ? 'Server-side' : 'Compatible', gameVersion: normalizedVersion, installed: isProjectInstalled(normalizedVersion, hit.project_id), ...compatible };
    } catch (_) { return null; }
  }));
  const ranked = suggestions.filter(Boolean).sort((a, b) => { const rank = value => value === 'required' ? 0 : value === 'optional' ? 1 : 2; return rank(a.clientSide) - rank(b.clientSide) || Number(b.downloads || 0) - Number(a.downloads || 0); });
  return { results: ranked, page: normalizedPage, pageSize: 18, total: result.total_hits || 0, hasNext: (normalizedPage + 1) * 18 < (result.total_hits || 0) };
}
async function getCompatibleResourcePackVersion(projectId, gameVersion) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), limit: '10' });
  const versions = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const ordered = [...versions].sort((a, b) => (a.version_type === 'release' ? 0 : 1) - (b.version_type === 'release' ? 0 : 1));
  for (const version of ordered) {
    const file = selectPrimaryZip(version.files);
    if (file) return { versionId: version.id, versionNumber: version.version_number, versionType: version.version_type, fileName: file.filename, downloadUrl: file.url, size: file.size, sha512: file.hashes?.sha512 || null };
  }
  return null;
}
async function searchResourcePacks(query, gameVersion, page = 0) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  const normalizedQuery = String(query || '').trim().slice(0, 80);
  const normalizedPage = Math.max(0, Math.min(99, Number(page) || 0));
  if (!normalizedVersion) throw new Error('This Minecraft version is not supported.');
  if (normalizedQuery.length < 2) return { results: [], page: normalizedPage, pageSize: 12, total: 0, hasNext: false };
  const facets = JSON.stringify([['project_type:resourcepack'], [`versions:${normalizedVersion}`]]);
  const params = new URLSearchParams({ query: normalizedQuery, facets, limit: '12', offset: String(normalizedPage * 12), index: 'relevance' });
  const result = await modrinthJson(`${MODRINTH_API}/search?${params}`);
  const suggestions = await Promise.all(result.hits.map(async hit => {
    try {
      const compatible = await getCompatibleResourcePackVersion(hit.project_id, normalizedVersion);
      if (!compatible) return null;
      return { projectId: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description || 'No description available.', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, categories: hit.display_categories || hit.categories || [], gameVersion: normalizedVersion, ...compatible };
    } catch (_) { return null; }
  }));
  return { results: suggestions.filter(Boolean), page: normalizedPage, pageSize: 12, total: result.total_hits || 0, hasNext: (normalizedPage + 1) * 12 < (result.total_hits || 0) };
}
async function downloadResourcePack(gameVersion, requested = {}) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  if (!normalizedVersion || !requested.versionId) throw new Error('Invalid resource pack or Minecraft version.');
  const version = await modrinthJson(`${MODRINTH_API}/version/${encodeURIComponent(String(requested.versionId))}`);
  if (!Array.isArray(version.game_versions) || !version.game_versions.includes(normalizedVersion)) throw new Error('This resource pack is not compatible with the selected Minecraft version.');
  const file = selectPrimaryZip(version.files);
  const fileName = path.basename(String(file?.filename || ''));
  if (!file || !/^https:\/\//i.test(file.url) || fileName !== file.filename || !/\.zip$/i.test(fileName) || /[\0\r\n]/.test(fileName)) throw new Error('Could not securely determine the resource pack file.');
  if (file.size > 500 * 1024 * 1024) throw new Error('The resource pack is larger than 500 MB and was rejected for security reasons.');
  const targetDir = resourcePacksRoot(normalizedVersion); ensureDir(targetDir);
  const target = path.join(targetDir, fileName);
  if (exists(target)) throw new Error(`The file ${fileName} already exists in this instance.`);
  const response = await fetch(file.url, { headers: { 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Resource pack download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 500 * 1024 * 1024) throw new Error('The downloaded resource pack is larger than 500 MB.');
  if (file.hashes?.sha512) { const digest = crypto.createHash('sha512').update(buffer).digest('hex'); if (digest.toLowerCase() !== file.hashes.sha512.toLowerCase()) throw new Error('The resource pack checksum does not match.'); }
  fs.writeFileSync(target, buffer);
  return { ok: true, fileName, size: buffer.length, version: normalizedVersion, projectId: requested.projectId || null };
}
async function downloadModrinthMod(gameVersion, requested = {}) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  if (!normalizedVersion || !requested.versionId) throw new Error('Invalid mod or Minecraft version.');
  const version = await modrinthJson(`${MODRINTH_API}/version/${encodeURIComponent(String(requested.versionId))}`);
  if (!Array.isArray(version.game_versions) || !version.game_versions.includes(normalizedVersion) || !Array.isArray(version.loaders) || !version.loaders.includes('fabric')) throw new Error('This mod version is not compatible with Fabric and the selected Minecraft version.');
  const file = selectPrimaryJar(version.files);
  if (!file || !/^https:\/\//i.test(file.url) || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.jar$/i.test(file.filename)) throw new Error('Mod file could not be securely determined.');
  if (file.size > 100 * 1024 * 1024) throw new Error('The mod file is larger than 100 MB and was rejected for security reasons.');
  const targetDir = modsRoot(normalizedVersion); ensureDir(targetDir);
  const target = path.join(targetDir, file.filename);
  if (exists(target)) throw new Error(`The file ${file.filename} already exists in this instance.`);
  const response = await fetch(file.url, { headers: { 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Mod download failed (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 100 * 1024 * 1024) throw new Error('The downloaded file is larger than 100 MB.');
  if (file.hashes?.sha512) { const digest = crypto.createHash('sha512').update(buffer).digest('hex'); if (digest.toLowerCase() !== file.hashes.sha512.toLowerCase()) throw new Error('The mod file checksum does not match.'); }
  fs.writeFileSync(target, buffer);
  const projectId = String(requested.projectId || version.project_id || '');
  if (projectId) { const metadata = await getProjectMetadata(projectId); const projects = installedProjectMap(normalizedVersion); projects[projectId] = { fileName: file.filename, title: metadata?.title || '', author: metadata?.author || '', iconUrl: metadata?.iconUrl || null, downloadUrl: file.url, sha512: file.hashes?.sha512 || null, versionId: version.id, versionNumber: version.version_number }; writeJson(installedProjectsFile(normalizedVersion), projects); }
  setModSource(normalizedVersion, file.filename, 'modrinth');
  return { ok: true, fileName: file.filename, size: buffer.length, version: normalizedVersion, projectId: projectId || null };
}
async function communityCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: COMMUNITY_BASE_URL });
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
async function communityFetch(route, options = {}) {
  const cookie = await communityCookieHeader();
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${COMMUNITY_BASE_URL}${route}`, { ...options, headers, signal: AbortSignal.timeout(30000) });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  if (!response.ok) throw new Error(payload?.error || payload || `Community responded with ${response.status}.`);
  return payload;
}
async function communityBinaryFetch(route) {
  if (!/^\/api\/capes\/[a-z0-9_-]{1,48}\/(?:texture|preview)$/i.test(String(route || ''))) throw new Error('Invalid cape download path.');
  const cookie = await communityCookieHeader();
  const headers = { Accept: 'image/png', 'User-Agent': MODRINTH_USER_AGENT };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${COMMUNITY_BASE_URL}${route}`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Cape file responded with ${response.status}.`);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('image/png')) throw new Error('The website did not provide a PNG cape file.');
  return Buffer.from(await response.arrayBuffer());
}
async function getCommunityState() {
  let websiteAccount = null;
  try { websiteAccount = await communityFetch('/api/auth/me'); }
  catch (_) { websiteAccount = null; }
  return { launcherAccount: account ? { username: account.username, uuid: account.uuid } : null, websiteAccount, baseUrl: COMMUNITY_BASE_URL };
}
function communityDownloadsRoot() { return path.join(vortexConfigRoot(COSMETICS_MOD_VERSION), 'community-downloads'); }
function validCommunityFilename(name) { return /^(preset[123]\.txt|macro\.txt)$/i.test(String(name || '')); }
async function listCommunityPresets() {
  const presets = await communityFetch('/api/presets');
  return Array.isArray(presets) ? presets.slice(0, 100).map(item => ({ id: item.id, name: String(item.name || 'Unnamed').slice(0, 60), filename: validCommunityFilename(item.filename) ? item.filename : 'preset1.txt', kind: item.kind === 'macro' ? 'macro' : 'preset', description: String(item.description || ''), downloads: Number(item.downloads || 0), createdAt: item.created_at || null, shareCode: String(item.share_code || ''), username: String(item.display_name || item.username || 'Community') })) : [];
}
async function downloadCommunityPreset(shareCode, filename) {
  const code = String(shareCode || '');
  if (!/^[a-f0-9]{8,32}$/i.test(code) || !validCommunityFilename(filename)) throw new Error('Invalid community entry.');
  const content = await communityFetch(`/api/presets/${encodeURIComponent(code)}/download`);
  if (typeof content !== 'string' || !content.length || content.length > 400000) throw new Error('The community download is invalid or too large.');
  ensureDir(communityDownloadsRoot());
  const targetName = `${code}-${filename}`;
  fs.writeFileSync(path.join(communityDownloadsRoot(), targetName), content, 'utf8');
  return { ok: true, fileName: targetName, folder: communityDownloadsRoot() };
}
async function uploadCommunityPreset(metadata = {}) {
  const state = await getCommunityState();
  if (!state.websiteAccount?.username) throw new Error('Please sign in to the community window first.');
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Select Vortex Preset or Macro', properties: ['openFile'], filters: [{ name: 'Vortex preset or macro', extensions: ['txt'] }] });
  if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
  const source = choice.filePaths[0];
  const content = fs.readFileSync(source, 'utf8');
  if (!content.length || Buffer.byteLength(content, 'utf8') > 400000) throw new Error('The file must be between 1 byte and 400 KB in size.');
  const isMacro = content.trim().startsWith('vortex-macro:');
  const filename = isMacro ? 'macro.txt' : String(metadata.filename || path.basename(source));
  if (!isMacro && !validCommunityFilename(filename)) throw new Error('A preset must be named preset1.txt, preset2.txt or preset3.txt.');
  const name = String(metadata.name || path.basename(source, path.extname(source))).trim().slice(0, 60);
  const description = String(metadata.description || '').trim().slice(0, 500);
  if (!name) throw new Error('Please provide a name for your community submission.');
  const visibility = metadata.visibility === 'unlisted' ? 'unlisted' : 'public';
  const result = await communityFetch('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, filename, description, visibility, content }) });
  return { ok: true, shareCode: result.shareCode || null, kind: isMacro ? 'macro' : 'preset' };
}
function normalizeStudioSkinData(dataUri) {
  const value = String(dataUri || '');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('The Skin Studio must provide a PNG image.');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > 96 * 1024) throw new Error('The 64×64 skin PNG is invalid or too large.');
  const skin = PNG.sync.read(buffer);
  if (skin.width !== 64 || skin.height !== 64) throw new Error('The Skin Studio image must be exactly 64×64 pixels.');
  return { buffer, dataUri: `data:image/png;base64,${buffer.toString('base64')}` };
}
function saveStudioSkinPreview(version, dataUri, sourceName = 'skin-studio') {
  if (version !== COSMETICS_MOD_VERSION) throw new Error('The Skin Studio is available for Minecraft 1.21.11.');
  const { buffer, dataUri: normalizedData } = normalizeStudioSkinData(dataUri);
  const name = safeFileName(String(sourceName || 'skin-studio')).slice(0, 60) || 'skin-studio';
  const previewName = `vortex-preview-${name}.png`;
  ensureDir(previewSkinsRoot(version));
  fs.writeFileSync(path.join(previewSkinsRoot(version), previewName), buffer);
  const profile = {
    previewSkin: previewName,
    createdAt: new Date().toISOString(),
    source: 'launcher-skin-studio-preview-only',
    launcher: `Vortex Client Launcher ${app.getVersion()}`
  };
  writeJson(previewProfileFile(version), profile);
  // Keep the Core-facing profile explicitly skin-free even if an old profile existed.
  removeLegacyCosmeticOverlays(version);
  return { ok: true, profile, preview: normalizedData };
}
function validCommunitySkinCode(value) { return /^[a-f0-9]{8,32}$/i.test(String(value || '')); }
async function communitySkinBinaryFetch(shareCode) {
  const code = String(shareCode || '');
  if (!validCommunitySkinCode(code)) throw new Error('Invalid Community skin ID.');
  const cookie = await communityCookieHeader();
  const headers = { Accept: 'image/png', 'User-Agent': MODRINTH_USER_AGENT };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${COMMUNITY_BASE_URL}/api/skins/${encodeURIComponent(code)}/download`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.error || `Community skin responded with ${response.status}.`); }
  if (!(response.headers.get('content-type') || '').includes('image/png')) throw new Error('The Community did not provide a PNG skin.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 96 * 1024) throw new Error('The Community skin is invalid or too large.');
  const skin = PNG.sync.read(buffer);
  if (skin.width !== 64 || skin.height !== 64) throw new Error('The Community skin is not a valid 64×64 Minecraft skin.');
  return buffer;
}
async function listCommunitySkins() {
  const skins = await communityFetch('/api/skins');
  return Array.isArray(skins) ? skins.slice(0, 60).map(item => {
    const preview = String(item.preview || '');
    return {
      id: Number(item.id || 0), name: String(item.name || 'Unnamed Skin').slice(0, 60),
      description: String(item.description || '').slice(0, 500), downloads: Number(item.downloads || 0),
      createdAt: item.createdAt || item.created_at || null, shareCode: validCommunitySkinCode(item.shareCode || item.share_code) ? String(item.shareCode || item.share_code) : '',
      username: String(item.displayName || item.display_name || item.username || 'Community').slice(0, 60),
      preview: /^data:image\/png;base64,[A-Za-z0-9+/=]{1,131072}$/.test(preview) ? preview : null
    };
  }).filter(item => item.shareCode && item.preview) : [];
}
async function uploadCommunitySkin(metadata = {}) {
  const state = await getCommunityState();
  if (!state.websiteAccount?.username) throw new Error('Please sign in to the Community before publishing a skin.');
  const name = String(metadata.name || '').trim().slice(0, 60);
  const description = String(metadata.description || '').trim().slice(0, 500);
  if (!name) throw new Error('Give your Community skin a title first.');
  const { dataUri } = normalizeStudioSkinData(metadata.skinData);
  const visibility = metadata.visibility === 'unlisted' ? 'unlisted' : 'public';
  const result = await communityFetch('/api/skins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, visibility, skinData: dataUri }) });
  return { ok: true, shareCode: result.shareCode || null };
}
async function downloadCommunitySkin(shareCode) {
  const code = String(shareCode || '');
  const buffer = await communitySkinBinaryFetch(code);
  ensureDir(communityDownloadsRoot());
  const fileName = `community-skin-${code}.png`;
  fs.writeFileSync(path.join(communityDownloadsRoot(), fileName), buffer);
  return { ok: true, fileName, folder: communityDownloadsRoot() };
}
async function useCommunitySkin(shareCode, version = COSMETICS_MOD_VERSION) {
  const code = String(shareCode || '');
  const buffer = await communitySkinBinaryFetch(code);
  const profile = saveStudioSkinPreview(version, `data:image/png;base64,${buffer.toString('base64')}`, `community-${code}`);
  const skin = await communityFetch(`/api/skins/${encodeURIComponent(code)}`).catch(() => null);
  return { ...profile, name: String(skin?.name || 'Community skin').slice(0, 60) };
}
function openCommunityLogin() {
  const communityWindow = new BrowserWindow({ width: 520, height: 720, title: 'Sign in to Vortex Community', parent: mainWindow, modal: true, backgroundColor: '#090d18', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const notifyIfLoggedIn = async () => {
    const state = await getCommunityState();
    if (state.websiteAccount?.username) {
      send('community-state', state);
      send('status', { type: 'success', message: `Signed in to the community as ${state.websiteAccount.display_name || state.websiteAccount.username}.` });
      if (!communityWindow.isDestroyed()) communityWindow.close();
    }
  };
  communityWindow.webContents.on('did-navigate', () => { void notifyIfLoggedIn(); });
  communityWindow.loadURL(`${COMMUNITY_BASE_URL}/login.html`);
  return { ok: true };
}
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  send('update-state', updateState);
  return updateState;
}
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', info => setUpdateState({ status: 'available', availableVersion: info.version, progress: 0, error: null }));
  autoUpdater.on('update-not-available', info => setUpdateState({ status: 'up-to-date', availableVersion: info.version || null, progress: 0, error: null }));
  autoUpdater.on('download-progress', progress => setUpdateState({ status: 'downloading', progress: Math.round(progress.percent), error: null }));
  autoUpdater.on('update-downloaded', info => setUpdateState({ status: 'downloaded', availableVersion: info.version, progress: 100, error: null }));
  autoUpdater.on('error', error => setUpdateState({ status: 'error', error: error.message || String(error) }));
}
async function checkForUpdates() {
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates are disabled in development mode.' });
  // Electron-updater permits only one metadata request at a time. Manual and
  // background checks therefore share this guard instead of racing each other.
  if (updateCheckInFlight) return updateState;
  updateCheckInFlight = true;
  try { await autoUpdater.checkForUpdates(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
  finally { updateCheckInFlight = false; }
}
function startBackgroundUpdateChecks() {
  if (!app.isPackaged) return;
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  // Check shortly after launch and then repeatedly while the launcher remains open.
  setTimeout(() => { void checkForUpdates(); }, 2000);
  updateCheckTimer = setInterval(() => { void checkForUpdates(); }, UPDATE_CHECK_INTERVAL_MS);
}
async function downloadUpdate() {
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates are disabled in development mode.' });
  try { await autoUpdater.downloadUpdate(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
}

function accountId(value = {}) { const uuid = String(value.uuid || '').trim().toLowerCase(); return uuid || `name:${String(value.username || '').trim().toLowerCase()}`; }
function profileImagePath(value) { const file = String(value?.profileImage || ''); return /^[a-z0-9][a-z0-9._-]{0,100}\.(png|jpe?g|webp)$/i.test(file) ? path.join(profileImagesRoot, file) : null; }
function dataUriForImage(file) { if (!file || !exists(file)) return null; const size = fs.statSync(file).size; if (!size || size > 5 * 1024 * 1024) return null; const extension = path.extname(file).toLowerCase(); const type = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'; return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`; }
function validModrinthIconUrl(value) { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com'; } catch (_) { return false; } }
function modIconFile(projectId, extension = '.png') { return path.join(modImagesRoot, `modrinth-${safeFileName(projectId)}${extension}`); }
async function cachedModIconData(projectId, iconUrl) {
  const key = safeFileName(projectId);
  if (!key || !validModrinthIconUrl(iconUrl)) return null;
  for (const extension of ['.png', '.jpg', '.webp']) { const cached = dataUriForImage(modIconFile(key, extension)); if (cached) return cached; }
  try {
    const response = await fetch(iconUrl, { headers: { Accept: 'image/png,image/jpeg,image/webp' }, signal: AbortSignal.timeout(15000) });
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const extension = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : contentType === 'image/jpeg' ? '.jpg' : null;
    if (!response.ok || !extension) return null;
    const image = Buffer.from(await response.arrayBuffer());
    if (!image.length || image.length > 3 * 1024 * 1024) return null;
    ensureDir(modImagesRoot); const file = modIconFile(key, extension); fs.writeFileSync(file, image);
    return dataUriForImage(file);
  } catch (_) { return null; }
}
function accountSummary(value) { return { id: accountId(value), username: String(value?.username || 'Minecraft Player'), uuid: String(value?.uuid || ''), hasCustomProfileImage: Boolean(dataUriForImage(profileImagePath(value))) }; }
function avatarFromMinecraftSkin(skin) {
  const avatar = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
    const sourceIndex = ((8 + y) * skin.width + (8 + x)) << 2;
    const hatIndex = ((8 + y) * skin.width + (40 + x)) << 2;
    for (let scaleY = 0; scaleY < 8; scaleY += 1) for (let scaleX = 0; scaleX < 8; scaleX += 1) {
      const targetIndex = ((y * 8 + scaleY) * 64 + (x * 8 + scaleX)) << 2;
      avatar.data[targetIndex] = skin.data[sourceIndex]; avatar.data[targetIndex + 1] = skin.data[sourceIndex + 1]; avatar.data[targetIndex + 2] = skin.data[sourceIndex + 2]; avatar.data[targetIndex + 3] = skin.data[sourceIndex + 3];
      if (skin.data[hatIndex + 3]) { avatar.data[targetIndex] = skin.data[hatIndex]; avatar.data[targetIndex + 1] = skin.data[hatIndex + 1]; avatar.data[targetIndex + 2] = skin.data[hatIndex + 2]; avatar.data[targetIndex + 3] = skin.data[hatIndex + 3]; }
    }
  }
  return PNG.sync.write(avatar);
}
async function minecraftAvatarData(value) {
  const uuid = String(value?.uuid || '').replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/i.test(uuid)) return null;
  const cache = path.join(profileImagesRoot, `minecraft-${uuid.toLowerCase()}.png`);
  const cached = dataUriForImage(cache); if (cached) return cached;
  try {
    const profileResponse = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, { signal: AbortSignal.timeout(15000) });
    if (!profileResponse.ok) return null;
    const profile = await profileResponse.json();
    const property = (profile.properties || []).find(entry => entry.name === 'textures' && typeof entry.value === 'string');
    const skinUrl = property ? JSON.parse(Buffer.from(property.value, 'base64').toString('utf8'))?.textures?.SKIN?.url : null;
    if (!/^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(skinUrl || '')) return null;
    const skinResponse = await fetch(skinUrl, { signal: AbortSignal.timeout(15000) });
    if (!skinResponse.ok) return null;
    const skin = PNG.sync.read(Buffer.from(await skinResponse.arrayBuffer()));
    if (skin.width !== 64 || skin.height < 32) return null;
    ensureDir(profileImagesRoot); fs.writeFileSync(cache, avatarFromMinecraftSkin(skin));
    return dataUriForImage(cache);
  } catch (_) { return null; }
}
async function accountAvatar(value) { return dataUriForImage(profileImagePath(value)) || minecraftAvatarData(value); }
function saveAccounts() { const activeAccountId = account ? accountId(account) : null; writeJson(accountFile, { schemaVersion: 2, activeAccountId, accounts }); }
function loadAccount() {
  const stored = loadJson(accountFile, null);
  if (stored && Array.isArray(stored.accounts)) {
    const unique = new Map();
    for (const entry of stored.accounts) if (entry && typeof entry === 'object' && entry.auth) unique.set(accountId(entry), entry);
    accounts = [...unique.values()];
    account = accounts.find(entry => accountId(entry) === stored.activeAccountId) || accounts[0] || null;
    if (accountId(account || {}) !== String(stored.activeAccountId || '')) saveAccounts();
    return;
  }
  accounts = stored && typeof stored === 'object' && stored.auth ? [stored] : [];
  account = accounts[0] || null;
  if (stored) saveAccounts();
}
function saveAccount(value) {
  const id = accountId(value);
  accounts = [value, ...accounts.filter(entry => accountId(entry) !== id)];
  account = value;
  saveAccounts();
  return account;
}
function updateAccountSession(value) {
  const id = accountId(value);
  accounts = [value, ...accounts.filter(entry => accountId(entry) !== id)];
  if (account && accountId(account) === id) account = value;
  saveAccounts();
  return value;
}
async function signInToMinecraft() {
  const authManager = new Auth('select_account');
  const xboxManager = await authManager.launch('electron', { width: 520, height: 720, resizable: false });
  const token = await xboxManager.getMinecraft();
  const profile = token.profile || {};
  const signedIn = saveAccount({ username: profile.name || 'Minecraft player', uuid: profile.id || '', auth: token.mclc(true) });
  return signedIn;
}
async function validateMinecraftAccessToken(auth) {
  if (!auth?.access_token) return false;
  try {
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${auth.access_token}` }
    });
    // Only a definitive 401 means the token is invalid. Temporary service errors
    // should not prevent the user from starting Minecraft.
    return response.status !== 401;
  } catch {
    return true;
  }
}
async function refreshMinecraftAuthorization(savedAccount) {
  const previous = savedAccount?.auth;
  const refreshToken = previous?.meta?.refresh;
  if (!previous?.access_token || !refreshToken) {
    send('status', { type: 'info', message: 'Your saved Minecraft session needs a one-time reauthentication …' });
    return (await signInToMinecraft()).auth;
  }
  try {
    const authManager = new Auth('select_account');
    const minecraft = await tokenUtils.fromMclcToken(authManager, previous, true);
    const profile = minecraft?.profile || {};
    const refreshedAuth = minecraft?.mclc?.(true);
    if (!refreshedAuth?.access_token || !refreshedAuth?.meta?.refresh || !profile?.id) throw new Error('The refreshed Minecraft session is incomplete.');
    const refreshedAccount = { ...savedAccount, username: profile.name || savedAccount.username, uuid: profile.id || savedAccount.uuid, auth: refreshedAuth };
    updateAccountSession(refreshedAccount);
    if (!(await validateMinecraftAccessToken(refreshedAuth))) {
      send('status', { type: 'info', message: 'The saved Minecraft session is invalid. Please sign in again …' });
      return (await signInToMinecraft()).auth;
    }
    return refreshedAuth;
  } catch (error) {
    throw new Error(`Minecraft session refresh failed. Sign in again to continue. (${error.message || error})`);
  }
}
function selectAccount(id) {
  const selected = accounts.find(entry => accountId(entry) === String(id || ''));
  if (!selected) return null;
  account = selected;
  saveAccounts();
  return account;
}
function removeAccount(id) {
  const targetId = String(id || '');
  const removed = accounts.find(entry => accountId(entry) === targetId);
  if (!removed) return null;
  accounts = accounts.filter(entry => accountId(entry) !== targetId);
  if (account && accountId(account) === targetId) account = accounts[0] || null;
  saveAccounts();
  return removed;
}
function accountSummaries() { return accounts.map(accountSummary); }
function normalizeServerAddress(value) {
  const input = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!input || input.length > 253 || /[\s/\\@]/.test(input)) return null;
  const parts = input.split(':'); if (parts.length > 2) return null;
  const host = parts[0]; const port = parts[1] || '';
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return null;
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return null;
  return port ? `${host}:${Number(port)}` : host;
}
function normalizeServer(entry) {
  const name = String(entry?.name || '').trim().replace(/\s+/g, ' ').slice(0, 42);
  const address = normalizeServerAddress(entry?.address);
  const id = String(entry?.id || '');
  if (!name || !address || !/^[a-z0-9][a-z0-9_-]{3,60}$/i.test(id)) return null;
  return { id, name, address, official: false, addedAt: String(entry?.addedAt || '') };
}
function serverLibrary() {
  const stored = loadJson(serversFile, {}); const seen = new Set([OFFICIAL_SERVER.address]);
  const custom = Array.isArray(stored?.servers) ? stored.servers.map(normalizeServer).filter(Boolean).filter(server => !seen.has(server.address) && Boolean(seen.add(server.address))).slice(0, 50) : [];
  return [OFFICIAL_SERVER, ...custom];
}
function cachedServerStatus(id) { return serverStatusCache.get(String(id || ''))?.status || null; }
function serverSummary(server) { return { id: server.id, name: server.name, address: server.address, official: Boolean(server.official), status: cachedServerStatus(server.id), addedAt: server.addedAt || '' }; }
function serverSummaries() { return serverLibrary().map(serverSummary); }
function saveServerLibrary(servers) { writeJson(serversFile, { schemaVersion: 3, servers: servers.filter(server => !server.official).map(({ id, name, address, addedAt }) => ({ id, name, address, addedAt })) }); }
function serverById(id) { return serverLibrary().find(server => server.id === String(id || '')) || null; }
async function refreshServerStatus(id, force = false) {
  const server = serverById(id);
  if (!server) return { ok: false, error: 'The server was not found.' };
  const cached = serverStatusCache.get(server.id);
  if (!force && cached && Date.now() - cached.updatedAt < SERVER_STATUS_CACHE_MS) return { ok: true, server: serverSummary(server), status: cached.status, cached: true };
  if (serverStatusPending.has(server.id)) return serverStatusPending.get(server.id);
  const task = (async () => {
    const status = await getMinecraftServerStatus(server.address);
    serverStatusCache.set(server.id, { status, updatedAt: Date.now() });
    return { ok: true, server: serverSummary(server), status, cached: false };
  })();
  serverStatusPending.set(server.id, task);
  try { return await task; }
  finally { if (serverStatusPending.get(server.id) === task) serverStatusPending.delete(server.id); }
}
function loadState() {
  const legacy = loadJson(stateFile, {});
  return {
    selectedVersion: sanitizeVersion(legacy.selectedVersion) || COSMETICS_MOD_VERSION,
    selectedServerId: serverById(legacy.selectedServerId)?.id || OFFICIAL_SERVER.id,
    hat: HATS.includes(legacy.hat) ? legacy.hat : 'vortex-cap',
    emblem: EMBLEMS.includes(legacy.emblem) ? legacy.emblem : 'vortex-crest'
  };
}
function saveState(patch) { const state = { ...loadState(), ...patch }; if (!serverById(state.selectedServerId)) state.selectedServerId = OFFICIAL_SERVER.id; writeJson(stateFile, state); return state; }

function copyIfChanged(source, destination) {
  if (!exists(destination) || fs.statSync(source).size !== fs.statSync(destination).size || hashFile(source) !== hashFile(destination)) {
    fs.copyFileSync(source, destination);
    return true;
  }
  return false;
}
function bundledModFiles(version) {
  const dir = path.join(assetsRoot(), 'modpacks', version);
  return exists(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.jar')) : [];
}
function isProtectedCosmeticsMod(name) { return /^(?:vortexclient|vortex[-_]plus[-_]addon).*\.jar$/i.test(name); }
function mandatoryModNames(version) { return new Set(bundledModFiles(version)); }
function protectedModNames(version) { return new Set(bundledModFiles(version).filter(isProtectedCosmeticsMod)); }
function cosmeticFiles(version) {
  const dir = skinsRoot(version);
  if (!exists(dir)) return [];
  // Every PNG in this Core-owned directory is a legacy override candidate. Launcher-only
  // previews are now stored under config/vortexlauncher and never in this directory.
  return fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.png'));
}
function loadCosmeticProfile(version) {
  return loadJson(profileFile(version), { hat: loadState().hat, emblem: loadState().emblem, baseSkin: null, generatedSkin: null, updatedAt: null });
}
// The Cosmetics Core reads this file directly every two seconds. Keep the selected
// 3D hat here independently of the optional generated skin workflow.
function applyHatChoice(version, hat) {
  const normalized = sanitizeVersion(version);
  if (!normalized || !HATS.includes(hat)) return;
  const previous = loadJson(profileFile(normalized), {});
  // Hats and capes are rendered as 3D cosmetics. Never activate a generated skin here:
  // the signed-in Minecraft account must keep its original Mojang/Microsoft skin.
  const { baseSkin, generatedSkin, previewSkin, skin, skinPath, activeSkin, selectedSkin, customSkin, ...cosmeticOnly } = previous;
  writeJson(profileFile(normalized), {
    ...cosmeticOnly,
    hat,
    baseSkin: null,
    generatedSkin: null,
    previewSkin: null,
    skin: null,
    skinPath: null,
    activeSkin: null,
    selectedSkin: null,
    customSkin: null,
    skinOverrideDisabled: true,
    updatedAt: new Date().toISOString(),
    source: 'launcher-3d-cosmetics-no-skin-override',
    launcher: `Vortex Client Launcher ${app.getVersion()}`
  });
}
function applyHatChoiceToAllInstances(hat) {
  for (const version of SUPPORTED_VERSIONS) applyHatChoice(version, hat);
}
function removeLegacyCosmeticOverlays(version) {
  const dir = skinsRoot(version);
  let removed = 0;
  if (exists(dir)) {
    for (const name of cosmeticFiles(version)) {
      try { fs.rmSync(path.join(dir, name), { force: true }); removed += 1; } catch (_) {}
    }
  }
  // Clear any profile values that the legacy SkinOverrideMixin may use. The file still
  // remains authoritative for the selected real 3D hat and cape, never for player skin data.
  const previous = loadJson(profileFile(version), {});
  // Strip, rather than preserve, every known skin path/selection key from old Core builds.
  // The Core profile may only contain settings for real 3D cosmetics.
  const { baseSkin, generatedSkin, previewSkin, skin, skinPath, activeSkin, selectedSkin, customSkin, ...cosmeticOnly } = previous;
  writeJson(profileFile(version), {
    ...cosmeticOnly,
    baseSkin: null,
    generatedSkin: null,
    previewSkin: null,
    skin: null,
    skinPath: null,
    activeSkin: null,
    selectedSkin: null,
    customSkin: null,
    skinOverrideDisabled: true,
    cleanedAt: new Date().toISOString(),
    source: 'launcher-hard-skin-override-cleanup',
    launcher: `Vortex Client Launcher ${app.getVersion()}`
  });
  return removed;
}

function hasFabricProfile(version) {
  const versionsDir = path.join(instanceRoot(version), 'versions');
  if (!exists(versionsDir)) return false;
  return fs.readdirSync(versionsDir).some(name => /^fabric-loader-/.test(name) && exists(path.join(versionsDir, name, `${name}.json`)));
}
function maintainBundledMods(version) {
  const normalized = sanitizeVersion(version);
  if (!normalized) return { installed: 0, replaced: 0 };
  const mods = modsRoot(normalized);
  ensureDir(mods);
  const replaced = cleanReplacedVortexJars(normalized, mods);
  const removedSkinOverlays = removeLegacyCosmeticOverlays(normalized);
  applyWebsiteCapeChoice(normalized);
  applyHatChoice(normalized, loadState().hat);
  let installed = 0;
  const bundleDir = path.join(assetsRoot(), 'modpacks', normalized);
  for (const name of bundledModFiles(normalized)) {
    if (copyIfChanged(path.join(bundleDir, name), path.join(mods, name))) installed += 1;
  }
  return { installed, replaced, removedSkinOverlays };
}
async function maintainInstancesSilently() {
  if (instanceMaintenanceRunning) return;
  instanceMaintenanceRunning = true;
  const repairedVersions = [];
  try {
    for (const version of SUPPORTED_VERSIONS) {
      ensureDir(instanceRoot(version));
      ensureDir(vortexConfigRoot(version));
      const repair = maintainBundledMods(version);
      let fabricInstalled = false;
      if (!hasFabricProfile(version)) {
        try { await installFabricProfile(version, instanceRoot(version)); fabricInstalled = true; }
        catch (error) { send('log', `Fabric check for ${version} will be retried: ${error.message}`); }
      }
      if (repair.installed || repair.replaced || fabricInstalled) {
        repairedVersions.push(version);
        const details = [];
        if (repair.installed) details.push(`${repair.installed} bundled mod(s) repaired`);
        if (fabricInstalled) details.push('Fabric profile restored');
        if (repair.replaced) details.push('modified Vortex files replaced');
        if (repair.removedSkinOverlays) details.push(`${repair.removedSkinOverlays} old skin overlay(s) removed`);
        send('status', { type: 'success', message: `Instance maintenance ${version}: ${details.join(', ')}.` });
      }
    }
    lastMaintenance = { checkedAt: new Date().toISOString(), repairedVersions };
    send('instance-maintenance', lastMaintenance);
  } finally { instanceMaintenanceRunning = false; }
}
function startInstanceMaintenance() {
  if (instanceMaintenanceTimer) clearInterval(instanceMaintenanceTimer);
  void maintainInstancesSilently();
  instanceMaintenanceTimer = setInterval(() => { void maintainInstancesSilently(); }, 1000);
}
function getInstanceSummary(version) {
  const root = instanceRoot(version);
  const mods = modsRoot(version);
  const coreFiles = bundledModFiles(version);
  const present = exists(mods) ? fs.readdirSync(mods).filter(name => name.endsWith('.jar')) : [];
  const required = mandatoryModNames(version);
  return {
    version,
    root,
    ready: coreFiles.length > 0 && coreFiles.every(name => exists(path.join(mods, name))),
    coreModCount: coreFiles.length,
    totalModCount: present.length,
    customModCount: present.filter(name => !required.has(name)).length,
    fabricInstalled: hasFabricProfile(version),
    cosmeticsSupported: protectedModNames(version).size > 0,
    cosmeticsModPresent: [...protectedModNames(version)].some(name => exists(path.join(mods, name))),
    cosmeticsModNames: [...protectedModNames(version)],
    cosmeticSkinCount: cosmeticFiles(version).length,
    cosmeticProfile: version === COSMETICS_MOD_VERSION ? loadCosmeticProfile(version) : null
  };
}

async function installFabricProfile(version, root) {
  const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`);
  if (!response.ok) throw new Error(`Fabric metadata could not be loaded (${response.status}).`);
  const loaders = await response.json();
  const preferred = loaders.find(entry => entry.loader?.stable) || loaders[0];
  if (!preferred?.loader?.version) throw new Error(`No Fabric Loader is available for Minecraft ${version}.`);
  const loaderVersion = preferred.loader.version;
  const profileResponse = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  if (!profileResponse.ok) throw new Error(`Fabric profile could not be loaded (${profileResponse.status}).`);
  const profile = await profileResponse.json();
  const profileId = `fabric-loader-${loaderVersion}-${version}`;
  profile.id = profileId;
  const profileDir = path.join(root, 'versions', profileId);
  ensureDir(profileDir);
  writeJson(path.join(profileDir, `${profileId}.json`), profile);
  return { profileId, loaderVersion };
}

function cleanReplacedVortexJars(version, modsDir) {
  const allowed = mandatoryModNames(version);
  if (!exists(modsDir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(modsDir)) {
    const baseName = name.replace(/\.disabled$/i, '');
    if (/^(?:vortexclient|vortex[-_]plus[-_]addon).*\.jar$/i.test(name) && (!allowed.has(baseName) || name.endsWith('.disabled'))) {
      fs.rmSync(path.join(modsDir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

async function ensureInstance(version) {
  const normalized = sanitizeVersion(version);
  if (!normalized) throw new Error('Invalid Minecraft release version. Use a release such as 1.20.1 or 26.2.');
  const root = instanceRoot(normalized);
  const mods = modsRoot(normalized);
  ensureDir(mods);
  ensureDir(vortexConfigRoot(normalized));
  send('status', { type: 'info', message: `Preparing Minecraft ${normalized}${bundledModFiles(normalized).length ? ' with Vortex enhancements' : ' with Fabric (vanilla-compatible)'}…` });
  const { installed, replaced } = maintainBundledMods(normalized);
  const requiredFiles = bundledModFiles(normalized);
  const missingFiles = requiredFiles.filter(name => !exists(path.join(mods, name)));
  if (missingFiles.length) {
    throw new Error(`Vortex core installation failed for Minecraft ${normalized}. Missing: ${missingFiles.join(', ')}`);
  }
  if (installed) send('log', `Installed ${installed} bundled Vortex mod file(s) into ${mods}.`);
  if (replaced) send('log', `Replaced outdated or disabled Vortex core mod files in ${normalized}.`);
  if (normalized === COSMETICS_MOD_VERSION) {
    const capeChoice = loadJson(websiteCapeConfigPath(normalized), { cape: null });
    const capeId = capeChoice && typeof capeChoice.cape === 'string' ? capeChoice.cape : null;
    if (capeId) {
      const capeFile = path.join(instanceRoot(normalized), 'config', 'vortex-client', 'capes', `${safeFileName(capeId)}.png`);
      if (!exists(capeFile)) {
        if (!installBundledCape(normalized, capeId)) throw new Error(`Selected Vortex cape '${capeId}' is missing from the 1.21.11 instance.`);
      }
      send('log', `Cape verified: ${capeId}; vanilla cape suppression is enabled by the Cosmetics core.`);
    } else {
      send('log', 'No Vortex cape selected; the normal Minecraft cape remains unchanged.');
    }
  }
  const cosmeticState = loadState();
  const protectedCosmetics = [...protectedModNames(normalized)];
  if (protectedCosmetics.length) send('log', `Vortex Cosmetics core protected: ${protectedCosmetics.join(', ')}`);
  writeJson(path.join(vortexConfigRoot(normalized), 'launcher-profile.json'), {
    launcher: 'Vortex Client Launcher',
    version: normalized,
    memoryProfile: 'managed-2G-4G',
    cosmetics: normalized === COSMETICS_MOD_VERSION ? loadCosmeticProfile(normalized) : null,
    launcherSelection: cosmeticState,
    generatedAt: new Date().toISOString()
  });
  send('status', { type: 'info', message: `Preparing Fabric for ${normalized}…` });
  const fabric = await installFabricProfile(normalized, root);
  send('status', { type: 'success', message: `Minecraft ${normalized} ready: Fabric ${fabric.loaderVersion}${bundledModFiles(normalized).length ? `, ${bundledModFiles(normalized).length} Vortex mods verified` : ', no Vortex core required'}.` });
  return { ...getInstanceSummary(normalized), installed, replaced, fabric };
}

function parallelGameRoot(version, accountValue) {
  const accountKey = safeFileName(accountId(accountValue)).slice(0, 48);
  return path.join(instancesRoot, `${version}-parallel-${accountKey}`);
}
function copyParallelDirectory(source, target) {
  if (!exists(source)) return;
  fs.cpSync(source, target, { recursive: true, force: true, dereference: true });
}
function prepareParallelGameDirectory(version, accountValue) {
  const base = instanceRoot(version);
  const target = parallelGameRoot(version, accountValue);
  ensureDir(target);
  // Libraries, assets and Fabric version metadata remain shared through the prepared
  // base root. Only actual game data is copied, avoiding Minecraft's session lock.
  for (const name of ['mods', 'config', 'resourcepacks', 'shaderpacks']) copyParallelDirectory(path.join(base, name), path.join(target, name));
  for (const name of ['options.txt', 'servers.dat']) {
    const source = path.join(base, name);
    if (exists(source)) { ensureDir(target); fs.copyFileSync(source, path.join(target, name)); }
  }
  return target;
}
function runningProcessKey(kind, accountValue) { return `${kind}:${accountId(accountValue)}`; }
async function startMinecraftSession({ accountValue, version, server, parallel, gameDirectoryOverride = null }) {
  if (!accountValue?.auth) throw new Error('Please sign in to a Minecraft Microsoft account first.');
  const key = runningProcessKey(parallel ? 'parallel' : 'primary', accountValue);
  if ([...minecraftProcesses.values()].some(entry => entry.accountId === accountId(accountValue))) throw new Error(`${accountValue.username} already has a running Vortex Minecraft session.`);
  if (!parallel && [...minecraftProcesses.values()].some(entry => entry.kind === 'primary')) throw new Error('The primary Vortex instance is already running. Switch to another saved account and use Launch Vortex again.');
  const authorization = await refreshMinecraftAuthorization(accountValue);
  const instance = await ensureInstance(version);
  const gameDirectory = gameDirectoryOverride || (parallel ? prepareParallelGameDirectory(version, accountValue) : instance.root);
  const launcher = new Client();
  launcher.on('debug', message => send('log', String(message)));
  launcher.on('data', message => send('log', String(message)));
  launcher.on('download-status', data => send('progress', data));
  launcher.on('progress', data => send('progress', data));
  const javaPath = await javaPathForVersion(version);
  const options = { authorization, root: instance.root, version: { number: version, type: 'release', custom: instance.fabric.profileId }, memory: FIXED_MEMORY, javaPath: javaPath || undefined, overrides: { gameDirectory }, window: parallel ? { width: 960, height: 620 } : { width: 1280, height: 720 } };
  if (server) options.quickPlay = { type: 'multiplayer', identifier: server.address };
  const child = await launcher.launch(options);
  minecraftProcesses.set(key, { child, kind: parallel ? 'parallel' : 'primary', username: accountValue.username, accountId: accountId(accountValue), gameDirectory });
  child.on('close', code => {
    minecraftProcesses.delete(key);
    send('status', { type: 'info', message: `${accountValue.username}'s ${parallel ? 'second-account' : 'Minecraft'} session exited (Code ${code}).` });
  });
  return { server: server ? { id: server.id, name: server.name, address: server.address } : null, username: accountValue.username, gameDirectory, parallel };
}

function writePixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= 64 || y >= 64) return;
  const index = (png.width * y + x) << 2;
  png.data[index] = (color >> 16) & 255;
  png.data[index + 1] = (color >> 8) & 255;
  png.data[index + 2] = color & 255;
  png.data[index + 3] = (color >>> 24) & 255;
}
function fillPixels(png, x, y, width, height, color) { for (let xx = x; xx < x + width; xx++) for (let yy = y; yy < y + height; yy++) writePixel(png, xx, yy, color); }
function applyHat(png, hat) {
  if (hat === 'none') return;
  if (hat === 'vortex-cap') { fillPixels(png, 40, 8, 8, 3, 0xff126eff); fillPixels(png, 40, 11, 8, 2, 0xff0a346e); fillPixels(png, 42, 9, 4, 1, 0xff7feaff); fillPixels(png, 48, 8, 8, 3, 0xff1055bd); fillPixels(png, 32, 8, 8, 3, 0xff1055bd); fillPixels(png, 56, 8, 8, 3, 0xff0b2557); return; }
  if (hat === 'void-crown') { fillPixels(png, 40, 12, 8, 3, 0xff25133e); fillPixels(png, 41, 9, 2, 3, 0xffe9c55b); fillPixels(png, 44, 8, 2, 4, 0xffe9c55b); fillPixels(png, 47, 9, 1, 3, 0xffe9c55b); fillPixels(png, 48, 9, 8, 3, 0xffb883ff); fillPixels(png, 32, 9, 8, 3, 0xffb883ff); return; }
  if (hat === 'neon-halo') { fillPixels(png, 40, 8, 8, 1, 0xff66f6ff); writePixel(png, 40, 9, 0xff27bfe9); writePixel(png, 47, 9, 0xff27bfe9); fillPixels(png, 32, 8, 8, 1, 0xff42d4ff); fillPixels(png, 48, 8, 8, 1, 0xff42d4ff); fillPixels(png, 56, 8, 8, 1, 0xff2e9bff); return; }
  if (hat === 'cyber-headphones') { fillPixels(png, 32, 9, 2, 6, 0xff3ad6ff); fillPixels(png, 54, 9, 2, 6, 0xff3ad6ff); fillPixels(png, 34, 8, 4, 1, 0xff15447e); fillPixels(png, 50, 8, 4, 1, 0xff15447e); return; }
  if (hat === 'slime-antenna') { fillPixels(png, 43, 7, 2, 2, 0xff7dff85); writePixel(png, 44, 6, 0xffb5ff5b); fillPixels(png, 40, 9, 8, 1, 0xff2f7d48); }
}
function clearCapeOverlay(png) { fillPixels(png, 32, 36, 8, 12, 0x00000000); }
function drawCapeBase(png, colors) {
  const { base, shade, trim, light } = colors;
  // The outer back surface of the standard skin occupies rectangle x=32–39, y=36–47.
  fillPixels(png, 34, 36, 4, 1, trim);
  fillPixels(png, 33, 37, 6, 1, shade);
  fillPixels(png, 32, 38, 8, 7, base);
  fillPixels(png, 33, 45, 6, 1, base);
  fillPixels(png, 34, 46, 4, 1, base);
  fillPixels(png, 35, 47, 2, 1, shade);
  fillPixels(png, 32, 38, 1, 7, trim);
  fillPixels(png, 39, 38, 1, 7, shade);
  fillPixels(png, 33, 45, 6, 1, shade);
  fillPixels(png, 34, 46, 4, 1, shade);
  writePixel(png, 33, 38, light);
  writePixel(png, 34, 38, light);
}
function applyEmblem(png, emblem) {
  clearCapeOverlay(png);
  if (emblem === 'none') return;
  if (emblem === 'vortex-crest') {
    drawCapeBase(png, { base: 0xff0f3e9f, shade: 0xff081f55, trim: 0xff06132f, light: 0xff58ddff });
    writePixel(png, 34, 40, 0xff2ca8ff); writePixel(png, 37, 40, 0xff2ca8ff);
    writePixel(png, 35, 41, 0xff56dfff); writePixel(png, 36, 41, 0xff56dfff);
    writePixel(png, 35, 42, 0xff7cf4ff); writePixel(png, 36, 42, 0xff7cf4ff);
    writePixel(png, 35, 43, 0xff2199e8); writePixel(png, 36, 43, 0xff2199e8);
    return;
  }
  if (emblem === 'nebula-mark') {
    drawCapeBase(png, { base: 0xff52238d, shade: 0xff29134e, trim: 0xff160b2d, light: 0xffd9a7ff });
    fillPixels(png, 35, 40, 2, 1, 0xffe4c2ff); fillPixels(png, 34, 41, 4, 2, 0xffa860ff);
    writePixel(png, 33, 42, 0xff7b48df); writePixel(png, 38, 42, 0xff7b48df);
    fillPixels(png, 35, 43, 2, 1, 0xffe7d5ff);
    return;
  }
  if (emblem === 'void-rune') {
    drawCapeBase(png, { base: 0xff263447, shade: 0xff111b2a, trim: 0xff080d16, light: 0xffdae8ff });
    fillPixels(png, 35, 39, 2, 5, 0xffc6d7ed);
    fillPixels(png, 34, 40, 1, 1, 0xff718ba8); fillPixels(png, 37, 40, 1, 1, 0xff718ba8);
    fillPixels(png, 34, 42, 4, 1, 0xff9db5d0); writePixel(png, 35, 44, 0xffe9f3ff); writePixel(png, 36, 44, 0xffe9f3ff);
  }
}
async function fetchMinecraftSkinByUsername(username) {
  const normalized = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(normalized)) throw new Error('Please enter a valid Minecraft username.');
  const lookup = await fetch(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(30000) });
  if (!lookup.ok) throw new Error('This Minecraft username was not found.');
  const profile = await lookup.json();
  if (!/^[a-f0-9]{32}$/i.test(profile?.id || '')) throw new Error('The Minecraft profile is invalid.');
  const sessionProfile = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(profile.id)}`, { signal: AbortSignal.timeout(30000) });
  if (!sessionProfile.ok) throw new Error('Could not load the skin data.');
  const sessionData = await sessionProfile.json();
  const textureProperty = (sessionData.properties || []).find(property => property.name === 'textures' && typeof property.value === 'string');
  if (!textureProperty) throw new Error('No Minecraft skin is available for this profile.');
  const textureData = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8'));
  const url = textureData?.textures?.SKIN?.url;
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(url || '')) throw new Error('Could not securely determine the skin texture.');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not load the Minecraft skin.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('The skin file is invalid or too large.');
  const skin = PNG.sync.read(buffer);
  if (skin.width !== 64 || skin.height !== 64) throw new Error('The found skin does not have a valid 64×64 format.');
  const temporaryFile = path.join(previewSkinsRoot(COSMETICS_MOD_VERSION), `import-${safeFileName(profile.name || normalized)}.png`);
  ensureDir(previewSkinsRoot(COSMETICS_MOD_VERSION));
  fs.writeFileSync(temporaryFile, buffer);
  return { file: temporaryFile, username: profile.name || normalized };
}
function cosmeticSkinPreview(version = COSMETICS_MOD_VERSION) {
  const profile = loadJson(previewProfileFile(version), {});
  const fileName = profile.previewSkin || null;
  if (!fileName || !/^[a-z0-9][a-z0-9._-]*\.png$/i.test(fileName)) return { ok: true, preview: null, fileName: null };
  const file = path.join(previewSkinsRoot(version), fileName);
  if (!exists(file)) return { ok: true, preview: null, fileName: null };
  const data = fs.readFileSync(file).toString('base64');
  return { ok: true, preview: `data:image/png;base64,${data}`, fileName };
}
function makeCosmeticSkin(version, sourceFile, hat, emblem) {
  if (version !== COSMETICS_MOD_VERSION) throw new Error('The built-in Vortex Cosmetics preview currently supports Minecraft 1.21.11.');
  const source = PNG.sync.read(fs.readFileSync(sourceFile));
  if (source.width !== 64 || source.height !== 64) throw new Error('Please choose a valid Minecraft skin in 64×64 pixel format.');
  // A local import is preview-only. Do not draw hats/capes into the skin PNG and do not
  // populate baseSkin/generatedSkin: the Minecraft account's original skin must remain active.
  const baseName = safeFileName(path.basename(sourceFile, path.extname(sourceFile)));
  ensureDir(previewSkinsRoot(version));
  const previewName = `vortex-preview-${baseName}.png`;
  const target = path.join(previewSkinsRoot(version), previewName);
  fs.copyFileSync(sourceFile, target);
  const profile = {
    previewSkin: previewName,
    hat,
    emblem,
    createdAt: new Date().toISOString(),
    launcher: `Vortex Client Launcher ${app.getVersion()}`
  };
  writeJson(previewProfileFile(version), profile);
  // Do not write a skin path into launcher-cosmetics.json under any circumstance.
  removeLegacyCosmeticOverlays(version);
  return profile;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({ width: 1380, height: 880, minWidth: 1080, minHeight: 720, backgroundColor: '#060914', title: 'Vortex Client', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

process.on('uncaughtException', error => { appendPersistentLog(crashLogPath(), `uncaughtException: ${error?.stack || error}`); appendPersistentLog(launchLogPath(), `ERROR uncaughtException: ${error?.message || error}`); });
process.on('unhandledRejection', reason => { appendPersistentLog(crashLogPath(), `unhandledRejection: ${reason?.stack || reason}`); appendPersistentLog(launchLogPath(), `ERROR unhandledRejection: ${reason?.message || reason}`); });
app.whenReady().then(() => {
  loadAccount();
  setupAutoUpdater();
  createWindow();
  startInstanceMaintenance();
  startBackgroundUpdateChecks();
});
app.on('before-quit', () => {
  if (instanceMaintenanceTimer) clearInterval(instanceMaintenanceTimer);
  if (updateCheckTimer) clearInterval(updateCheckTimer);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-state', async () => ({ account: account ? accountSummary(account) : null, accounts: accountSummaries(), state: loadState(), servers: serverSummaries(), versions: availableMinecraftVersions().map(getInstanceSummary), cosmeticsVersion: COSMETICS_MOD_VERSION, bedrock: await getBedrockState(), update: updateState, maintenance: lastMaintenance, news: unreadReleaseNews(), community: await getCommunityState() }));
ipcMain.handle('toggle-fullscreen', () => { if (!mainWindow) return false; const next = !mainWindow.isFullScreen(); mainWindow.setFullScreen(next); return next; });
ipcMain.handle('is-fullscreen', () => Boolean(mainWindow?.isFullScreen()));
ipcMain.handle('list-servers', () => ({ ok: true, servers: serverSummaries(), selectedServerId: loadState().selectedServerId }));
ipcMain.handle('get-bedrock-state', () => getBedrockState());
ipcMain.handle('launch-bedrock', () => launchBedrock());
ipcMain.handle('refresh-server-status', async (_event, id, force = false) => {
  try { return await refreshServerStatus(id, Boolean(force)); }
  catch (error) { return { ok: false, error: error.message || 'Minecraft status could not be updated.' }; }
});
ipcMain.handle('add-server', (_event, input) => { try { const address = normalizeServerAddress(input?.address); const name = String(input?.name || '').trim().replace(/\s+/g, ' ').slice(0, 42); if (!name) throw new Error('Enter a server name.'); if (!address) throw new Error('Enter a valid server IP or domain.'); const existing = serverLibrary(); if (existing.some(server => server.address === address)) throw new Error('This server is already in your library.'); const server = { id: `server-${crypto.randomUUID()}`, name, address, official: false, addedAt: new Date().toISOString() }; saveServerLibrary([...existing, server]); const state = saveState({ selectedServerId: server.id }); return { ok: true, server: serverSummary(server), servers: serverSummaries(), state }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('select-server', (_event, id) => { const server = serverById(id); if (!server) return { ok: false, error: 'The selected server was not found.' }; return { ok: true, server, state: saveState({ selectedServerId: server.id }) }; });
ipcMain.handle('remove-server', (_event, id) => { const server = serverById(id); if (!server) return { ok: false, error: 'The server was not found.' }; if (server.official) return { ok: false, error: 'The official VortexPvP server is permanently available.' }; const remaining = serverLibrary().filter(item => item.id !== server.id); saveServerLibrary(remaining); serverStatusCache.delete(server.id); serverStatusPending.delete(server.id); const state = saveState({ selectedServerId: loadState().selectedServerId === server.id ? OFFICIAL_SERVER.id : loadState().selectedServerId }); return { ok: true, servers: serverSummaries(), state }; });
ipcMain.handle('mark-release-news-seen', () => ({ ok: true, news: markReleaseNewsSeen() }));
ipcMain.handle('get-account-avatar', async (_event, id) => { const selected = accounts.find(entry => accountId(entry) === String(id || '')); return { ok: Boolean(selected), avatar: selected ? await accountAvatar(selected) : null, custom: Boolean(selected && dataUriForImage(profileImagePath(selected))) }; });
ipcMain.handle('select-account-avatar', async (_event, id) => {
  try {
    const selected = accounts.find(entry => accountId(entry) === String(id || '')); if (!selected) throw new Error('The saved account was not found.');
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Choose profile picture', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
    const source = choice.filePaths[0]; const stat = fs.statSync(source); if (!stat.isFile() || !stat.size || stat.size > 5 * 1024 * 1024) throw new Error('Choose an image up to 5 MB.');
    const extension = path.extname(source).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('This image format is not supported.');
    ensureDir(profileImagesRoot); const fileName = `profile-${safeFileName(accountId(selected))}${extension}`; fs.copyFileSync(source, path.join(profileImagesRoot, fileName)); selected.profileImage = fileName; saveAccounts();
    return { ok: true, avatar: dataUriForImage(profileImagePath(selected)), custom: true };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('reset-account-avatar', async (_event, id) => {
  const selected = accounts.find(entry => accountId(entry) === String(id || '')); if (!selected) return { ok: false, error: 'The saved account was not found.' };
  const image = profileImagePath(selected); if (image) try { fs.rmSync(image, { force: true }); } catch (_) {}
  delete selected.profileImage; saveAccounts(); return { ok: true, avatar: await minecraftAvatarData(selected), custom: false };
});
ipcMain.handle('ai-get-state', () => aiStudio.getState());
ipcMain.handle('ai-save-key', (_event, key, provider, textModel) => { try { return { ok: true, state: aiStudio.saveKey(key, provider, textModel) }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-remove-key', () => ({ ok: true, state: aiStudio.removeKey() }));
ipcMain.handle('ai-generate-cape', async (_event, prompt) => { try { const result = await aiStudio.generateCape(prompt); send('status', { type: 'success', message: `AI cape '${result.design.title}' was saved locally for ${result.instances} instance(s).` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-create-mod-project', async (_event, prompt) => { try { const result = await aiStudio.createModProject(prompt); send('status', { type: 'success', message: `Private mod project template '${result.design.title}' was created locally.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-open-output', (_event, kind) => { const folder = aiStudio.openOutputFolder(kind); return shell.openPath(folder); });
ipcMain.handle('open-launch-log', () => { if (!exists(launchLogPath())) return { ok: false, error: 'No launcher log has been created yet.' }; shell.showItemInFolder(launchLogPath()); return { ok: true }; });
ipcMain.handle('open-crash-log', () => { if (!exists(crashLogPath())) return { ok: false, error: 'No crash log has been created yet.' }; shell.showItemInFolder(crashLogPath()); return { ok: true }; });
ipcMain.handle('get-website-cape-catalogue', async () => { const choice = loadJson(websiteCapeChoiceFile(), { cape: null }); try { return { ok: true, capes: await loadWebsiteCapeEntitlements(), choice, needsWebsiteLogin: false }; } catch (error) { const community = await getCommunityState(); return { ok: true, capes: [], choice, needsWebsiteLogin: !community.websiteAccount?.username, error: error.message }; } });ipcMain.handle('select-website-cape', async (_event, capeId) => { try { const normalizedId = capeId === null || capeId === '' ? null : String(capeId); if (normalizedId === null) { const choice = clearWebsiteCape(); send('log', 'Website cape removed.'); return { ok: true, choice, written: SUPPORTED_VERSIONS.length }; } const capes = await loadWebsiteCapeEntitlements(); const cape = capes.find(entry => entry.id === normalizedId); if (!cape) throw new Error('This cape is not unlocked for your signed-in website account.'); const result = installWebsiteCape(cape.id, await downloadWebsiteCape(cape)); send('log', `Website cape unlocked and installed: ${cape.id}.`); return { ok: true, ...result }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-get-state', () => getCommunityState());
ipcMain.handle('community-login', () => openCommunityLogin());
ipcMain.handle('community-list-presets', async () => { try { return { ok: true, presets: await listCommunityPresets() }; } catch (error) { return { ok: false, presets: [], error: error.message }; } });
ipcMain.handle('community-download-preset', async (_event, shareCode, filename) => { try { return await downloadCommunityPreset(shareCode, filename); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-upload-preset', async (_event, metadata) => { try { return await uploadCommunityPreset(metadata); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-list-skins', async () => { try { return { ok: true, skins: await listCommunitySkins() }; } catch (error) { return { ok: false, skins: [], error: error.message }; } });
ipcMain.handle('community-download-skin', async (_event, shareCode) => { try { return await downloadCommunitySkin(shareCode); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('search-mods', async (_event, query, version, page = 0) => { try { return { ok: true, ...await searchModrinth(query, version, page) }; } catch (error) { return { ok: false, results: [], page: 0, total: 0, hasNext: false, error: error.message }; } });
function copyImportedModFiles(version, sourceFiles, source, details = {}) {
  const normalized = sanitizeVersion(version);
  if (!normalized) throw new Error('Select a valid Minecraft version first.');
  const targetDir = modsRoot(normalized); ensureDir(targetDir);
  const imported = []; const skipped = []; const limit = 100 * 1024 * 1024;
  for (const sourcePath of sourceFiles || []) {
    const sourceFile = path.resolve(String(sourcePath || ''));
    const fileName = path.basename(sourceFile);
    if (!/^\S+\.jar(?:\.disabled)?$/i.test(fileName) || !exists(sourceFile)) { skipped.push(fileName || 'unknown file'); continue; }
    let stat; try { stat = fs.statSync(sourceFile); } catch (_) { skipped.push(fileName); continue; }
    if (!stat.isFile() || stat.size < 1024 || stat.size > limit) { skipped.push(fileName); continue; }
    const target = path.join(targetDir, fileName);
    if (exists(target)) { skipped.push(fileName); continue; }
    fs.copyFileSync(sourceFile, target, fs.constants.COPYFILE_EXCL);
    setModSource(normalized, fileName, source, details);
    imported.push(fileName);
  }
  return { ok: true, version: normalized, imported, skipped, source: sourceLabelFor(source) };
}
async function importExternalModFiles(version) {
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Import local Minecraft mod files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft Mods', extensions: ['jar'] }] });
  if (selection.canceled || !selection.filePaths.length) return { ok: false, canceled: true };
  return copyImportedModFiles(version, selection.filePaths, 'external');
}
async function transferModrinthProfileMods(version) {
  const defaultPath = path.join(process.env.APPDATA || app.getPath('appData'), 'ModrinthApp', 'profiles');
  const selection = await dialog.showOpenDialog(mainWindow, { title: 'Choose a Modrinth profile folder', defaultPath, properties: ['openDirectory'] });
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true };
  const selected = path.resolve(selection.filePaths[0]);
  const sourceMods = path.basename(selected).toLowerCase() === 'mods' ? selected : path.join(selected, 'mods');
  if (!exists(sourceMods)) throw new Error('The selected folder does not contain a mods directory. Select a Modrinth profile folder.');
  const profileRoot = path.basename(selected).toLowerCase() === 'mods' ? path.dirname(selected) : selected;
  const profileName = path.basename(profileRoot).replace(/[._-]+/g, ' ').trim() || 'Modrinth profile';
  const files = fs.readdirSync(sourceMods, { withFileTypes: true }).filter(entry => entry.isFile() && /\.jar(?:\.disabled)?$/i.test(entry.name)).map(entry => path.join(sourceMods, entry.name));
  const result = copyImportedModFiles(version, files, 'modrinth-profile', { profileName, label: `Modrinth profile · ${profileName}` });
  return { ...result, profileName };
}
ipcMain.handle('import-external-mod-files', async (_event, version) => { try { const result = await importExternalModFiles(version); if (result.ok) send('status', { type: 'success', message: `${result.imported.length} external mod file(s) added to Minecraft ${result.version}.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('transfer-modrinth-profile', async (_event, version) => { try { const result = await transferModrinthProfileMods(version); if (result.ok) send('status', { type: 'success', message: `${result.imported.length} mod(s) transferred from ${result.profileName}.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('download-mod', async (_event, version, mod) => { try { const result = await downloadModrinthMod(version, mod); send('status', { type: 'success', message: `${result.fileName} was added to the Minecraft ${result.version} instance.` }); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('install-mod-project', async (_event, projectId, version) => { try { const result = await installModrinthProject(projectId, version); const count = result.installed.length + result.present.length; send('status', { type: 'success', message: `${count} mod file(s) provided for Minecraft ${result.version}.` }); if (result.conflicts.length) send('log', `Note: possible incompatible Modrinth projects: ${result.conflicts.join(', ')}`); if (result.missing.length) send('log', `Skipped (no matching version): ${result.missing.join(', ')}`); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('search-resource-packs', async (_event, query, version, page = 0) => { try { return { ok: true, ...await searchResourcePacks(query, version, page) }; } catch (error) { return { ok: false, results: [], page: 0, total: 0, hasNext: false, error: error.message }; } });
ipcMain.handle('download-resource-pack', async (_event, version, pack) => { try { const result = await downloadResourcePack(version, pack); send('status', { type: 'success', message: `${result.fileName} was added to the resource packs of Minecraft ${result.version}.` }); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('check-for-updates', () => checkForUpdates());
ipcMain.handle('download-update', () => downloadUpdate());
ipcMain.handle('install-update', () => { if (updateState.status !== 'downloaded') return { ok: false, error: 'No downloaded update available.' }; autoUpdater.quitAndInstall(false, true); return { ok: true }; });
ipcMain.handle('select-version', (_event, version) => {
  const normalized = registerMinecraftVersion(version);
  if (!normalized) return { ok: false, error: 'Enter a valid Minecraft release version, for example 1.20.1 or 26.2.' };
  return { ok: true, state: saveState({ selectedVersion: normalized }), versions: availableMinecraftVersions().map(getInstanceSummary) };
});
ipcMain.handle('prepare-instance', async (_event, version) => { try { return { ok: true, instance: await ensureInstance(version) }; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('get-instance-summary', (_event, version) => getInstanceSummary(version));
ipcMain.handle('open-mods-folder', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return { ok: false }; ensureDir(modsRoot(normalized)); return shell.openPath(modsRoot(normalized)); });
ipcMain.handle('open-instance-folder', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return { ok: false }; ensureDir(instanceRoot(normalized)); return shell.openPath(instanceRoot(normalized)); });
ipcMain.handle('list-resource-packs', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const dir = resourcePacksRoot(normalized); ensureDir(dir); return fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.zip')).sort().map(file => ({ name: file, file })); });
ipcMain.handle('remove-resource-pack', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); if (!normalized || !/^\S+\.zip$/i.test(safeName)) return { ok: false, error: 'Invalid resource pack file.' }; const target = path.join(resourcePacksRoot(normalized), safeName); if (!exists(target)) return { ok: false, error: 'The resource pack was not found.' }; fs.rmSync(target, { force: true }); send('status', { type: 'success', message: `${safeName} was removed from Minecraft ${normalized}.` }); return { ok: true, fileName: safeName, version: normalized }; });
ipcMain.handle('open-cosmetics-profile', (_event, version = COSMETICS_MOD_VERSION) => { if (version !== COSMETICS_MOD_VERSION) return { ok: false, error: 'No cosmetics profile for this version.' }; ensureDir(vortexConfigRoot(version)); return shell.openPath(vortexConfigRoot(version)); });
ipcMain.handle('list-mods', async (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const required = mandatoryModNames(normalized); const cosmetics = protectedModNames(normalized); const dir = modsRoot(normalized); ensureDir(dir); const files = fs.readdirSync(dir).filter(name => name.endsWith('.jar') || name.endsWith('.jar.disabled')).sort(); return Promise.all(files.map(async file => { const enabled = file.endsWith('.jar'); const name = enabled ? file : file.slice(0, -'.disabled'.length); const mapping = await mapInstalledModrinthFile(normalized, name); const stored = mapping && typeof mapping.record === 'object' ? mapping.record : null; const metadata = mapping ? await getProjectMetadata(mapping.projectId) : null; const iconUrl = metadata?.iconUrl || stored?.iconUrl || null; const iconData = mapping && iconUrl ? (metadata?.iconData || await cachedModIconData(mapping.projectId, iconUrl)) : null; const importedSource = modSourceForFile(normalized, name); const sourceLabel = cosmetics.has(name) ? 'Vortex managed' : required.has(name) ? 'Vortex managed' : importedSource?.label || (mapping ? 'Modrinth' : 'Local file'); return { name, file, enabled, required: required.has(name), protected: cosmetics.has(name), projectId: mapping?.projectId || null, iconUrl, iconData, title: metadata?.title || stored?.title || null, author: metadata?.author || stored?.author || null, source: cosmetics.has(name) || required.has(name) ? 'vortex' : (importedSource?.source || (mapping ? 'modrinth' : 'external')), sourceLabel, role: cosmetics.has(name) ? 'Vortex Cosmetics core · automatically protected' : required.has(name) ? 'Vortex required mod' : enabled ? 'Custom mod · enabled' : 'Custom mod · disabled' }; })); });
ipcMain.handle('remove-mod', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); const baseName = safeName.replace(/\.disabled$/i, ''); if (!normalized || !/^\S+\.jar(?:\.disabled)?$/i.test(safeName)) return { ok: false, error: 'Invalid mod file.' }; if (mandatoryModNames(normalized).has(baseName) || protectedModNames(normalized).has(baseName)) return { ok: false, error: 'This Vortex required mod is protected and cannot be removed.' }; const target = path.join(modsRoot(normalized), safeName); if (!exists(target)) return { ok: false, error: 'The mod file was not found.' }; fs.rmSync(target, { force: true }); removeProjectMappingForFile(normalized, baseName); send('status', { type: 'success', message: `${baseName} was removed from Minecraft ${normalized}.` }); return { ok: true, fileName: baseName, version: normalized }; });
ipcMain.handle('toggle-mod', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); const baseName = safeName.replace(/\.disabled$/i, ''); if (!normalized || !/^\S+\.jar(?:\.disabled)?$/i.test(safeName)) return { ok: false, error: 'Invalid mod file.' }; if (mandatoryModNames(normalized).has(baseName) || protectedModNames(normalized).has(baseName)) return { ok: false, error: 'This Vortex required mod is protected and cannot be disabled.' }; const dir = modsRoot(normalized); const source = path.join(dir, safeName); if (!exists(source)) return { ok: false, error: 'The mod file was not found.' }; const targetName = safeName.endsWith('.jar') ? `${safeName}.disabled` : safeName.slice(0, -'.disabled'.length); const target = path.join(dir, targetName); if (exists(target)) return { ok: false, error: 'The target file already exists.' }; fs.renameSync(source, target); return { ok: true, file: targetName, enabled: targetName.endsWith('.jar') }; });
ipcMain.handle('set-cosmetics', (_event, cosmetics = {}) => {
  const state = loadState();
  const hat = cosmetics.hat ?? state.hat;
  const emblem = cosmetics.emblem ?? state.emblem;
  if (!HATS.includes(hat) || !EMBLEMS.includes(emblem)) return { ok: false, error: 'Unknown cosmetic.' };
  const saved = saveState({ hat, emblem });
  if (Object.prototype.hasOwnProperty.call(cosmetics, 'hat')) applyHatChoiceToAllInstances(saved.hat);
  if (Object.prototype.hasOwnProperty.call(cosmetics, 'emblem')) {
    const choice = { cape: saved.emblem === 'none' ? null : saved.emblem, updatedAt: new Date().toISOString(), source: 'bodyfit-cosmetic' };
    writeJson(websiteCapeChoiceFile(), choice);
    for (const version of SUPPORTED_VERSIONS) applyWebsiteCapeChoice(version);
  }
  // Cape-Auswahl bleibt eine echte Cape-Auswahl. Keine Skin-Variante mehr erzeugen:
  // Das alte Skin-Overlay war die blockartige Fläche auf Brust und Armen.
  return { ok: true, hat: saved.hat, emblem: saved.emblem, profile: null, capeOnly: true };
});
ipcMain.handle('show-cosmetics-info', () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'Vortex Cosmetics in the Launcher', buttons: ['Got it'], message: 'Vortex Capes are rendered as real capes behind the player.', detail: 'Select a cape in the launcher. The selected cape is written to the Vortex cosmetics profile and rendered on the player’s back. The launcher no longer creates a chest or body skin overlay. Vortex players can see each other’s selected capes when using the updated client and addon.' }));

ipcMain.handle('login', async () => {
  try {
    send('status', { type: 'info', message: 'Opening Microsoft sign-in…' });
    const signedIn = await signInToMinecraft();
    send('status', { type: 'success', message: `Signed in as ${signedIn.username}. ${accounts.length} account(s) saved.` });
    return { ok: true, account: accountSummary(signedIn), accounts: accountSummaries() };
  } catch (error) { send('status', { type: 'error', message: `Sign-in failed: ${error.message}` }); return { ok: false, error: error.message }; }
});ipcMain.handle('select-account', (_event, id) => { const selected = selectAccount(id); if (!selected) return { ok: false, error: 'The stored account was not found.' }; send('status', { type: 'success', message: `Active account: ${selected.username}` }); return { ok: true, account: accountSummary(selected), accounts: accountSummaries() }; });
ipcMain.handle('remove-account', (_event, id) => { const removed = removeAccount(id); if (!removed) return { ok: false, error: 'The stored account was not found.' }; send('status', { type: 'info', message: `${removed.username} was removed from the launcher.` }); return { ok: true, account: account ? accountSummary(account) : null, accounts: accountSummaries() }; });
ipcMain.handle('logout', () => { if (!account) return { ok: true, account: null, accounts: accountSummaries() }; const removed = removeAccount(accountId(account)); return { ok: true, removed: removed ? accountSummary(removed) : null, account: account ? accountSummary(account) : null, accounts: accountSummaries() }; });
ipcMain.handle('launch', async (_event, requestedVersion, requestedServerId = null) => {
  const version = sanitizeVersion(requestedVersion || loadState().selectedVersion);
  const server = requestedServerId ? serverById(requestedServerId) : null;
  if (!version) return { ok: false, error: 'Select a supported Vortex version.' };
  if (requestedServerId && !server) return { ok: false, error: 'The selected server was not found.' };
  try {
    send('status', { type: 'info', message: 'Refreshing Minecraft session …' });
    const parallel = [...minecraftProcesses.values()].some(entry => entry.kind === 'primary');
    const result = await startMinecraftSession({ accountValue: account, version, server, parallel });
    send('status', { type: 'success', message: server ? `${result.username} is launching${parallel ? ' in a separate instance' : ''} directly with ${server.name}.` : `${result.username}'s ${parallel ? 'separate ' : ''}Vortex Fabric instance has started.` });
    return { ok: true, ...result };
  } catch (error) { send('status', { type: 'error', message: `Launch failed: ${error.message}` }); return { ok: false, error: error.message }; }
});

// Modpack workspace: Modrinth .mrpack download/import and local composition export.
const JSZip = require('jszip');
function modpackArchiveSafePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) return null;
  if (!/^(mods|resourcepacks|config|shaderpacks|datapacks|options\.txt)(\/|$)/i.test(normalized)) return null;
  return normalized;
}
async function searchModpacks(query, gameVersion, page = 0) {
  const normalizedVersion = validModrinthVersion(gameVersion); const normalizedQuery = String(query || '').trim().slice(0, 80); const normalizedPage = Math.max(0, Math.min(99, Number(page) || 0));
  if (!normalizedVersion) throw new Error('This Minecraft version is not supported.');
  const facets = JSON.stringify([['project_type:modpack'], [`versions:${normalizedVersion}`]]);
  const params = new URLSearchParams({ query: normalizedQuery, facets, limit: '18', offset: String(normalizedPage * 18), index: 'relevance' });
  const result = await modrinthJson(`${MODRINTH_API}/search?${params}`);
  return { results: (result.hits || []).map(hit => ({ projectId: hit.project_id, slug: hit.slug, title: hit.title, author: hit.author || '', description: hit.description || '', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, gameVersion: normalizedVersion })).filter(item => item.projectId), page: normalizedPage, pageSize: 18, total: result.total_hits || 0, hasNext: (normalizedPage + 1) * 18 < (result.total_hits || 0) };
}
async function getModpackVersion(projectId, gameVersion) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify(['fabric']), limit: '30' });
  const versions = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const selected = versions.find(version => version.version_type === 'release') || versions[0];
  if (!selected) throw new Error('No compatible Modrinth pack version found.');
  const file = selectPrimaryFile(selected.files, '.mrpack');
  if (!file) throw new Error('This Modrinth pack has no .mrpack file.');
  return { versionId: selected.id, versionNumber: selected.version_number, fileName: file.filename, downloadUrl: file.url, sha512: file.hashes?.sha512 || null };
}
async function fetchVerifiedBuffer(url, sha512 = null) {
  const response = await fetch(url, { headers: modrinthHeaders(), signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Download failed with ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer()); if (buffer.length > 250 * 1024 * 1024) throw new Error('The downloaded pack is too large.');
  if (sha512 && crypto.createHash('sha512').update(buffer).digest('hex').toLowerCase() !== sha512.toLowerCase()) throw new Error('The downloaded pack hash is invalid.');
  return buffer;
}
function installedModpacksFile() { return path.join(dataRoot, 'installed-modpacks.json'); }
function modpackInstanceRoot(instanceId) { return path.join(instancesRoot, 'modpacks', safeFileName(instanceId)); }
function modpackInstanceId(version, name) { return `${version}-${safeFileName(String(name || 'pack').toLowerCase()).slice(0, 42)}-${Date.now()}`; }
function loadInstalledModpacks() { const value = loadJson(installedModpacksFile(), []); return Array.isArray(value) ? value : []; }
function saveInstalledModpacks(value) { writeJson(installedModpacksFile(), value.slice(0, 100)); }
async function installMrpackFile(version, filePath) {
  const selectedVersion = sanitizeVersion(version);
  const source = path.resolve(filePath);
  if (!fs.existsSync(source) || path.extname(source).toLowerCase() !== '.mrpack') throw new Error('Please choose a valid .mrpack file.');
  const archive = await JSZip.loadAsync(fs.readFileSync(source));
  const indexEntry = archive.file('modrinth.index.json');
  if (!indexEntry) throw new Error('This file is not a valid Modrinth Modpack.');
  const index = JSON.parse(await indexEntry.async('string'));
  if (index.game !== 'minecraft' || index.formatVersion !== 1) throw new Error('Only Modrinth formatVersion 1 Minecraft packs are supported.');
  const metadataVersion = String(index.dependencies?.minecraft || '').trim().replace(/^v/i, '');
  const normalized = sanitizeVersion(metadataVersion) || (selectedVersion ? registerMinecraftVersion(selectedVersion) : null);
  if (!normalized) throw new Error(`The pack does not contain a valid Minecraft release version${selectedVersion ? ` and the selected version is ${selectedVersion}` : ''}.`);
  registerMinecraftVersion(normalized);
  const instanceId = modpackInstanceId(normalized, index.name || path.basename(source, '.mrpack'));
  const targetRoot = modpackInstanceRoot(instanceId);
  ensureDir(targetRoot);
  const installed = [];
  const skipped = [];
  await ensureInstance(normalized);
  const baseRequiredMods = modsRoot(normalized);
  for (const requiredName of mandatoryModNames(normalized)) {
    const requiredPath = path.join(baseRequiredMods, requiredName);
    if (exists(requiredPath)) { ensureDir(path.join(targetRoot, 'mods')); fs.copyFileSync(requiredPath, path.join(targetRoot, 'mods', requiredName)); }
  }
  for (const entry of Array.isArray(index.files) ? index.files : []) {
    const safePath = modpackArchiveSafePath(entry.path); if (!safePath || !Array.isArray(entry.downloads) || !entry.downloads[0]) { skipped.push(entry.path || 'unknown'); continue; }
    const buffer = await fetchVerifiedBuffer(entry.downloads[0], entry.hashes?.sha512); const target = path.join(targetRoot, safePath); ensureDir(path.dirname(target)); fs.writeFileSync(target, buffer); installed.push(safePath);
  }
  for (const prefix of ['overrides/', 'client-overrides/']) {
    for (const entry of Object.values(archive.files)) { if (entry.dir || !entry.name.startsWith(prefix)) continue; const safePath = modpackArchiveSafePath(entry.name.slice(prefix.length)); if (!safePath) continue; const target = path.join(targetRoot, safePath); ensureDir(path.dirname(target)); fs.writeFileSync(target, await entry.async('nodebuffer')); }
  }
  const packRecord = { id: instanceId, name: index.name || path.basename(source, '.mrpack'), packVersion: index.versionId || '', targetVersion: normalized, instanceId, instancePath: targetRoot, fileCount: installed.length, installedAt: new Date().toISOString() }; const existing = loadInstalledModpacks().filter(item => item.id !== packRecord.id); saveInstalledModpacks([packRecord, ...existing]);
  return { ok: true, name: packRecord.name, version: packRecord.packVersion, installed, skipped, targetVersion: normalized };
}
async function exportMrpackFile(version, metadata = {}) {
  const normalized = sanitizeVersion(version); if (!normalized) throw new Error('Invalid Minecraft version.'); const root = instanceRoot(normalized); const zip = new JSZip();
  const projectMap = installedProjectMap(normalized); const files = []; const missing = [];
  for (const folder of ['mods', 'resourcepacks']) { const dir = path.join(root, folder); if (!fs.existsSync(dir)) continue; for (const fileName of fs.readdirSync(dir)) { if (!/\.(jar|zip)$/i.test(fileName) || fileName.endsWith('.disabled')) continue; const record = Object.values(projectMap).find(item => projectRecordFileName(item) === fileName); if (!record?.downloadUrl) { missing.push(fileName); continue; } const local = fs.readFileSync(path.join(dir, fileName)); files.push({ path: `${folder}/${fileName}`, hashes: { sha512: crypto.createHash('sha512').update(local).digest('hex') }, env: { client: 'required', server: 'required' }, downloads: [record.downloadUrl], fileSize: local.length }); } }
  const packName = String(metadata.name || `Vortex ${normalized} Pack`).slice(0, 80); zip.file('modrinth.index.json', JSON.stringify({ game: 'minecraft', formatVersion: 1, versionId: String(metadata.version || '1.0.0'), name: packName, summary: String(metadata.summary || 'Created with Vortex Client Launcher').slice(0, 200), files, dependencies: { minecraft: normalized, fabric_loader: '' } }, null, 2));
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Export Modrinth Modpack', defaultPath: `${packName.replace(/[^a-z0-9._-]+/gi, '-')}.mrpack`, filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }] }); if (result.canceled || !result.filePath) return { ok: false, canceled: true, missing }; await fs.promises.writeFile(result.filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); return { ok: true, filePath: result.filePath, fileCount: files.length, missing };
}
ipcMain.handle('search-modpacks', async (_event, query, version, page) => { try { return { ok: true, ...(await searchModpacks(query, version, page)) }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('download-modpack', async (_event, version, pack) => { try { const compatible = await getModpackVersion(pack.projectId, version); const temp = path.join(app.getPath('temp'), `vortex-${Date.now()}.mrpack`); fs.writeFileSync(temp, await fetchVerifiedBuffer(compatible.downloadUrl, compatible.sha512)); const result = await installMrpackFile(version, temp); fs.rmSync(temp, { force: true }); return { ...result, projectId: pack.projectId, versionNumber: compatible.versionNumber }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('import-mrpack', async (_event, version) => { try { const result = await dialog.showOpenDialog(mainWindow, { title: 'Import Modrinth Modpack', properties: ['openFile'], filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }] }); if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }; return await installMrpackFile(version, result.filePaths[0]); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('export-mrpack', async (_event, version, metadata) => { try { return await exportMrpackFile(version, metadata); } catch (error) { return { ok: false, error: error.message }; } });

ipcMain.handle('list-installed-modpacks', () => loadInstalledModpacks().map(item => ({ ...item, exists: fs.existsSync(item.instancePath || modpackInstanceRoot(item.instanceId || item.id)) })));
ipcMain.handle('open-modpack-folder', (_event, instanceId) => { const pack = loadInstalledModpacks().find(item => item.id === String(instanceId)); if (!pack) return { ok: false, error: 'The modpack was not found.' }; const folder = pack.instancePath || modpackInstanceRoot(pack.instanceId || pack.id); ensureDir(folder); return shell.openPath(folder); });
ipcMain.handle('delete-installed-modpack', (_event, instanceId) => {
  const id = String(instanceId || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id)) return { ok: false, error: 'Invalid modpack identifier.' };
  const packs = loadInstalledModpacks();
  const pack = packs.find(item => item.id === id);
  if (!pack) return { ok: false, error: 'The modpack was not found.' };
  const root = path.resolve(path.join(instancesRoot, 'modpacks'));
  const folder = path.resolve(pack.instancePath || modpackInstanceRoot(pack.instanceId || pack.id));
  if (!folder.startsWith(`${root}${path.sep}`)) return { ok: false, error: 'This modpack location is outside the managed instances directory.' };
  try {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
    saveInstalledModpacks(packs.filter(item => item.id !== id));
    send('status', { type: 'success', message: `${pack.name} was removed from installed modpacks.` });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: `Could not remove the modpack: ${error.message}` };
  }
});
ipcMain.handle('launch-modpack', async (_event, instanceId) => { const pack = loadInstalledModpacks().find(item => item.id === String(instanceId)); if (!pack) return { ok: false, error: 'The modpack was not found.' }; try { const parallel = [...minecraftProcesses.values()].some(entry => entry.kind === 'primary'); const result = await startMinecraftSession({ accountValue: account, version: pack.targetVersion, server: null, parallel, gameDirectoryOverride: pack.instancePath || modpackInstanceRoot(pack.instanceId || pack.id) }); send('status', { type: 'success', message: `${pack.name} is launching in its own instance.` }); return { ok: true, ...result, modpack: pack.name }; } catch (error) { send('status', { type: 'error', message: `Modpack launch failed: ${error.message}` }); return { ok: false, error: error.message }; } });

async function listCommunityModpacks() { const packs = await communityFetch('/api/modpacks'); return Array.isArray(packs) ? packs : []; }
async function downloadCommunityModpack(shareCode, version) { const code = String(shareCode || ''); if (!/^[a-f0-9]{8,32}$/i.test(code)) throw new Error('Invalid community modpack.'); const cookie = await communityCookieHeader(); const headers = { Accept: 'application/x-modrinth-modpack' }; if (cookie) headers.Cookie = cookie; const response = await fetch(`${COMMUNITY_BASE_URL}/api/modpacks/${encodeURIComponent(code)}/download`, { headers, signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`Community modpack responded with ${response.status}.`); const buffer = Buffer.from(await response.arrayBuffer()); if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('The community modpack is too large.'); const temp = path.join(app.getPath('temp'), `vortex-community-${Date.now()}.mrpack`); fs.writeFileSync(temp, buffer); try { return await installMrpackFile(version, temp); } finally { fs.rmSync(temp, { force: true }); } }
async function uploadCommunityModpack(metadata = {}) { const state = await getCommunityState(); if (!state.websiteAccount?.username) throw new Error('Please sign in to the community window first.'); const choice = await dialog.showOpenDialog(mainWindow, { title: 'Publish Modrinth Modpack', properties: ['openFile'], filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }] }); if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true }; const source = choice.filePaths[0]; const buffer = fs.readFileSync(source); if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new Error('The MRPACK must be between 1 byte and 25 MB.'); const archive = await JSZip.loadAsync(buffer); const indexEntry = archive.file('modrinth.index.json'); if (!indexEntry) throw new Error('The selected file is not a valid Modrinth Modpack.'); const index = JSON.parse(await indexEntry.async('string')); const name = String(metadata.name || index.name || path.basename(source, '.mrpack')).trim().slice(0, 60); const description = String(metadata.description || index.summary || '').trim().slice(0, 500); const result = await communityFetch('/api/modpacks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, visibility: metadata.visibility === 'unlisted' ? 'unlisted' : 'public', version: String(index.versionId || '1.0.0').slice(0, 32), minecraftVersion: String(index.dependencies?.minecraft || metadata.minecraftVersion || '').slice(0, 32), loader: 'fabric', filename: path.basename(source), contentBase64: buffer.toString('base64') }) }); return { ok: true, shareCode: result.shareCode || null, name }; }
ipcMain.handle('community-list-modpacks', async () => { try { return { ok: true, packs: await listCommunityModpacks() }; } catch (error) { return { ok: false, packs: [], error: error.message }; } });
ipcMain.handle('community-download-modpack', async (_event, shareCode, version) => { try { return { ok: true, ...(await downloadCommunityModpack(shareCode, version)) }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-upload-modpack', async (_event, metadata) => { try { return await uploadCommunityModpack(metadata); } catch (error) { return { ok: false, error: error.message }; } });
