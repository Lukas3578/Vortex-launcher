const $ = id => document.getElementById(id);
const logEl = $('log');
let launcherState = null;
let selectedVersion = '1.21.11';
let selectedHat = 'vortex-cap';
let selectedEmblem = 'vortex-crest';
let templateModResults = [];
let installedCollapsed = false;
let resourcePackResults = [];
let installedPacksCollapsed = false;
let aiState = null;
let deferredUpdateVersion = null;
let skinStudioReady = false;
let skinStudioErasing = false;
let skinStudioRotation = -28;
let skinStudioDragging = null;

const hatNames = { none: 'No Hat', 'vortex-cap': 'Vortex Cap', 'neon-halo': 'Neon Halo', 'void-crown': 'Void Crown', 'cyber-headphones': 'Cyber Headphones', 'slime-antenna': 'Slime Antenna' };
const emblemNames = { none: 'No Cape', 'vortex-crest': 'Vortex Cape', 'nebula-mark': 'Nebula Cape', 'void-rune': 'Void Cape' };
const escapeHtml = value => String(value).replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char]));
const escapeAttr = value => escapeHtml(value).replace(/['"]/g, char => char === '"' ? '&quot;' : '&#39;');
const aiProviderModels = { openai: [{ value: 'gpt-4.1-mini', label: 'gpt-4.1-mini · fast' }, { value: 'gpt-5-mini', label: 'gpt-5-mini · creative' }], manus: [{ value: 'manus-1.6-lite', label: 'manus-1.6-lite · fast' }, { value: 'manus-1.6', label: 'manus-1.6 · standard' }, { value: 'manus-1.6-max', label: 'manus-1.6-max · comprehensive' }] };

function addLog(message, tone = '') {
  if (!logEl) return;
  const text = String(message || '').trim();
  if (!text) return;
  const last = logEl.lastElementChild;
  if (last && last.dataset.message === text && last.dataset.tone === tone) {
    const count = Number(last.dataset.count || 1) + 1;
    last.dataset.count = String(count);
    let badge = last.querySelector('.log-count');
    if (!badge) { badge = document.createElement('span'); badge.className = 'log-count'; last.appendChild(badge); }
    badge.textContent = `×${count}`;
    return;
  }
  const item = document.createElement('div');
  item.className = `log-line ${tone}`.trim();
  item.dataset.message = text;
  item.dataset.tone = tone;
  item.dataset.count = '1';
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<span class="log-time">${time}</span><span class="log-text">${escapeHtml(text)}</span>`;
  logEl.appendChild(item);
  while (logEl.childElementCount > 300) logEl.firstElementChild?.remove();
  requestAnimationFrame(() => logEl.scrollTo({ top: logEl.scrollHeight, behavior: 'smooth' }));
}
function setStatus(message) { $('statusText').textContent = message; }
function avatarMarkup(value, className = 'avatar signed') { return `<span class="${className}" data-avatar-for="${escapeAttr(value.id)}">${escapeHtml(value.username.slice(0, 2).toUpperCase())}</span>`; }
async function hydrateAccountAvatar(value) {
  if (!value?.id) return;
  const result = await window.vortex.getAccountAvatar(value.id);
  const target = [...document.querySelectorAll('[data-avatar-for]')].find(element => element.dataset.avatarFor === value.id);
  if (!target || !result?.avatar) return;
  target.classList.add('has-image');
  target.innerHTML = `<img src="${escapeAttr(result.avatar)}" alt="${escapeAttr(value.username)}" />`;
}
async function chooseAccountAvatar() {
  if (!launcherState?.account) return;
  const result = await window.vortex.selectAccountAvatar(launcherState.account.id);
  if (!result.ok) { if (!result.canceled) addLog(result.error || 'Profile image could not be saved.', 'error'); return; }
  launcherState.account.hasCustomProfileImage = true; const matching = (launcherState.accounts || []).find(item => item.id === launcherState.account.id); if (matching) matching.hasCustomProfileImage = true;
  setAccount(launcherState.account, launcherState.accounts); addLog('Personal profile image saved locally.', 'success');
}
async function resetAccountAvatar() {
  if (!launcherState?.account) return;
  const result = await window.vortex.resetAccountAvatar(launcherState.account.id);
  if (!result.ok) { addLog(result.error || 'Profile image could not be reset.', 'error'); return; }
  launcherState.account.hasCustomProfileImage = false; const matching = (launcherState.accounts || []).find(item => item.id === launcherState.account.id); if (matching) matching.hasCustomProfileImage = false;
  setAccount(launcherState.account, launcherState.accounts); addLog('Reverted to Microsoft/Minecraft avatar.', 'success');
}
function setAccount(account, savedAccounts = []) {
  const element = $('account'); const communityNav = $('communityNav'); const accounts = Array.isArray(savedAccounts) ? savedAccounts : [];
  if (communityNav) communityNav.hidden = !account;
  ['joinOfficialServerBtn', 'joinOfficialServerHeroBtn'].forEach(id => { const button = $(id); if (button) button.disabled = !account; });
  if (!account) { element.innerHTML = '<div class="avatar">?</div><div><strong>Not signed in</strong><span>Minecraft Microsoft account</span></div><button class="button secondary small" id="loginBtn">Sign in</button>'; $('loginBtn').onclick = login; return; }
  const accountRows = accounts.map(item => `<div class="account-menu-row"><button class="account-choice${item.id === account.id ? ' active' : ''}" data-account-choice="${escapeAttr(item.id)}"><span class="account-choice-avatar">${escapeHtml(item.username.slice(0, 2).toUpperCase())}</span><span><strong>${escapeHtml(item.username)}</strong><small>${item.id === account.id ? 'Active account' : 'Minecraft Microsoft account'}</small></span>${item.id === account.id ? '<b>✓</b>' : ''}</button><button class="account-remove" data-account-remove="${escapeAttr(item.id)}" title="Remove account from this launcher" aria-label="Remove ${escapeAttr(item.username)}">×</button></div>`).join('');
  const avatarTools = `<div class="account-avatar-tools"><p>PROFILE IMAGE</p><button class="account-avatar-action" id="chooseAvatarBtn">${account.hasCustomProfileImage ? 'Change image' : 'Choose custom image'}</button>${account.hasCustomProfileImage ? '<button class="account-avatar-action muted" id="resetAvatarBtn">Use Microsoft avatar</button>' : '<small>Default: your Minecraft head</small>'}</div>`;
  element.innerHTML = `<div class="account-manager"><button class="account-current" id="accountMenuBtn" aria-expanded="false">${avatarMarkup(account, 'avatar signed account-profile-avatar')}<span><strong>${escapeHtml(account.username)}</strong><small>${accounts.length} saved ${accounts.length === 1 ? 'account' : 'accounts'}</small></span><b>⌄</b></button><div class="account-menu" id="accountMenu" hidden><p class="account-menu-label">MINECRAFT ACCOUNTS</p>${accountRows}${avatarTools}<button class="account-add" id="addAccountBtn">+ Add account</button></div></div>`;
  $('accountMenuBtn').onclick = () => { const menu = $('accountMenu'); const open = menu.hidden; menu.hidden = !open; $('accountMenuBtn').setAttribute('aria-expanded', String(open)); };
  element.querySelectorAll('[data-account-choice]').forEach(button => button.onclick = () => selectSavedAccount(button.dataset.accountChoice));
  element.querySelectorAll('[data-account-remove]').forEach(button => button.onclick = event => { event.stopPropagation(); removeSavedAccount(button.dataset.accountRemove); });
  $('addAccountBtn').onclick = login; $('chooseAvatarBtn').onclick = chooseAccountAvatar; if ($('resetAvatarBtn')) $('resetAvatarBtn').onclick = resetAccountAvatar;
  void hydrateAccountAvatar(account);
}
async function selectSavedAccount(id) { const result = await window.vortex.selectAccount(id); if (!result.ok) { addLog(result.error || 'Account could not be switched.', 'error'); return; } launcherState.account = result.account; launcherState.accounts = result.accounts; setAccount(result.account, result.accounts); addLog(`Active account: ${result.account.username}`, 'success'); }
async function removeSavedAccount(id) { const selected = (launcherState?.accounts || []).find(item => item.id === id); if (!selected || !confirm(`Remove ${selected.username} from this launcher?`)) return; const result = await window.vortex.removeAccount(id); if (!result.ok) { addLog(result.error || 'Account could not be removed.', 'error'); return; } launcherState.account = result.account; launcherState.accounts = result.accounts; setAccount(result.account, result.accounts); addLog(`${selected.username} was removed from the launcher.`); }
function currentSummary() { return launcherState?.versions?.find(instance => instance.version === selectedVersion); }
function cosmeticsSummary() { return launcherState?.versions?.find(instance => instance.version === launcherState?.cosmeticsVersion); }
function updatePlaySummary() { const summary = currentSummary(); $('selectedVersionLabel').textContent = selectedVersion; $('coreStatus').textContent = summary?.ready ? 'Active' : 'Provisioning'; $('modCount').textContent = summary ? `${summary.totalModCount} Mods` : '— Mods'; }
function updateBedrockView(bedrock = launcherState?.bedrock || {}) {
  const title = $('bedrockTitle'); const description = $('bedrockDescription'); const pill = $('bedrockStatusPill'); const version = $('bedrockVersion'); const launch = $('launchBedrockBtn');
  if (!title || !description || !pill || !version || !launch) return;
  if (!bedrock.supported) {
    title.textContent = 'Bedrock launch is only available on Windows'; description.textContent = bedrock.message || 'Minecraft for Windows can be launched by Vortex only on Windows.'; pill.textContent = 'WINDOWS ONLY'; version.hidden = true; launch.disabled = true; return;
  }
  if (!bedrock.installed) {
    title.textContent = 'Minecraft for Windows is not installed'; description.textContent = bedrock.message || 'Install Minecraft for Windows from the Microsoft Store, then refresh this page.'; pill.textContent = 'NOT INSTALLED'; version.hidden = true; launch.disabled = true; return;
  }
  title.textContent = 'Minecraft for Windows is ready'; description.textContent = 'Bedrock is installed and can be launched directly from Vortex.'; pill.textContent = 'READY'; version.textContent = bedrock.version ? `VERSION ${bedrock.version}` : ''; version.hidden = !bedrock.version; launch.disabled = false;
}
async function refreshBedrock() {
  const button = $('refreshBedrockBtn'); if (button) { button.disabled = true; button.textContent = 'Checking …'; }
  try { const state = await window.vortex.getBedrockState(); if (launcherState) launcherState.bedrock = state; updateBedrockView(state); }
  catch (_) { updateBedrockView({ supported: true, installed: false, message: 'Minecraft for Windows could not be detected.' }); }
  if (button) { button.disabled = false; button.textContent = 'Refresh Status'; }
}
async function startBedrock() {
  const button = $('launchBedrockBtn'); if (button) { button.disabled = true; button.textContent = 'Launching …'; }
  const result = await window.vortex.launchBedrock();
  if (launcherState) launcherState.bedrock = result;
  updateBedrockView(result);
  if (result?.ok) addLog('Minecraft Bedrock launch request sent.', 'success'); else addLog(result?.error || result?.message || 'Minecraft Bedrock could not be started.', 'error');
  if (button) button.textContent = 'Launch Bedrock';
}
function selectedServer() { return (launcherState?.servers || []).find(server => server.id === launcherState?.state?.selectedServerId) || (launcherState?.servers || [])[0] || null; }
function serverStatusDetails(status) {
  if (!status) return { description: 'Real server data is loading …', meta: 'LOADING STATUS', state: 'loading' };
  if (!status.online) return { description: status.description || 'Server status currently unavailable.', meta: 'STATUS UNREACHABLE', state: 'offline' };
  const playerCount = `${Number(status.players?.online || 0)}/${Number(status.players?.max || 0)}`;
  return { description: status.description || 'The server has not set a description.', meta: `ONLINE · ${playerCount} PLAYERS · ${status.version || 'UNKNOWN VERSION'}`, state: 'online' };
}
function serverImageMarkup(server) {
  const status = server.status;
  const details = serverStatusDetails(status);
  const image = status?.online && status.favicon ? `<img class="server-favicon" src="${escapeAttr(status.favicon)}" alt="${escapeAttr(server.name)} – real server favicon" />` : '';
  const badge = server.official ? 'VORTEXPVP' : details.state === 'online' ? 'ONLINE' : details.state === 'offline' ? 'OFFLINE' : 'CHECK';
  return `<div class="server-card-media${status?.favicon ? ' has-image' : ''}" data-server-media="${escapeAttr(server.id)}">${image}<div class="server-media-shade"></div><span class="server-media-badge ${details.state}">${badge}</span></div>`;
}
function updateOfficialServerHero(server) {
  const description = $('officialServerLiveDescription');
  const meta = $('officialServerLiveMeta');
  if (!server || !description || !meta) return;
  const details = serverStatusDetails(server.status);
  description.textContent = details.description;
  meta.textContent = details.meta;
}
async function hydrateServerStatuses(servers) {
  await Promise.all(servers.map(async server => {
    try {
      const result = await window.vortex.refreshServerStatus(server.id);
      if (!result?.ok) return;
      const current = (launcherState?.servers || []).find(item => item.id === server.id);
      if (!current || JSON.stringify(current.status || null) === JSON.stringify(result.status || null)) return;
      current.status = result.status || null;
      renderServers();
    } catch (_) {}
  }));
}
function renderServers() {
  const list = $('serverList'); if (!list || !launcherState) return;
  const servers = Array.isArray(launcherState.servers) ? launcherState.servers : [];
  const selectedId = launcherState.state?.selectedServerId;
  const joinDisabled = launcherState.account ? '' : ' disabled title="Sign in with a Minecraft account first"';
  $('serverCount').textContent = `${servers.length} SERVER${servers.length === 1 ? '' : 'S'}`;
  updateOfficialServerHero(servers.find(server => server.official));
  list.innerHTML = servers.map(server => { const details = serverStatusDetails(server.status); return `<article class="server-card gallery${server.id === selectedId ? ' selected' : ''}${server.official ? ' official' : ''}">${serverImageMarkup(server)}<div class="server-card-content"><div class="server-card-heading"><div><div class="server-title-line"><h4>${escapeHtml(server.name)}</h4>${server.official ? '<span class="server-official-label">OFFICIAL</span>' : ''}</div><code>${escapeHtml(server.address)}</code></div>${server.id === selectedId ? '<span class="server-selected-dot">DEFAULT</span>' : ''}</div><p>${escapeHtml(details.description)}</p><small class="server-live-meta ${details.state}">${escapeHtml(details.meta)}</small><div class="server-card-actions"><button class="button small" data-server-join="${escapeAttr(server.id)}"${joinDisabled}>Join</button><button class="server-select-button${server.id === selectedId ? ' selected' : ''}" data-server-select="${escapeAttr(server.id)}">${server.id === selectedId ? '✓ Selected' : 'Select'}</button><button class="server-refresh-button" data-server-refresh="${escapeAttr(server.id)}" title="Refresh real server data" aria-label="Update ${escapeAttr(server.name)}">↻</button>${server.official ? '<span class="server-lock" title="Official server">⌘</span>' : `<button class="server-remove-button" data-server-remove="${escapeAttr(server.id)}" title="Remove server" aria-label="Remove ${escapeAttr(server.name)}">×</button>`}</div></div></article>`; }).join('') || '<p class="mod-empty">No servers saved yet.</p>';
  list.querySelectorAll('[data-server-join]').forEach(button => button.onclick = () => joinServer(button.dataset.serverJoin));
  list.querySelectorAll('[data-server-select]').forEach(button => button.onclick = () => selectServer(button.dataset.serverSelect));
  list.querySelectorAll('[data-server-refresh]').forEach(button => button.onclick = () => refreshServerStatus(button.dataset.serverRefresh, button));
  list.querySelectorAll('[data-server-remove]').forEach(button => button.onclick = () => removeServer(button.dataset.serverRemove));
  void hydrateServerStatuses(servers);
}
async function refreshServerStatus(id, button = null) { const server = (launcherState?.servers || []).find(item => item.id === id); if (!server) return; if (button) { button.disabled = true; button.textContent = '…'; } const result = await window.vortex.refreshServerStatus(id, true); if (button) { button.disabled = false; button.textContent = '↻'; } if (!result?.ok) { addLog(result?.error || 'Server status could not be updated.', 'error'); return; } server.status = result.status || null; renderServers(); addLog(`${server.name}: real server data updated.`, result.status?.online ? 'success' : 'error'); }
async function selectServer(id) { const result = await window.vortex.selectServer(id); if (!result.ok) { addLog(result.error || 'Server could not be selected.', 'error'); return; } launcherState.state = result.state; renderServers(); addLog(`${result.server.name} is selected as the default server.`, 'success'); }
async function joinServer(id) { const server = (launcherState?.servers || []).find(item => item.id === id); if (!server) { addLog('Server could not be found.', 'error'); return; } await selectServer(id); $('playBtn').disabled = true; $('playLabel').textContent = 'Connecting …'; const result = await window.vortex.launch(selectedVersion, id); if (!result.ok) { addLog(result.error || 'Failed to start server.', 'error'); $('playBtn').disabled = false; $('playLabel').textContent = 'Launch Vortex'; return; } addLog(`Direct launch to ${server.name} (${server.address}).`, 'success'); }
async function addServer() { const button = $('addServerBtn'); const input = { name: $('serverName').value.trim(), address: $('serverAddress').value.trim() }; button.disabled = true; const result = await window.vortex.addServer(input); button.disabled = false; if (!result.ok) { $('serverFormStatus').textContent = result.error || 'Server could not be saved.'; return; } launcherState.servers = result.servers; launcherState.state = result.state; $('serverName').value = ''; $('serverAddress').value = ''; $('serverFormStatus').textContent = `${result.server.name} saved. Image and description will now be loaded from the Minecraft server.`; renderServers(); addLog(`Server added: ${result.server.name} (${result.server.address}).`, 'success'); }
async function removeServer(id) { const server = (launcherState?.servers || []).find(item => item.id === id); if (!server || !confirm(`Remove ${server.name} from your server library?`)) return; const result = await window.vortex.removeServer(id); if (!result.ok) { addLog(result.error || 'Server could not be removed.', 'error'); return; } launcherState.servers = result.servers; launcherState.state = result.state; renderServers(); addLog(`${server.name} was removed from your server library.`); }
function modScopeLabel() { const scope = $('modScope'); if (scope) scope.textContent = `for ${selectedVersion}`; const packScope = $('resourcePackScope'); if (packScope) packScope.textContent = `for ${selectedVersion}`; }

function renderVersions() { const select = $('versionSelect'); const options = launcherState.versions.map(item => `<option value="${item.version}">${item.version} · Fabric + Vortex Client${item.cosmeticsSupported ? ' · Cosmetics' : ''}</option>`).join(''); select.innerHTML = options; select.value = selectedVersion; select.onchange = async event => { selectedVersion = event.target.value; await window.vortex.selectVersion(selectedVersion); updatePlaySummary(); renderInstanceCards(); modScopeLabel(); await refreshInstalled(); await renderOverview(); }; }
function renderInstanceCards() { $('instancesGrid').innerHTML = launcherState.versions.map(instance => { const active = instance.version === selectedVersion ? ' selected' : ''; const state = instance.ready && instance.fabricInstalled ? 'Protected' : 'Auto-repairing'; return `<article class="instance-card${active}"><div class="instance-title"><div><h3>${instance.version}</h3><p>FABRIC + VORTEX CLIENT</p></div><span class="instance-state">${state}</span></div><div class="instance-stats"><div class="instance-stat"><span>REQUIRED MODS</span><strong>${instance.coreModCount}</strong></div><div class="instance-stat"><span>TOTAL</span><strong>${instance.totalModCount} Mods</strong></div></div><div class="instance-actions"><button class="button secondary" data-select="${instance.version}">Select</button><button class="button secondary" data-instance-folder="${instance.version}">Instance folder</button><button class="button ghost" data-mods="${instance.version}">Mods</button></div></article>`; }).join(''); document.querySelectorAll('[data-select]').forEach(button => button.onclick = async () => { selectedVersion = button.dataset.select; await window.vortex.selectVersion(selectedVersion); $('versionSelect').value = selectedVersion; updatePlaySummary(); renderInstanceCards(); modScopeLabel(); await refreshInstalled(); await renderOverview(); showPage('play'); }); document.querySelectorAll('[data-instance-folder]').forEach(button => button.onclick = () => window.vortex.openInstanceFolder(button.dataset.instanceFolder)); document.querySelectorAll('[data-mods]').forEach(button => button.onclick = () => window.vortex.openModsFolder(button.dataset.mods)); }
function updateCosmetics() {
  const hatPreviewPaths = { none: '../assets/cosmetics/previews/hat-none.png', 'vortex-cap': '../assets/cosmetics/previews/hat-vortex-cap.png', 'neon-halo': '../assets/cosmetics/previews/hat-neon-halo.png', 'void-crown': '../assets/cosmetics/previews/hat-void-crown.png', 'cyber-headphones': '../assets/cosmetics/previews/hat-cyber-headphones.png', 'slime-antenna': '../assets/cosmetics/previews/hat-slime-antenna.png' };
  const capePreviewPaths = { none: '../assets/cosmetics/previews/cape-none.png', 'vortex-crest': '../assets/cosmetics/previews/cape-vortex-crest.png', 'nebula-mark': '../assets/cosmetics/previews/cape-nebula-mark.png', 'void-rune': '../assets/cosmetics/previews/cape-void-rune.png' };
  $('cosmeticName').textContent = hatNames[selectedHat]; $('emblemName').textContent = emblemNames[selectedEmblem];
  $('cosmeticPreview').className = `cosmetic-shape ${selectedHat === 'void-crown' ? 'purple' : selectedHat === 'neon-halo' ? 'cyan' : selectedHat === 'slime-antenna' ? 'green' : ''}`;
  const loadoutHat = $('loadoutHatPreview'); const loadoutCape = $('loadoutCapePreview'); const loadoutHatName = $('loadoutHatName'); const loadoutCapeName = $('loadoutCapeName');
  if (loadoutHat) { loadoutHat.src = hatPreviewPaths[selectedHat]; loadoutHat.alt = `${hatNames[selectedHat]} 3D preview`; }
  if (loadoutCape) { loadoutCape.src = capePreviewPaths[selectedEmblem]; loadoutCape.alt = `${emblemNames[selectedEmblem]} preview`; }
  if (loadoutHatName) loadoutHatName.textContent = hatNames[selectedHat]; if (loadoutCapeName) loadoutCapeName.textContent = emblemNames[selectedEmblem];
  document.querySelectorAll('.hat-card').forEach(card => card.classList.toggle('selected', card.dataset.hat === selectedHat)); document.querySelectorAll('.emblem-card').forEach(card => card.classList.toggle('selected', card.dataset.emblem === selectedEmblem));
  const summary = cosmeticsSummary(); const profile = summary?.cosmeticProfile; const status = $('cosmeticsStatus');
  if (!summary?.cosmeticsSupported) status.textContent = 'Cosmetics output for 1.21.11 is being prepared.';
  else status.innerHTML = `<strong>Original skin protected.</strong> ${escapeHtml(hatNames[selectedHat])} + ${escapeHtml(emblemNames[selectedEmblem])} use separate real 3D cosmetics.`;
}


function updateUpdateView(update = launcherState?.update || {}) {
  const modal = $('updateModal');
  const sidebarUpdate = $('sidebarUpdate');
  const active = ['available', 'downloading', 'downloaded'].includes(update.status);
  const version = update.availableVersion || '';
  sidebarUpdate.hidden = !active;
  if (active) $('sidebarUpdateText').textContent = update.status === 'downloaded' ? `Version ${version} ready · Restart` : `Version ${version} available`;
  if (!active || !version) { if (modal) modal.hidden = true; return; }
  if (deferredUpdateVersion === version && update.status !== 'downloaded') return;
  showUpdatePopup(update);
}
function showUpdatePopup(update = launcherState?.update || {}) {
  const modal = $('updateModal'); if (!modal || !update.availableVersion) return;
  const downloading = update.status === 'downloading';
  const downloaded = update.status === 'downloaded';
  const progress = Math.max(0, Math.min(100, update.progress || 0));
  $('updateModalTitle').textContent = downloaded ? 'Restart required' : downloading ? 'Update is downloading' : 'Update available';
  $('updateModalText').textContent = downloaded ? `Version ${update.availableVersion} is ready. Restart the launcher to install it.` : downloading ? `Version ${update.availableVersion} is being securely downloaded.` : `Version ${update.availableVersion} is available and keeps your launcher up to date.`;
  $('updateModalNote').textContent = downloaded ? 'The launcher will restart briefly. Your instances, mods, cosmetics and settings will be preserved.' : 'When the update finishes, the launcher will restart automatically. Your instances and files will be preserved.';
  $('updateModalProgress').hidden = !downloading;
  $('updateModalProgressValue').textContent = `${progress} %`;
  $('updateModalProgressBar').style.width = `${progress}%`;
  const action = $('updateActionBtn');
  action.textContent = downloaded ? 'Restart now' : downloading ? 'Downloading …' : 'Update now';
  action.disabled = downloading;
  $('updateLaterBtn').textContent = downloaded ? 'Restart later' : 'Later';
  modal.hidden = false;
}
async function runUpdateAction() {
  const update = launcherState?.update || {};
  if (update.status === 'available') { const result = await window.vortex.downloadUpdate(); if (launcherState) launcherState.update = result; updateUpdateView(result); return; }
  if (update.status === 'downloaded') { const result = await window.vortex.installUpdate(); if (!result.ok) addLog(result.error || 'Update could not be started.', 'error'); }
}
function updateReleaseNews(news = launcherState?.news || {}) {
  const modal = $('newsModal');
  const notes = Array.isArray(news?.notes) ? news.notes : [];
  if (!notes.length) { modal.hidden = true; return; }
  const latest = notes[notes.length - 1];
  $('newsVersionLabel').textContent = `VERSION ${latest.version}`;
  $('newsModalTitle').textContent = notes.length === 1 ? `New in version ${latest.version}` : `What's new since version ${notes[0].version}`;
  $('newsModalSummary').textContent = latest.summary || 'Your launcher has been updated.';
  $('newsModalList').innerHTML = notes.map(note => `<article class="news-entry"><strong>${escapeHtml(note.title || `Version ${note.version}`)}</strong><span>VERSION ${escapeHtml(note.version || '')}</span><ul>${(Array.isArray(note.items) ? note.items : []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article>`).join('');
  modal.hidden = false;
}
async function closeReleaseNews() {
  const result = await window.vortex.markReleaseNewsSeen();
  if (result?.ok && launcherState) launcherState.news = result.news;
  $('newsModal').hidden = true;
}
function updateAiProviderControls(provider = $('aiProvider')?.value || 'openai', requestedModel) { const selected = provider === 'manus' ? 'manus' : 'openai'; const models = aiProviderModels[selected]; const providerSelect = $('aiProvider'); const modelSelect = $('aiTextModel'); if (providerSelect) providerSelect.value = selected; $('aiKeyLabel').textContent = `Your ${selected === 'manus' ? 'Manus' : 'OpenAI'} API key`; $('aiKeyInput').placeholder = 'sk-…'; $('aiModelLabel').textContent = selected === 'manus' ? 'Manus profile' : 'Text model'; modelSelect.innerHTML = models.map(model => `<option value="${model.value}">${model.label}</option>`).join(''); modelSelect.value = models.some(model => model.value === requestedModel) ? requestedModel : models[0].value; }
function updateAiStudio(state = aiState || {}) { aiState = state; const ready = Boolean(state.ready); const provider = state.provider === 'manus' ? 'manus' : 'openai'; updateAiProviderControls(provider, state.textModel); const badge = $('aiSecurityBadge'); const keyState = $('aiKeyState'); const createState = $('aiCreateStatus'); badge.textContent = ready ? 'Ready and protected' : 'Not set up'; badge.classList.toggle('ai-ready', ready); keyState.textContent = ready ? `Securely stored locally · ${state.providerLabel || (provider === 'manus' ? 'Manus API' : 'OpenAI API')} · ${state.textModel || 'Default model'}` : (state.encryptionAvailable === false ? 'Windows key encryption is not available.' : 'Select OpenAI or Manus and then provide a private API key.'); createState.textContent = ready ? 'Describe your desired look or a mod idea.' : 'Provide a private API key to get started.'; ['generateAiCapeBtn', 'generateAiModBtn'].forEach(id => { const button = $(id); if (button) button.disabled = !ready; }); $('removeAiKeyBtn').disabled = !ready; }
async function refreshAiStudio() { try { updateAiStudio(await window.vortex.getAiState()); } catch (_) { updateAiStudio({ ready: false, encryptionAvailable: false }); } }
function showAiResult(result, type) { const preview = $('aiResultPreview'); const design = result.design || {}; $('aiResultTitle').textContent = design.title || 'AI draft created'; $('aiResultText').textContent = type === 'mod' ? `Private project template ${result.modId || ''} was created locally. Check the files before building.` : `${design.summary || 'Local draft created.'}${type === 'cape' ? ' Restart Minecraft to load the cape.' : ''}`; if (result.preview) { preview.innerHTML = `<img src="${escapeAttr(result.preview)}" alt="${escapeAttr(design.title || 'AI draft')}" />`; preview.querySelector('img').onerror = () => { preview.innerHTML = '<span>✺</span>'; }; } else preview.innerHTML = '<span>✦</span>'; }
async function saveAiKey() { const input = $('aiKeyInput'); const button = $('saveAiKeyBtn'); const key = input.value.trim(); const provider = $('aiProvider').value; if (!key) { $('aiKeyState').textContent = 'Enter your private API key.'; return; } button.disabled = true; const result = await window.vortex.saveAiKey(key, provider, $('aiTextModel').value); input.value = ''; button.disabled = false; if (!result.ok) { $('aiKeyState').textContent = result.error || 'Key could not be saved.'; return; } updateAiStudio(result.state); addLog(`${provider === 'manus' ? 'Manus' : 'OpenAI'} key was securely stored locally.`, 'success'); }
async function removeAiKey() { if (!aiState?.ready || !confirm('Remove the locally stored AI key?')) return; const result = await window.vortex.removeAiKey(); if (result.ok) { updateAiStudio(result.state); addLog('Local AI key removed.'); } }
async function createAiAsset(kind) { const prompt = $('aiPrompt').value.trim(); if (!prompt) { $('aiCreateStatus').textContent = 'Describe your desired design first.'; return; } const button = $(kind === 'skin' ? 'generateAiSkinBtn' : kind === 'cape' ? 'generateAiCapeBtn' : 'generateAiModBtn'); const label = button.textContent; button.disabled = true; button.textContent = 'AI designing …'; $('aiCreateStatus').textContent = 'Your private draft is being created …'; const result = kind === 'skin' ? await window.vortex.generateAiSkin(prompt) : kind === 'cape' ? await window.vortex.generateAiCape(prompt) : await window.vortex.createAiModProject(prompt); button.disabled = false; button.textContent = label; if (!result.ok) { $('aiCreateStatus').textContent = result.error || 'AI draft could not be created.'; addLog(result.error || 'AI draft could not be created.', 'error'); return; } showAiResult(result, kind); $('aiCreateStatus').textContent = kind === 'skin' ? 'AI skin created and activated as a Vortex skin variant.' : kind === 'cape' ? 'AI cape created and activated for the next Minecraft start.' : 'Private mod project template created. Inspect the source before building.'; addLog(`AI-${kind === 'mod' ? 'mod project' : kind} created: ${result.design?.title || 'Draft'}.`, 'success'); if (kind === 'skin') { await refresh(); await updateSkinPreview(); } }

async function checkUpdate() { const result = await window.vortex.checkForUpdates(); if (launcherState) launcherState.update = result; updateUpdateView(result); }

// Mod installer — exactly the layout and interaction model from the supplied source ZIP.
function templateIcon(hit) { const letter = escapeHtml((hit.title || '?').slice(0, 1).toUpperCase()); const iconUrl = /^https:\/\/cdn\.modrinth\.com\//i.test(hit.iconUrl || '') ? hit.iconUrl : null; return iconUrl ? `<img class="mod-icon" src="${escapeAttr(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mod-icon fallback',textContent:'${letter}'}))" />` : `<span class="mod-icon fallback">${letter}</span>`; }
function installedModIcon(mod, className = 'mod-icon own') { const title = mod.title || mod.name.replace(/\.jar$/, ''); const letter = escapeHtml(title.slice(0, 1).toUpperCase()); const source = mod.protected ? '../assets/branding/vortex-logo.png' : (mod.iconData || (/^https:\/\/cdn\.modrinth\.com\//i.test(mod.iconUrl || '') ? mod.iconUrl : null)); return source ? `<img class="${className}" src="${escapeAttr(source)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mod-icon fallback',textContent:'${letter}'}))" />` : `<span class="${className} fallback">${letter}</span>`; }
function renderModResults(hits) { const box = $('modResults'); if (!hits.length) { box.innerHTML = '<p class="mod-empty">Nothing found. Try another term.</p>'; return; } box.innerHTML = hits.map((hit, index) => { const button = hit.installed ? '<button class="button small" disabled>Already installed</button>' : `<button class="button small" data-install="${index}">Install</button>`; return `<article class="mod-card${hit.installed ? ' has-mod' : ''}">${templateIcon(hit)}<div class="mod-body"><strong>${escapeHtml(hit.title)}</strong><p>${escapeHtml(hit.description || '')}</p><small>${Number(hit.downloads || 0).toLocaleString('en-GB')} downloads${hit.author ? ' · ' + escapeHtml(hit.author) : ''}</small></div>${button}</article>`; }).join(''); box.querySelectorAll('[data-install]').forEach(button => button.onclick = () => installTemplateMod(Number(button.dataset.install), button)); }
async function searchTemplateMods() { const query = $('modQuery').value.trim(); if (!query) { setStatus('Enter a search term.'); return; } const button = $('modSearchBtn'); button.disabled = true; $('modResults').innerHTML = '<p class="mod-empty">Searching …</p>'; const result = await window.vortex.searchMods(query, selectedVersion, 0); button.disabled = false; if (!result.ok) { $('modResults').innerHTML = `<p class="mod-empty">${escapeHtml(result.error || 'Search failed.')}</p>`; return; } templateModResults = result.results || []; renderModResults(templateModResults); }
async function installTemplateMod(index, button) { const hit = templateModResults[index]; if (!hit) return; button.disabled = true; const label = button.textContent; button.textContent = 'Downloading …'; addLog(`Installing ${hit.title} for ${selectedVersion} …`); const result = await window.vortex.installModProject(hit.projectId, selectedVersion); if (result.ok) { hit.installed = true; button.textContent = 'Installed'; addLog(`${hit.title}: ${(result.installed || []).length + (result.present || []).length} file(s) in the mods folder.`, 'success'); await refreshInstalled(); await renderOverview(); await refresh(); } else { button.textContent = label; button.disabled = false; addLog(result.error || 'Installation failed.', 'error'); } }
async function refreshInstalled() { const box = $('installedMods'); if (!box || !launcherState) return; const list = await window.vortex.listMods(selectedVersion); if (!list.length) { box.innerHTML = '<p class="mod-empty">No mods in this instance yet.</p>'; return; } box.hidden = installedCollapsed; box.innerHTML = list.map(mod => `<div class="installed-row installed-row-art">${installedModIcon(mod, 'mod-icon installed-icon')}<span>${escapeHtml(mod.title || mod.name)}</span><button class="text-button" data-installed-remove="${escapeAttr(mod.file || mod.name)}">Remove</button></div>`).join(''); box.querySelectorAll('[data-installed-remove]').forEach(button => button.onclick = async () => { const result = await window.vortex.removeMod(selectedVersion, button.dataset.installedRemove); if (!result.ok) addLog(result.error || 'Could not remove this Vortex file.', 'error'); else addLog(`${button.dataset.installedRemove} removed.`, 'success'); await refreshInstalled(); await renderOverview(); }); }

// Installed mods — exact card, totals, switch and remove model from the supplied source ZIP.
function formatSize(bytes) { if (!bytes) return ''; const mb = bytes / 1048576; return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
async function renderOverview() { const list = $('overviewList'); const totals = $('overviewTotals'); if (!list || !launcherState) return; list.innerHTML = '<p class="mod-empty">Loading …</p>'; const mods = await window.vortex.listMods(selectedVersion); const active = mods.filter(mod => mod.enabled).length; const own = mods.filter(mod => !mod.required).length; $('ovInstance').textContent = `Minecraft ${selectedVersion}`; totals.innerHTML = `<div class="total-card"><span>${active}</span><small>Active</small></div><div class="total-card"><span>${mods.length - active}</span><small>Disabled</small></div><div class="total-card"><span>${own}</span><small>Added by you</small></div><div class="total-card"><span>${escapeHtml(selectedVersion)}</span><small>Version</small></div>`; if (!mods.length) { list.innerHTML = '<p class="mod-empty">Nothing installed yet. Pick a version above.</p>'; return; } list.innerHTML = mods.map(mod => { const title = mod.title || mod.name.replace(/\.jar$/, ''); const letter = escapeHtml(title.slice(0, 1).toUpperCase()); const icon = installedModIcon(mod); const origin = mod.protected ? 'Vortex core' : mod.required ? 'Vortex required' : 'Added by you'; const actions = mod.required ? '<span class="ov-lock" title="Belongs to Vortex Client — cannot be disabled or removed">Fixed</span>' : `<button class="mod-switch${mod.enabled ? ' on' : ''}" data-mod="${escapeAttr(mod.file || mod.name)}" aria-label="${mod.enabled ? 'Turn off' : 'Turn on'}"><span></span></button><button class="ov-remove" data-overview-remove="${escapeAttr(mod.file || mod.name)}" title="Remove from this instance" aria-label="Remove">✕</button>`; return `<article class="mod-card ov-card${mod.enabled ? '' : ' off'}">${icon}<div class="mod-body"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(mod.name)}</p><small>${origin}</small></div><div class="ov-actions">${actions}</div></article>`; }).join(''); list.querySelectorAll('[data-overview-remove]').forEach(button => button.onclick = async () => { const name = button.dataset.overviewRemove; if (!confirm(`Remove ${name} from this instance?`)) return; button.disabled = true; const result = await window.vortex.removeMod(selectedVersion, name); addLog(result.ok ? `${name} removed.` : (result.error || `Could not remove ${name}.`), result.ok ? 'success' : 'error'); await renderOverview(); await refreshInstalled(); }); list.querySelectorAll('[data-mod]').forEach(button => button.onclick = async () => { button.disabled = true; const result = await window.vortex.toggleMod(selectedVersion, button.dataset.mod); if (!result.ok) addLog(result.error || 'Could not toggle.', 'error'); else addLog(`${button.dataset.mod.replace(/\.disabled$/, '')} ${result.enabled ? 'enabled' : 'disabled'}.`, 'success'); await renderOverview(); await refreshInstalled(); }); }

// Resource-Pack installer — same card and instance-list interaction model as the Mod installer.
function renderResourcePackResults(hits) { const box = $('resourcePackResults'); if (!hits.length) { box.innerHTML = '<p class="mod-empty">Nothing found. Try another term.</p>'; return; } box.innerHTML = hits.map((pack, index) => { const button = `<button class="button small" data-pack-install="${index}">Install</button>`; return `<article class="mod-card">${templateIcon(pack)}<div class="mod-body"><strong>${escapeHtml(pack.title)}</strong><p>${escapeHtml(pack.description || '')}</p><small>${Number(pack.downloads || 0).toLocaleString('en-GB')} downloads · ${escapeHtml(pack.gameVersion || selectedVersion)}</small></div>${button}</article>`; }).join(''); box.querySelectorAll('[data-pack-install]').forEach(button => button.onclick = () => installTemplateResourcePack(Number(button.dataset.packInstall), button)); }
async function searchTemplateResourcePacks() { const query = $('resourcePackQuery').value.trim(); if (!query) { setStatus('Enter a resource-pack search term.'); return; } const button = $('resourcePackSearchBtn'); button.disabled = true; $('resourcePackResults').innerHTML = '<p class="mod-empty">Searching …</p>'; const result = await window.vortex.searchResourcePacks(query, selectedVersion, 0); button.disabled = false; if (!result.ok) { $('resourcePackResults').innerHTML = `<p class="mod-empty">${escapeHtml(result.error || 'Search failed.')}</p>`; return; } resourcePackResults = result.results || []; renderResourcePackResults(resourcePackResults); }
async function installTemplateResourcePack(index, button) { const pack = resourcePackResults[index]; if (!pack) return; button.disabled = true; const label = button.textContent; button.textContent = 'Downloading …'; const result = await window.vortex.downloadResourcePack(selectedVersion, { projectId: pack.projectId, versionId: pack.versionId }); if (result.ok) { button.textContent = 'Installed'; addLog(`${result.fileName} saved in the resourcepacks folder.`, 'success'); await refreshInstalledPacks(); } else { button.textContent = label; button.disabled = false; addLog(result.error || 'Resource-pack installation failed.', 'error'); } }
async function refreshInstalledPacks() { const box = $('installedPacks'); if (!box || !launcherState) return; const list = await window.vortex.listResourcePacks(selectedVersion); box.hidden = installedPacksCollapsed; if (!list.length) { box.innerHTML = '<p class="mod-empty">No resource packs in this instance yet.</p>'; return; } box.innerHTML = list.map(pack => `<div class="installed-row"><span>${escapeHtml(pack.name)}</span><button class="text-button" data-pack-remove="${escapeAttr(pack.file)}">Remove</button></div>`).join(''); box.querySelectorAll('[data-pack-remove]').forEach(button => button.onclick = async () => { const result = await window.vortex.removeResourcePack(selectedVersion, button.dataset.packRemove); if (!result.ok) addLog(result.error || 'Could not remove this resource pack.', 'error'); else addLog(`${button.dataset.packRemove} removed.`, 'success'); await refreshInstalledPacks(); }); }

function studioCanvas() { return $('skinStudioCanvas'); }
function studioContext() { const canvas = studioCanvas(); return canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null; }
function studioColor() { return $('skinStudioColor')?.value || '#38d8ff'; }
function studioBrush() { return Math.max(1, Math.min(4, Number($('skinStudioBrush')?.value || 1))); }
function paintStudioRegion(ctx, x, y, width, height, base, shadow, highlight) { ctx.fillStyle = base; ctx.fillRect(x, y, width, height); ctx.fillStyle = shadow; ctx.fillRect(x, y, 1, height); ctx.fillRect(x, y + height - 1, width, 1); ctx.fillStyle = highlight; ctx.fillRect(x + 1, y, Math.max(1, width - 1), 1); }
function studioDefaultDesign() { const ctx = studioContext(); if (!ctx) return; ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, 64, 64); const skin = '#efbf9e'; const skinShade = '#cc8f78'; const skinLight = '#ffe0bf'; const hair = '#342535'; const hairShade = '#1c1421'; const hairLight = '#5a3a4c'; const jacket = '#183e75'; const jacketShade = '#0b2148'; const jacketLight = '#2a5a9c'; const pants = '#111c34'; const pantsShade = '#07101f'; const pantsLight = '#273957'; const cyan = '#3ed9f6'; const cyanShade = '#1a87bc';
  // Head: top, right, front, left, back and bottom. Every cube face receives a deliberate base texture.
  paintStudioRegion(ctx, 8, 0, 8, 8, hair, hairShade, hairLight); paintStudioRegion(ctx, 16, 0, 8, 8, skin, skinShade, skinLight); paintStudioRegion(ctx, 0, 8, 8, 8, hair, hairShade, hairLight); paintStudioRegion(ctx, 8, 8, 8, 8, skin, skinShade, skinLight); paintStudioRegion(ctx, 16, 8, 8, 8, skin, skinShade, skinLight); paintStudioRegion(ctx, 24, 8, 8, 8, hair, hairShade, hairLight); ctx.fillStyle = hair; ctx.fillRect(8, 8, 8, 2); ctx.fillRect(8, 10, 1, 4); ctx.fillStyle = '#17314e'; ctx.fillRect(10, 11, 2, 1); ctx.fillRect(13, 11, 2, 1); ctx.fillStyle = '#c96f74'; ctx.fillRect(11, 14, 3, 1);
  // Body: a dark Vortex jacket, cyan center emblem and complete side/top/bottom faces.
  paintStudioRegion(ctx, 20, 16, 8, 4, jacket, jacketShade, jacketLight); paintStudioRegion(ctx, 28, 16, 8, 4, jacket, jacketShade, jacketLight); paintStudioRegion(ctx, 16, 20, 4, 12, jacket, jacketShade, jacketLight); paintStudioRegion(ctx, 20, 20, 8, 12, jacket, jacketShade, jacketLight); paintStudioRegion(ctx, 28, 20, 4, 12, jacket, jacketShade, jacketLight); paintStudioRegion(ctx, 32, 20, 8, 12, jacket, jacketShade, jacketLight); ctx.fillStyle = cyan; ctx.fillRect(23, 22, 2, 7); ctx.fillRect(22, 23, 1, 2); ctx.fillRect(25, 23, 1, 2); ctx.fillStyle = cyanShade; ctx.fillRect(24, 29, 1, 2);
  // Right arm and right leg.
  [[44,16,4,4],[48,16,4,4],[40,20,4,12],[44,20,4,12],[48,20,4,12],[52,20,4,12]].forEach(([x,y,w,h]) => paintStudioRegion(ctx,x,y,w,h,jacket,jacketShade,jacketLight)); [[4,16,4,4],[8,16,4,4],[0,20,4,12],[4,20,4,12],[8,20,4,12],[12,20,4,12]].forEach(([x,y,w,h]) => paintStudioRegion(ctx,x,y,w,h,pants,pantsShade,pantsLight));
  // Left arm and left leg use the modern 64×64 second-half layout.
  [[36,48,4,4],[40,48,4,4],[32,52,4,12],[36,52,4,12],[40,52,4,12],[44,52,4,12]].forEach(([x,y,w,h]) => paintStudioRegion(ctx,x,y,w,h,jacket,jacketShade,jacketLight)); [[20,48,4,4],[24,48,4,4],[16,52,4,12],[20,52,4,12],[24,52,4,12],[28,52,4,12]].forEach(([x,y,w,h]) => paintStudioRegion(ctx,x,y,w,h,pants,pantsShade,pantsLight));
  renderStudioCharacter(); }
function studioFill() { const ctx = studioContext(); if (!ctx) return; ctx.fillStyle = skinStudioErasing ? '#17253b' : studioColor(); ctx.fillRect(0, 0, 64, 64); renderStudioCharacter(); }
function studioPaintAt(event) { const canvas = studioCanvas(); const ctx = studioContext(); if (!canvas || !ctx) return; const rect = canvas.getBoundingClientRect(); const x = Math.floor(((event.clientX - rect.left) / rect.width) * 64); const y = Math.floor(((event.clientY - rect.top) / rect.height) * 64); if (x < 0 || y < 0 || x >= 64 || y >= 64) return; const brush = studioBrush(); const px = Math.floor(x / brush) * brush; const py = Math.floor(y / brush) * brush; ctx.fillStyle = skinStudioErasing ? '#17253b' : studioColor(); ctx.fillRect(px, py, brush, brush); renderStudioCharacter(); }
function studioFace(cube, face, sx, sy, sw, sh) { const source = studioCanvas(); const target = document.querySelector(`[data-cube="${cube}"] canvas[data-face="${face}"]`); if (!source || !target) return; const ctx = target.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, target.width, target.height); ctx.drawImage(source, sx, sy, sw, sh, 0, 0, target.width, target.height); }
function renderStudioCharacter() { if (!studioCanvas()) return; const faces = { head: { front: [8, 8, 8, 8], back: [24, 8, 8, 8], right: [0, 8, 8, 8], left: [16, 8, 8, 8], top: [8, 0, 8, 8], bottom: [16, 0, 8, 8] }, body: { front: [20, 20, 8, 12], back: [32, 20, 8, 12], right: [16, 20, 4, 12], left: [28, 20, 4, 12], top: [20, 16, 8, 4], bottom: [28, 16, 8, 4] }, 'arm-right': { front: [44, 20, 4, 12], back: [52, 20, 4, 12], right: [40, 20, 4, 12], left: [48, 20, 4, 12], top: [44, 16, 4, 4], bottom: [48, 16, 4, 4] }, 'arm-left': { front: [36, 52, 4, 12], back: [44, 52, 4, 12], right: [32, 52, 4, 12], left: [40, 52, 4, 12], top: [36, 48, 4, 4], bottom: [40, 48, 4, 4] }, 'leg-right': { front: [4, 20, 4, 12], back: [12, 20, 4, 12], right: [0, 20, 4, 12], left: [8, 20, 4, 12], top: [4, 16, 4, 4], bottom: [8, 16, 4, 4] }, 'leg-left': { front: [20, 52, 4, 12], back: [28, 52, 4, 12], right: [16, 52, 4, 12], left: [24, 52, 4, 12], top: [20, 48, 4, 4], bottom: [24, 48, 4, 4] } }; Object.entries(faces).forEach(([cube, values]) => Object.entries(values).forEach(([face, area]) => studioFace(cube, face, ...area))); const world = $('skinModelWorld'); if (world) world.style.transform = `rotateX(-14deg) rotateY(${skinStudioRotation}deg) scale(1.24)`; }
function studioDataUrl() { const canvas = studioCanvas(); return canvas ? canvas.toDataURL('image/png') : null; }
async function loadStudioData(dataUri, label = 'Local preview') { const canvas = studioCanvas(); const ctx = studioContext(); if (!canvas || !ctx || !dataUri) return false; const image = new Image(); return new Promise(resolve => { image.onload = () => { ctx.clearRect(0, 0, 64, 64); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, 64, 64); renderStudioCharacter(); const status = $('skinManagerStatus'); if (status) status.textContent = `${label} loaded into Skin Studio.`; resolve(true); }; image.onerror = () => resolve(false); image.src = dataUri; }); }
async function loadStudioFromLocalPreview() { const result = await window.vortex.getCosmeticSkinPreview(launcherState?.cosmeticsVersion); if (result?.preview) { await loadStudioData(result.preview, result.fileName || 'Local preview'); return; } studioDefaultDesign(); const status = $('skinManagerStatus'); if (status) status.textContent = 'A complete Vortex starter character is ready to paint.'; }
function setupSkinStudio() { if (skinStudioReady || !studioCanvas()) return; skinStudioReady = true; studioDefaultDesign(); const setActiveStudioColor = value => { document.querySelectorAll('[data-studio-color]').forEach(button => button.classList.toggle('active', button.dataset.studioColor.toLowerCase() === String(value || '').toLowerCase())); }; const setStudioEraser = active => { skinStudioErasing = active; const button = $('skinStudioEraserBtn'); button.classList.toggle('is-active', active); button.textContent = active ? 'Eraser Active' : 'Eraser'; }; setActiveStudioColor($('skinStudioColor').value); const canvas = studioCanvas(); canvas.addEventListener('pointerdown', event => { canvas.setPointerCapture(event.pointerId); studioPaintAt(event); }); canvas.addEventListener('pointermove', event => { if (event.buttons) studioPaintAt(event); }); $('skinStudioColor').oninput = event => { setStudioEraser(false); setActiveStudioColor(event.target.value); }; $('skinStudioFillBtn').onclick = studioFill; $('skinStudioEraserBtn').onclick = () => { setStudioEraser(!skinStudioErasing); }; document.querySelectorAll('[data-studio-color]').forEach(button => button.onclick = () => { $('skinStudioColor').value = button.dataset.studioColor; setStudioEraser(false); setActiveStudioColor(button.dataset.studioColor); }); const stage = $('skinModelStage'); stage.addEventListener('pointerdown', event => { skinStudioDragging = { id: event.pointerId, x: event.clientX, rotation: skinStudioRotation }; stage.setPointerCapture(event.pointerId); }); stage.addEventListener('pointermove', event => { if (!skinStudioDragging || skinStudioDragging.id !== event.pointerId) return; skinStudioRotation = Math.max(-180, Math.min(180, skinStudioDragging.rotation + (event.clientX - skinStudioDragging.x) * .8)); $('skinStudioRotation').value = String(skinStudioRotation); renderStudioCharacter(); }); ['pointerup', 'pointercancel'].forEach(type => stage.addEventListener(type, () => { skinStudioDragging = null; })); $('skinStudioRotation').oninput = event => { skinStudioRotation = Number(event.target.value); renderStudioCharacter(); }; $('skinStudioResetBtn').onclick = () => { if (confirm('Reset the current Skin Studio design?')) studioDefaultDesign(); }; $('skinStudioLoadPreviewBtn').onclick = () => { void loadStudioFromLocalPreview(); }; $('skinStudioSaveBtn').onclick = async () => { const button = $('skinStudioSaveBtn'); button.disabled = true; const result = await window.vortex.saveStudioSkin(launcherState.cosmeticsVersion, studioDataUrl(), 'skin-studio'); button.disabled = false; if (result.ok) { $('skinManagerStatus').textContent = `Local studio preview saved: ${result.profile.previewSkin}`; await updateSkinPreview(); addLog('Skin Studio preview saved locally. Your Microsoft skin remains unchanged.', 'success'); } else { $('skinManagerStatus').textContent = result.error || 'Skin Studio preview could not be saved.'; addLog(result.error || 'Skin Studio preview could not be saved.', 'error'); } }; $('shareStudioSkinBtn').onclick = () => { void publishStudioSkin(); }; }
async function publishStudioSkin() { if (!launcherState?.community?.websiteAccount) { addLog('Sign in to the Vortex Community before publishing a skin.', 'error'); return; } const name = $('skinStudioName').value.trim(); const description = $('skinStudioDescription').value.trim(); const visibility = $('skinStudioVisibility').value; if (!name) { $('skinManagerStatus').textContent = 'Give your Community skin a title first.'; return; } const button = $('shareStudioSkinBtn'); button.disabled = true; button.textContent = 'Publishing …'; const result = await window.vortex.uploadCommunitySkin({ name, description, visibility, skinData: studioDataUrl() }); button.disabled = false; button.textContent = 'Publish to Community'; if (result.ok) { $('skinManagerStatus').textContent = `Published to Community: ${result.shareCode}`; addLog(`Skin '${name}' published to the Vortex Community.`, 'success'); await renderCommunity(); } else { $('skinManagerStatus').textContent = result.error || 'Skin could not be published.'; addLog(result.error || 'Skin could not be published.', 'error'); } }
async function importCommunitySkin(shareCode) { const result = await window.vortex.useCommunitySkin(shareCode, launcherState?.cosmeticsVersion); if (!result.ok) { addLog(result.error || 'Community skin could not be loaded.', 'error'); return; } showPage('cosmetics'); showCosmeticsTab('skins'); await loadStudioData(result.preview, 'Community skin'); await updateSkinPreview(); addLog(`Community skin '${result.name}' loaded into Skin Studio.`, 'success'); }
function relativeCommunityTime(value) { const parsed = new Date(String(value || '').replace(' ', 'T') + (String(value || '').endsWith('Z') ? '' : 'Z')); const days = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000)); if (!Number.isFinite(days) || days === 0) return 'today'; if (days === 1) return '1 day ago'; return `${days} days ago`; }
function updateCommunityView(community = launcherState?.community || {}) { const account = community.websiteAccount; $('communityAccountTitle').textContent = account ? `Signed in as ${account.display_name || account.username}` : 'Community login required'; $('communityAccountText').textContent = account ? 'You can now publish presets, macros and Skin Studio designs directly to the Vortex Community.' : 'Sign in with your Vortex website account to publish presets, macros and your own Skin Studio designs.'; $('communityLoginBtn').textContent = account ? 'Open Community again' : 'Sign in to Community'; $('communityUploadBtn').disabled = !account; }
async function renderCommunity() { const grid = $('communityPresetGrid'); if (!launcherState?.account) { if (grid) grid.innerHTML = '<p class="mod-empty">Sign in with your Minecraft account in the launcher first.</p>'; return; } if (grid) grid.innerHTML = '<p class="mod-empty">Community posts are loading …</p>'; if (skinGrid) skinGrid.innerHTML = '<p class="mod-empty">Community skins are loading …</p>'; const presetResult = await window.vortex.listCommunityPresets(); if (!presetResult.ok) { if (grid) grid.innerHTML = `<p class="mod-empty">${escapeHtml(presetResult.error || 'Community could not be loaded.')}</p>`; } else if (!presetResult.presets.length) { if (grid) grid.innerHTML = '<p class="mod-empty">No public presets or macros yet.</p>'; } else if (grid) { grid.innerHTML = presetResult.presets.map((preset, index) => `<article class="community-preset-card"><div class="community-preset-top"><span class="community-kind ${preset.kind}">${preset.kind === 'macro' ? 'MACRO' : 'PRESET'}</span><span>${relativeCommunityTime(preset.createdAt)}</span></div><h3>${escapeHtml(preset.name)}</h3><p>${escapeHtml(preset.description || 'No description provided.')}</p><div class="community-preset-meta"><span>${escapeHtml(preset.filename)}</span><span>by ${escapeHtml(preset.username)}</span><span>${Number(preset.downloads || 0).toLocaleString('en-GB')} Downloads</span></div><button class="button small" data-community-download="${index}">Download</button></article>`).join(''); grid.querySelectorAll('[data-community-download]').forEach(button => button.onclick = async () => { const preset = presetResult.presets[Number(button.dataset.communityDownload)]; button.disabled = true; const download = await window.vortex.downloadCommunityPreset(preset.shareCode, preset.filename); if (download.ok) { button.textContent = 'Saved'; addLog(`${preset.name} saved to the community folder.`, 'success'); } else { button.disabled = false; addLog(download.error || 'Community post could not be downloaded.', 'error'); } }); } }
async function openCommunityLogin() { const result = await window.vortex.openCommunityLogin(); if (!result.ok) addLog(result.error || 'Community login could not be opened.', 'error'); }
async function uploadCommunityPreset() { if (!launcherState?.community?.websiteAccount) { addLog('Sign in to the Community first.', 'error'); return; } const name = window.prompt('Name for your preset or macro:'); if (name === null) return; const description = window.prompt('Short description (optional):') || ''; const visibility = window.confirm('Show publicly in the community?\n\nOK = public · Cancel = unlisted') ? 'public' : 'unlisted'; const result = await window.vortex.uploadCommunityPreset({ name, description, visibility }); if (result.ok) { addLog(`${result.kind === 'macro' ? 'Macro' : 'Preset'} published.`, 'success'); await renderCommunity(); } else if (!result.canceled) addLog(result.error || 'Community post could not be uploaded.', 'error'); }

function showPage(page) { document.querySelectorAll('.page').forEach(element => element.classList.toggle('active', element.id === page)); document.querySelectorAll('.nav-link').forEach(element => element.classList.toggle('active', element.dataset.page === page)); if (page === 'bedrock') void refreshBedrock(); if (page === 'servers') renderServers(); if (page === 'mods') { modScopeLabel(); refreshInstalled(); } if (page === 'resource-packs') { modScopeLabel(); refreshInstalledPacks(); } if (page === 'community') renderCommunity(); if (page === 'cosmetics') {  updateSkinPreview(); renderWebsiteCapes(); } if (page === 'overview') renderOverview();  }
async function refresh() { launcherState = await window.vortex.getState(); selectedVersion = launcherState.state?.selectedVersion || '1.21.11'; selectedHat = launcherState.state?.hat || 'vortex-cap'; selectedEmblem = launcherState.state?.emblem || 'vortex-crest'; setAccount(launcherState.account, launcherState.accounts); renderVersions(); renderInstanceCards(); updatePlaySummary(); updateBedrockView(launcherState.bedrock); renderServers(); updateUpdateView(launcherState.update); updateReleaseNews(launcherState.news); updateCommunityView(launcherState.community); modScopeLabel(); await refreshInstalled(); await refreshInstalledPacks(); await renderOverview(); }
async function login() { const button = $('loginBtn') || $('addAccountBtn'); if (button) button.disabled = true; addLog('Starting Microsoft sign-in …'); const result = await window.vortex.login(); if (result.ok) { launcherState.account = result.account; launcherState.accounts = result.accounts; setAccount(result.account, result.accounts); addLog(`Signed in as ${result.account.username}`, 'success'); } else { addLog(result.error, 'error'); if (button) button.disabled = false; } }
async function logout() { if (!launcherState?.account) return; await removeSavedAccount(launcherState.account.id); }
async function launch() { $('playBtn').disabled = true; $('playLabel').textContent = 'Launching …'; const result = await window.vortex.launch(selectedVersion); if (!result.ok) { addLog(result.error, 'error'); $('playBtn').disabled = false; $('playLabel').textContent = 'Launch Vortex'; } }
async function saveCosmetics(patch) { const result = await window.vortex.setCosmetics({ hat: selectedHat, emblem: selectedEmblem, ...patch }); if (!result.ok) { addLog(result.error || 'Could not save cosmetic.', 'error'); return; } selectedHat = result.hat; selectedEmblem = result.emblem; updateCosmetics(); addLog(`Cosmetics selection saved: ${hatNames[selectedHat]} + ${emblemNames[selectedEmblem]}.`, 'success'); }
function addCosmeticPreviewFallbacks() { document.querySelectorAll('.cosmetic-art').forEach(image => image.addEventListener('error', () => { const fallback = document.createElement('span'); fallback.className = 'cosmetic-art-fallback'; fallback.textContent = image.closest('[data-hat]')?.dataset.hat === 'none' || image.closest('[data-emblem]')?.dataset.emblem === 'none' ? '×' : (image.alt || 'V').charAt(0).toUpperCase(); fallback.title = image.alt || 'Cosmetic preview'; image.replaceWith(fallback); }, { once: true })); }
async function renderWebsiteCapes() { const grid = $('websiteCapeGrid'); if (!grid) return; grid.innerHTML = '<p class="mod-empty">Website cape unlocks are loading …</p>'; const result = await window.vortex.getWebsiteCapeCatalogue(); const current = result?.choice?.cape || null; if (!result?.ok) { grid.innerHTML = `<p class="mod-empty">Website cape could not be loaded.<br><small>${escapeHtml(result?.error || 'Unknown error')}</small></p>`; return; } if (result.needsWebsiteLogin) { grid.innerHTML = '<p class="mod-empty">Sign in on the Vortex website. Your member cape will be unlocked here afterward.</p>'; $('websiteCapeNote').textContent = 'Not signed in to the website yet.'; return; } const capes = [{ id: null, name: 'No website cape', description: 'Do not apply any unlocked cape.', preview: null }, ...(result.capes || [])]; grid.innerHTML = capes.map(cape => { const selected = (cape.id || null) === current; const preview = cape.preview ? `<img src="${escapeAttr(cape.preview)}" alt="${escapeAttr(cape.name)} preview" loading="lazy" />` : '<span class="website-cape-fallback">×</span>'; return `<button class="website-cape-card${selected ? ' selected' : ''}" data-website-cape="${escapeAttr(cape.id || '')}"><span class="website-cape-image">${preview}</span><strong>${escapeHtml(cape.name)}</strong><small>${escapeHtml(selected ? 'Active' : (cape.description || 'Select'))}</small></button>`; }).join(''); grid.querySelectorAll('[data-website-cape]').forEach(button => button.onclick = () => selectWebsiteCape(button.dataset.websiteCape || null)); $('websiteCapeNote').textContent = current ? 'Selection saved. Restart Minecraft to load the cape.' : 'Choose your unlocked cape or remove the selection.'; }
async function openWebsiteCapeLogin() { const button = $('websiteCapeLoginBtn'); if (button) { button.disabled = true; button.textContent = 'Opening …'; } const result = await window.vortex.openCommunityLogin(); if (!result?.ok) { addLog(result?.error || 'Website login could not be opened.', 'error'); } else { $('websiteCapeNote').textContent = 'Sign in in the website window. After returning, your cape will be loaded.'; } if (button) { button.disabled = false; button.textContent = 'Sign in on website'; } }
async function selectWebsiteCape(capeId) { const result = await window.vortex.selectWebsiteCape(capeId); if (!result.ok) { $('websiteCapeNote').textContent = result.error || 'Cape could not be saved.'; addLog(result.error || 'Cape could not be saved.', 'error'); return; } $('websiteCapeNote').textContent = result.choice.cape ? `Cape securely saved and prepared for ${result.written} instance(s). Restart Minecraft.` : 'Website cape removed.'; addLog(result.choice.cape ? `Website cape selected: ${result.choice.cape}.` : 'Website cape removed.', 'success'); await renderWebsiteCapes(); }
function showCosmeticsTab(tab) { document.querySelectorAll('.cosmetics-tab').forEach(button => button.classList.toggle('active', button.dataset.cosmeticTab === tab)); document.querySelectorAll('.cosmetic-subpage').forEach(page => page.classList.toggle('active', page.id === `cosmetic-${tab}`)); if (tab === 'skins') {  void updateSkinPreview(); } if (tab === 'capes') void renderWebsiteCapes(); }
async function updateSkinPreview() { const result = await window.vortex.getCosmeticSkinPreview(launcherState?.cosmeticsVersion); const image = $('skinPreviewImage'); const label = $('skinPreviewLabel'); if (result?.preview) { image.src = result.preview; image.classList.add('skin-pixel-preview'); label.textContent = `Local preview: ${result.fileName}. Your signed-in Minecraft skin remains unchanged.`; if (skinStudioReady) void loadStudioData(result.preview, result.fileName || 'Local preview'); } else if (skinStudioReady && studioDataUrl()) { image.src = studioDataUrl(); image.classList.add('skin-pixel-preview'); label.textContent = 'Vortex starter skin — draw on it or save it as a local preview. Your signed-in Minecraft skin remains unchanged.'; } else { image.src = '../assets/branding/vortex-logo.png'; image.classList.remove('skin-pixel-preview'); label.textContent = 'No local preview selected. Your signed-in Minecraft skin remains unchanged.'; } }
async function createCosmeticSkin() { const button = $('createCosmeticsBtn'); button.disabled = true; button.textContent = 'Choose skin …'; const result = await window.vortex.importCosmeticSkin(launcherState.cosmeticsVersion, { hat: selectedHat, emblem: selectedEmblem }); if (result.ok) { $('skinManagerStatus').textContent = `Local preview saved: ${result.profile.previewSkin}`; addLog(`Local skin preview saved: ${result.profile.previewSkin}.`, 'success'); await refresh(); await updateSkinPreview(); } else if (!result.canceled) { $('skinManagerStatus').textContent = result.error || 'Skin preview could not be saved.'; addLog(result.error || 'Skin preview could not be saved.', 'error'); } button.disabled = false; button.textContent = 'Choose skin file'; }
async function createCosmeticSkinByUsername() { const input = $('skinUsername'); const username = input.value.trim(); if (!username) { $('skinManagerStatus').textContent = 'Enter a Minecraft username first.'; return; } const button = $('importUsernameSkinBtn'); button.disabled = true; button.textContent = 'Loading …'; const result = await window.vortex.importCosmeticSkinByUsername(launcherState.cosmeticsVersion, username, { hat: selectedHat, emblem: selectedEmblem }); if (result.ok) { $('skinManagerStatus').textContent = `Local preview from ${result.username} saved: ${result.profile.previewSkin}`; addLog(`Local skin preview imported from ${result.username}.`, 'success'); await refresh(); await updateSkinPreview(); } else { $('skinManagerStatus').textContent = result.error || 'Skin preview could not be loaded.'; addLog(result.error || 'Skin preview could not be loaded.', 'error'); } button.disabled = false; button.textContent = 'Load skin'; }

addCosmeticPreviewFallbacks(); $('playBtn').onclick = launch; $('copyLog').onclick = async () => { const text = [...logEl.children].map(line => line.textContent.replace(/\s+/g, ' ').trim()).join('\n'); try { await navigator.clipboard.writeText(text); setStatus('System log copied.'); } catch (_) { setStatus('Could not copy system log.'); } }; $('openLaunchLogBtn').onclick = async () => { const result = await window.vortex.openLaunchLog(); if (!result.ok) addLog(result.error || 'Launch log is still empty.', 'error'); }; $('openCrashLogBtn').onclick = async () => { const result = await window.vortex.openCrashLog(); if (!result.ok) addLog(result.error || 'Crash log is still empty.', 'error'); }; $('openInstancesBtn').onclick = () => window.vortex.openInstanceFolder(selectedVersion); $('launchBedrockBtn').onclick = startBedrock; $('refreshBedrockBtn').onclick = refreshBedrock; $('joinOfficialServerBtn').onclick = () => joinServer('official-vortexpvp'); $('joinOfficialServerHeroBtn').onclick = () => joinServer('official-vortexpvp'); $('addServerBtn').onclick = addServer; $('openModsBtn').onclick = () => window.vortex.openModsFolder(selectedVersion); $('openInstanceBtn').onclick = () => window.vortex.openInstanceFolder(selectedVersion); $('clearLog').onclick = () => { logEl.innerHTML = ''; };  document.querySelectorAll('.nav-link').forEach(button => button.onclick = () => showPage(button.dataset.page)); document.querySelectorAll('[data-page-target]').forEach(button => button.onclick = () => showPage(button.dataset.pageTarget));   $('modSearchBtn').onclick = searchTemplateMods; $('modQuery').onkeydown = event => { if (event.key === 'Enter') searchTemplateMods(); }; $('toggleInstalled').onclick = () => { installedCollapsed = !installedCollapsed; $('toggleInstalled').textContent = installedCollapsed ? 'Expand' : 'Collapse'; refreshInstalled(); }; $('resourcePackSearchBtn').onclick = searchTemplateResourcePacks; $('resourcePackQuery').onkeydown = event => { if (event.key === 'Enter') searchTemplateResourcePacks(); }; $('toggleInstalledPacks').onclick = () => { installedPacksCollapsed = !installedPacksCollapsed; $('toggleInstalledPacks').textContent = installedPacksCollapsed ? 'Expand' : 'Collapse'; refreshInstalledPacks(); };  $('communityLoginBtn').onclick = openCommunityLogin; $('communityUploadBtn').onclick = uploadCommunityPreset; $('refreshCommunityBtn').onclick = renderCommunity; $('sidebarUpdate').onclick = () => showUpdatePopup(launcherState?.update); $('updateActionBtn').onclick = runUpdateAction; $('updateLaterBtn').onclick = () => { deferredUpdateVersion = launcherState?.update?.availableVersion || null; $('updateModal').hidden = true; }; $('closeNewsBtn').onclick = closeReleaseNews; $('saveAiKeyBtn').onclick = saveAiKey; $('removeAiKeyBtn').onclick = removeAiKey;  $('generateAiCapeBtn').onclick = () => createAiAsset('cape'); $('generateAiModBtn').onclick = () => createAiAsset('mod');  $('openAiCapesBtn').onclick = () => window.vortex.openAiOutput('capes'); $('openAiModsBtn').onclick = () => window.vortex.openAiOutput('mods');
window.vortex.onStatus(({ type, message }) => { setStatus(message); addLog(message, type); if (type === 'success' && message.includes('started')) { $('playBtn').disabled = false; $('playLabel').textContent = 'Launch Vortex'; } }); window.vortex.onLog(message => addLog(message)); window.vortex.onProgress(data => { if (data?.type) setStatus(`Loading ${data.type} …`); }); window.vortex.onInstanceMaintenance(async maintenance => { if (!launcherState) return; launcherState.maintenance = maintenance; launcherState.versions = await Promise.all(launcherState.versions.map(instance => window.vortex.getInstanceSummary(instance.version))); updatePlaySummary(); renderInstanceCards(); }); window.vortex.onCommunityState(state => { if (!launcherState) return; launcherState.community = state; updateCommunityView(state); renderCommunity(); }); window.vortex.onUpdateState(update => { if (launcherState) launcherState.update = update; updateUpdateView(update); });
addLog('Vortex Client Launcher 0.9.54 ready.'); refresh();


// Photon UX: global command palette for fast launcher control.
(() => {
  const overlay = document.getElementById('commandOverlay');
  const input = document.getElementById('commandSearch');
  const close = document.getElementById('closeCommandBtn');
  const list = document.getElementById('commandList');
  if (!overlay || !input || !list) return;
  let focusedIndex = 0;
  const items = () => [...list.querySelectorAll('.command-item:not([hidden])')];
  const focusItem = index => {
    const available = items();
    if (!available.length) return;
    focusedIndex = (index + available.length) % available.length;
    available.forEach((item, i) => item.classList.toggle('command-focused', i === focusedIndex));
  };
  const closePalette = () => { overlay.hidden = true; input.value = ''; list.querySelectorAll('.command-item').forEach(item => { item.hidden = false; item.classList.remove('command-focused'); }); };
  const openPalette = () => { overlay.hidden = false; input.value = ''; focusItem(0); requestAnimationFrame(() => input.focus()); };
  const runCommand = command => {
    closePalette();
    if (command === 'play') return void launch();
    if (command === 'openmods') return void window.vortex.openModsFolder(selectedVersion);
    showPage(command);
  };
  list.querySelectorAll('.command-item').forEach(item => item.addEventListener('click', () => runCommand(item.dataset.command)));
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    list.querySelectorAll('.command-item').forEach(item => { item.hidden = query && !item.textContent.toLowerCase().includes(query); });
    focusItem(0);
  });
  input.addEventListener('keydown', event => {
    const available = items();
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(focusedIndex + 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(focusedIndex - 1); }
    if (event.key === 'Enter' && available[focusedIndex]) { event.preventDefault(); runCommand(available[focusedIndex].dataset.command); }
    if (event.key === 'Escape') closePalette();
  });
  close?.addEventListener('click', closePalette);
  overlay.addEventListener('click', event => { if (event.target === overlay) closePalette(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
    if (event.key === 'Escape' && !overlay.hidden) closePalette();
  });
})();


// Window controls: F11 toggles native fullscreen, Escape exits it.
(() => {
  const syncFullscreenClass = async () => {
    const fullscreen = await window.vortex.isFullscreen();
    document.body.classList.toggle('is-fullscreen', fullscreen);
  };
  document.addEventListener('keydown', async event => {
    if (event.key === 'F11') { event.preventDefault(); await window.vortex.toggleFullscreen(); await syncFullscreenClass(); }
    if (event.key === 'Escape' && document.body.classList.contains('is-fullscreen')) { event.preventDefault(); await window.vortex.toggleFullscreen(); await syncFullscreenClass(); }
  });
  void syncFullscreenClass();
})();


// Global category UX: spotlight cards, keyboard navigation and quick refresh.
(() => {
  document.addEventListener('pointermove', event => {
    const card = event.target.closest('.info-card,.server-card,.mod-card,.pack-card,.instance-card,.community-preset-card,.community-skin-card,.cosmetic-panel');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  }, { passive: true });
  document.querySelectorAll('.mod-search-bar input').forEach(input => input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const button = input.parentElement?.querySelector('button');
    if (button && !button.disabled) { event.preventDefault(); button.click(); }
  }));
  document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'r') { event.preventDefault(); void refresh(); }
  });
})();
