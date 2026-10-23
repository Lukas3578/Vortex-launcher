'use strict';
/**
 * Die ganze Logik des Freunde-Servers -- ohne Netzwerk (das macht server.js).
 *
 * Beziehungen, Einstellungen und Gruppen liegen im Speicher und werden bei
 * jeder Aenderung sofort in die Datenbank geschrieben. Nachrichten werden nur
 * aus der Datenbank gelesen (es koennen viele sein).
 *
 * Jede Verbindung ist entweder der LAUNCHER oder das SPIEL (Vortex Client).
 * Der Online-Status ergibt sich aus beiden: Spiel verbunden = "spielt" (mit
 * Server, falls der Spieler das zeigt), nur Launcher = "online".
 *
 * PRIVATSPHAERE wird hier auf dem Server durchgesetzt, nicht im Client: Wer
 * etwas nicht sehen darf, bekommt es gar nicht erst geschickt.
 */
const crypto = require('crypto');
const cosmetics = require('./cosmetics');
const music = require('./music');

const now = () => Date.now();
const LIMITS = {
  friends: 300, outgoing: 50, groupMembers: 20, groupsPerUser: 30, body: 1000, nickname: 24, statusText: 60,
  groupName: 32, history: 50, editWindowMs: 15 * 60 * 1000, inviteMs: 10 * 60 * 1000, profileMods: 400,
  profileBytes: 96 * 1024
};

const AUDIENCE = ['friends', 'favorites', 'nobody'];
const SCHEMA = {
  privacy: {
    requests: ['everyone', 'fof', 'nobody'],
    messages: AUDIENCE,
    invites: AUDIENCE,
    groups: AUDIENCE,
    joinRequests: AUDIENCE,
    showOnline: AUDIENCE,
    showServer: AUDIENCE,
    allowJoin: 'bool',
    modProfile: AUDIENCE,
    lastSeen: AUDIENCE,
    readReceipts: 'bool',
    typing: 'bool'
  },
  notify: {
    friendOnline: ['all', 'favorites', 'off'],
    friendOffline: ['all', 'favorites', 'off'],
    friendJoin: ['all', 'favorites', 'off'],
    messages: ['all', 'favorites', 'off'],
    groupMessages: ['all', 'mentions', 'off'],
    invites: 'bool',
    requests: 'bool',
    joinRequests: 'bool',
    whilePlaying: ['all', 'important', 'off'],
    sound: 'bool',
    desktop: 'bool',
    inGame: 'bool',
    dndSilence: 'bool'
  }
};
const DEFAULTS = {
  privacy: {
    requests: 'everyone', messages: 'friends', invites: 'friends', groups: 'friends', joinRequests: 'friends',
    showOnline: 'friends', showServer: 'friends', allowJoin: true, modProfile: 'friends', lastSeen: 'friends',
    readReceipts: true, typing: true
  },
  notify: {
    friendOnline: 'all', friendOffline: 'off', friendJoin: 'all', messages: 'all', groupMessages: 'all',
    invites: true, requests: true, joinRequests: true, whilePlaying: 'all', sound: true, desktop: true,
    inGame: true, dndSilence: true
  }
};
const MODES = ['online', 'away', 'dnd', 'invisible'];

function mergeSettings(stored) {
  const out = {};
  for (const [group, keys] of Object.entries(SCHEMA)) {
    out[group] = {};
    for (const [k, allowed] of Object.entries(keys)) {
      const v = stored?.[group]?.[k];
      const ok = allowed === 'bool' ? typeof v === 'boolean' : allowed.includes(v);
      out[group][k] = ok ? v : DEFAULTS[group][k];
    }
  }
  return out;
}

class UserError extends Error {}
const fail = msg => { throw new UserError(msg); };
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, max);
const safeJson = (s, d) => { try { return JSON.parse(s); } catch (_) { return d; } };
const ADDRESS = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

class Hub {
  constructor(db, { log = () => {}, banned = [], cosmeticAdmins = [], shopAdmins = [] } = {}) {
    this.db = db;
    this.shopAdminListe = shopAdmins;
    this.logPuffer = [];
    this.log = (...teile) => {
      const zeile = teile.map(t => (typeof t === 'string' ? t : t && t.message ? t.message : String(t))).join(' ');
      this.logPuffer.push({ at: now(), text: zeile.slice(0, 300) });
      if (this.logPuffer.length > 200) this.logPuffer.splice(0, this.logPuffer.length - 200);
      log(...teile);
    };
    this.banned = new Set(banned.map(s => String(s).toLowerCase()));
    this.cosmeticAdmins = new Set(cosmeticAdmins.map(s => String(s).toLowerCase()));
    this.lastImageUpload = new Map();
    /** Musik: uuid -> { track, at } (nur im Speicher, siehe music.js) */
    this.music = new Map();
    this.lastMusicSet = new Map();
    this.lastEmote = new Map();
    this.users = new Map();
    this.byName = new Map();
    this.friends = new Map();
    this.reqOut = new Map();
    this.reqIn = new Map();
    this.blocks = new Map();
    this.convs = new Map();
    this.convsOf = new Map();
    this.conns = new Map();
    this.invites = new Map();
    this.lastId = 0;
  }

  async load() {
    const db = this.db;
    for (const u of await db.all('SELECT * FROM users')) this._putUser(u);
    for (const f of await db.all('SELECT * FROM friends')) {
      this._map(this.friends, f.owner).set(f.friend, { since: f.since, favorite: Boolean(f.favorite), nickname: f.nickname || '', muted: Boolean(f.muted) });
    }
    for (const r of await db.all('SELECT * FROM requests')) {
      this._map(this.reqOut, r.src).set(r.dst, r.created);
      this._map(this.reqIn, r.dst).set(r.src, r.created);
    }
    for (const b of await db.all('SELECT * FROM blocks')) this._map(this.blocks, b.owner).set(b.target, b.created);
    for (const c of await db.all('SELECT * FROM convs')) {
      this.convs.set(c.id, { id: c.id, kind: c.kind, name: c.name, owner: c.owner, created: c.created, lastMsg: c.last_msg, members: new Map() });
    }
    for (const m of await db.all('SELECT * FROM members')) {
      const c = this.convs.get(m.conv);
      if (!c) continue;
      c.members.set(m.uuid, { joined: m.joined, lastRead: m.last_read, muted: Boolean(m.muted) });
      this._set(this.convsOf, m.uuid).add(c.id);
    }
    const last = await db.get('SELECT MAX(id) AS n FROM messages');
    this.lastId = Number(last?.n) || 0;
    this.log(`Loaded ${this.users.size} user(s), ${this.convs.size} conversation(s).`);
    await this._creatorsLaden();
    await this._bansLaden();
    await this._shopLaden(this.shopAdminListe);
  }

  _map(m, k) { let v = m.get(k); if (!v) { v = new Map(); m.set(k, v); } return v; }
  _set(m, k) { let v = m.get(k); if (!v) { v = new Set(); m.set(k, v); } return v; }

  _putUser(row) {
    const u = {
      uuid: row.uuid, name: row.name, created: row.created, lastSeen: row.last_seen,
      settings: mergeSettings(safeJson(row.settings, {})),
      profile: safeJson(row.profile, {}) || {},
      status: (() => { const s = safeJson(row.status, {}) || {}; return { mode: MODES.includes(s.mode) ? s.mode : 'online', text: cleanText(s.text, LIMITS.statusText) }; })()
    };
    const old = this.users.get(u.uuid);
    if (old && old.name.toLowerCase() !== u.name.toLowerCase()) this.byName.delete(old.name.toLowerCase());
    this.users.set(u.uuid, u);
    this.byName.set(u.name.toLowerCase(), u.uuid);
    return u;
  }

  async _saveUser(u) {
    await this.db.run(
      `INSERT INTO users (uuid, name, created, last_seen, settings, profile, status) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (uuid) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen,
       settings = excluded.settings, profile = excluded.profile, status = excluded.status`,
      [u.uuid, u.name, u.created, u.lastSeen, JSON.stringify(u.settings), JSON.stringify(u.profile || {}), JSON.stringify(u.status)]);
  }

  isBanned(uuid, name) {
    return this.banned.has(String(uuid).toLowerCase()) || this.banned.has(String(name).toLowerCase()) || Boolean(this.bans?.has(String(uuid).toLowerCase()));
  }

  /** Nach erfolgreicher Mojang-Pruefung: Nutzer anlegen/aktualisieren, Token ausstellen. */
  async login(uuid, name) {
    if (this.isBanned(uuid, name)) fail('This account is banned from Vortex friends.');
    let u = this.users.get(uuid);
    if (!u) {
      u = this._putUser({ uuid, name, created: now(), last_seen: now(), settings: '{}', profile: '{}', status: '{}' });
    } else if (u.name !== name) {
      this.byName.delete(u.name.toLowerCase());
      u.name = name;
      this.byName.set(name.toLowerCase(), uuid);
    }
    const other = this.byName.get(name.toLowerCase());
    if (other && other !== uuid) this.byName.set(name.toLowerCase(), uuid);
    await this._saveUser(u);
    const token = crypto.randomBytes(32).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await this.db.run('INSERT INTO tokens (hash, uuid, created, expires) VALUES (?, ?, ?, ?)', [hash, uuid, now(), now() + 60 * 86400000]);
    return { token, uuid, name: u.name };
  }

  async resume(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await this.db.get('SELECT * FROM tokens WHERE hash = ?', [hash]);
    if (!row || row.expires < now()) return null;
    const u = this.users.get(row.uuid);
    if (!u || this.isBanned(u.uuid, u.name)) return null;
    return { uuid: u.uuid, name: u.name };
  }

  async logout(token) {
    const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
    await this.db.run('DELETE FROM tokens WHERE hash = ?', [hash]);
  }

  async cleanup() {
    await this.db.run('DELETE FROM tokens WHERE expires < ?', [now()]);
    await this.db.run('DELETE FROM messages WHERE created < ?', [now() - 180 * 86400000]);
    for (const [id, inv] of this.invites) if (inv.expires < now()) this.invites.delete(id);
  }

  /** conn = { uuid, kind: 'launcher'|'game', activity, send(obj) } */
  async attach(conn) {
    const set = this._set(this.conns, conn.uuid);
    const before = this._rawPresenceKey(conn.uuid);
    set.add(conn);
    await this.sendState(conn.uuid, conn);
    this._presenceChanged(conn.uuid, before);
  }

  async detach(conn) {
    const set = this.conns.get(conn.uuid);
    if (!set || !set.has(conn)) return;
    const before = this._rawPresenceKey(conn.uuid);
    set.delete(conn);
    if (!set.size) {
      this.conns.delete(conn.uuid);
      this.music.delete(conn.uuid);
      const u = this.users.get(conn.uuid);
      if (u && u.status.mode !== 'invisible') {
        u.lastSeen = now();
        await this._saveUser(u).catch(() => {});
      }
    }
    this._presenceChanged(conn.uuid, before);
  }

  setActivity(conn, a) {
    const before = this._rawPresenceKey(conn.uuid);
    conn.activity = this._cleanActivity(conn.kind, a);
    this._presenceChanged(conn.uuid, before);
  }

  _cleanActivity(kind, a) {
    if (!a || typeof a !== 'object') return null;
    if (kind === 'launcher') {
      return a.playing ? { mode: 'game', version: cleanText(a.version, 20), since: Number(a.since) || now() } : null;
    }
    const mode = ['menu', 'singleplayer', 'server', 'realms'].includes(a.mode) ? a.mode : 'menu';
    let address = mode === 'server' ? cleanText(a.address, 120).toLowerCase() : '';
    if (address && !ADDRESS.test(address)) address = '';
    return {
      mode, version: cleanText(a.version, 20), address, serverName: mode === 'server' ? cleanText(a.serverName, 40) : '',
      client: cleanText(a.client, 20), since: Number(a.since) || now()
    };
  }

  /** Was aus Sicht des Spielers selbst gerade los ist (ohne Privatsphaere). */
  _raw(uuid, without = null) {
    const set = [...(this.conns.get(uuid) || [])].filter(c => c !== without);
    if (!set.length) return null;
    const game = set.find(c => c.kind === 'game' && c.activity);
    const launcher = set.find(c => c.kind === 'launcher' && c.activity);
    const activity = game ? game.activity : launcher ? launcher.activity : null;
    return { activity, inGame: Boolean(game), launcher: set.some(c => c.kind === 'launcher') };
  }
  _rawPresenceKey(uuid, without = null) {
    const u = this.users.get(uuid);
    return JSON.stringify([this._raw(uuid, without), u?.status]);
  }

  _presenceChanged(uuid, beforeKey) {
    if (this._rawPresenceKey(uuid) === beforeKey) return;
    for (const f of this.friends.get(uuid)?.keys() || []) {
      this.emit(f, 'presence', { uuid, presence: this.presence(uuid, f) });
    }
    this.emit(uuid, 'self', { status: this.users.get(uuid)?.status, presence: this.presence(uuid, uuid) });
  }

  /** Wie sieht `viewer` den Spieler `uuid`? */
  presence(uuid, viewer) {
    const u = this.users.get(uuid);
    if (!u) return { state: 'offline' };
    const self = uuid === viewer;
    const raw = this._raw(uuid);
    const lastSeen = self || this.allowed(uuid, viewer, u.settings.privacy.lastSeen) ? u.lastSeen : null;
    const visible = self || (u.status.mode !== 'invisible' && this.allowed(uuid, viewer, u.settings.privacy.showOnline));
    if (!raw || !visible) return { state: 'offline', lastSeen };
    const p = {
      state: raw.activity ? 'playing' : 'online',
      mode: u.status.mode === 'invisible' ? 'online' : u.status.mode,
      text: u.status.text || '',
      launcher: raw.launcher,
      hasProfile: Boolean(u.profile?.versions && Object.keys(u.profile.versions).length) && (self || this.allowed(uuid, viewer, u.settings.privacy.modProfile))
    };
    if (self) p.mode = u.status.mode;
    const a = raw.activity;
    if (a) {
      const showServer = self || this.allowed(uuid, viewer, u.settings.privacy.showServer);
      p.activity = { mode: a.mode === 'game' ? 'game' : showServer ? a.mode : 'hidden', version: a.version, since: a.since, client: a.client || '' };
      if (showServer && a.mode === 'server') {
        p.activity.address = a.address;
        p.activity.serverName = a.serverName;
        p.activity.joinable = Boolean(a.address) && u.settings.privacy.allowJoin && !self;
      }
    }
    return p;
  }

  isFriend(a, b) { return Boolean(this.friends.get(a)?.has(b)); }
  hasBlocked(a, b) { return Boolean(this.blocks.get(a)?.has(b)); }
  blockedEither(a, b) { return this.hasBlocked(a, b) || this.hasBlocked(b, a); }
  isFavoriteOf(owner, viewer) { return Boolean(this.friends.get(owner)?.get(viewer)?.favorite); }
  mutual(a, b) {
    const fa = this.friends.get(a), fb = this.friends.get(b);
    if (!fa || !fb) return 0;
    let n = 0;
    for (const k of fa.keys()) if (fb.has(k)) n++;
    return n;
  }

  /** Darf `viewer` etwas von `owner`, das auf `level` steht? */
  allowed(owner, viewer, level) {
    if (owner === viewer) return true;
    if (this.blockedEither(owner, viewer)) return false;
    switch (level) {
      case 'everyone': return true;
      case 'fof': return this.isFriend(owner, viewer) || this.mutual(owner, viewer) > 0;
      case 'friends': return this.isFriend(owner, viewer);
      case 'favorites': return this.isFriend(owner, viewer) && this.isFavoriteOf(owner, viewer);
      default: return false;
    }
  }

  emit(uuid, ev, data, only = null) {
    for (const c of this.conns.get(uuid) || []) {
      if (only && c.kind !== only) continue;
      try { c.send({ t: 'ev', ev, data }); } catch (_) {}
    }
  }

  _pub(uuid) { const u = this.users.get(uuid); return { uuid, name: u?.name || '?' }; }

  async state(me) {
    const u = this.users.get(me);
    const friends = [];
    for (const [f, rel] of this.friends.get(me) || []) {
      friends.push({ ...this._pub(f), since: rel.since, favorite: rel.favorite, nickname: rel.nickname, muted: rel.muted, presence: this.presence(f, me) });
    }
    const incoming = [...(this.reqIn.get(me) || [])].map(([s, created]) => ({ ...this._pub(s), created, mutual: this.mutual(me, s) }));
    const outgoing = [...(this.reqOut.get(me) || [])].map(([d, created]) => ({ ...this._pub(d), created }));
    const blocked = [...(this.blocks.get(me) || [])].map(([b, created]) => ({ ...this._pub(b), created }));
    const convs = [];
    for (const id of this.convsOf.get(me) || []) {
      const c = this.convs.get(id);
      if (c) convs.push(await this.convInfo(c, me));
    }
    convs.sort((a, b) => (b.lastMsg || b.created) - (a.lastMsg || a.created));
    const invites = [...this.invites.values()].filter(i => i.to === me && i.expires > now()).map(i => this._invitePub(i));
    return {
      me: { uuid: me, name: u.name, settings: u.settings, status: u.status, profileVersions: Object.keys(u.profile?.versions || {}) },
      friends, incoming, outgoing, blocked, convs, invites, limits: LIMITS
    };
  }

  async sendState(uuid, only = null) {
    const s = await this.state(uuid);
    for (const c of this.conns.get(uuid) || []) {
      if (only && c !== only) continue;
      try { c.send({ t: 'ev', ev: 'state', data: s }); } catch (_) {}
    }
  }

  async convInfo(c, me) {
    const m = c.members.get(me);
    const lastRow = await this.db.get('SELECT * FROM messages WHERE conv = ? ORDER BY id DESC LIMIT 1', [c.id]);
    const blocked = this.blocks.get(me);
    let unread = 0;
    if (m) {
      const rows = await this.db.all('SELECT sender, COUNT(*) AS n FROM messages WHERE conv = ? AND id > ? AND sender <> ? AND deleted = 0 GROUP BY sender', [c.id, m.lastRead, me]);
      for (const r of rows) if (!blocked?.has(r.sender)) unread += Number(r.n);
    }
    const members = [...c.members.keys()].map(x => this._pub(x));
    const info = { id: c.id, kind: c.kind, name: c.name, owner: c.owner, created: c.created, lastMsg: c.lastMsg, members, unread, muted: Boolean(m?.muted), last: lastRow ? this._msgPub(lastRow, me) : null };
    if (c.kind === 'dm') {
      const other = [...c.members.keys()].find(x => x !== me) || me;
      info.with = other;
      const ou = this.users.get(other);
      if (ou?.settings.privacy.readReceipts && this.users.get(me)?.settings.privacy.readReceipts) info.readUpTo = c.members.get(other)?.lastRead || 0;
    }
    return info;
  }

  _msgPub(row, viewer) {
    const hidden = viewer && row.sender !== viewer && this.hasBlocked(viewer, row.sender);
    return {
      id: row.id, conv: row.conv, sender: row.sender, senderName: this.users.get(row.sender)?.name || '?',
      body: row.deleted || hidden ? '' : row.body, created: row.created, edited: row.edited, deleted: Boolean(row.deleted),
      blocked: Boolean(hidden), replyTo: row.reply_to || 0, kind: row.kind, extra: row.deleted || hidden ? null : safeJson(row.extra, null)
    };
  }

  async op(conn, name, a = {}) {
    const me = conn.uuid;
    const fn = OPS[name];
    if (!fn) fail('Unknown request.');
    return fn.call(this, me, a || {}, conn);
  }

  _user(a, key = 'uuid') {
    const uuid = String(a[key] || '').toLowerCase();
    const u = this.users.get(uuid);
    if (!u) fail('Player not found.');
    return u;
  }

  async _addFriend(a, b) {
    const t = now();
    for (const [x, y] of [[a, b], [b, a]]) {
      this._map(this.friends, x).set(y, { since: t, favorite: false, nickname: '', muted: false });
      await this.db.run('INSERT INTO friends (owner, friend, since) VALUES (?, ?, ?) ON CONFLICT (owner, friend) DO NOTHING', [x, y, t]);
    }
    await this._dropRequest(a, b);
    await this._dropRequest(b, a);
  }

  async _removeFriend(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      this.friends.get(x)?.delete(y);
      await this.db.run('DELETE FROM friends WHERE owner = ? AND friend = ?', [x, y]);
    }
  }

  async _dropRequest(src, dst) {
    this.reqOut.get(src)?.delete(dst);
    this.reqIn.get(dst)?.delete(src);
    await this.db.run('DELETE FROM requests WHERE src = ? AND dst = ?', [src, dst]);
  }

  async _saveRel(owner, friend) {
    const r = this.friends.get(owner)?.get(friend);
    if (!r) return;
    await this.db.run('UPDATE friends SET favorite = ?, nickname = ?, muted = ? WHERE owner = ? AND friend = ?',
      [r.favorite ? 1 : 0, r.nickname, r.muted ? 1 : 0, owner, friend]);
  }

  async _dm(a, b) {
    const id = `dm:${[a, b].sort().join(':')}`;
    let c = this.convs.get(id);
    if (!c) {
      c = { id, kind: 'dm', name: '', owner: '', created: now(), lastMsg: 0, members: new Map() };
      this.convs.set(id, c);
      await this.db.run('INSERT INTO convs (id, kind, name, owner, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', [id, 'dm', '', '', c.created]);
    }
    for (const x of [a, b]) if (!c.members.has(x)) await this._addMember(c, x);
    return c;
  }

  async _addMember(c, uuid) {
    c.members.set(uuid, { joined: now(), lastRead: this.lastId, muted: false });
    this._set(this.convsOf, uuid).add(c.id);
    await this.db.run('INSERT INTO members (conv, uuid, joined, last_read) VALUES (?, ?, ?, ?) ON CONFLICT (conv, uuid) DO NOTHING', [c.id, uuid, now(), this.lastId]);
  }

  async _removeMember(c, uuid) {
    c.members.delete(uuid);
    this.convsOf.get(uuid)?.delete(c.id);
    await this.db.run('DELETE FROM members WHERE conv = ? AND uuid = ?', [c.id, uuid]);
  }

  _conv(me, id) {
    const c = this.convs.get(String(id || ''));
    if (!c || !c.members.has(me)) fail('Conversation not found.');
    return c;
  }

  async _post(c, sender, body, { kind = 'text', replyTo = 0, extra = null } = {}) {
    const id = Math.max(now() * 1000, this.lastId + 1);
    this.lastId = id;
    const row = { id, conv: c.id, sender, body, created: now(), edited: 0, deleted: 0, reply_to: replyTo, kind, extra: extra ? JSON.stringify(extra) : '' };
    await this.db.run('INSERT INTO messages (id, conv, sender, body, created, reply_to, kind, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.id, row.conv, row.sender, row.body, row.created, row.reply_to, row.kind, row.extra]);
    c.lastMsg = row.created;
    await this.db.run('UPDATE convs SET last_msg = ? WHERE id = ?', [row.created, c.id]);
    const m = c.members.get(sender);
    if (m) { m.lastRead = id; await this.db.run('UPDATE members SET last_read = ? WHERE conv = ? AND uuid = ?', [id, c.id, sender]); }
    for (const member of c.members.keys()) {
      if (member !== sender && this.hasBlocked(member, sender) && kind !== 'system') continue;
      this.emit(member, 'message', { conv: await this.convInfo(c, member), message: this._msgPub(row, member) });
    }
    return this._msgPub(row, sender);
  }

  _invitePub(i) {
    return { id: i.id, from: this._pub(i.from), to: i.to, address: i.address, serverName: i.serverName, version: i.version, created: i.created, expires: i.expires };
  }
}

const OPS = {
  async state(me) { return this.state(me); },

  async 'friend.request'(me, a) {
    const name = cleanText(a.name, 16);
    if (!/^\w{2,16}$/.test(name)) fail('Enter a Minecraft name.');
    const uuid = this.byName.get(name.toLowerCase());
    if (!uuid) fail('{0} has never used Vortex. They need to sign in to the launcher or the Vortex Client once.'.replace('{0}', name));
    if (uuid === me) fail('That is you.');
    const target = this.users.get(uuid);
    if (this.isFriend(me, uuid)) fail('You are already friends with {0}.'.replace('{0}', target.name));
    if (this.hasBlocked(me, uuid)) fail('You blocked {0}. Unblock them first.'.replace('{0}', target.name));
    if (this.hasBlocked(uuid, me) || !this.allowed(uuid, me, target.settings.privacy.requests)) {
      fail('{0} does not accept friend requests from you.'.replace('{0}', target.name));
    }
    if (this.reqIn.get(me)?.has(uuid)) {
      await this._addFriend(me, uuid);
      await this.sendState(me); await this.sendState(uuid);
      this.emit(uuid, 'friendAdded', this._pub(me));
      return { friends: true, name: target.name };
    }
    if (this.reqOut.get(me)?.has(uuid)) fail('You already sent {0} a request.'.replace('{0}', target.name));
    if ((this.reqOut.get(me)?.size || 0) >= LIMITS.outgoing) fail('Too many open requests. Cancel some first.');
    if ((this.friends.get(me)?.size || 0) >= LIMITS.friends) fail('Your friend list is full.');
    const t = now();
    this._map(this.reqOut, me).set(uuid, t);
    this._map(this.reqIn, uuid).set(me, t);
    await this.db.run('INSERT INTO requests (src, dst, created) VALUES (?, ?, ?) ON CONFLICT (src, dst) DO NOTHING', [me, uuid, t]);
    await this.sendState(me); await this.sendState(uuid);
    this.emit(uuid, 'request', { ...this._pub(me), mutual: this.mutual(me, uuid) });
    return { sent: true, name: target.name };
  },

  async 'friend.accept'(me, a) {
    const u = this._user(a);
    if (!this.reqIn.get(me)?.has(u.uuid)) fail('This request no longer exists.');
    if ((this.friends.get(me)?.size || 0) >= LIMITS.friends) fail('Your friend list is full.');
    await this._addFriend(me, u.uuid);
    await this.sendState(me); await this.sendState(u.uuid);
    this.emit(u.uuid, 'friendAdded', this._pub(me));
    return {};
  },

  async 'friend.decline'(me, a) {
    const u = this._user(a);
    await this._dropRequest(u.uuid, me);
    await this.sendState(me); await this.sendState(u.uuid);
    return {};
  },

  async 'friend.cancel'(me, a) {
    const u = this._user(a);
    await this._dropRequest(me, u.uuid);
    await this.sendState(me); await this.sendState(u.uuid);
    return {};
  },

  async 'friend.remove'(me, a) {
    const u = this._user(a);
    await this._removeFriend(me, u.uuid);
    await this.sendState(me); await this.sendState(u.uuid);
    return {};
  },

  async 'friend.update'(me, a) {
    const u = this._user(a);
    const r = this.friends.get(me)?.get(u.uuid);
    if (!r) fail('You are not friends.');
    const favBefore = r.favorite;
    if (typeof a.favorite === 'boolean') r.favorite = a.favorite;
    if (typeof a.muted === 'boolean') r.muted = a.muted;
    if (a.nickname !== undefined) r.nickname = cleanText(a.nickname, LIMITS.nickname);
    await this._saveRel(me, u.uuid);
    if (favBefore !== r.favorite) this.emit(u.uuid, 'presence', { uuid: me, presence: this.presence(me, u.uuid) });
    await this.sendState(me);
    return {};
  },

  async block(me, a) {
    let u = a.uuid ? this.users.get(String(a.uuid).toLowerCase()) : this.users.get(this.byName.get(cleanText(a.name, 16).toLowerCase()));
    if (!u) fail('Player not found.');
    if (u.uuid === me) fail('That is you.');
    const t = now();
    this._map(this.blocks, me).set(u.uuid, t);
    await this.db.run('INSERT INTO blocks (owner, target, created) VALUES (?, ?, ?) ON CONFLICT (owner, target) DO NOTHING', [me, u.uuid, t]);
    await this._removeFriend(me, u.uuid);
    await this._dropRequest(me, u.uuid);
    await this._dropRequest(u.uuid, me);
    for (const [id, inv] of this.invites) if ((inv.from === u.uuid && inv.to === me) || (inv.from === me && inv.to === u.uuid)) this.invites.delete(id);
    await this.sendState(me); await this.sendState(u.uuid);
    return { name: u.name };
  },

  async unblock(me, a) {
    const u = this._user(a);
    this.blocks.get(me)?.delete(u.uuid);
    await this.db.run('DELETE FROM blocks WHERE owner = ? AND target = ?', [me, u.uuid]);
    await this.sendState(me); await this.sendState(u.uuid);
    return {};
  },

  async 'settings.set'(me, a) {
    const u = this.users.get(me);
    const patch = a.patch || {};
    const next = mergeSettings({
      privacy: { ...u.settings.privacy, ...(patch.privacy || {}) },
      notify: { ...u.settings.notify, ...(patch.notify || {}) }
    });
    u.settings = next;
    await this._saveUser(u);
    for (const f of this.friends.get(me)?.keys() || []) this.emit(f, 'presence', { uuid: me, presence: this.presence(me, f) });
    await this.sendState(me);
    return { settings: next };
  },

  async 'status.set'(me, a) {
    const u = this.users.get(me);
    const before = this._rawPresenceKey(me);
    if (a.mode !== undefined) { if (!MODES.includes(a.mode)) fail('Unknown status.'); u.status.mode = a.mode; }
    if (a.text !== undefined) u.status.text = cleanText(a.text, LIMITS.statusText);
    await this._saveUser(u);
    this._presenceChanged(me, before);
    return { status: u.status };
  },

  async activity(me, a, conn) { this.setActivity(conn, a); return {}; },

  async 'profile.set'(me, a) {
    const u = this.users.get(me);
    const versions = {};
    for (const [v, e] of Object.entries(a.versions || {}).slice(0, 12)) {
      if (!/^[\w.+-]{1,24}$/.test(v) || !Array.isArray(e?.mods)) continue;
      versions[v] = {
        updated: now(),
        loader: cleanText(e.loader || 'fabric', 16),
        mods: e.mods.slice(0, LIMITS.profileMods).map(m => ({
          name: cleanText(m.name, 60), version: cleanText(m.version, 40), id: cleanText(m.id, 64),
          projectId: /^[A-Za-z0-9]{8}$/.test(m.projectId || '') ? m.projectId : '', enabled: m.enabled !== false,
          vortex: Boolean(m.vortex)
        })).filter(m => m.name)
      };
    }
    const next = { versions };
    if (JSON.stringify(next).length > LIMITS.profileBytes) fail('Your mod profile is too large.');
    const had = Object.keys(u.profile?.versions || {}).length > 0;
    u.profile = next;
    await this._saveUser(u);
    if (had !== Object.keys(versions).length > 0) {
      for (const f of this.friends.get(me)?.keys() || []) this.emit(f, 'presence', { uuid: me, presence: this.presence(me, f) });
    }
    return { versions: Object.keys(versions) };
  },

  async 'profile.get'(me, a) {
    const u = this._user(a);
    if (!this.allowed(u.uuid, me, u.settings.privacy.modProfile)) fail('{0} does not share their mod profile with you.'.replace('{0}', u.name));
    return { uuid: u.uuid, name: u.name, versions: u.profile?.versions || {} };
  },

  async 'chat.open'(me, a) {
    const u = this._user(a);
    if (u.uuid === me) fail('That is you.');
    const c = await this._dm(me, u.uuid);
    return { conv: await this.convInfo(c, me) };
  },

  async 'chat.history'(me, a) {
    const c = this._conv(me, a.conv);
    const before = Number(a.before) || Number.MAX_SAFE_INTEGER;
    const limit = Math.min(LIMITS.history, Math.max(1, Number(a.limit) || LIMITS.history));
    const rows = await this.db.all('SELECT * FROM messages WHERE conv = ? AND id < ? ORDER BY id DESC LIMIT ?', [c.id, before, limit]);
    return { conv: c.id, messages: rows.reverse().map(r => this._msgPub(r, me)), more: rows.length === limit };
  },

  async 'chat.send'(me, a) {
    let c;
    if (a.to) {
      const u = this._user(a, 'to');
      if (this.hasBlocked(me, u.uuid)) fail('You blocked {0}.'.replace('{0}', u.name));
      c = await this._dm(me, u.uuid);
    } else c = this._conv(me, a.conv);
    const body = cleanText(a.body, LIMITS.body);
    if (!body) fail('The message is empty.');
    if (c.kind === 'dm') {
      const other = [...c.members.keys()].find(x => x !== me);
      const ou = this.users.get(other);
      if (!ou || this.blockedEither(me, other) || !this.allowed(other, me, ou.settings.privacy.messages)) {
        fail('{0} does not accept messages from you.'.replace('{0}', ou?.name || '?'));
      }
    }
    const replyTo = Number(a.replyTo) || 0;
    return { message: await this._post(c, me, body, { replyTo }) };
  },

  async 'chat.edit'(me, a) {
    const row = await this.db.get('SELECT * FROM messages WHERE id = ?', [Number(a.id) || 0]);
    if (!row || row.sender !== me || row.deleted || row.kind !== 'text') fail('You can only edit your own messages.');
    if (now() - row.created > LIMITS.editWindowMs) fail('Messages can only be edited for 15 minutes.');
    const body = cleanText(a.body, LIMITS.body);
    if (!body) fail('The message is empty.');
    await this.db.run('UPDATE messages SET body = ?, edited = ? WHERE id = ?', [body, now(), row.id]);
    return { message: await this._broadcastUpdate(row.conv, row.id, me) };
  },

  async 'chat.delete'(me, a) {
    const row = await this.db.get('SELECT * FROM messages WHERE id = ?', [Number(a.id) || 0]);
    if (!row || row.sender !== me) fail('You can only delete your own messages.');
    await this.db.run("UPDATE messages SET deleted = 1, body = '', extra = '' WHERE id = ?", [row.id]);
    return { message: await this._broadcastUpdate(row.conv, row.id, me) };
  },

  async 'chat.read'(me, a) {
    const c = this._conv(me, a.conv);
    const m = c.members.get(me);
    const upTo = Math.min(Number(a.upTo) || this.lastId, this.lastId);
    if (upTo <= m.lastRead) return {};
    m.lastRead = upTo;
    await this.db.run('UPDATE members SET last_read = ? WHERE conv = ? AND uuid = ?', [upTo, c.id, me]);
    const u = this.users.get(me);
    for (const other of c.members.keys()) {
      if (other === me) { this.emit(me, 'read', { conv: c.id, uuid: me, upTo }); continue; }
      if (c.kind === 'dm' && u.settings.privacy.readReceipts && this.users.get(other)?.settings.privacy.readReceipts) {
        this.emit(other, 'read', { conv: c.id, uuid: me, upTo });
      }
    }
    return {};
  },

  async 'chat.typing'(me, a) {
    const c = this._conv(me, a.conv);
    if (!this.users.get(me).settings.privacy.typing) return {};
    for (const other of c.members.keys()) {
      if (other !== me && !this.hasBlocked(other, me)) this.emit(other, 'typing', { conv: c.id, uuid: me, name: this.users.get(me).name });
    }
    return {};
  },

  async 'chat.mute'(me, a) {
    const c = this._conv(me, a.conv);
    const m = c.members.get(me);
    m.muted = Boolean(a.muted);
    await this.db.run('UPDATE members SET muted = ? WHERE conv = ? AND uuid = ?', [m.muted ? 1 : 0, c.id, me]);
    return { conv: await this.convInfo(c, me) };
  },

  async 'group.create'(me, a) {
    const name = cleanText(a.name, LIMITS.groupName) || 'Group';
    const list = [...new Set((Array.isArray(a.members) ? a.members : []).map(x => String(x).toLowerCase()))].filter(x => x !== me);
    if (!list.length) fail('Pick at least one friend.');
    if (list.length + 1 > LIMITS.groupMembers) fail('A group can have at most {0} members.'.replace('{0}', LIMITS.groupMembers));
    if ([...(this.convsOf.get(me) || [])].filter(id => this.convs.get(id)?.kind === 'group').length >= LIMITS.groupsPerUser) fail('You are in too many groups.');
    for (const x of list) this._checkGroupAdd(me, x);
    const c = { id: `g:${crypto.randomBytes(8).toString('hex')}`, kind: 'group', name, owner: me, created: now(), lastMsg: 0, members: new Map() };
    this.convs.set(c.id, c);
    await this.db.run('INSERT INTO convs (id, kind, name, owner, created) VALUES (?, ?, ?, ?, ?)', [c.id, 'group', name, me, c.created]);
    await this._addMember(c, me);
    for (const x of list) await this._addMember(c, x);
    await this._post(c, me, '', { kind: 'system', extra: { event: 'created', name } });
    return { conv: await this.convInfo(c, me) };
  },

  async 'group.add'(me, a) {
    const c = this._conv(me, a.conv);
    if (c.kind !== 'group') fail('This is not a group.');
    const u = this._user(a);
    if (c.members.has(u.uuid)) fail('{0} is already in the group.'.replace('{0}', u.name));
    if (c.members.size >= LIMITS.groupMembers) fail('A group can have at most {0} members.'.replace('{0}', LIMITS.groupMembers));
    this._checkGroupAdd(me, u.uuid);
    await this._addMember(c, u.uuid);
    await this._post(c, me, '', { kind: 'system', extra: { event: 'added', uuid: u.uuid, name: u.name } });
    return { conv: await this.convInfo(c, me) };
  },

  async 'group.kick'(me, a) {
    const c = this._conv(me, a.conv);
    if (c.kind !== 'group' || c.owner !== me) fail('Only the group owner can remove members.');
    const u = this._user(a);
    if (!c.members.has(u.uuid) || u.uuid === me) fail('Player not found.');
    await this._post(c, me, '', { kind: 'system', extra: { event: 'removed', uuid: u.uuid, name: u.name } });
    await this._removeMember(c, u.uuid);
    this.emit(u.uuid, 'convRemoved', { conv: c.id });
    return {};
  },

  async 'group.leave'(me, a) {
    const c = this._conv(me, a.conv);
    if (c.kind !== 'group') fail('This is not a group.');
    await this._post(c, me, '', { kind: 'system', extra: { event: 'left', uuid: me, name: this.users.get(me).name } });
    await this._removeMember(c, me);
    if (c.owner === me && c.members.size) {
      c.owner = [...c.members.keys()][0];
      await this.db.run('UPDATE convs SET owner = ? WHERE id = ?', [c.owner, c.id]);
    }
    if (!c.members.size) {
      this.convs.delete(c.id);
      await this.db.run('DELETE FROM convs WHERE id = ?', [c.id]);
      await this.db.run('DELETE FROM messages WHERE conv = ?', [c.id]);
    }
    return {};
  },

  async 'group.rename'(me, a) {
    const c = this._conv(me, a.conv);
    if (c.kind !== 'group') fail('This is not a group.');
    const name = cleanText(a.name, LIMITS.groupName);
    if (!name) fail('Enter a name.');
    c.name = name;
    await this.db.run('UPDATE convs SET name = ? WHERE id = ?', [name, c.id]);
    await this._post(c, me, '', { kind: 'system', extra: { event: 'renamed', name } });
    return { conv: await this.convInfo(c, me) };
  },

  async 'invite.send'(me, a) {
    const u = this._user(a, 'to');
    if (!this.isFriend(me, u.uuid)) fail('You can only invite friends.');
    if (!this.allowed(u.uuid, me, u.settings.privacy.invites)) fail('{0} does not accept invites from you.'.replace('{0}', u.name));
    let address = cleanText(a.address, 120).toLowerCase();
    if (!ADDRESS.test(address)) {
      const act = this._raw(me)?.activity;
      address = act?.mode === 'server' ? act.address : '';
    }
    if (!address || !ADDRESS.test(address)) fail('Join a server first or enter an address.');
    const inv = {
      id: crypto.randomBytes(6).toString('hex'), from: me, to: u.uuid, address,
      serverName: cleanText(a.serverName, 40), version: cleanText(a.version || this._raw(me)?.activity?.version, 20),
      created: now(), expires: now() + LIMITS.inviteMs
    };
    this.invites.set(inv.id, inv);
    const c = await this._dm(me, u.uuid);
    await this._post(c, me, '', { kind: 'invite', extra: { id: inv.id, address, serverName: inv.serverName, version: inv.version, expires: inv.expires } });
    this.emit(u.uuid, 'invite', this._invitePub(inv));
    return { invite: this._invitePub(inv) };
  },

  async 'invite.respond'(me, a) {
    const inv = this.invites.get(String(a.id || ''));
    if (!inv || inv.to !== me) fail('This invite has expired.');
    if (inv.expires < now()) { this.invites.delete(inv.id); fail('This invite has expired.'); }
    this.invites.delete(inv.id);
    this.emit(inv.from, 'inviteAnswer', { id: inv.id, from: this._pub(me), accept: Boolean(a.accept) });
    return { address: inv.address, version: inv.version, accept: Boolean(a.accept) };
  },

  async 'join.ask'(me, a) {
    const u = this._user(a, 'to');
    if (!this.isFriend(me, u.uuid)) fail('You can only ask friends.');
    if (!this.allowed(u.uuid, me, u.settings.privacy.joinRequests)) fail('{0} does not accept join requests from you.'.replace('{0}', u.name));
    if (!this._raw(u.uuid)?.activity) fail('{0} is not playing right now.'.replace('{0}', u.name));
    this.emit(u.uuid, 'joinRequest', this._pub(me));
    return {};
  },

  async 'join.check'(me, a) {
    const u = this._user(a);
    const p = this.presence(u.uuid, me);
    if (!p.activity?.joinable) fail('You cannot join {0} right now.'.replace('{0}', u.name));
    return { address: p.activity.address, version: p.activity.version, serverName: p.activity.serverName };
  },

  async 'player.lookup'(me, a) {
    const name = cleanText(a.name, 16).toLowerCase();
    const uuid = this.byName.get(name);
    if (!uuid) return { found: false };
    return { found: true, ...this._pub(uuid), friend: this.isFriend(me, uuid), blocked: this.hasBlocked(me, uuid) };
  }
};

Object.assign(OPS, {
  async 'cosmetics.set'(me, a) {
    const sel = await this._auswahlPruefen(me, cosmetics.cleanSelection(a));
    const row = await this.db.get('SELECT image_hash FROM cosmetics WHERE uuid = ?', [me]);
    if (sel.cape === 'custom' && !row?.image_hash) sel.cape = '';
    await this.db.run(`INSERT INTO cosmetics (uuid, data, updated) VALUES (?, ?, ?)
      ON CONFLICT (uuid) DO UPDATE SET data = excluded.data, updated = excluded.updated`, [me, JSON.stringify(sel), now()]);
    return { cosmetics: sel };
  },

  async 'cosmetics.image'(me, a) {
    const row = await this.db.get('SELECT image_banned FROM cosmetics WHERE uuid = ?', [me]);
    if (row?.image_banned) fail('You cannot upload cape pictures any more.');
    const last = this.lastImageUpload.get(me) || 0;
    if (now() - last < cosmetics.LIMITS.uploadEveryMs) fail('Please wait a moment before uploading another picture.');
    const buf = cosmetics.checkImage(a.image, fail);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
    this.lastImageUpload.set(me, now());
    await this.db.run(`INSERT INTO cosmetics (uuid, image, image_hash, updated) VALUES (?, ?, ?, ?)
      ON CONFLICT (uuid) DO UPDATE SET image = excluded.image, image_hash = excluded.image_hash, updated = excluded.updated`,
    [me, buf.toString('base64'), hash, now()]);
    this.log(`cosmetics: ${this.users.get(me)?.name} uploaded cape picture ${hash}`);
    return { hash };
  },

  async 'cosmetics.get'(me, a) {
    const ids = [...new Set((Array.isArray(a.uuids) ? a.uuids : []).map(x => String(x).replace(/-/g, '').toLowerCase()))]
      .filter(x => /^[0-9a-f]{32}$/.test(x)).slice(0, cosmetics.LIMITS.getMax);
    const players = {};
    for (const uuid of ids) {
      const row = await this.db.get('SELECT data, image_hash, image_banned FROM cosmetics WHERE uuid = ?', [uuid]);
      if (!row) {
        if (this.users.has(uuid)) players[uuid] = { ...cosmetics.cleanSelection({}), image: null, badge: this._abzeichen(uuid) };
        continue;
      }
      const sel = cosmetics.cleanSelection(safeJson(row.data, {}));
      const zeigeBild = row.image_hash && !row.image_banned && !this.hasBlocked(me, uuid) && !this.hasBlocked(uuid, me);
      if (sel.cape === 'custom' && !zeigeBild) sel.cape = '';
      players[uuid] = { ...sel, image: sel.cape === 'custom' ? row.image_hash : null, badge: this._abzeichen(uuid) };
    }
    return { players };
  },

  async 'cosmetics.imageGet'(me, a) {
    const hash = String(a.hash || '');
    if (!/^[0-9a-f]{32}$/.test(hash)) fail('Picture not found.');
    const row = await this.db.get('SELECT uuid, image, image_banned FROM cosmetics WHERE image_hash = ?', [hash]);
    if (!row || row.image_banned || !row.image || this.hasBlocked(me, row.uuid) || this.hasBlocked(row.uuid, me)) fail('Picture not found.');
    return { hash, image: row.image };
  },

  async 'cosmetics.report'(me, a) {
    const target = String(a.uuid || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(target) || target === me) fail('Player not found.');
    const row = await this.db.get('SELECT image_hash FROM cosmetics WHERE uuid = ?', [target]);
    if (!row?.image_hash) fail('This player has no cape picture.');
    await this.db.run(`INSERT INTO cosmetic_reports (reporter, target, image_hash, created) VALUES (?, ?, ?, ?)
      ON CONFLICT (reporter, target) DO UPDATE SET image_hash = excluded.image_hash, created = excluded.created`, [me, target, row.image_hash, now()]);
    this.log(`cosmetics: ${this.users.get(me)?.name} reported the cape picture of ${this.users.get(target)?.name || target}`);
    return { reported: true };
  },

  async 'cosmetics.reports'(me) {
    this._cosmeticAdmin(me);
    const rows = await this.db.all(`SELECT target, image_hash, COUNT(*) AS n, MAX(created) AS created FROM cosmetic_reports
      GROUP BY target, image_hash ORDER BY n DESC LIMIT 100`);
    return { reports: rows.map(r => ({ uuid: r.target, name: this.users.get(r.target)?.name || '', hash: r.image_hash, count: Number(r.n), last: Number(r.created) })) };
  },

  async 'cosmetics.moderate'(me, a) {
    this._cosmeticAdmin(me);
    const target = String(a.uuid || '').replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(target)) fail('Player not found.');
    const ban = a.action === 'ban' ? 1 : a.action === 'unban' ? 0 : null;
    if (a.action === 'remove' || ban === 1) {
      await this.db.run("UPDATE cosmetics SET image = '', image_hash = '' WHERE uuid = ?", [target]);
      await this.db.run('DELETE FROM cosmetic_reports WHERE target = ?', [target]);
    }
    if (ban !== null) await this.db.run('UPDATE cosmetics SET image_banned = ? WHERE uuid = ?', [ban, target]);
    else if (a.action !== 'remove') fail('Unknown action.');
    this.log(`cosmetics: ${this.users.get(me)?.name} -> ${a.action} for ${this.users.get(target)?.name || target}`);
    return { done: true };
  }
});

Object.assign(OPS, {
  async 'music.set'(me, a) {
    const t = music.cleanTrack(a.track);
    if (!t) { this.music.delete(me); return { sharing: false }; }
    const last = this.lastMusicSet.get(me) || 0;
    const prev = this.music.get(me);
    if (now() - last < music.LIMITS.setEveryMs && prev && prev.track.id === t.id && prev.track.title === t.title && prev.track.playing === t.playing) return { sharing: true };
    this.lastMusicSet.set(me, now());
    this.music.set(me, { track: t, at: now(), friendsOnly: a.visibility === 'friends' });
    return { sharing: true };
  },

  async 'music.clear'(me) {
    this.music.delete(me);
    return { sharing: false };
  },

  async 'music.get'(me, a) {
    const ids = [...new Set((Array.isArray(a.uuids) ? a.uuids : []).map(x => String(x).replace(/-/g, '').toLowerCase()))]
      .filter(x => /^[0-9a-f]{32}$/.test(x)).slice(0, music.LIMITS.getMax);
    const players = {};
    const t = now();
    for (const uuid of ids) {
      const e = this.music.get(uuid);
      if (!e) continue;
      if (t - e.at > music.LIMITS.ttlMs) { this.music.delete(uuid); continue; }
      if (this.hasBlocked(me, uuid) || this.hasBlocked(uuid, me)) continue;
      if (e.friendsOnly && uuid !== me && !this.isFriend(uuid, me)) continue;
      players[uuid] = { ...e.track, ageMs: t - e.at };
    }
    return { players };
  },

  async 'emote.play'(me, a, conn) {
    const emote = String(a.emote || '');
    if (!music.EMOTE.test(emote)) fail('Unknown emote.');
    const last = this.lastEmote.get(me) || 0;
    if (now() - last < music.LIMITS.emoteEveryMs) return { sent: 0 };
    this.lastEmote.set(me, now());
    const address = conn?.activity?.mode === 'server' ? conn.activity.address : '';
    if (!address) return { sent: 0 };
    let sent = 0;
    for (const [uuid, set] of this.conns) {
      if (uuid === me || this.hasBlocked(uuid, me) || this.hasBlocked(me, uuid)) continue;
      for (const c of set) {
        if (c.kind !== 'game' || c.activity?.mode !== 'server' || c.activity.address !== address) continue;
        try { c.send({ t: 'ev', ev: 'emote', data: { uuid: me, emote } }); sent++; } catch (_) {}
      }
    }
    return { sent };
  }
});

Hub.prototype._cosmeticAdmin = function (me) {
  if (!this.cosmeticAdmins.has(String(this.users.get(me)?.name || '').toLowerCase())) fail('Only cosmetics admins can do that.');
};

Hub.prototype._checkGroupAdd = function (me, uuid) {
  const u = this.users.get(uuid);
  if (!u) fail('Player not found.');
  if (!this.isFriend(me, uuid)) fail('You can only add friends.');
  if (!this.allowed(uuid, me, u.settings.privacy.groups)) fail('{0} cannot be added to groups by you.'.replace('{0}', u.name));
};

Hub.prototype._broadcastUpdate = async function (convId, id, me) {
  const row = await this.db.get('SELECT * FROM messages WHERE id = ?', [id]);
  const c = this.convs.get(convId);
  if (c) for (const member of c.members.keys()) this.emit(member, 'messageUpdate', { conv: convId, message: this._msgPub(row, member) });
  return this._msgPub(row, me);
};

for (const teil of [require('./shop'), require('./creators'), require('./admin')]) {
  const t = teil.factory({ fail, cleanText });
  Object.assign(Hub.prototype, t.methods);
  Object.assign(OPS, t.OPS);
}

module.exports = { Hub, UserError, mergeSettings, DEFAULTS, SCHEMA, LIMITS };
