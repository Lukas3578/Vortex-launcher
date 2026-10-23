'use strict';
/**
 * Vortex Friends -- Server.
 *
 * Ein WebSocket-Endpunkt (wss://<host>/ws) fuer Launcher und Vortex Client.
 *
 * ABLAUF
 *   Client -> {t:'hello', client:'launcher'|'game', version, token?}
 *   Server -> {t:'ready', uuid, name, token}            (Token noch gueltig)
 *          oder {t:'challenge', serverId}                (Mojang-Pruefung noetig)
 *   Client meldet sich bei Mojang an (sessionserver /join) und schickt
 *          -> {t:'login', name, serverId}
 *   Server prueft bei Mojang (hasJoined) -> {t:'ready', ...}
 *
 *   Danach: {t:'req', id, op, args} -> {t:'res', id, ok, data | error}
 *   Server schickt von sich aus {t:'ev', ev, data} (Status, Nachrichten ...).
 *
 * UMGEBUNG
 *   PORT            (Standard 8080)
 *   DATABASE_URL    Postgres (empfohlen bei Render & Co.), sonst SQLite in DATA_DIR
 *   DATA_DIR        Ordner fuer die SQLite-Datei (Standard ./data)
 *   BANNED          Komma-Liste gesperrter Namen/UUIDs
 *   COSMETIC_ADMINS Komma-Liste von Minecraft-Namen, die Cape-Bilder entfernen/sperren duerfen
 *   SHOP_ADMINS     Komma-Liste von Namen oder UUIDs fuer den Shop-Admin-Bereich (Standard: Lukas3577, M_rc).
 *                   Namen werden einmal bei Mojang in UUIDs umgewandelt und so festgehalten.
 */
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { open } = require('./db');
const { Hub, UserError } = require('./hub');
const mojang = require('./mojang');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const PROTOCOL = 1;
const VERSION = require('../package.json').version;

/** Einfacher Token-Eimer: `cap` auf einmal, danach `perSec` pro Sekunde. */
function bucket(cap, perSec) {
  let tokens = cap, last = Date.now();
  return (cost = 1) => {
    const t = Date.now();
    tokens = Math.min(cap, tokens + ((t - last) / 1000) * perSec);
    last = t;
    if (tokens < cost) return false;
    tokens -= cost;
    return true;
  };
}

async function start({ env = process.env, port = Number(env.PORT) || 8080, hasJoined = mojang.hasJoined, lookup = mojang.lookup, shopTakt = 15000 } = {}) {
  const db = await open(env);
  const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  const hub = new Hub(db, { log, banned: list(env.BANNED), cosmeticAdmins: list(env.COSMETIC_ADMINS), shopAdmins: list(env.SHOP_ADMINS) });
  await hub.load();
  void hub._shopAdminsAufloesen(lookup).catch(e => log('shop admins', e.message));
  const started = Date.now();

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (url === '/' || url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ name: 'Vortex Friends', version: VERSION, shop: true, protocol: PROTOCOL, online: hub.conns.size, users: hub.users.size, uptime: Math.round((Date.now() - started) / 1000) }));
      return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 128 * 1024 });
  const perIp = new Map();
  const requestBuckets = new Map();

  wss.on('connection', (ws, req) => {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const n = (perIp.get(ip) || 0) + 1;
    if (n > 30) { ws.close(1008, 'too many connections'); return; }
    perIp.set(ip, n);

    const conn = { uuid: null, kind: 'launcher', activity: null, alive: true, send: obj => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } };
    let challenge = null;
    let authing = false;
    const ops = bucket(40, 4);
    const chat = bucket(10, 1);
    const authTimer = setTimeout(() => { if (!conn.uuid) ws.close(1008, 'no login'); }, 30000);

    ws.on('pong', () => { conn.alive = true; });

    const ready = async who => {
      if (hub.isBanned(who.uuid, who.name)) { conn.send({ t: 'error', error: 'This account is banned from Vortex friends.' }); ws.close(); return; }
      const existing = [...(hub.conns.get(who.uuid) || [])];
      if (existing.length >= 4) existing[0].close?.();
      conn.uuid = who.uuid;
      conn.close = () => ws.close(4000, 'replaced');
      clearTimeout(authTimer);
      conn.send({ t: 'ready', uuid: who.uuid, name: who.name, token: who.token, protocol: PROTOCOL });
      await hub.attach(conn);
      log(`+ ${who.name} (${conn.kind})`);
    };

    ws.on('message', async raw => {
      let m;
      try { m = JSON.parse(String(raw)); } catch (_) { return; }
      if (!m || typeof m !== 'object') return;
      try {
        if (!conn.uuid) {
          if (authing) return;
          if (m.t === 'hello') {
            conn.kind = m.client === 'game' ? 'game' : 'launcher';
            const who = m.token ? await hub.resume(m.token) : null;
            if (who) { await ready({ ...who, token: m.token }); return; }
            challenge = `vf${crypto.randomBytes(16).toString('hex')}`;
            conn.send({ t: 'challenge', serverId: challenge });
            return;
          }
          if (m.t === 'login' && challenge && m.serverId === challenge) {
            authing = true;
            const name = String(m.name || '').slice(0, 16);
            let who = await hasJoined(name, challenge);
            if (!who) { await new Promise(r => setTimeout(r, 1200)); who = await hasJoined(name, challenge); }
            challenge = null;
            authing = false;
            if (!who) { conn.send({ t: 'error', error: 'Mojang could not confirm your account. Sign in to the launcher again.' }); ws.close(); return; }
            const session = await hub.login(who.uuid, who.name);
            await ready(session);
            return;
          }
          return;
        }
        if (m.t === 'ping') { conn.send({ t: 'pong' }); return; }
        if (m.t !== 'req') return;
        const reply = (ok, payload) => conn.send(ok ? { t: 'res', id: m.id, ok: true, data: payload } : { t: 'res', id: m.id, ok: false, error: payload });
        const op = String(m.op || '');
        if (!ops(op === 'chat.typing' ? 0.25 : 1)) { reply(false, 'Slow down a little.'); return; }
        if ((op === 'chat.send' || op === 'invite.send') && !chat()) { reply(false, 'You are sending messages too fast.'); return; }
        if (op === 'friend.request') {
          let b = requestBuckets.get(conn.uuid);
          if (!b) { b = bucket(15, 15 / 3600); requestBuckets.set(conn.uuid, b); }
          if (!b()) { reply(false, 'Too many friend requests. Try again later.'); return; }
        }
        if (op === 'logout') { await hub.logout(m.args?.token); reply(true, {}); ws.close(); return; }
        const data = await hub.op(conn, op, m.args || {});
        reply(true, data || {});
      } catch (e) {
        authing = false;
        if (e instanceof UserError) {
          if (m.t === 'req') conn.send({ t: 'res', id: m.id, ok: false, error: e.message });
          else conn.send({ t: 'error', error: e.message });
        } else {
          log('Error:', e && e.stack || e);
          if (m.t === 'req') conn.send({ t: 'res', id: m.id, ok: false, error: 'Something went wrong on the friends server.' });
          else { conn.send({ t: 'error', error: 'The friends server could not sign you in right now.' }); ws.close(); }
        }
      }
    });

    ws.on('close', async () => {
      clearTimeout(authTimer);
      perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
      if (!perIp.get(ip)) perIp.delete(ip);
      if (conn.uuid) {
        await hub.detach(conn).catch(e => log('detach', e.message));
        log(`- ${hub.users.get(conn.uuid)?.name} (${conn.kind})`);
      }
    });
    ws.on('error', () => {});
    conn.ws = ws;
  });

  const beat = setInterval(() => {
    for (const set of hub.conns.values()) {
      for (const c of set) {
        if (!c.alive) { try { c.ws.terminate(); } catch (_) {} continue; }
        c.alive = false;
        try { c.ws.ping(); } catch (_) {}
      }
    }
  }, 25000);
  const tidy = setInterval(() => hub.cleanup().catch(e => log('cleanup', e.message)), 3600 * 1000);
  const shopUhr = shopTakt > 0 ? setInterval(() => hub.shopTick(shopTakt / 1000).catch(e => log('shop', e.message)), shopTakt) : null;

  await new Promise(r => server.listen(port, r));
  log(`Vortex Friends listening on :${server.address().port} (${db.kind}${db.file ? ` ${db.file}` : ''})`);
  return {
    hub, server, port: server.address().port,
    async stop() { clearInterval(beat); clearInterval(tidy); if (shopUhr) clearInterval(shopUhr); for (const c of wss.clients) c.terminate(); await new Promise(r => server.close(r)); await db.close(); }
  };
}

if (require.main === module) {
  start().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { start };
