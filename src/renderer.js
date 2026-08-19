const $ = (id) => document.getElementById(id);
const logEl = $('log');
let launcherState = null;
let selectedVersion = '1.21.11';
let selectedHat = 'vortex-cap';
let selectedEmblem = 'vortex-crest';
let onlineModResults = [];

const hatNames = { none: 'Kein Hut', 'vortex-cap': 'Vortex Cap', 'neon-halo': 'Neon Halo', 'void-crown': 'Void Crown', 'cyber-headphones': 'Cyber Headphones', 'slime-antenna': 'Slime Antenna' };
const emblemNames = { none: 'Kein Emblem', 'vortex-crest': 'Vortex Crest', 'nebula-mark': 'Nebula Mark', 'void-rune': 'Void Rune' };
const escapeHtml = (value) => String(value).replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));

function addLog(message, tone = '') {
  const item = document.createElement('div');
  item.className = `log-line ${tone}`;
  item.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span><span>${escapeHtml(message)}</span>`;
  logEl.appendChild(item); logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(message) { $('statusText').textContent = message; }
function setAccount(account) {
  const element = $('account');
  if (!account) { element.innerHTML = '<div class="avatar">?</div><div><strong>Nicht angemeldet</strong><span>Minecraft Microsoft-Konto</span></div><button class="button secondary small" id="loginBtn">Anmelden</button>'; $('loginBtn').onclick = login; return; }
  element.innerHTML = `<div class="avatar signed">${escapeHtml(account.username.slice(0, 2).toUpperCase())}</div><div><strong>${escapeHtml(account.username)}</strong><span>Minecraft Microsoft-Konto</span></div><button class="button secondary small" id="loginBtn">Abmelden</button>`;
  $('loginBtn').onclick = logout;
}
function currentSummary() { return launcherState?.versions?.find(instance => instance.version === selectedVersion); }
function cosmeticsSummary() { return launcherState?.versions?.find(instance => instance.version === launcherState?.cosmeticsVersion); }
function updatePlaySummary() {
  const summary = currentSummary();
  $('selectedVersionLabel').textContent = selectedVersion;
  $('coreStatus').textContent = summary?.ready ? 'Aktiv' : 'Bereitstellen';
  $('modCount').textContent = summary ? `${summary.totalModCount} Mods` : '— Mods';
}
function renderVersions() {
  const select = $('versionSelect'); const librarySelect = $('libraryVersion');
  const options = launcherState.versions.map(item => `<option value="${item.version}">${item.version} · Fabric + Vortex Client${item.cosmeticsSupported ? ' · Cosmetics' : ''}</option>`).join('');
  select.innerHTML = options; librarySelect.innerHTML = options; select.value = selectedVersion; librarySelect.value = selectedVersion;
  select.onchange = async (event) => { selectedVersion = event.target.value; librarySelect.value = selectedVersion; await window.vortex.selectVersion(selectedVersion); updatePlaySummary(); renderInstanceCards(); refreshLibrary(); };
  librarySelect.onchange = () => { selectedVersion = librarySelect.value; select.value = selectedVersion; window.vortex.selectVersion(selectedVersion); updatePlaySummary(); renderInstanceCards(); refreshLibrary(); };
}
function renderInstanceCards() {
  $('instancesGrid').innerHTML = launcherState.versions.map(instance => {
    const active = instance.version === selectedVersion ? ' selected' : ''; const state = instance.ready ? 'Bereit' : 'Nicht installiert';
    const cosmeticLine = instance.cosmeticsSupported ? `<div class="instance-stat accent"><span>COSMETICS</span><strong>${instance.cosmeticProfile?.generatedSkin ? 'Aktiv' : 'Bereit'}</strong></div>` : '<div class="instance-stat"><span>COSMETICS</span><strong>1.21.11</strong></div>';
    return `<article class="instance-card${active}"><div class="instance-title"><div><h3>${instance.version}</h3><p>FABRIC + VORTEX CLIENT</p></div><span class="instance-state">${state}</span></div><div class="instance-stats"><div class="instance-stat"><span>PFLICHTMODS</span><strong>${instance.coreModCount}</strong></div><div class="instance-stat"><span>GESAMT</span><strong>${instance.totalModCount} Mods</strong></div>${cosmeticLine}</div><div class="instance-actions"><button class="button secondary" data-select="${instance.version}">Auswählen</button><button class="button secondary" data-prepare="${instance.version}">Prüfen</button><button class="button ghost" data-mods="${instance.version}">Mods</button></div></article>`;
  }).join('');
  document.querySelectorAll('[data-select]').forEach(button => button.onclick = async () => { selectedVersion = button.dataset.select; await window.vortex.selectVersion(selectedVersion); $('versionSelect').value = selectedVersion; $('libraryVersion').value = selectedVersion; updatePlaySummary(); renderInstanceCards(); refreshLibrary(); showPage('play'); });
  document.querySelectorAll('[data-prepare]').forEach(button => button.onclick = () => prepare(button.dataset.prepare));
  document.querySelectorAll('[data-mods]').forEach(button => button.onclick = () => window.vortex.openModsFolder(button.dataset.mods));
}
function updateCosmetics() {
  $('cosmeticName').textContent = hatNames[selectedHat]; $('emblemName').textContent = emblemNames[selectedEmblem];
  $('cosmeticPreview').className = `cosmetic-shape ${selectedHat === 'void-crown' ? 'purple' : selectedHat === 'neon-halo' ? 'cyan' : selectedHat === 'slime-antenna' ? 'green' : ''}`;
  document.querySelectorAll('.hat-card').forEach(card => card.classList.toggle('selected', card.dataset.hat === selectedHat));
  document.querySelectorAll('.emblem-card').forEach(card => card.classList.toggle('selected', card.dataset.emblem === selectedEmblem));
  const summary = cosmeticsSummary(); const profile = summary?.cosmeticProfile;
  const status = $('cosmeticsStatus');
  if (!summary?.cosmeticsSupported) status.textContent = 'Die Cosmetics-Ausgabe für 1.21.11 wird vorbereitet.';
  else if (profile?.generatedSkin) status.innerHTML = `<strong>Bereit:</strong> ${escapeHtml(profile.generatedSkin)} · ${escapeHtml(hatNames[profile.hat] || profile.hat)} + ${escapeHtml(emblemNames[profile.emblem] || profile.emblem)}`;
  else status.textContent = 'Noch keine Skin-Variante erstellt. Wähle deinen Look und importiere einen 64×64-Skin.';
}
function updateUpdateView(update = launcherState?.update || {}) {
  const labels = { idle: 'Bereit', checking: 'Suche läuft …', available: 'Update verfügbar', downloading: 'Download läuft …', downloaded: 'Bereit zur Installation', 'up-to-date': 'Aktuell', dev: 'Entwicklermodus', error: 'Fehler' };
  const messages = { idle: 'Noch nicht auf Updates geprüft.', checking: 'Die GitHub-Releases werden geprüft …', available: `Version ${update.availableVersion} ist verfügbar.`, downloading: `Update wird heruntergeladen: ${update.progress || 0} %`, downloaded: `Version ${update.availableVersion} wurde heruntergeladen und kann installiert werden.`, 'up-to-date': 'Du verwendest bereits die neueste Version.', dev: update.error || 'Updates sind im Entwicklungsmodus deaktiviert.', error: update.error || 'Die Update-Prüfung ist fehlgeschlagen.' };
  $('currentVersion').textContent = update.currentVersion || '0.4.0'; $('updateBadge').textContent = labels[update.status] || 'Bereit'; $('updateStatus').textContent = messages[update.status] || messages.idle; $('updateProgressBar').style.width = `${Math.max(0, Math.min(100, update.progress || 0))}%`;
  $('downloadUpdateBtn').disabled = update.status !== 'available'; $('installUpdateBtn').disabled = update.status !== 'downloaded';
}
async function checkUpdate() { $('checkUpdateBtn').disabled = true; updateUpdateView({ ...(launcherState?.update || {}), status: 'checking' }); const result = await window.vortex.checkForUpdates(); launcherState.update = result; updateUpdateView(result); $('checkUpdateBtn').disabled = false; }
async function downloadUpdate() { $('downloadUpdateBtn').disabled = true; const result = await window.vortex.downloadUpdate(); launcherState.update = result; updateUpdateView(result); }
async function installUpdate() { const result = await window.vortex.installUpdate(); if (!result.ok) addLog(result.error, 'error'); }
function showPage(page) { document.querySelectorAll('.page').forEach(element => element.classList.toggle('active', element.id === page)); document.querySelectorAll('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.page === page)); if (page === 'library') refreshLibrary(); if (page === 'updates') updateUpdateView(); }
async function refresh() {
  launcherState = await window.vortex.getState(); selectedVersion = launcherState.state?.selectedVersion || '1.21.11'; selectedHat = launcherState.state?.hat || 'vortex-cap'; selectedEmblem = launcherState.state?.emblem || 'vortex-crest';
  setAccount(launcherState.account); renderVersions(); renderInstanceCards(); updatePlaySummary(); updateCosmetics(); updateUpdateView(launcherState.update); renderOnlineModVersions(); await refreshLibrary();
}
async function login() { const button = $('loginBtn'); button.disabled = true; addLog('Microsoft-Anmeldung wird gestartet …'); const result = await window.vortex.login(); if (result.ok) { setAccount(result.account); addLog(`Angemeldet als ${result.account.username}`, 'success'); } else { addLog(result.error, 'error'); setAccount(null); } }
async function logout() { await window.vortex.logout(); setAccount(null); addLog('Konto abgemeldet.'); }
async function prepare(version = selectedVersion) {
  const button = $('prepareBtn'); if (button) button.disabled = true; setStatus(`Prüfe Instanz ${version} …`); addLog(`Vortex-Instanz ${version} wird bereitgestellt …`);
  const result = await window.vortex.prepareInstance(version);
  if (result.ok) { addLog(`Instanz ${version}: ${result.instance.coreModCount} Pflichtmods geprüft und bereitgestellt.`, 'success'); await refresh(); } else addLog(result.error, 'error');
  if (button) button.disabled = false;
}
async function launch() { $('playBtn').disabled = true; $('playLabel').textContent = 'Startet …'; const result = await window.vortex.launch(selectedVersion); if (!result.ok) { addLog(result.error, 'error'); $('playBtn').disabled = false; $('playLabel').textContent = 'Vortex starten'; } }
async function saveCosmetics(patch) {
  const result = await window.vortex.setCosmetics({ hat: selectedHat, emblem: selectedEmblem, ...patch });
  if (!result.ok) { addLog(result.error || 'Cosmetic konnte nicht gespeichert werden.', 'error'); return; }
  selectedHat = result.hat; selectedEmblem = result.emblem; updateCosmetics(); addLog(`Cosmetics-Auswahl gespeichert: ${hatNames[selectedHat]} + ${emblemNames[selectedEmblem]}.`, 'success');
}
async function createCosmeticSkin() {
  const button = $('createCosmeticsBtn'); button.disabled = true; button.textContent = 'Skin wählen …';
  const result = await window.vortex.importCosmeticSkin(launcherState.cosmeticsVersion, { hat: selectedHat, emblem: selectedEmblem });
  if (result.ok) { addLog(`Cosmetic-Skin erstellt: ${result.profile.generatedSkin}`, 'success'); await refresh(); }
  else if (!result.canceled) addLog(result.error || 'Skin-Variante konnte nicht erstellt werden.', 'error');
  button.disabled = false; button.textContent = 'Skin importieren & erstellen';
}
async function refreshLibrary() {
  if (!launcherState) return; const version = selectedVersion; const mods = await window.vortex.listMods(version); const summary = launcherState.versions.find(item => item.version === version);
  $('libraryTotal').textContent = mods.length; $('libraryCore').textContent = mods.filter(mod => mod.required).length; $('libraryCustom').textContent = mods.filter(mod => !mod.required).length;
  $('modList').innerHTML = mods.length ? mods.map(mod => `<div class="mod-row"><span class="mod-dot ${mod.required ? 'core' : 'custom'}"></span><div><strong>${escapeHtml(mod.name)}</strong><small>${mod.required ? 'Vortex-Pflichtmod · wird beim Prüfen geschützt' : 'Eigener Mod · in dieser Instanz gespeichert'}</small></div><span class="mod-badge ${mod.required ? 'required' : ''}">${mod.required ? 'CORE' : 'EIGEN'}</span></div>`).join('') : `<div class="empty-library">Noch keine JAR-Dateien vorhanden. Klicke auf „Instanz reparieren“ oder öffne den Mods-Ordner.</div>`;
  if (summary) $('libraryVersion').value = version;
}
function renderOnlineModVersions() {
  const select = $('onlineModVersion');
  if (!select || !launcherState) return;
  select.innerHTML = launcherState.versions.map(item => `<option value="${escapeHtml(item.version)}">${escapeHtml(item.version)} · Fabric</option>`).join('');
  select.value = selectedVersion;
}
function renderOnlineMods() {
  const container = $('onlineModResults');
  if (!onlineModResults.length) { container.innerHTML = '<div class="empty-library">Keine kompatiblen Mods gefunden. Probiere einen anderen Namen.</div>'; return; }
  container.innerHTML = onlineModResults.map((mod, index) => `<article class="online-mod-card"><div class="online-mod-icon">${escapeHtml(mod.title.slice(0, 1).toUpperCase())}</div><div class="online-mod-main"><div class="online-mod-title"><h3>${escapeHtml(mod.title)}</h3><span class="mod-badge required">${escapeHtml(mod.versionType || 'release')}</span></div><p>${escapeHtml(mod.description)}</p><small>${escapeHtml(mod.versionNumber)} · ${escapeHtml(mod.gameVersion)} · ${escapeHtml((mod.categories || []).slice(0, 3).join(' · '))} · ${Number(mod.downloads || 0).toLocaleString('de-DE')} Downloads</small></div><button class="button secondary mod-download-button" data-mod-index="${index}">Herunterladen</button></article>`).join('');
  container.querySelectorAll('[data-mod-index]').forEach(button => button.onclick = () => downloadOnlineMod(Number(button.dataset.modIndex), button));
}
async function searchOnlineMods() {
  const query = $('modSearchInput').value.trim(); const version = $('onlineModVersion').value || selectedVersion; const button = $('searchModsBtn');
  if (query.length < 2) { $('modSearchStatus').textContent = 'Bitte gib mindestens zwei Zeichen ein.'; return; }
  button.disabled = true; $('modSearchStatus').textContent = `Suche nach „${query}“ für Minecraft ${version} …`; $('onlineModResults').innerHTML = '<div class="empty-library">Kompatible Mod-Versionen werden geladen …</div>';
  const result = await window.vortex.searchMods(query, version); button.disabled = false;
  if (!result.ok) { onlineModResults = []; $('modSearchStatus').textContent = result.error || 'Die Modsuche ist fehlgeschlagen.'; renderOnlineMods(); return; }
  onlineModResults = result.results || []; $('modSearchStatus').textContent = `${onlineModResults.length} kompatible Vorschläge für Minecraft ${version}.`; renderOnlineMods();
}
async function downloadOnlineMod(index, button) {
  const mod = onlineModResults[index]; const version = $('onlineModVersion').value || selectedVersion; if (!mod) return;
  button.disabled = true; button.textContent = 'Lädt …';
  const result = await window.vortex.downloadMod(version, { projectId: mod.projectId, versionId: mod.versionId });
  if (result.ok) { button.textContent = 'Installiert'; addLog(`${result.fileName} wurde in Minecraft ${result.version} installiert.`, 'success'); await refresh(); }
  else { button.disabled = false; button.textContent = 'Erneut versuchen'; addLog(result.error || 'Mod konnte nicht geladen werden.', 'error'); }
}

$('playBtn').onclick = launch; $('prepareBtn').onclick = () => prepare(); $('openModsBtn').onclick = () => window.vortex.openModsFolder(selectedVersion); $('openInstanceBtn').onclick = () => window.vortex.openInstanceFolder(selectedVersion); $('clearLog').onclick = () => { logEl.innerHTML = ''; }; $('cosmeticsInfoBtn').onclick = () => window.vortex.showCosmeticsInfo();
document.querySelectorAll('.nav-link').forEach(button => button.onclick = () => showPage(button.dataset.page)); document.querySelectorAll('[data-page-target]').forEach(button => button.onclick = () => showPage(button.dataset.pageTarget)); document.querySelectorAll('.hat-card').forEach(button => button.onclick = () => saveCosmetics({ hat: button.dataset.hat })); document.querySelectorAll('.emblem-card').forEach(button => button.onclick = () => saveCosmetics({ emblem: button.dataset.emblem }));
$('createCosmeticsBtn').onclick = createCosmeticSkin; $('openSkinsBtn').onclick = () => window.vortex.openSkinsFolder(launcherState.cosmeticsVersion); $('searchModsBtn').onclick = searchOnlineMods; $('modSearchInput').onkeydown = event => { if (event.key === 'Enter') searchOnlineMods(); }; $('openProfileBtn').onclick = () => window.vortex.openCosmeticsProfile(launcherState.cosmeticsVersion); $('refreshModsBtn').onclick = refreshLibrary; $('prepareLibraryBtn').onclick = () => prepare(selectedVersion); $('openLibraryModsBtn').onclick = () => window.vortex.openModsFolder(selectedVersion); $('checkUpdateBtn').onclick = checkUpdate; $('downloadUpdateBtn').onclick = downloadUpdate; $('installUpdateBtn').onclick = installUpdate;
window.vortex.onStatus(({ type, message }) => { setStatus(message); addLog(message, type); if (type === 'success' && message.includes('gestartet')) { $('playBtn').disabled = false; $('playLabel').textContent = 'Vortex starten'; } }); window.vortex.onLog(message => addLog(message)); window.vortex.onProgress(data => { if (data?.type) setStatus(`Lade ${data.type} …`); }); window.vortex.onUpdateState(update => { if (launcherState) launcherState.update = update; updateUpdateView(update); });
addLog('Vortex Client Launcher 0.4.0 bereit.'); refresh();
