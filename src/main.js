const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
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
function resourcePacksRoot(version) { return path.join(instanceRoot(version), 'resourcepacks'); }
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
const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_USER_AGENT = 'Lukas3578/Vortex-launcher/0.4.5 (github.com/Lukas3578/Vortex-launcher)';
function modrinthHeaders() { return { Accept: 'application/json', 'User-Agent': MODRINTH_USER_AGENT }; }
function validModrinthVersion(version) { return sanitizeVersion(version); }
async function modrinthJson(url) {
  const response = await fetch(url, { headers: modrinthHeaders(), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Modrinth antwortet mit ${response.status}.`);
  return response.json();
}
function selectPrimaryFile(files = [], extension) { return files.find(file => file.primary && file.filename.toLowerCase().endsWith(extension)) || files.find(file => file.filename.toLowerCase().endsWith(extension)); }
function selectPrimaryJar(files = []) { return selectPrimaryFile(files, '.jar'); }
function selectPrimaryZip(files = []) { return selectPrimaryFile(files, '.zip'); }
async function getCompatibleModVersion(projectId, gameVersion) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify(['fabric']), limit: '10' });
  const versions = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  const ordered = [...versions].sort((a, b) => (a.version_type === 'release' ? 0 : 1) - (b.version_type === 'release' ? 0 : 1));
  for (const version of ordered) {
    const file = selectPrimaryJar(version.files);
    if (file) return { versionId: version.id, versionNumber: version.version_number, versionType: version.version_type, fileName: file.filename, downloadUrl: file.url, size: file.size, sha512: file.hashes?.sha512 || null };
  }
  return null;
}
async function searchModrinth(query, gameVersion, page = 0) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  const normalizedQuery = String(query || '').trim().slice(0, 80);
  const normalizedPage = Math.max(0, Math.min(99, Number(page) || 0));
  if (!normalizedVersion) throw new Error('Diese Minecraft-Version wird nicht unterstützt.');
  if (normalizedQuery.length < 2) return { results: [], page: normalizedPage, pageSize: 12, total: 0, hasNext: false };
  const facets = JSON.stringify([['project_type:mod'], [`versions:${normalizedVersion}`], ['categories:fabric']]);
  const params = new URLSearchParams({ query: normalizedQuery, facets, limit: '12', offset: String(normalizedPage * 12), index: 'relevance' });
  const result = await modrinthJson(`${MODRINTH_API}/search?${params}`);
  const suggestions = await Promise.all(result.hits.map(async hit => {
    try {
      const compatible = await getCompatibleModVersion(hit.project_id, normalizedVersion);
      if (!compatible) return null;
      return { projectId: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description || 'Keine Beschreibung vorhanden.', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, categories: hit.display_categories || hit.categories || [], gameVersion: normalizedVersion, ...compatible };
    } catch (_) { return null; }
  }));
  return { results: suggestions.filter(Boolean), page: normalizedPage, pageSize: 12, total: result.total_hits || 0, hasNext: (normalizedPage + 1) * 12 < (result.total_hits || 0) };
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
  if (!normalizedVersion) throw new Error('Diese Minecraft-Version wird nicht unterstützt.');
  if (normalizedQuery.length < 2) return { results: [], page: normalizedPage, pageSize: 12, total: 0, hasNext: false };
  const facets = JSON.stringify([['project_type:resourcepack'], [`versions:${normalizedVersion}`]]);
  const params = new URLSearchParams({ query: normalizedQuery, facets, limit: '12', offset: String(normalizedPage * 12), index: 'relevance' });
  const result = await modrinthJson(`${MODRINTH_API}/search?${params}`);
  const suggestions = await Promise.all(result.hits.map(async hit => {
    try {
      const compatible = await getCompatibleResourcePackVersion(hit.project_id, normalizedVersion);
      if (!compatible) return null;
      return { projectId: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description || 'Keine Beschreibung vorhanden.', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, categories: hit.display_categories || hit.categories || [], gameVersion: normalizedVersion, ...compatible };
    } catch (_) { return null; }
  }));
  return { results: suggestions.filter(Boolean), page: normalizedPage, pageSize: 12, total: result.total_hits || 0, hasNext: (normalizedPage + 1) * 12 < (result.total_hits || 0) };
}
async function downloadResourcePack(gameVersion, requested = {}) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  if (!normalizedVersion || !requested.versionId) throw new Error('Ungültige Resource-Pack- oder Minecraft-Version.');
  const version = await modrinthJson(`${MODRINTH_API}/version/${encodeURIComponent(String(requested.versionId))}`);
  if (!Array.isArray(version.game_versions) || !version.game_versions.includes(normalizedVersion)) throw new Error('Dieses Resource Pack ist nicht mit der ausgewählten Minecraft-Version kompatibel.');
  const file = selectPrimaryZip(version.files);
  if (!file || !/^https:\/\//i.test(file.url) || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.zip$/i.test(file.filename)) throw new Error('Resource-Pack-Datei konnte nicht sicher bestimmt werden.');
  if (file.size > 500 * 1024 * 1024) throw new Error('Das Resource Pack ist größer als 500 MB und wurde aus Sicherheitsgründen abgelehnt.');
  const targetDir = resourcePacksRoot(normalizedVersion); ensureDir(targetDir);
  const target = path.join(targetDir, file.filename);
  if (exists(target)) throw new Error(`Die Datei ${file.filename} ist bereits in dieser Instanz vorhanden.`);
  const response = await fetch(file.url, { headers: { 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Der Resource-Pack-Download ist fehlgeschlagen (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 500 * 1024 * 1024) throw new Error('Das heruntergeladene Resource Pack ist größer als 500 MB.');
  if (file.hashes?.sha512) { const digest = crypto.createHash('sha512').update(buffer).digest('hex'); if (digest.toLowerCase() !== file.hashes.sha512.toLowerCase()) throw new Error('Die Prüfsumme des Resource Packs stimmt nicht überein.'); }
  fs.writeFileSync(target, buffer);
  return { ok: true, fileName: file.filename, size: buffer.length, version: normalizedVersion, projectId: requested.projectId || null };
}
async function downloadModrinthMod(gameVersion, requested = {}) {
  const normalizedVersion = validModrinthVersion(gameVersion);
  if (!normalizedVersion || !requested.versionId) throw new Error('Ungültige Mod- oder Minecraft-Version.');
  const version = await modrinthJson(`${MODRINTH_API}/version/${encodeURIComponent(String(requested.versionId))}`);
  if (!Array.isArray(version.game_versions) || !version.game_versions.includes(normalizedVersion) || !Array.isArray(version.loaders) || !version.loaders.includes('fabric')) throw new Error('Diese Mod-Version ist nicht mit Fabric und der ausgewählten Minecraft-Version kompatibel.');
  const file = selectPrimaryJar(version.files);
  if (!file || !/^https:\/\//i.test(file.url) || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.jar$/i.test(file.filename)) throw new Error('Mod-Datei konnte nicht sicher bestimmt werden.');
  if (file.size > 100 * 1024 * 1024) throw new Error('Die Mod-Datei ist größer als 100 MB und wurde aus Sicherheitsgründen abgelehnt.');
  const targetDir = modsRoot(normalizedVersion); ensureDir(targetDir);
  const target = path.join(targetDir, file.filename);
  if (exists(target)) throw new Error(`Die Datei ${file.filename} ist bereits in dieser Instanz vorhanden.`);
  const response = await fetch(file.url, { headers: { 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Der Mod-Download ist fehlgeschlagen (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 100 * 1024 * 1024) throw new Error('Die heruntergeladene Datei ist größer als 100 MB.');
  if (file.hashes?.sha512) { const digest = crypto.createHash('sha512').update(buffer).digest('hex'); if (digest.toLowerCase() !== file.hashes.sha512.toLowerCase()) throw new Error('Die Prüfsumme der Mod-Datei stimmt nicht überein.'); }
  fs.writeFileSync(target, buffer);
  return { ok: true, fileName: file.filename, size: buffer.length, version: normalizedVersion, projectId: requested.projectId || null };
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
function isProtectedCosmeticsMod(name) { return /^vortexclient.*\.jar$/i.test(name); }
function mandatoryModNames(version) { return new Set(bundledModFiles(version)); }
function protectedModNames(version) { return new Set(bundledModFiles(version).filter(isProtectedCosmeticsMod)); }
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
    cosmeticsSupported: protectedModNames(version).size > 0,
    cosmeticsModPresent: [...protectedModNames(version)].some(name => exists(path.join(mods, name))),
    cosmeticsModNames: [...protectedModNames(version)],
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
  const protectedCosmetics = [...protectedModNames(normalized)];
  if (protectedCosmetics.length) send('log', `Vortex Cosmetics-Core geschützt: ${protectedCosmetics.join(', ')}`);
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
  const profile = { baseSkin: path.basename(sourceTarget), generatedSkin: generatedName, hat, emblem, createdAt: new Date().toISOString(), launcher: 'Vortex Client Launcher 0.4.5' };
  writeJson(profileFile(version), profile);
  return profile;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({ width: 1380, height: 880, minWidth: 1080, minHeight: 720, backgroundColor: '#060914', title: 'Vortex Client', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => { loadAccount(); setupAutoUpdater(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-state', () => ({ account: account ? { username: account.username, uuid: account.uuid } : null, state: loadState(), versions: SUPPORTED_VERSIONS.map(getInstanceSummary), cosmeticsVersion: COSMETICS_MOD_VERSION, update: updateState }));
ipcMain.handle('search-mods', async (_event, query, version, page = 0) => { try { return { ok: true, ...await searchModrinth(query, version, page) }; } catch (error) { return { ok: false, results: [], page: 0, total: 0, hasNext: false, error: error.message }; } });
ipcMain.handle('download-mod', async (_event, version, mod) => { try { const result = await downloadModrinthMod(version, mod); send('status', { type: 'success', message: `${result.fileName} wurde in die Minecraft-${result.version}-Instanz geladen.` }); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('search-resource-packs', async (_event, query, version, page = 0) => { try { return { ok: true, ...await searchResourcePacks(query, version, page) }; } catch (error) { return { ok: false, results: [], page: 0, total: 0, hasNext: false, error: error.message }; } });
ipcMain.handle('download-resource-pack', async (_event, version, pack) => { try { const result = await downloadResourcePack(version, pack); send('status', { type: 'success', message: `${result.fileName} wurde in die Resource-Packs von Minecraft ${result.version} geladen.` }); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
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
ipcMain.handle('list-mods', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const required = mandatoryModNames(normalized); const cosmetics = protectedModNames(normalized); const dir = modsRoot(normalized); ensureDir(dir); return fs.readdirSync(dir).filter(name => name.endsWith('.jar')).sort().map(name => ({ name, required: required.has(name), protected: cosmetics.has(name), role: cosmetics.has(name) ? 'Vortex Cosmetics-Core · wird automatisch geschützt' : required.has(name) ? 'Vortex-Pflichtmod' : 'Eigener Mod' })); });
ipcMain.handle('remove-mod', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); if (!normalized || !/^\S+\.jar$/i.test(safeName)) return { ok: false, error: 'Ungültige Mod-Datei.' }; if (mandatoryModNames(normalized).has(safeName) || protectedModNames(normalized).has(safeName)) return { ok: false, error: 'Diese Vortex-Pflichtmod ist geschützt und kann nicht entfernt werden.' }; const target = path.join(modsRoot(normalized), safeName); if (!exists(target)) return { ok: false, error: 'Die Mod-Datei wurde nicht gefunden.' }; fs.rmSync(target, { force: true }); send('status', { type: 'success', message: `${safeName} wurde aus Minecraft ${normalized} entfernt.` }); return { ok: true, fileName: safeName, version: normalized }; });
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
