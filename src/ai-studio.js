// ==========================================================================
// Vortex AI Studio
// --------------------------------------------------------------------------
// Wird von main.js über createAiStudio({...}) initialisiert.
// Stellt sichere lokale Speicherung des API-Keys und lokale Generierung
// von Capes / Mod-Projekt-Templates bereit. Nichts wird hochgeladen.
// ==========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --------------------------------------------------------------------------
// Factory — main.js ruft createAiStudio({ dataRoot, instanceRoot, supportedVersions, safeStorage }) auf
// --------------------------------------------------------------------------
function createAiStudio(options = {}) {
  const {
    dataRoot,
    instanceRoot,
    supportedVersions = [],
    safeStorage = null
  } = options;

  // ------------------------------------------------------------------------
  // Pfade
  // ------------------------------------------------------------------------
  const studioRoot = path.join(dataRoot || process.cwd(), 'ai-studio');
  const credsFile = path.join(studioRoot, 'credentials.json');

  function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
  }
  function outputDir(kind = '') {
    return ensureDir(path.join(studioRoot, 'output', kind));
  }
  function isEncryptionAvailable() {
    try {
      return typeof safeStorage?.isEncryptionAvailable === 'function'
        ? safeStorage.isEncryptionAvailable()
        : false;
    } catch (_) { return false; }
  }

  // ------------------------------------------------------------------------
  // Verschlüsselung des API-Keys
  // ------------------------------------------------------------------------
  function encrypt(value) {
    try {
      if (isEncryptionAvailable()) {
        return { enc: 'safe', data: safeStorage.encryptString(value).toString('base64') };
      }
    } catch (_) {}
    return { enc: 'plain', data: Buffer.from(value, 'utf8').toString('base64') };
  }
  function decrypt(record) {
    if (!record || typeof record !== 'object') return null;
    try {
      if (record.enc === 'safe' && safeStorage) {
        return safeStorage.decryptString(Buffer.from(record.data, 'base64'));
      }
      return Buffer.from(record.data, 'base64').toString('utf8');
    } catch (_) { return null; }
  }
  function readCreds() {
    try { return JSON.parse(fs.readFileSync(credsFile, 'utf8')); } catch (_) { return null; }
  }
  function writeCreds(record) {
    ensureDir(studioRoot);
    fs.writeFileSync(credsFile, JSON.stringify(record, null, 2), { mode: 0o600 });
  }
  function deleteCreds() {
    try { fs.unlinkSync(credsFile); } catch (_) {}
  }

  // ------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------
  let STATE = { ready: false, provider: null, providerLabel: null, textModel: null, encryptionAvailable: isEncryptionAvailable() };

  function hydrate() {
    const stored = readCreds();
    if (!stored || !stored.apiKey) {
      STATE = {
        ready: false,
        provider: null,
        providerLabel: null,
        textModel: null,
        encryptionAvailable: isEncryptionAvailable()
      };
      return STATE;
    }
    STATE = {
      ready: true,
      provider: stored.provider || 'openai',
      providerLabel: stored.provider === 'manus' ? 'Manus API' : 'OpenAI API',
      textModel: stored.textModel || (stored.provider === 'manus' ? 'manus-1.6' : 'gpt-4.1-mini'),
      encryptionAvailable: isEncryptionAvailable()
    };
    return STATE;
  }
  hydrate();

  // ------------------------------------------------------------------------
  // Public API — exakt die Methoden, die main.js verwendet
  // ------------------------------------------------------------------------

  // main.js: ipcMain.handle('ai-get-state', () => aiStudio.getState());
  function getState() {
    return hydrate();
  }

  // main.js: ipcMain.handle('ai-save-key', (_e, key, provider, textModel) => ({ ok: true, state: aiStudio.saveKey(key, provider, textModel) }));
  function saveKey(apiKey, provider, textModel) {
    if (!apiKey || !String(apiKey).trim()) throw new Error('API key must not be empty.');
    const cleanProvider = provider === 'manus' ? 'manus' : 'openai';
    const defaultModel = cleanProvider === 'manus' ? 'manus-1.6' : 'gpt-4.1-mini';
    writeCreds({
      provider: cleanProvider,
      textModel: textModel || defaultModel,
      apiKey: encrypt(String(apiKey).trim()),
      createdAt: Date.now()
    });
    return hydrate();
  }

  // main.js: ipcMain.handle('ai-remove-key', () => ({ ok: true, state: aiStudio.removeKey() }));
  function removeKey() {
    deleteCreds();
    return hydrate();
  }

  function getStoredApiKey() {
    const stored = readCreds();
    if (!stored?.apiKey) return null;
    return decrypt(stored.apiKey);
  }

  // ------------------------------------------------------------------------
  // Cape-Generierung — main.js erwartet: { design: { title }, instances }
  // ------------------------------------------------------------------------
  function randomHex(len = 4) {
    return crypto.randomBytes(len).toString('hex');
  }
  function paletteFromPrompt(prompt) {
    const seed = crypto.createHash('md5').update(String(prompt || randomHex())).digest();
    const hex = i => `#${seed[i].toString(16).padStart(2,'0')}${seed[i+1].toString(16).padStart(2,'0')}${seed[i+2].toString(16).padStart(2,'0')}`;
    return [hex(0), hex(3), hex(6)];
  }
  function capeSvg(title, [a, b, c]) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="192" viewBox="0 0 128 192">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="55%" stop-color="${b}"/>
      <stop offset="100%" stop-color="${c}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="192" rx="14" fill="url(#g)"/>
  <path d="M64 28 L96 60 L80 60 L80 148 L48 148 L48 60 L32 60 Z" fill="#ffffff" opacity="0.18"/>
  <text x="64" y="178" text-anchor="middle" font-family="Manrope,Arial" font-size="11" fill="#ffffff" opacity="0.7">${title}</text>
</svg>`;
  }

  function generateCape(prompt) {
    const key = getStoredApiKey();
    if (!key) throw new Error('No AI key is stored locally.');

    const title = String(prompt || 'Vortex Cape').slice(0, 42);
    const pal = paletteFromPrompt(prompt);
    const id = `cape-${Date.now()}-${randomHex(3)}`;
    const dir = outputDir('capes');
    const file = path.join(dir, `${id}.svg`);
    const svg = capeSvg(title, pal);
    fs.writeFileSync(file, svg, 'utf8');

    // main.js liest result.design.title und result.instances
    const instanceCount = Array.isArray(supportedVersions) ? supportedVersions.length : 0;
    return {
      ok: true,
      kind: 'cape',
      capeId: id,
      preview: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      design: {
        title,
        summary: `Local cape draft generated from prompt: "${title}".`,
        palette: pal
      },
      filePath: file,
      instances: instanceCount
    };
  }

  // ------------------------------------------------------------------------
  // Mod-Projekt-Generierung — main.js erwartet: { design: { title } }
  // ------------------------------------------------------------------------
  function createModProject(prompt) {
    const key = getStoredApiKey();
    if (!key) throw new Error('No AI key is stored locally.');

    const title = String(prompt || 'Vortex Mod').slice(0, 42);
    const modId = `vortex-mod-${Date.now()}-${randomHex(3)}`;
    const dir = path.join(outputDir('mods'), modId);
    ensureDir(dir);
    ensureDir(path.join(dir, 'src', 'main', 'java'));
    ensureDir(path.join(dir, 'src', 'main', 'resources'));

    fs.writeFileSync(path.join(dir, 'README.md'),
      `# ${title}\n\nGenerated locally by Vortex AI Studio.\n\nPrompt: ${prompt}\n`, 'utf8');

    fs.writeFileSync(path.join(dir, 'build.gradle'), `
plugins { id 'fabric-loom' version '1.6-SNAPSHOT' }
group = 'com.vortex.generated'
version = '1.0.0'
dependencies { minecraft 'com.mojang:minecraft:1.21.11' }
`, 'utf8');

    return {
      ok: true,
      kind: 'mod',
      modId,
      design: {
        title,
        summary: `Private Fabric project template ready at ${dir}.`
      },
      filePath: dir
    };
  }

  // main.js: ipcMain.handle('ai-open-output', (_e, kind) => { const folder = aiStudio.openOutputFolder(kind); return shell.openPath(folder); });
  function openOutputFolder(kind = '') {
    return outputDir(kind);
  }

  // ------------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------------
  return {
    getState,
    saveKey,
    removeKey,
    generateCape,
    createModProject,
    openOutputFolder
  };
}

module.exports = { createAiStudio };
