'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const OPENAI_BASE = 'https://api.openai.com/v1';
const MANUS_BASE = 'https://api.manus.ai/v2';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_MANUS_PROFILE = 'manus-1.6-lite';
const MAX_PROMPT_LENGTH = 520;
const OPENAI_MODELS = new Set(['gpt-4.1-mini', 'gpt-5-mini']);
const MANUS_PROFILES = new Set(['manus-1.6-lite', 'manus-1.6', 'manus-1.6-max']);

function createAiStudio({ dataRoot, instanceRoot, supportedVersions, safeStorage }) {
  const settingsFile = path.join(dataRoot, 'ai-studio.json');
  const studioRoot = path.join(dataRoot, 'ai-studio');

  const exists = file => fs.existsSync(file);
  const ensureDir = dir => fs.mkdirSync(dir, { recursive: true });
  const readJson = (file, fallback) => {
    try { return exists(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; } catch (_) { return fallback; }
  };
  const writeJson = (file, value) => { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); };
  const safeName = value => String(value || 'entwurf').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || 'entwurf';
  const cleanPrompt = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH);
  const nowId = () => `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const aiSettings = () => readJson(settingsFile, { provider: 'openai', textModel: DEFAULT_OPENAI_MODEL, keyCipher: null });
  const providerOf = config => config?.provider === 'manus' ? 'manus' : 'openai';
  const providerLabel = provider => provider === 'manus' ? 'Manus API' : 'OpenAI API';
  const defaultModel = provider => provider === 'manus' ? DEFAULT_MANUS_PROFILE : DEFAULT_OPENAI_MODEL;
  const allowedModel = (provider, value) => provider === 'manus' ? MANUS_PROFILES.has(value) : OPENAI_MODELS.has(value);

  function isReady() {
    const config = aiSettings();
    return Boolean(safeStorage?.isEncryptionAvailable?.() && typeof config.keyCipher === 'string' && config.keyCipher.length > 20);
  }

  function getState() {
    const config = aiSettings();
    const provider = providerOf(config);
    const textModel = allowedModel(provider, String(config.textModel || '')) ? config.textModel : defaultModel(provider);
    return { ready: isReady(), encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()), provider, providerLabel: providerLabel(provider), textModel, storage: 'Windows-geschützt lokal', outputFolder: studioRoot };
  }

  function saveKey(apiKey, provider = 'openai', textModel) {
    const key = String(apiKey || '').trim();
    const selectedProvider = provider === 'manus' ? 'manus' : 'openai';
    const model = allowedModel(selectedProvider, String(textModel || '')) ? String(textModel) : defaultModel(selectedProvider);
    if (!safeStorage?.isEncryptionAvailable?.()) throw new Error('Die geschützte Windows-Schlüsselablage ist nicht verfügbar.');
    if (!/^sk-[A-Za-z0-9_-]{24,300}$/.test(key)) throw new Error('Der API-Schlüssel hat kein gültiges Format.');
    const keyCipher = safeStorage.encryptString(key).toString('base64');
    writeJson(settingsFile, { schemaVersion: 2, provider: selectedProvider, keyCipher, textModel: model, updatedAt: new Date().toISOString() });
    return getState();
  }

  function removeKey() {
    try { fs.rmSync(settingsFile, { force: true }); } catch (_) {}
    return getState();
  }

  function readCredentials() {
    const config = aiSettings();
    if (!isReady()) throw new Error('Hinterlege einen privaten API-Schlüssel im KI-Studio.');
    try { const provider = providerOf(config); return { key: safeStorage.decryptString(Buffer.from(config.keyCipher, 'base64')), provider, textModel: allowedModel(provider, String(config.textModel || '')) ? config.textModel : defaultModel(provider) }; }
    catch (_) { throw new Error('Der geschützte API-Schlüssel konnte nicht gelesen werden. Bitte speichere ihn erneut.'); }
  }

  function normalizeDesign(value, prompt) {
    const palette = Array.isArray(value?.palette) ? value.palette.filter(color => /^#[0-9a-f]{6}$/i.test(String(color))).slice(0, 4) : [];
    while (palette.length < 4) palette.push(['#1976d2', '#0d213f', '#74eaff', '#f2f7ff'][palette.length]);
    return { title: String(value?.title || 'Vortex-Entwurf').replace(/[<>]/g, '').slice(0, 42), summary: String(value?.summary || prompt).replace(/[<>]/g, '').slice(0, 220), motif: String(value?.motif || 'Vortex').replace(/[<>]/g, '').slice(0, 60), palette, prompt };
  }

  const manusDesignSchema = { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, motif: { type: 'string' }, palette: { type: 'array', items: { type: 'string' } } }, required: ['title', 'summary', 'motif', 'palette'], additionalProperties: false };
  const designInstruction = (kind, prompt) => `Erstelle einen privaten Vortex-Minecraft-Entwurf für ${kind}. Wunsch: ${prompt}. Liefere ausschließlich einen kreativen, jugendfreien Pixel-Art-Entwurf: Titel maximal 42 Zeichen, Zusammenfassung maximal 220 Zeichen, Motiv maximal 60 Zeichen und genau vier Hex-Farben #RRGGBB. Keine URLs, keine fremden Marken, keine Code-Ausführung, keine externen Dateien oder Aktionen.`;
  const apiError = (payload, fallback) => String(payload?.error?.message || payload?.message || fallback).slice(0, 240);
  const taskIdOf = payload => String(payload?.data?.task_id || payload?.data?.id || payload?.task_id || payload?.id || '');
  const eventListOf = payload => { const data = payload?.data ?? payload; if (Array.isArray(data)) return data; return Array.isArray(data?.events) ? data.events : Array.isArray(data?.messages) ? data.messages : Array.isArray(data?.items) ? data.items : []; };

  async function openAiDesign(credentials, prompt, kind) {
    const system = `Du bist Vortex Studio, ein kreativer Minecraft-Designer. ${designInstruction(kind, prompt)} Antworte ausschließlich als JSON mit den Feldern title, summary, palette und motif.`;
    const response = await fetch(`${OPENAI_BASE}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${credentials.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: credentials.textModel, temperature: 0.85, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }), signal: AbortSignal.timeout(45000) });
    let payload = null; try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(apiError(payload, `Die OpenAI-Anfrage wurde mit Status ${response.status} abgelehnt.`));
    try { return normalizeDesign(JSON.parse(payload?.choices?.[0]?.message?.content || '{}'), prompt); } catch (_) { throw new Error('Die KI hat keinen lesbaren Entwurf zurückgegeben.'); }
  }

  async function manusDesign(credentials, prompt, kind) {
    const create = await fetch(`${MANUS_BASE}/task.create`, { method: 'POST', headers: { 'x-manus-api-key': credentials.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Vortex private design', message: { content: designInstruction(kind, prompt) }, locale: 'de', interactive_mode: false, hide_in_task_list: true, share_visibility: 'private', agent_profile: credentials.textModel, structured_output_schema: manusDesignSchema }), signal: AbortSignal.timeout(30000) });
    let created = null; try { created = await create.json(); } catch (_) {}
    if (!create.ok || created?.ok === false) throw new Error(apiError(created, `Die Manus-Anfrage wurde mit Status ${create.status} abgelehnt.`));
    const taskId = taskIdOf(created); if (!taskId) throw new Error('Manus hat keine gültige Auftragskennung zurückgegeben.');
    const deadline = Date.now() + 150000;
    const answeredQuestionEvents = new Set();
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const response = await fetch(`${MANUS_BASE}/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=100`, { headers: { 'x-manus-api-key': credentials.key }, signal: AbortSignal.timeout(30000) });
      let payload = null; try { payload = await response.json(); } catch (_) {}
      if (!response.ok || payload?.ok === false) throw new Error(apiError(payload, `Manus-Ergebnis konnte nicht geladen werden (${response.status}).`));
      const events = eventListOf(payload);
      const output = events.find(event => event?.type === 'structured_output_result')?.structured_output_result;
      if (output) { if (!output.success) throw new Error(String(output.error || 'Manus konnte keinen strukturierten Entwurf erstellen.').slice(0, 240)); return normalizeDesign(output.value, prompt); }
      const status = events.find(event => event?.type === 'status_update')?.status_update;
      if (status?.agent_status === 'waiting') {
        const detail = status.status_detail || {};
        const eventId = String(detail.waiting_for_event_id || '');
        if (detail.waiting_for_event_type === 'messageAskUser' && eventId && !answeredQuestionEvents.has(eventId)) {
          const reply = await fetch(`${MANUS_BASE}/task.sendMessage`, { method: 'POST', headers: { 'x-manus-api-key': credentials.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId, message: { content: '' } }), signal: AbortSignal.timeout(30000) });
          let replyPayload = null; try { replyPayload = await reply.json(); } catch (_) {}
          if (!reply.ok || replyPayload?.ok === false) throw new Error(apiError(replyPayload, 'Die leere Antwort an Manus konnte nicht gesendet werden.'));
          answeredQuestionEvents.add(eventId);
          continue;
        }
        throw new Error('Der Manus-Auftrag benötigt eine Rückfrage oder Bestätigung und wurde aus Sicherheitsgründen nicht automatisch fortgesetzt.');
      }
      if (status?.agent_status === 'error') { const error = events.find(event => event?.type === 'error_message')?.error_message; throw new Error(apiError(error, 'Der Manus-Auftrag ist fehlgeschlagen.')); }
    }
    throw new Error('Der Manus-Auftrag dauert länger als erwartet. Bitte versuche den Entwurf erneut.');
  }

  async function createDesign(userPrompt, kind) {
    const prompt = cleanPrompt(userPrompt); if (!prompt) throw new Error('Beschreibe zuerst deinen gewünschten Look oder deine Mod-Idee.');
    const credentials = readCredentials();
    return credentials.provider === 'manus' ? manusDesign(credentials, prompt, kind) : openAiDesign(credentials, prompt, kind);
  }

  function hex(color) {
    const value = String(color || '#000000').replace('#', '');
    return { r: parseInt(value.slice(0, 2), 16) || 0, g: parseInt(value.slice(2, 4), 16) || 0, b: parseInt(value.slice(4, 6), 16) || 0, a: 255 };
  }
  function paint(png, x, y, color) {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const offset = (png.width * y + x) * 4;
    png.data[offset] = color.r; png.data[offset + 1] = color.g; png.data[offset + 2] = color.b; png.data[offset + 3] = color.a ?? 255;
  }
  function rectangle(png, x, y, width, height, color) { for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) paint(png, xx, yy, color); }
  function seededRandom(text) {
    let state = 2166136261;
    for (const char of String(text)) { state ^= char.charCodeAt(0); state = Math.imul(state, 16777619); }
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function makeSkin(design) {
    const png = new PNG({ width: 64, height: 64, fill: true });
    const [primary, dark, accent, light] = design.palette.map(hex);
    const rng = seededRandom(`${design.title}:${design.motif}`);
    rectangle(png, 0, 0, 64, 64, { r: 0, g: 0, b: 0, a: 0 });
    // Kopf: Vorderseite, Seiten, Oberseite und dezente Overlay-Details.
    rectangle(png, 8, 8, 8, 8, primary); rectangle(png, 0, 8, 8, 8, dark); rectangle(png, 16, 8, 8, 8, dark); rectangle(png, 8, 0, 8, 8, accent);
    rectangle(png, 9, 10, 2, 2, light); rectangle(png, 13, 10, 2, 2, light); rectangle(png, 11, 13, 2, 1, dark);
    rectangle(png, 40, 8, 8, 8, { ...accent, a: 185 }); rectangle(png, 41, 8, 6, 1, light);
    // Körper und Gliedmaßen im Standard-Skin-Layout.
    rectangle(png, 20, 20, 8, 12, dark); rectangle(png, 16, 20, 4, 12, primary); rectangle(png, 28, 20, 4, 12, primary);
    rectangle(png, 20, 32, 4, 12, primary); rectangle(png, 24, 32, 4, 12, dark);
    rectangle(png, 20, 22, 8, 2, accent); rectangle(png, 21, 26, 6, 1, light);
    // Zweite Ebene für Jacke und Akzente.
    rectangle(png, 20, 36, 8, 12, { ...accent, a: 180 }); rectangle(png, 16, 36, 4, 12, { ...primary, a: 160 }); rectangle(png, 28, 36, 4, 12, { ...primary, a: 160 });
    for (let index = 0; index < 22; index += 1) {
      const x = 20 + Math.floor(rng() * 8); const y = 36 + Math.floor(rng() * 12);
      paint(png, x, y, rng() > 0.5 ? light : dark);
    }
    return png;
  }

  function makeCape(design) {
    const png = new PNG({ width: 64, height: 32, fill: true });
    const [primary, dark, accent, light] = design.palette.map(hex);
    const rng = seededRandom(`${design.motif}:${design.summary}`);
    rectangle(png, 0, 0, 64, 32, dark);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 64; x += 1) {
      const wave = Math.sin((x / 64) * Math.PI * 5 + (y / 10)) * 0.5 + 0.5;
      if ((x + y) % 7 === 0 || rng() > 0.965) paint(png, x, y, wave > 0.52 ? accent : primary);
    }
    rectangle(png, 22, 6, 20, 20, primary); rectangle(png, 25, 9, 14, 14, accent); rectangle(png, 29, 11, 6, 10, light); rectangle(png, 26, 14, 12, 4, dark);
    return png;
  }

  function privateCapeChoiceFile() { return path.join(dataRoot, 'website-cape-choice.json'); }
  function privateCapeConfigPath(version) { return path.join(instanceRoot(version), 'config', 'vortex-client', 'cosmetics.json'); }
  function saveCapeForInstances(capeId, bytes) {
    let written = 0;
    for (const version of supportedVersions) {
      const target = path.join(instanceRoot(version), 'config', 'vortex-client', 'capes', `${capeId}.png`);
      ensureDir(path.dirname(target)); fs.writeFileSync(target, bytes);
      writeJson(privateCapeConfigPath(version), { cape: capeId, updatedAt: new Date().toISOString(), source: 'ai-studio' });
      written += 1;
    }
    writeJson(privateCapeChoiceFile(), { cape: capeId, updatedAt: new Date().toISOString(), source: 'ai-studio' });
    return written;
  }

  async function generateSkin(prompt) {
    const design = await createDesign(prompt, 'einen Minecraft-Skin im Pixel-Art-Stil');
    const id = `ai-skin-${safeName(design.title)}-${nowId()}`;
    const target = path.join(studioRoot, 'skins', `${id}.png`);
    ensureDir(path.dirname(target)); fs.writeFileSync(target, PNG.sync.write(makeSkin(design)));
    return { ok: true, id, path: target, design, preview: `file://${target.replace(/\\/g, '/')}` };
  }

  async function generateCape(prompt) {
    const design = await createDesign(prompt, 'ein dynamisches Minecraft-Cape im Pixel-Art-Stil');
    const id = `ai-cape-${safeName(design.title)}-${nowId()}`;
    const bytes = PNG.sync.write(makeCape(design));
    const archive = path.join(studioRoot, 'capes', `${id}.png`);
    ensureDir(path.dirname(archive)); fs.writeFileSync(archive, bytes);
    const instances = saveCapeForInstances(id, bytes);
    return { ok: true, id, path: archive, instances, design, preview: `file://${archive.replace(/\\/g, '/')}` };
  }

  function javaIdentifier(value, fallback) {
    const words = String(value || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    const combined = words.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('').replace(/^[^A-Za-z]+/, '');
    return (combined || fallback).slice(0, 48);
  }
  function javaComment(value) { return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /').slice(0, 400); }

  async function createModProject(prompt) {
    const design = await createDesign(prompt, 'eine private Fabric-Mod-Projektvorlage für Minecraft');
    const modId = `vortex_${safeName(design.title).replace(/-/g, '_').slice(0, 28)}`;
    const packageName = `de.vortex.privateprojects.${modId.replace(/[^a-z0-9_]/g, '')}`;
    const className = `${javaIdentifier(design.title, 'PrivateMod')}Mod`;
    const project = path.join(studioRoot, 'mod-projects', `${safeName(design.title)}-${nowId()}`);
    const javaDir = path.join(project, 'src', 'main', 'java', ...packageName.split('.'));
    const resourcesDir = path.join(project, 'src', 'main', 'resources');
    ensureDir(javaDir); ensureDir(resourcesDir);
    fs.writeFileSync(path.join(project, 'README.md'), `# ${design.title}\n\n${design.summary}\n\n## Private Vortex-Projektvorlage\n\nDiese Vorlage wurde lokal vom KI-Studio erstellt. Sie wird nicht automatisch kompiliert oder installiert. Prüfe und erweitere den Quellcode zuerst in einer Fabric-Entwicklungsumgebung.\n\n- Motiv: ${design.motif}\n- Palette: ${design.palette.join(', ')}\n- Ziel: Minecraft 1.21.11 mit Fabric\n`, 'utf8');
    writeJson(path.join(resourcesDir, 'fabric.mod.json'), { schemaVersion: 1, id: modId, version: '0.1.0-private', name: design.title, description: design.summary, environment: '*', entrypoints: { main: [packageName + '.' + className] }, depends: { fabricloader: '>=0.19.3', minecraft: '1.21.11', java: '>=21' } });
    fs.writeFileSync(path.join(javaDir, `${className}.java`), `package ${packageName};\n\nimport net.fabricmc.api.ModInitializer;\n\n/**\n * Private KI-Projektvorlage für Vortex.\n * Idee: ${javaComment(design.summary)}\n * Motiv: ${javaComment(design.motif)}\n */\npublic final class ${className} implements ModInitializer {\n    public static final String MOD_ID = "${modId}";\n\n    @Override\n    public void onInitialize() {\n        // Füge hier nach eigener Prüfung deine sichere Modlogik ein.\n        System.out.println("[" + MOD_ID + "] Private Vortex-Projektvorlage geladen.");\n    }\n}\n`, 'utf8');
    return { ok: true, path: project, modId, className, design };
  }

  function openOutputFolder(kind) {
    const folder = kind === 'mods' ? path.join(studioRoot, 'mod-projects') : kind === 'capes' ? path.join(studioRoot, 'capes') : path.join(studioRoot, 'skins');
    ensureDir(folder);
    return folder;
  }

  return { getState, saveKey, removeKey, generateSkin, generateCape, createModProject, openOutputFolder };
}

module.exports = { createAiStudio };
