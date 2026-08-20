const { app, BrowserWindow, ipcMain, dialog, shell, Menu, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const { Client } = require('minecraft-launcher-core');
const { Auth } = require('msmc');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createAiStudio } = require('./ai-studio');

const execFileAsync = promisify(execFile);

const FIXED_MEMORY = { min: '2G', max: '4G' };
const SUPPORTED_VERSIONS = ['1.21.11', '26.1.1', '26.1.2', '26.2'];
const COSMETICS_MOD_VERSION = '1.21.11';
const HATS = ['none', 'vortex-cap', 'neon-halo', 'void-crown', 'cyber-headphones', 'slime-antenna'];
const EMBLEMS = ['none', 'vortex-crest', 'nebula-mark', 'void-rune'];
const BUNDLED_TEXTURED_CAPES = new Set(EMBLEMS.filter(id => id !== 'none'));
let mainWindow;
let minecraftProcess;
let account = null;
let accounts = [];
let updateState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: null, progress: 0, error: null };
let instanceMaintenanceTimer = null;
let instanceMaintenanceRunning = false;
let lastMaintenance = { checkedAt: null, repairedVersions: [] };

const dataRoot = path.join(app.getPath('appData'), 'Vortex Client');
const instancesRoot = path.join(dataRoot, 'instances');
const accountFile = path.join(dataRoot, 'account.json');
const stateFile = path.join(dataRoot, 'launcher-state.json');
const newsFile = path.join(dataRoot, 'release-news.json');
const serversFile = path.join(dataRoot, 'servers.json');
const serverImagesRoot = path.join(dataRoot, 'server-images');
const profileImagesRoot = path.join(dataRoot, 'profile-images');
const aiStudio = createAiStudio({ dataRoot, instanceRoot, supportedVersions: SUPPORTED_VERSIONS, safeStorage });

const OFFICIAL_SERVER = Object.freeze({ id: 'official-vortexpvp', name: 'VortexPvP', address: 'mc.vortexpvp.eu', official: true, description: 'Der offizielle VortexPvP-Server. Starte direkt aus deiner Vortex-Fabric-Instanz.', imageKind: 'builtin' });

const RELEASE_NEWS = [
  {
    version: '0.9.11',
    title: 'Visuelle Server-Galerie',
    summary: 'Serverkarten zeigen jetzt Bilder und Beschreibungen statt nur einer IP-Adresse.',
    items: [
      'VortexPvP erhält ein eigenes lokales Vortex-Banner im Stil der offiziellen Website.',
      'Eigene Serverkarten zeigen Name, IP, Beschreibung und ein frei wählbares lokales Bild.',
      'Serverbilder werden ausschließlich lokal im Vortex-Datenordner gespeichert und lassen sich jederzeit ändern.',
      'Die Server-Bibliothek wurde zu einer übersichtlichen visuellen Karten-Galerie überarbeitet.'
    ]
  },
  {
    version: '0.9.10',
    title: 'Server-Bibliothek & Direct-Join',
    summary: 'Server verwalten und direkt über deine Vortex-Instanz beitreten.',
    items: [
      'Neue Server-Seite zum Speichern, Auswählen und Entfernen eigener Minecraft-Server.',
      'Direkter Mehrspielerstart: Ein Klick auf „Beitreten“ startet Minecraft mit der ausgewählten Server-IP.',
      'Mc.VortexPvP.Eu ist als offizieller VortexPvP-Server immer sichtbar und bleibt dauerhaft verfügbar.',
      'Überarbeitete Spielseite mit einem schnellen VortexPvP-Beitrittsknopf und klareren Startzuständen.'
    ]
  },
  {
    version: '0.9.9',
    title: 'Neuigkeiten & Profil-Update',
    summary: 'Nach jedem Launcher-Update siehst du nun gesammelt, was neu ist.',
    items: [
      'Neue „Neu in dieser Version“-Ansicht mit allen Änderungen seit deinem letzten Update.',
      'Überarbeitete Konto-Karte oben rechts mit Microsoft-Avatar und persönlichem Profilbild.',
      'Profilbild kann lokal ausgewählt, geändert oder wieder entfernt werden.',
      'Klarere Update-Kommunikation mit einem einfachen Aktualisieren-und-neu-starten-Ablauf.'
    ]
  }
];

const JAVA_25_DOWNLOAD_URL = 'https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jdk/hotspot/normal/eclipse';

function assetsRoot() { return path.join(app.getAppPath(), 'assets'); }
function javaRuntimeRoot() { return path.join(dataRoot, 'runtime', 'java-25'); }
function requiresJava25(version) { return /^26\./.test(String(version || '')); }
// minecraft-launcher-core ruft den übergebenen Pfad zuerst mit `-version` auf.
// Daher muss unter Windows java.exe (nicht das stille javaw.exe) verwendet werden.
function javaExecutable(home) { return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'); }
function javaConsoleExecutable(home) { return javaExecutable(home); }
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
    const match = output.match(/version\s+\"(?:1\.)?(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  } catch (_) { return null; }
}
async function findJava25Home() {
  const roots = [
    javaRuntimeRoot(),
    process.env.JAVA_HOME || '',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Java'),
    path.join(process.env['ProgramW6432'] || 'C:\\Program Files', 'Microsoft')
  ];
  const seen = new Set();
  for (const root of roots) for (const home of localJavaHomes(root)) {
    if (seen.has(home)) continue;
    seen.add(home);
    if ((await javaMajorVersion(home)) >= 25) return home;
  }
  return null;
}
async function installPortableJava25() {
  if (process.platform !== 'win32') throw new Error('Für Minecraft 26.x wird Java 25 benötigt. Die automatische Java-Bereitstellung ist im Windows-Launcher verfügbar.');
  const existing = await findJava25Home();
  if (existing) return existing;
  send('status', { type: 'info', message: 'Java 25 wird einmalig für Minecraft 26.x bereitgestellt …' });
  const runtimeRoot = javaRuntimeRoot();
  const archive = path.join(runtimeRoot, 'java-25.zip');
  ensureDir(runtimeRoot);
  const response = await fetch(JAVA_25_DOWNLOAD_URL, { redirect: 'follow', signal: AbortSignal.timeout(300000), headers: { 'User-Agent': MODRINTH_USER_AGENT } });
  if (!response.ok) throw new Error(`Java 25 konnte nicht geladen werden (HTTP ${response.status}). Installiere Java 25 und starte den Launcher erneut.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 10 * 1024 * 1024 || data.length > 500 * 1024 * 1024) throw new Error('Die heruntergeladene Java-25-Datei ist ungültig oder zu groß.');
  fs.writeFileSync(archive, data);
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedRoot = runtimeRoot.replace(/'/g, "''");
    await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedRoot}' -Force`], { windowsHide: true, timeout: 180000 });
  } finally { try { fs.rmSync(archive, { force: true }); } catch (_) {} }
  const installed = await findJava25Home();
  if (!installed) throw new Error('Java 25 wurde entpackt, konnte aber nicht geprüft werden. Installiere Java 25 und starte den Launcher erneut.');
  send('status', { type: 'success', message: 'Java 25 ist bereit und wird für Minecraft 26.x verwendet.' });
  return installed;
}
async function javaPathForVersion(version) {
  if (!requiresJava25(version)) return null;
  const home = await findJava25Home() || await installPortableJava25();
  const binary = javaExecutable(home);
  if (!exists(binary)) throw new Error('Java 25 wurde nicht gefunden. Starte den Launcher erneut oder installiere Java 25.');
  send('log', `Minecraft ${version} verwendet Java ${await javaMajorVersion(home) || 25}: ${binary}`);
  return binary;
}
function instanceRoot(version) { return path.join(instancesRoot, version); }
function modsRoot(version) { return path.join(instanceRoot(version), 'mods'); }
function resourcePacksRoot(version) { return path.join(instanceRoot(version), 'resourcepacks'); }
function vortexConfigRoot(version) { return path.join(instanceRoot(version), 'config', 'vortexclient'); }
function skinsRoot(version) { return path.join(vortexConfigRoot(version), 'skins'); }
function profileFile(version) { return path.join(vortexConfigRoot(version), 'launcher-cosmetics.json'); }
function sanitizeVersion(version) { return SUPPORTED_VERSIONS.includes(version) ? version : null; }
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
function isVortexCosmeticUrl(value) { try { const url = new URL(String(value || '')); return url.protocol === 'https:' && ['vortexclient.at', 'vortex-client.onrender.com'].includes(url.hostname) && /^\/cosmetics\//.test(url.pathname); } catch (_) { return false; } }
function normalizeCapeCatalogue(data) { const seen = new Set(); return (Array.isArray(data?.capes) ? data.capes : []).map(entry => ({ id: String(entry?.id || ''), name: String(entry?.name || '').trim().slice(0, 60), texture: String(entry?.texture || ''), preview: String(entry?.preview || '') })).filter(entry => /^[a-z0-9_-]{1,48}$/i.test(entry.id) && entry.name && isVortexCosmeticUrl(entry.texture) && isVortexCosmeticUrl(entry.preview) && !seen.has(entry.id) && Boolean(seen.add(entry.id))).slice(0, 60); }
async function loadWebsiteCapeCatalogue() { const response = await fetch(COSMETICS_CATALOGUE_URL, { headers: { Accept: 'application/json', 'User-Agent': MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Cape-Katalog antwortet mit ${response.status}.`); return normalizeCapeCatalogue(await response.json()); }
function applyWebsiteCapeChoice(version) { const stored = loadJson(websiteCapeChoiceFile(), null); const legacyEmblem = loadState().emblem; const fallbackCape = BUNDLED_TEXTURED_CAPES.has(legacyEmblem) ? legacyEmblem : null; const choice = stored && (stored.cape === null || /^[a-z0-9_-]{1,48}$/i.test(stored.cape)) ? stored : { cape: fallbackCape, updatedAt: new Date().toISOString(), source: 'bodyfit-migration' }; if (!stored) writeJson(websiteCapeChoiceFile(), choice); try { if (choice.cape) installBundledCape(version, choice.cape); const target = websiteCapeConfigPath(version); ensureDir(path.dirname(target)); writeJson(target, choice); } catch (_) {} }
const MODRINTH_API = 'https://api.modrinth.com/v2';
const COMMUNITY_BASE_URL = 'https://vortex-client.onrender.com';
const COSMETICS_CATALOGUE_URL = 'https://vortex-client.onrender.com/cosmetics.json';
const MODRINTH_USER_AGENT = 'Lukas3578/Vortex-launcher/0.9.11 (github.com/Lukas3578/Vortex-launcher)';
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
function projectRecordFileName(record) { return typeof record === 'string' ? record : String(record?.fileName || ''); }
function isProjectInstalled(version, projectId) { return Boolean(installedProjectMap(version)[projectId]); }
const projectMetadataCache = new Map();
async function getProjectMetadata(projectId) {
  const key = String(projectId || '');
  if (!key) return null;
  if (projectMetadataCache.has(key)) return projectMetadataCache.get(key);
  try {
    const project = await modrinthJson(`${MODRINTH_API}/project/${encodeURIComponent(key)}`);
    const metadata = { projectId: key, title: project.title || '', author: project.author || '', iconUrl: /^https:\/\/cdn\.modrinth\.com\//i.test(project.icon_url || '') ? project.icon_url : null };
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
  const projects = installedProjectMap(version);
  const baseName = String(fileName || '').replace(/\.disabled$/i, '');
  let changed = false;
  for (const [projectId, record] of Object.entries(projects)) {
    if (projectRecordFileName(record) === baseName) { delete projects[projectId]; changed = true; }
  }
  if (changed) writeJson(installedProjectsFile(version), projects);
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
  if (!normalizedVersion || !projectId) throw new Error('Ungültige Mod- oder Minecraft-Version.');
  const plan = await resolveModInstall(projectId, normalizedVersion);
  if (!plan.versions.length) throw new Error(`Für Minecraft ${normalizedVersion} wurde keine passende Fabric-Version gefunden.`);
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
  if (!installed.length && !present.length) throw new Error('Keine Mod-Datei konnte installiert werden.');
  return { ok: true, version: normalizedVersion, installed, present, missing: [...new Set(plan.missing)], conflicts: [...new Set(plan.conflicts)] };
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
      return { projectId: hit.project_id, slug: hit.slug, title: hit.title, author: hit.author || '', description: hit.description || 'Keine Beschreibung vorhanden.', iconUrl: hit.icon_url || null, downloads: hit.downloads || 0, categories: hit.display_categories || hit.categories || [], gameVersion: normalizedVersion, installed: isProjectInstalled(normalizedVersion, hit.project_id), ...compatible };
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
  if (!response.ok) throw new Error(payload?.error || payload || `Community antwortet mit ${response.status}.`);
  return payload;
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
  return Array.isArray(presets) ? presets.slice(0, 100).map(item => ({ id: item.id, name: String(item.name || 'Ohne Namen').slice(0, 60), filename: validCommunityFilename(item.filename) ? item.filename : 'preset1.txt', kind: item.kind === 'macro' ? 'macro' : 'preset', description: String(item.description || ''), downloads: Number(item.downloads || 0), createdAt: item.created_at || null, shareCode: String(item.share_code || ''), username: String(item.display_name || item.username || 'Community') })) : [];
}
async function downloadCommunityPreset(shareCode, filename) {
  const code = String(shareCode || '');
  if (!/^[a-f0-9]{8,32}$/i.test(code) || !validCommunityFilename(filename)) throw new Error('Ungültiger Community-Beitrag.');
  const content = await communityFetch(`/api/presets/${encodeURIComponent(code)}/download`);
  if (typeof content !== 'string' || !content.length || content.length > 400000) throw new Error('Der Community-Download ist ungültig oder zu groß.');
  ensureDir(communityDownloadsRoot());
  const targetName = `${code}-${filename}`;
  fs.writeFileSync(path.join(communityDownloadsRoot(), targetName), content, 'utf8');
  return { ok: true, fileName: targetName, folder: communityDownloadsRoot() };
}
async function uploadCommunityPreset(metadata = {}) {
  const state = await getCommunityState();
  if (!state.websiteAccount?.username) throw new Error('Melde dich zuerst im Community-Fenster an.');
  const choice = await dialog.showOpenDialog(mainWindow, { title: 'Vortex Preset oder Makro auswählen', properties: ['openFile'], filters: [{ name: 'Vortex-Preset oder Makro', extensions: ['txt'] }] });
  if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
  const source = choice.filePaths[0];
  const content = fs.readFileSync(source, 'utf8');
  if (!content.length || Buffer.byteLength(content, 'utf8') > 400000) throw new Error('Die Datei muss zwischen 1 Byte und 400 KB groß sein.');
  const isMacro = content.trim().startsWith('vortex-macro:');
  const filename = isMacro ? 'macro.txt' : String(metadata.filename || path.basename(source));
  if (!isMacro && !validCommunityFilename(filename)) throw new Error('Ein Preset muss preset1.txt, preset2.txt oder preset3.txt heißen.');
  const name = String(metadata.name || path.basename(source, path.extname(source))).trim().slice(0, 60);
  const description = String(metadata.description || '').trim().slice(0, 500);
  if (!name) throw new Error('Gib einen Namen für deinen Community-Beitrag ein.');
  const visibility = metadata.visibility === 'unlisted' ? 'unlisted' : 'public';
  const result = await communityFetch('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, filename, description, visibility, content }) });
  return { ok: true, shareCode: result.shareCode || null, kind: isMacro ? 'macro' : 'preset' };
}
function openCommunityLogin() {
  const communityWindow = new BrowserWindow({ width: 520, height: 720, title: 'Vortex Community anmelden', parent: mainWindow, modal: true, backgroundColor: '#090d18', webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const notifyIfLoggedIn = async () => {
    const state = await getCommunityState();
    if (state.websiteAccount?.username) {
      send('community-state', state);
      send('status', { type: 'success', message: `Community angemeldet als ${state.websiteAccount.display_name || state.websiteAccount.username}.` });
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
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates sind im Entwicklungsmodus deaktiviert.' });
  try { await autoUpdater.checkForUpdates(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
}
async function downloadUpdate() {
  if (!app.isPackaged) return setUpdateState({ status: 'dev', error: 'Updates sind im Entwicklungsmodus deaktiviert.' });
  try { await autoUpdater.downloadUpdate(); return updateState; }
  catch (error) { return setUpdateState({ status: 'error', error: error.message || String(error) }); }
}

function accountId(value = {}) { const uuid = String(value.uuid || '').trim().toLowerCase(); return uuid || `name:${String(value.username || '').trim().toLowerCase()}`; }
function profileImagePath(value) { const file = String(value?.profileImage || ''); return /^[a-z0-9][a-z0-9._-]{0,100}\.(png|jpe?g|webp)$/i.test(file) ? path.join(profileImagesRoot, file) : null; }
function dataUriForImage(file) { if (!file || !exists(file)) return null; const size = fs.statSync(file).size; if (!size || size > 5 * 1024 * 1024) return null; const extension = path.extname(file).toLowerCase(); const type = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'; return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`; }
function accountSummary(value) { return { id: accountId(value), username: String(value?.username || 'Minecraft-Spieler'), uuid: String(value?.uuid || ''), hasCustomProfileImage: Boolean(dataUriForImage(profileImagePath(value))) }; }
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
function serverImagePath(server) {
  const file = String(server?.imageFile || '');
  if (!/^[a-z0-9][a-z0-9._-]{3,100}\.(png|jpe?g|webp)$/i.test(file)) return null;
  const target = path.join(serverImagesRoot, file);
  return target.startsWith(`${serverImagesRoot}${path.sep}`) ? target : null;
}
function normalizeServer(entry) {
  const name = String(entry?.name || '').trim().replace(/\s+/g, ' ').slice(0, 42);
  const address = normalizeServerAddress(entry?.address);
  const id = String(entry?.id || '');
  if (!name || !address || !/^[a-z0-9][a-z0-9_-]{3,60}$/i.test(id)) return null;
  const candidate = { id, name, address, official: false, description: String(entry?.description || '').trim().slice(0, 120), imageFile: String(entry?.imageFile || ''), addedAt: String(entry?.addedAt || '') };
  if (!serverImagePath(candidate) || !exists(serverImagePath(candidate))) candidate.imageFile = '';
  return candidate;
}
function serverLibrary() {
  const stored = loadJson(serversFile, {}); const seen = new Set([OFFICIAL_SERVER.address]);
  const custom = Array.isArray(stored?.servers) ? stored.servers.map(normalizeServer).filter(Boolean).filter(server => !seen.has(server.address) && Boolean(seen.add(server.address))).slice(0, 50) : [];
  return [OFFICIAL_SERVER, ...custom];
}
function serverSummary(server) { return { id: server.id, name: server.name, address: server.address, official: Boolean(server.official), description: server.description || '', imageKind: server.imageKind || (server.imageFile ? 'custom' : 'none'), hasImage: Boolean(server.official || server.imageFile), addedAt: server.addedAt || '' }; }
function serverSummaries() { return serverLibrary().map(serverSummary); }
function saveServerLibrary(servers) { writeJson(serversFile, { schemaVersion: 2, servers: servers.filter(server => !server.official) }); }
function serverById(id) { return serverLibrary().find(server => server.id === String(id || '')) || null; }
function loadState() {
  const legacy = loadJson(stateFile, {});
  return {
    selectedVersion: SUPPORTED_VERSIONS.includes(legacy.selectedVersion) ? legacy.selectedVersion : COSMETICS_MOD_VERSION,
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

function hasFabricProfile(version) {
  const versionsDir = path.join(instanceRoot(version), 'versions');
  if (!exists(versionsDir)) return false;
  return fs.readdirSync(versionsDir).some(name => /^fabric-loader-/.test(name) && exists(path.join(versionsDir, name, `${name}.json`)));
}
function maintainBundledMods(version) {
  const normalized = sanitizeVersion(version);
  if (!normalized) return { installed: 0, removedVoice: 0, replaced: 0 };
  const mods = modsRoot(normalized);
  ensureDir(mods);
  const removedVoice = removeVoiceChat(mods);
  const replaced = cleanReplacedVortexJars(normalized, mods);
  applyWebsiteCapeChoice(normalized);
  let installed = 0;
  const bundleDir = path.join(assetsRoot(), 'modpacks', normalized);
  for (const name of bundledModFiles(normalized)) {
    if (copyIfChanged(path.join(bundleDir, name), path.join(mods, name))) installed += 1;
  }
  return { installed, removedVoice, replaced };
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
        catch (error) { send('log', `Fabric-Prüfung für ${version} wird wiederholt: ${error.message}`); }
      }
      if (repair.installed || repair.removedVoice || repair.replaced || fabricInstalled) {
        repairedVersions.push(version);
        const details = [];
        if (repair.installed) details.push(`${repair.installed} Pflichtdatei(en) wiederhergestellt`);
        if (fabricInstalled) details.push('Fabric-Profil wiederhergestellt');
        if (repair.replaced) details.push('veränderte Vortex-Dateien ersetzt');
        if (repair.removedVoice) details.push('nicht erlaubte Voice-Chat-Dateien entfernt');
        send('status', { type: 'success', message: `Instanzschutz ${version}: ${details.join(', ')}.` });
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
  const { installed, removedVoice, replaced } = maintainBundledMods(normalized);
  if (removedVoice) send('log', `Unerwünschte Voice-Chat-Dateien aus ${normalized} entfernt.`);
  if (replaced) send('log', `Veraltete Vortex-Kernmod-Dateien in ${normalized} ersetzt.`);
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
function clearCapeOverlay(png) { fillPixels(png, 32, 36, 8, 12, 0x00000000); }
function drawCapeBase(png, colors) {
  const { base, shade, trim, light } = colors;
  // Die äußere Rückenfläche des Standard-Skins liegt im Rechteck x=32–39, y=36–47.
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
  if (!/^[A-Za-z0-9_]{3,16}$/.test(normalized)) throw new Error('Gib einen gültigen Minecraft-Benutzernamen ein.');
  const lookup = await fetch(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(normalized)}`, { signal: AbortSignal.timeout(30000) });
  if (!lookup.ok) throw new Error('Dieser Minecraft-Benutzername wurde nicht gefunden.');
  const profile = await lookup.json();
  if (!/^[a-f0-9]{32}$/i.test(profile?.id || '')) throw new Error('Das Minecraft-Profil ist ungültig.');
  const sessionProfile = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${encodeURIComponent(profile.id)}`, { signal: AbortSignal.timeout(30000) });
  if (!sessionProfile.ok) throw new Error('Die Skin-Daten konnten nicht geladen werden.');
  const sessionData = await sessionProfile.json();
  const textureProperty = (sessionData.properties || []).find(property => property.name === 'textures' && typeof property.value === 'string');
  if (!textureProperty) throw new Error('Für dieses Profil ist kein Minecraft-Skin vorhanden.');
  const textureData = JSON.parse(Buffer.from(textureProperty.value, 'base64').toString('utf8'));
  const url = textureData?.textures?.SKIN?.url;
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(url || '')) throw new Error('Die Skin-Textur konnte nicht sicher bestimmt werden.');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Der Minecraft-Skin konnte nicht geladen werden.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) throw new Error('Die Skin-Datei ist ungültig oder zu groß.');
  const skin = PNG.sync.read(buffer);
  if (skin.width !== 64 || skin.height !== 64) throw new Error('Der gefundene Skin hat kein gültiges 64×64-Format.');
  const temporaryFile = path.join(skinsRoot(COSMETICS_MOD_VERSION), `import-${safeFileName(profile.name || normalized)}.png`);
  ensureDir(skinsRoot(COSMETICS_MOD_VERSION));
  fs.writeFileSync(temporaryFile, buffer);
  return { file: temporaryFile, username: profile.name || normalized };
}
function cosmeticSkinPreview(version = COSMETICS_MOD_VERSION) {
  const profile = loadCosmeticProfile(version);
  const fileName = profile.generatedSkin || profile.baseSkin;
  if (!fileName || !/^[a-z0-9][a-z0-9._-]*\.png$/i.test(fileName)) return { ok: true, preview: null, fileName: null };
  const file = path.join(skinsRoot(version), fileName);
  if (!exists(file)) return { ok: true, preview: null, fileName: null };
  const data = fs.readFileSync(file).toString('base64');
  return { ok: true, preview: `data:image/png;base64,${data}`, fileName };
}
function makeCosmeticSkin(version, sourceFile, hat, emblem) {
  if (version !== COSMETICS_MOD_VERSION) throw new Error('Die integrierte Vortex-Cosmetics-Ausgabe unterstützt aktuell Minecraft 1.21.11.');
  const source = PNG.sync.read(fs.readFileSync(sourceFile));
  if (source.width !== 64 || source.height !== 64) throw new Error('Bitte wähle einen gültigen Minecraft-Skin im Format 64×64 Pixel.');
  // Hüte werden ab Version 2.29.0 als echte 3D-Geometrie vom Cosmetics-Core
  // direkt am animierten Kopf dargestellt. Der Skin selbst bleibt dadurch sauber.
  applyEmblem(source, emblem);
  const baseName = safeFileName(path.basename(sourceFile, path.extname(sourceFile)));
  ensureDir(skinsRoot(version));
  const sourceTarget = path.join(skinsRoot(version), `vortex-base-${baseName}.png`);
  if (!exists(sourceTarget)) fs.copyFileSync(sourceFile, sourceTarget);
  const generatedName = `vortex-cosmetic-${baseName}-${hat}-${emblem}.png`;
  const target = path.join(skinsRoot(version), generatedName);
  fs.writeFileSync(target, PNG.sync.write(source));
  const profile = { baseSkin: path.basename(sourceTarget), generatedSkin: generatedName, hat, emblem, createdAt: new Date().toISOString(), launcher: `Vortex Client Launcher ${app.getVersion()}` };
  writeJson(profileFile(version), profile);
  return profile;
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({ width: 1380, height: 880, minWidth: 1080, minHeight: 720, backgroundColor: '#060914', title: 'Vortex Client', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

process.on('uncaughtException', error => { appendPersistentLog(crashLogPath(), `uncaughtException: ${error?.stack || error}`); appendPersistentLog(launchLogPath(), `ERROR uncaughtException: ${error?.message || error}`); });
process.on('unhandledRejection', reason => { appendPersistentLog(crashLogPath(), `unhandledRejection: ${reason?.stack || reason}`); appendPersistentLog(launchLogPath(), `ERROR unhandledRejection: ${reason?.message || reason}`); });
app.whenReady().then(() => {
  loadAccount();
  setupAutoUpdater();
  createWindow();
  startInstanceMaintenance();
  setTimeout(() => { void checkForUpdates(); }, 2000);
});
app.on('before-quit', () => { if (instanceMaintenanceTimer) clearInterval(instanceMaintenanceTimer); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('get-state', async () => ({ account: account ? accountSummary(account) : null, accounts: accountSummaries(), state: loadState(), servers: serverSummaries(), versions: SUPPORTED_VERSIONS.map(getInstanceSummary), cosmeticsVersion: COSMETICS_MOD_VERSION, update: updateState, maintenance: lastMaintenance, news: unreadReleaseNews(), community: await getCommunityState() }));
ipcMain.handle('list-servers', () => ({ ok: true, servers: serverSummaries(), selectedServerId: loadState().selectedServerId }));
ipcMain.handle('get-server-image', (_event, id) => { const server = serverById(id); if (!server) return { ok: false, error: 'Der Server wurde nicht gefunden.' }; if (server.official) return { ok: true, image: 'builtin', hasImage: true }; const image = serverImagePath(server); return { ok: true, image: image && exists(image) ? dataUriForImage(image) : null, hasImage: Boolean(image && exists(image)) }; });
ipcMain.handle('select-server-image', async (_event, id) => {
  try {
    const server = serverById(id); if (!server) throw new Error('Der Server wurde nicht gefunden.'); if (server.official) throw new Error('Das Bild des offiziellen VortexPvP-Servers wird vom Launcher verwaltet.');
    const choice = await dialog.showOpenDialog(mainWindow, { title: `Serverbild für ${server.name} wählen`, properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
    const source = choice.filePaths[0]; const stat = fs.statSync(source); if (!stat.isFile() || !stat.size || stat.size > 5 * 1024 * 1024) throw new Error('Wähle ein Bild mit maximal 5 MB.');
    const extension = path.extname(source).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Dieses Bildformat wird nicht unterstützt.');
    ensureDir(serverImagesRoot); const targetName = `server-${safeFileName(server.id)}${extension}`; const target = path.join(serverImagesRoot, targetName); const old = serverImagePath(server); fs.copyFileSync(source, target); if (old && old !== target) try { fs.rmSync(old, { force: true }); } catch (_) {}
    const saved = serverLibrary().map(item => item.id === server.id ? { ...item, imageFile: targetName } : item); saveServerLibrary(saved); return { ok: true, image: dataUriForImage(target), servers: serverSummaries() };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('add-server', (_event, input) => { try { const address = normalizeServerAddress(input?.address); const name = String(input?.name || '').trim().replace(/\s+/g, ' ').slice(0, 42); if (!name) throw new Error('Gib einen Servernamen ein.'); if (!address) throw new Error('Gib eine gültige Server-IP oder Domain ein.'); const existing = serverLibrary(); if (existing.some(server => server.address === address)) throw new Error('Dieser Server ist bereits in deiner Bibliothek.'); const server = { id: `server-${crypto.randomUUID()}`, name, address, official: false, description: String(input?.description || '').trim().slice(0, 120), imageFile: '', addedAt: new Date().toISOString() }; saveServerLibrary([...existing, server]); const state = saveState({ selectedServerId: server.id }); return { ok: true, server: serverSummary(server), servers: serverSummaries(), state }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('select-server', (_event, id) => { const server = serverById(id); if (!server) return { ok: false, error: 'Der ausgewählte Server wurde nicht gefunden.' }; return { ok: true, server, state: saveState({ selectedServerId: server.id }) }; });
ipcMain.handle('remove-server', (_event, id) => { const server = serverById(id); if (!server) return { ok: false, error: 'Der Server wurde nicht gefunden.' }; if (server.official) return { ok: false, error: 'Der offizielle VortexPvP-Server bleibt dauerhaft verfügbar.' }; const image = serverImagePath(server); const remaining = serverLibrary().filter(item => item.id !== server.id); saveServerLibrary(remaining); if (image) try { fs.rmSync(image, { force: true }); } catch (_) {} const state = saveState({ selectedServerId: loadState().selectedServerId === server.id ? OFFICIAL_SERVER.id : loadState().selectedServerId }); return { ok: true, servers: serverSummaries(), state }; });
ipcMain.handle('mark-release-news-seen', () => ({ ok: true, news: markReleaseNewsSeen() }));
ipcMain.handle('get-account-avatar', async (_event, id) => { const selected = accounts.find(entry => accountId(entry) === String(id || '')); return { ok: Boolean(selected), avatar: selected ? await accountAvatar(selected) : null, custom: Boolean(selected && dataUriForImage(profileImagePath(selected))) }; });
ipcMain.handle('select-account-avatar', async (_event, id) => {
  try {
    const selected = accounts.find(entry => accountId(entry) === String(id || '')); if (!selected) throw new Error('Das gespeicherte Konto wurde nicht gefunden.');
    const choice = await dialog.showOpenDialog(mainWindow, { title: 'Persönliches Profilbild wählen', properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, canceled: true };
    const source = choice.filePaths[0]; const stat = fs.statSync(source); if (!stat.isFile() || !stat.size || stat.size > 5 * 1024 * 1024) throw new Error('Wähle ein Bild mit maximal 5 MB.');
    const extension = path.extname(source).toLowerCase(); if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new Error('Dieses Bildformat wird nicht unterstützt.');
    ensureDir(profileImagesRoot); const fileName = `profile-${safeFileName(accountId(selected))}${extension}`; fs.copyFileSync(source, path.join(profileImagesRoot, fileName)); selected.profileImage = fileName; saveAccounts();
    return { ok: true, avatar: dataUriForImage(profileImagePath(selected)), custom: true };
  } catch (error) { return { ok: false, error: error.message }; }
});
ipcMain.handle('reset-account-avatar', async (_event, id) => {
  const selected = accounts.find(entry => accountId(entry) === String(id || '')); if (!selected) return { ok: false, error: 'Das gespeicherte Konto wurde nicht gefunden.' };
  const image = profileImagePath(selected); if (image) try { fs.rmSync(image, { force: true }); } catch (_) {}
  delete selected.profileImage; saveAccounts(); return { ok: true, avatar: await minecraftAvatarData(selected), custom: false };
});
ipcMain.handle('ai-get-state', () => aiStudio.getState());
ipcMain.handle('ai-save-key', (_event, key, provider, textModel) => { try { return { ok: true, state: aiStudio.saveKey(key, provider, textModel) }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-remove-key', () => ({ ok: true, state: aiStudio.removeKey() }));
ipcMain.handle('ai-generate-skin', async (_event, prompt) => { try { const result = await aiStudio.generateSkin(prompt); const state = loadState(); result.profile = makeCosmeticSkin(COSMETICS_MOD_VERSION, result.path, state.hat || 'vortex-cap', state.emblem || 'vortex-crest'); send('status', { type: 'success', message: `KI-Skin „${result.design.title}“ wurde lokal erstellt.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-generate-cape', async (_event, prompt) => { try { const result = await aiStudio.generateCape(prompt); send('status', { type: 'success', message: `KI-Cape „${result.design.title}“ wurde lokal für ${result.instances} Instanz(en) gespeichert.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-create-mod-project', async (_event, prompt) => { try { const result = await aiStudio.createModProject(prompt); send('status', { type: 'success', message: `Private Mod-Projektvorlage „${result.design.title}“ wurde lokal erstellt.` }); return result; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('ai-open-output', (_event, kind) => { const folder = aiStudio.openOutputFolder(kind); return shell.openPath(folder); });
ipcMain.handle('open-launch-log', () => { if (!exists(launchLogPath())) return { ok: false, error: 'Es wurde noch kein Launcher-Protokoll erstellt.' }; shell.showItemInFolder(launchLogPath()); return { ok: true }; });
ipcMain.handle('open-crash-log', () => { if (!exists(crashLogPath())) return { ok: false, error: 'Es wurde noch kein Fehlerprotokoll erstellt.' }; shell.showItemInFolder(crashLogPath()); return { ok: true }; });
ipcMain.handle('get-website-cape-catalogue', async () => { try { return { ok: true, capes: await loadWebsiteCapeCatalogue(), choice: loadJson(websiteCapeChoiceFile(), { cape: null }) }; } catch (error) { return { ok: false, capes: [], choice: loadJson(websiteCapeChoiceFile(), { cape: null }), error: error.message }; } });
ipcMain.handle('select-website-cape', async (_event, capeId) => { try { const normalizedId = capeId === null || capeId === '' ? null : String(capeId); const capes = await loadWebsiteCapeCatalogue(); if (normalizedId !== null && !capes.some(cape => cape.id === normalizedId)) throw new Error('Dieses Cape ist nicht im offiziellen Vortex-Katalog vorhanden.'); const choice = { cape: normalizedId, updatedAt: new Date().toISOString() }; writeJson(websiteCapeChoiceFile(), choice); let written = 0; for (const version of SUPPORTED_VERSIONS) { if (!exists(instanceRoot(version))) continue; applyWebsiteCapeChoice(version); written += 1; } send('log', normalizedId ? `Website-Cape ausgewählt: ${normalizedId}.` : 'Website-Cape entfernt.'); return { ok: true, choice, written }; } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-get-state', () => getCommunityState());
ipcMain.handle('community-login', () => openCommunityLogin());
ipcMain.handle('community-list-presets', async () => { try { return { ok: true, presets: await listCommunityPresets() }; } catch (error) { return { ok: false, presets: [], error: error.message }; } });
ipcMain.handle('community-download-preset', async (_event, shareCode, filename) => { try { return await downloadCommunityPreset(shareCode, filename); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('community-upload-preset', async (_event, metadata) => { try { return await uploadCommunityPreset(metadata); } catch (error) { return { ok: false, error: error.message }; } });
ipcMain.handle('search-mods', async (_event, query, version, page = 0) => { try { return { ok: true, ...await searchModrinth(query, version, page) }; } catch (error) { return { ok: false, results: [], page: 0, total: 0, hasNext: false, error: error.message }; } });
ipcMain.handle('download-mod', async (_event, version, mod) => { try { const result = await downloadModrinthMod(version, mod); send('status', { type: 'success', message: `${result.fileName} wurde in die Minecraft-${result.version}-Instanz geladen.` }); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
ipcMain.handle('install-mod-project', async (_event, projectId, version) => { try { const result = await installModrinthProject(projectId, version); const count = result.installed.length + result.present.length; send('status', { type: 'success', message: `${count} Mod-Datei(en) für Minecraft ${result.version} bereitgestellt.` }); if (result.conflicts.length) send('log', `Hinweis: mögliche inkompatible Modrinth-Projekte: ${result.conflicts.join(', ')}`); if (result.missing.length) send('log', `Ohne passende Version übersprungen: ${result.missing.join(', ')}`); return result; } catch (error) { send('status', { type: 'error', message: error.message }); return { ok: false, error: error.message }; } });
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
ipcMain.handle('list-resource-packs', (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const dir = resourcePacksRoot(normalized); ensureDir(dir); return fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.zip')).sort().map(file => ({ name: file, file })); });
ipcMain.handle('remove-resource-pack', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); if (!normalized || !/^\S+\.zip$/i.test(safeName)) return { ok: false, error: 'Ungültige Resource-Pack-Datei.' }; const target = path.join(resourcePacksRoot(normalized), safeName); if (!exists(target)) return { ok: false, error: 'Das Resource Pack wurde nicht gefunden.' }; fs.rmSync(target, { force: true }); send('status', { type: 'success', message: `${safeName} wurde aus Minecraft ${normalized} entfernt.` }); return { ok: true, fileName: safeName, version: normalized }; });
ipcMain.handle('open-skins-folder', (_event, version = COSMETICS_MOD_VERSION) => { if (version !== COSMETICS_MOD_VERSION) return { ok: false, error: 'Cosmetics-Skins sind nur für 1.21.11 verfügbar.' }; ensureDir(skinsRoot(version)); return shell.openPath(skinsRoot(version)); });
ipcMain.handle('open-cosmetics-profile', (_event, version = COSMETICS_MOD_VERSION) => { if (version !== COSMETICS_MOD_VERSION) return { ok: false, error: 'Kein Cosmetics-Profil für diese Version.' }; ensureDir(vortexConfigRoot(version)); return shell.openPath(vortexConfigRoot(version)); });
ipcMain.handle('list-mods', async (_event, version) => { const normalized = sanitizeVersion(version); if (!normalized) return []; const required = mandatoryModNames(normalized); const cosmetics = protectedModNames(normalized); const dir = modsRoot(normalized); ensureDir(dir); const files = fs.readdirSync(dir).filter(name => name.endsWith('.jar') || name.endsWith('.jar.disabled')).sort(); return Promise.all(files.map(async file => { const enabled = file.endsWith('.jar'); const name = enabled ? file : file.slice(0, -'.disabled'.length); const mapping = mappedProjectForFile(normalized, name); const stored = mapping && typeof mapping.record === 'object' ? mapping.record : null; const metadata = mapping ? (stored?.iconUrl ? stored : await getProjectMetadata(mapping.projectId)) : null; return { name, file, enabled, required: required.has(name), protected: cosmetics.has(name), projectId: mapping?.projectId || null, iconUrl: metadata?.iconUrl || null, title: metadata?.title || null, author: metadata?.author || null, role: cosmetics.has(name) ? 'Vortex Cosmetics-Core · wird automatisch geschützt' : required.has(name) ? 'Vortex-Pflichtmod' : enabled ? 'Eigener Mod · aktiv' : 'Eigener Mod · deaktiviert' }; })); });
ipcMain.handle('remove-mod', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); const baseName = safeName.replace(/\.disabled$/i, ''); if (!normalized || !/^\S+\.jar(?:\.disabled)?$/i.test(safeName)) return { ok: false, error: 'Ungültige Mod-Datei.' }; if (mandatoryModNames(normalized).has(baseName) || protectedModNames(normalized).has(baseName)) return { ok: false, error: 'Diese Vortex-Pflichtmod ist geschützt und kann nicht entfernt werden.' }; const target = path.join(modsRoot(normalized), safeName); if (!exists(target)) return { ok: false, error: 'Die Mod-Datei wurde nicht gefunden.' }; fs.rmSync(target, { force: true }); removeProjectMappingForFile(normalized, baseName); send('status', { type: 'success', message: `${baseName} wurde aus Minecraft ${normalized} entfernt.` }); return { ok: true, fileName: baseName, version: normalized }; });
ipcMain.handle('toggle-mod', (_event, version, fileName) => { const normalized = sanitizeVersion(version); const safeName = path.basename(String(fileName || '')); const baseName = safeName.replace(/\.disabled$/i, ''); if (!normalized || !/^\S+\.jar(?:\.disabled)?$/i.test(safeName)) return { ok: false, error: 'Ungültige Mod-Datei.' }; if (mandatoryModNames(normalized).has(baseName) || protectedModNames(normalized).has(baseName)) return { ok: false, error: 'Diese Vortex-Pflichtmod ist geschützt und kann nicht deaktiviert werden.' }; const dir = modsRoot(normalized); const source = path.join(dir, safeName); if (!exists(source)) return { ok: false, error: 'Die Mod-Datei wurde nicht gefunden.' }; const targetName = safeName.endsWith('.jar') ? `${safeName}.disabled` : safeName.slice(0, -'.disabled'.length); const target = path.join(dir, targetName); if (exists(target)) return { ok: false, error: 'Die Ziel-Datei existiert bereits.' }; fs.renameSync(source, target); return { ok: true, file: targetName, enabled: targetName.endsWith('.jar') }; });
ipcMain.handle('set-cosmetics', (_event, cosmetics = {}) => {
  const state = loadState();
  const hat = cosmetics.hat ?? state.hat;
  const emblem = cosmetics.emblem ?? state.emblem;
  if (!HATS.includes(hat) || !EMBLEMS.includes(emblem)) return { ok: false, error: 'Unbekanntes Cosmetic.' };
  const saved = saveState({ hat, emblem });
  if (Object.prototype.hasOwnProperty.call(cosmetics, 'emblem')) {
    const choice = { cape: saved.emblem === 'none' ? null : saved.emblem, updatedAt: new Date().toISOString(), source: 'bodyfit-cosmetic' };
    writeJson(websiteCapeChoiceFile(), choice);
    for (const version of SUPPORTED_VERSIONS) applyWebsiteCapeChoice(version);
  }
  const previousProfile = loadCosmeticProfile(COSMETICS_MOD_VERSION);
  let profile = null;
  if (previousProfile?.baseSkin && /^[a-z0-9][a-z0-9._-]*\.png$/i.test(previousProfile.baseSkin)) {
    const baseSkin = path.join(skinsRoot(COSMETICS_MOD_VERSION), previousProfile.baseSkin);
    if (exists(baseSkin)) profile = makeCosmeticSkin(COSMETICS_MOD_VERSION, baseSkin, saved.hat, saved.emblem);
  }
  return { ok: true, hat: saved.hat, emblem: saved.emblem, profile };
});
ipcMain.handle('get-cosmetic-skin-preview', (_event, version = COSMETICS_MOD_VERSION) => cosmeticSkinPreview(version));
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
ipcMain.handle('import-cosmetic-skin-by-username', async (_event, version, username, cosmetics = {}) => {
  try {
    const normalized = sanitizeVersion(version);
    if (normalized !== COSMETICS_MOD_VERSION) throw new Error('Die Skin-Verwaltung ist in dieser Ausgabe für Minecraft 1.21.11 verfügbar.');
    const hat = HATS.includes(cosmetics.hat) ? cosmetics.hat : loadState().hat;
    const emblem = EMBLEMS.includes(cosmetics.emblem) ? cosmetics.emblem : loadState().emblem;
    const imported = await fetchMinecraftSkinByUsername(username);
    const profile = makeCosmeticSkin(normalized, imported.file, hat, emblem);
    saveState({ hat, emblem });
    send('status', { type: 'success', message: `Skin von ${imported.username} importiert und als Vortex-Variante erstellt.` });
    return { ok: true, profile, username: imported.username, summary: getInstanceSummary(normalized) };
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
    send('status', { type: 'success', message: `Angemeldet als ${account.username}. ${accounts.length} Konto/Konten gespeichert.` });
    return { ok: true, account: accountSummary(account), accounts: accountSummaries() };
  } catch (error) { send('status', { type: 'error', message: `Anmeldung fehlgeschlagen: ${error.message}` }); return { ok: false, error: error.message }; }
});
ipcMain.handle('select-account', (_event, id) => { const selected = selectAccount(id); if (!selected) return { ok: false, error: 'Das gespeicherte Konto wurde nicht gefunden.' }; send('status', { type: 'success', message: `Aktives Konto: ${selected.username}` }); return { ok: true, account: accountSummary(selected), accounts: accountSummaries() }; });
ipcMain.handle('remove-account', (_event, id) => { const removed = removeAccount(id); if (!removed) return { ok: false, error: 'Das gespeicherte Konto wurde nicht gefunden.' }; send('status', { type: 'info', message: `${removed.username} wurde aus dem Launcher entfernt.` }); return { ok: true, account: account ? accountSummary(account) : null, accounts: accountSummaries() }; });
ipcMain.handle('logout', () => { if (!account) return { ok: true, account: null, accounts: accountSummaries() }; const removed = removeAccount(accountId(account)); return { ok: true, removed: removed ? accountSummary(removed) : null, account: account ? accountSummary(account) : null, accounts: accountSummaries() }; });
ipcMain.handle('launch', async (_event, requestedVersion, requestedServerId = null) => {
  const version = sanitizeVersion(requestedVersion || loadState().selectedVersion);
  const server = requestedServerId ? serverById(requestedServerId) : null;
  if (!account?.auth) return { ok: false, error: 'Bitte melde zuerst dein Minecraft-Microsoft-Konto an.' };
  if (!version) return { ok: false, error: 'Wähle eine unterstützte Vortex-Version aus.' };
  if (requestedServerId && !server) return { ok: false, error: 'Der ausgewählte Server wurde nicht gefunden.' };
  if (minecraftProcess) return { ok: false, error: 'Minecraft läuft bereits.' };
  try {
    const instance = await ensureInstance(version);
    const launcher = new Client();
    launcher.on('debug', message => send('log', String(message)));
    launcher.on('data', message => send('log', String(message)));
    launcher.on('download-status', data => send('progress', data));
    launcher.on('progress', data => send('progress', data));
    send('status', { type: 'info', message: server ? `Starte ${server.name} (${server.address}) mit Vortex Client ${version} …` : `Starte Vortex Client ${version} mit Fabric …` });
    const javaPath = await javaPathForVersion(version);
    const options = { authorization: account.auth, root: instance.root, version: { number: version, type: 'release', custom: instance.fabric.profileId }, memory: FIXED_MEMORY, javaPath: javaPath || undefined, overrides: { gameDirectory: instance.root }, window: { width: 1280, height: 720 } };
    if (server) options.quickPlay = { type: 'multiplayer', identifier: server.address };
    minecraftProcess = await launcher.launch(options);
    minecraftProcess.on('close', code => { minecraftProcess = null; send('status', { type: 'info', message: `Minecraft beendet (Code ${code}).` }); });
    send('status', { type: 'success', message: server ? `Minecraft startet direkt mit ${server.name}.` : 'Minecraft wurde mit der Vortex-Fabric-Instanz gestartet.' });
    return { ok: true, server: server ? { id: server.id, name: server.name, address: server.address } : null };
  } catch (error) { minecraftProcess = null; send('status', { type: 'error', message: `Start fehlgeschlagen: ${error.message}` }); return { ok: false, error: error.message }; }
});
