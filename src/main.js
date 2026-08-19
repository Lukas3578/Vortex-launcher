const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { autoUpdater } = require('electron-updater');

const FIXED_MEMORY = { min: '2G', max: '4G' };
const SUPPORTED_VERSIONS = ['1.21.11', '26.1.1', '26.1.2', '26.2'];
const COSMETICS_MOD_VERSION = '1.21.11';
const HATS = ['none', 'vortex-cap', 'neon-halo', 'void-crown', 'cyber-headphones', 'slime-antenna'];
const EMBLEMS = ['none', 'vortex-crest', 'nebula-mark', 'void-rune'];
let mainWindow;
let minecraftProcess;
let account = null;
let updateState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: null, progress: 0, error: null };

const dataRoot = path.join(app.getPath('appData'), 'Vortex Client');
const instancesRoot = path.join(dataRoot, 'instances');
const accountFile = path.join(dataRoot, 'account.json');
const stateFile = path.join(dataRoot, 'launcher-state.json');

function assetsRoot() { return path.join(app.getAppPath(), 'assets'); }
function instanceRoot(version) { return path.join(instancesRoot, version); }
function modsRoot(version) { return path.join(instanceRoot(version), 'mods'); }
function vortexConfigRoot(version) { return path.join(instanceRoot(version), 'config', 'vortexclient'); }
function skinsRoot(version) { return path.join(vortexConfigRoot(version), 'skins'); }
function profileFile(version) { return path.join(vortexConfigRoot(version), 'launcher-cosmetics.json'); }
function sanitizeVersion(version) { return SUPPORTED_VERSIONS.includes(version) ? version : null; }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function exists(file) { return fs.existsSync(file); }
function send(channel, payload) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); }
function loadJson(file, fallback) { try { return exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch (_) { return fallback; } }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function safeFileName(value) { return String(value || 'skin').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '') || 'skin'; }
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
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates sind im Entwicklungsmodus deaktiviert.' });
  try { await autoUpdater.checkForUpdates(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
}
async function downloadUpdate() {
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates sind im Entwicklungsmodus deaktiviert.' });
  try { await autoUpdater.downloadUpdate(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
}

function loadAccount() { account = loadJson(accountFile, null); }
function saveAccount(value) { account = value; writeJson(accountFile, value); }
function loadState() {
  const legacy = loadJson(stateFile, {});
  return {
    selectedVersion: SUPPORTED_VERSIONS.includes(legacy.selectedVersion) ? legacy.selectedVersion : COSMETICS_MOD_VERSION,
    hat: HATS.includes(legacy.hat) ? legacy.hat : 'vortex-cap',
    emblem: EMBLEMS.includes(legacy.emblem) ? legacy.emblem : 'vortex-crest'
  };
}
function saveState(patch) { const state = { ...loadState(), ...patch }; writeJson(stateFile, state); return state; }

function copyIfChanged(source, destination) {
  if (!exists(destination) || fs.statSync(source).size !== fs.statSync(destination).size || hashFile(source) !== hashFile(destination)) {
    fs.copyFileSync(source, destination);
    return true;
  }
  return false;
}
function removeVoiceChat(modsDir) {
  if (!exists(modsDir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(modsDir)) if (/voice.?chat/i.test(name)) { fs.rmSync(path.join(modsDir, name), { force: true }); count += 1; }
  return count;
}
function bundledModFiles(version) {
  const dir = path.join(assetsRoot(), 'modpacks', version);
  return exists(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.jar') && !/voice.?chat/i.test(name)) : [];
}
function mandatoryModNames(version) { return new Set(bundledModFiles(version)); }
function cosmeticFiles(version) {
  const dir = skinsRoot(version);
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^vortex-(base|cosmetic)-.*\.png$/i.test(name));
}
function loadCosmeticProfile(version) {
  return loadJson(profileFile(version), { hat: loadState().hat, emblem: loadState().emblem, baseSkin: null, generatedSkin: null, updatedAt: null });
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
    fabricInstalled: exists(path.join(root, 'versions')),
    cosmeticsSupported: version === COSMETICS_MOD_VERSION,
    cosmeticSkinCount: cosmeticFiles(version).length,
    cosmeticProfile: version === COSMETICS_MOD_VERSION ? loadCosmeticProfile(version) : null
  };
}

async function installFabricProfile(version, root) {
  const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`);
  if (!response.ok) throw new Error(`Fabric-Metadaten konnten nicht geladen werden (${response.status}).`);
  const loaders = await response.json();
  const preferred = loaders.find(entry => entry.loader?.stable) || loaders[0];
  if (!preferred?.loader?.version) throw new Error(`Für Minecraft ${version} ist kein Fabric Loader verfügbar.`);
  const loaderVersion = preferred.loader.version;
  const profileResponse = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  if (!profileResponse.ok) throw new Error(`Fabric-Profil konnte nicht geladen werden (${profileResponse.status}).`);
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
    if (/^vortexclient.*\.jar$/i.test(name) && !allowed.has(name)) {
      fs.rmSync(path.join(modsDir, name), { force: true });
      removed += 1;
    }
  }
  return removed;
}

async function ensureInstance(version) {
  const normalized = sanitizeVersion(version);
  if (!normalized) throw new Error('Diese Minecraft-Version wird vom Vortex Client nicht unterstützt.');
  const root = instanceRoot(normalized);
  const mods = modsRoot(normalized);
  ensureDir(mods);
  ensureDir(vortexConfigRoot(normalized));
  send('status', { type: 'info', message: `Vortex-Instanz ${normalized} wird geprüft …` });
  const removedVoice = removeVoiceChat(mods);
  const replaced = cleanReplacedVortexJars(normalized, mods);
  if (removedVoice) send('log', `Unerwünschte Voice-Chat-Dateien aus ${normalized} entfernt.`);
  if (replaced) send('log', `Veraltete Vortex-Kernmod-Dateien in ${normalized} ersetzt.`);
  let installed = 0;
  const bundleDir = path.join(assetsRoot(), 'modpacks', normalized);
  for (const name of bundledModFiles(normalized)) if (copyIfChanged(path.join(bundleDir, name), path.join(mods, name))) installed += 1;
  const cosmeticState = loadState();
  writeJson(path.join(vortexConfigRoot(normalized), 'launcher-profile.json'), {
    launcher: 'Vortex Client Launcher',
    version: normalized,
    memoryProfile: 'managed-2G-4G',
    cosmetics: normalized === COSMETICS_MOD_VERSION ? loadCosmeticProfile(normalized) : null,
    launcherSelection: cosmeticState,
    generatedAt: new Date().toISOString()
  });
  send('status', { type: 'info', message: `Fabric wird für ${normalized} bereitgestellt …` });
  const fabric = await installFabricProfile(normalized, root);
  send('status', { type: 'success', message: `Instanz ${normalized} bereit: Fabric ${fabric.loaderVersion}, ${bundledModFiles(normalized).length} Pflichtmods geprüft.` });
  return { ...getInstanceSummary(normalized), installed, removedVoice, replaced, fabric };
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
function applyEmblem(png, emblem) {
  if (emblem === 'none') return;
  fillPixels(png, 32, 20, 8, 12, 0x00000000);
  if (emblem === 'vortex-crest') { writePixel(png, 33, 22, 0xff2ea8ff); writePixel(png, 38, 22, 0xff2ea8ff); writePixel(png, 34, 24, 0xff42dfff); writePixel(png, 37, 24, 0xff42dfff); writePixel(png, 35, 26, 0xff77f4ff); writePixel(png, 36, 26, 0xff77f4ff); return; }
  if (emblem === 'nebula-mark') { fillPixels(png, 34, 22, 4, 4, 0xff6c3dce); fillPixels(png, 33, 23, 6, 2, 0xffa461ff); writePixel(png, 35, 21, 0xffe3c0ff); writePixel(png, 36, 26, 0xffecdbff); return; }
  if (emblem === 'void-rune') { fillPixels(png, 35, 21, 2, 7, 0xffcbd8ed); fillPixels(png, 33, 23, 6, 1, 0xff7d8fa9); writePixel(png, 34, 26, 0xffe4f2ff); writePixel(png, 37, 26, 0xffe4f2ff); }
}
function makeCosmeticSkin(version, sourceFile, hat, emblem) {
  if (version !== COSMETICS_MOD_VERSION) throw new Error('Die integrierte Vortex-Cosmetics-Ausgabe unterstützt aktuell Minecraft 1.21.11.');
  const source = PNG.sync.read(fs.readFileSync(sourceFile));
  if (source.width !== 64 || source.height !== 64) throw new Error('Bitte wähle einen gültigen Minecraft-Skin im Format 64×64 Pixel.');
  applyHat(source, hat);
  applyEmblem(source, emblem);
  const baseName = safeFileName(path.basename(sourceFile, path.extname(sourceFile)));
  ensureDir(skinsRoot(version));
  const sourceTarget = path.join(skinsRoot(version), `vortex-base-${baseName}.png`);
  if (!exists(sourceTarget)) fs.copyFileSync(sourceFile, sourceTarget);
  const generatedName = `vortex-cosmetic-${baseName}-${hat}-${emblem}.png`;
  const target = path.join(skinsRoot(version), generatedName);
  fs.writeFileSync(target, PNG.sync.write(source));
  const profile = { baseSkin: path.basename(sourceTarget), generatedSkin: generatedName, hat, emblem, createdAt: new Date().toISOString(), launcher: 'Vortex Client Launcher 0.3.0' };
  writeJson(profileFile(version), profile);
  return profile;
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1380, height: 880, minWidth: 1080, minHeight: 720, backgroundColor: '#060914', title: 'Vortex Client', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => { loadAccount(); setupAutoUpdater(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-state', () => ({ account: account ? { username: account.username, uuid: account.uuid } : null, state: loadState(), versions: SUPPORTED_VERSIONS.map(getInstanceSummary), cosmeticsVersion: COSMETICS_MOD_VERSION, update: updateState }));
ipcMain.handle('check-for-updates', () => checkForUpdates());
ipcMain.handle('download-update', () => downloadUpdate());
ipcMain.handle('install-update', () => { if (updateState.status !== 'downloaded') return { ok: false, error: 'Es ist kein heruntergeladenes Update vorhanden.' }; autoUpdater.quitAndInstall(false, true); return { ok: true }; });
ipcMain.handle('select-version', (_event, version) => ({ ok: Boolean(sanitizeVersion(version)), state: saveState({ selectedVersion: version }) }));
ipcMain.handle('prepare-instance', async (_event, version) => { try { return { ok: true, instance: await ensureInstance(version) }; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('get-instance-summary', (_event, version) => getInstanceSummary(version));
ipcMain.handle('open-mods-folder', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return { ok: false }; ensureDir(modsRoot(normalized)); return shell.openPath(modsRoot(normalized)); });
ipcMain.handle('open-instance-folder', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return { ok: false }; ensureDir(instanceRoot(normalized)); return shell.openPath(instanceRoot(normalized)); });
ipcMain.handle('open-skins-folder', (_event, version = COSMETICS_MOD_VERSION) => { if (version !== COSMETICS_MOD_VERSION) return { ok: false, error: 'Cosmetics-Skins sind nur für 1.21.11 verfügbar.' }; ensureDir(skinsRoot(version)); return shell.openPath(skinsRoot(version)); });
ipcMain.handle('open-cosmetics-profile', (_event, version = COSMETICS_MOD_VERSION) => { if (version !== COSMETICS_MOD_VERSION) return { ok: false, error: 'Kein Cosmetics-Profil für diese Version.' }; ensureDir(vortexConfigRoot(version)); return shell.openPath(vortexConfigRoot(version)); });
ipcMain.handle('list-mods', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const required = mandatoryModNames(normalized); const dir = modsRoot(normalized); ensureDir(dir); return fs.readdirSync(dir).filter(name => name.endsWith('.jar')).sort().map(name => ({ name, required: required.has(name) })); });
ipcMain.handle('set-cosmetics', (_event, cosmetics = {}) => {
  const state = loadState();
  const hat = cosmetics.hat ?? state.hat;
  const emblem = cosmetics.emblem ?? state.emblem;
  if (!HATS.includes(hat) || !EMBLEMS.includes(emblem)) return { ok: false, error: 'Unbekanntes Cosmetic.' };
  const saved = saveState({ hat, emblem });
  return { ok: true, hat: saved.hat, emblem: saved.emblem };
});
ipcMain.handle('import-cosmetic-skin', async (_event, version, cosmetics = {}) => {
  try {
    const normalized = sanitizeVersion(version);
    if (normalized !== COSMETICS_MOD_VERSION) throw new Error('Die Cosmetics-Werkstatt ist in dieser Ausgabe für Minecraft 1.21.11 verfügbar.');
    const hat = HATS.includes(cosmetics.hat) ? cosmetics.hat : loadState().hat;
    const emblem = EMBLEMS.includes(cosmetics.emblem) ? cosmetics.emblem : loadState().emblem;
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Minecraft-Skin für Vortex Cosmetics wählen', properties: ['openFile'], filters: [{ name: 'Minecraft-Skin (PNG, 64×64)', extensions: ['png'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
    const profile = makeCosmeticSkin(normalized, choice.filePaths[0], hat, emblem);
    saveState({ hat, emblem });
    send('status', { type: 'success', message: 'Cosmetic-Skin erstellt. Öffne in Minecraft die Skin Wardrobe und wähle die neue Variante.' });
    return { ok: true, profile, summary: getInstanceSummary(normalized) };
  } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; }
});
ipcMain.handle('show-cosmetics-info', () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'Vortex Cosmetics im Launcher', buttons: ['Verstanden'], message: 'Der Launcher erstellt echte Skin-Varianten für den integrierten Vortex-Cosmetics-Mod.', detail: 'Wähle im Launcher Hut und Rücken-Emblem, importiere anschließend einen eigenen 64×64-Minecraft-Skin. Die generierte PNG-Datei wird direkt in den Skin-Ordner der separaten 1.21.11-Vortex-Instanz gelegt. Im Spiel öffnest du Right Shift → Skins → Scan und klickst die Variante an. Für eine sichtbare Account-Änderung nutzt du im Spiel freiwillig „Visible to everyone“. Offizielle Minecraft-Capes werden nicht vorgetäuscht.' }));

ipcMain.handle('login', async () => {
  try {
    send('status', { type: 'info', message: 'Microsoft-Anmeldung wird geöffnet …' });
    const authManager = new Auth('select_account');
    const xboxManager = await authManager.launch('electron', { width: 520, height: 720, resizable: false });
    const token = await xboxManager.getMinecraft();
    const profile = token.profile || {};
    saveAccount({ username: profile.name || 'Minecraft-Spieler', uuid: profile.id || '', auth: token.mclc() });
    send('status', { type: 'success', message: `Angemeldet als ${account.username}` });
    return { ok: true, account: { username: account.username, uuid: account.uuid } };
  } catch (error) { send('status', { type: 'error', message: `Anmeldung fehlgeschlagen: ${error.message}` }); return { ok: false, error: error.message }; }
});
ipcMain.handle('logout', () => { account = null; try { fs.unlinkSync(accountFile); } catch (_) {} return { ok: true }; });
ipcMain.handle('launch', async (_event, requestedVersion) => {
  const version = sanitizeVersion(requestedVersion || loadState().selectedVersion);
  if (!account?.auth) return { ok: false, error: 'Bitte melde zuerst dein Minecraft-Microsoft-Konto an.' };
  if (!version) return { ok: false, error: 'Wähle eine unterstützte Vortex-Version aus.' };
  if (minecraftProcess) return { ok: false, error: 'Minecraft läuft bereits.' };
  try {
    const instance = await ensureInstance(version);
    const launcher = new Client();
    launcher.on('debug', message => send('log', String(message)));
    launcher.on('data', message => send('log', String(message)));
    launcher.on('download-status', data => send('progress', data));
    launcher.on('progress', data => send('progress', data));
    send('status', { type: 'info', message: `Starte Vortex Client ${version} mit Fabric …` });
    minecraftProcess = await launcher.launch({ authorization: account.auth, root: instance.root, version: { number: version, type: 'release', custom: instance.fabric.profileId }, memory: FIXED_MEMORY, overrides: { gameDirectory: instance.root }, window: { width: 1280, height: 720 } });
    minecraftProcess.on('close', code => { minecraftProcess = null; send('status', { type: 'info', message: `Minecraft beendet (Code ${code}).` }); });
    send('status', { type: 'success', message: 'Minecraft wurde mit der Vortex-Fabric-Instanz gestartet.' });
    return { ok: true };
  } catch (error) { minecraftProcess = null; send('status', { type: 'error', message: `Start fehlgeschlagen: ${error.message}` }); return { ok: false, error: error.message }; }
});
