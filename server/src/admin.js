'use strict';
/**
 * Vortex Admin (seit Friends-Server 1.2): alles, was das Admin-Panel im Launcher und das
 * Schnellmenue im Spiel koennen.
 *
 * ZUGRIFF    Jede Anfrage prueft hier auf dem Server, ob die angemeldete UUID Admin ist
 *            (Tabelle shop_admins, gefuellt aus SHOP_ADMINS). Es gibt keinen Code und kein
 *            Passwort im Client; ein ausgeblendeter Knopf schuetzt nichts, diese Pruefung schon.
 * PROTOKOLL  Jede Aenderung landet in admin_log: wer, was, an wem, wann, warum, vorher, nachher.
 *            Ohne Grund wird nichts geaendert. Es gibt keine Anfrage, die das Protokoll aendert
 *            oder loescht.
 * COINS      Gutschriften brauchen eine Anfrage-ID; dieselbe ID bucht nie zweimal.
 */
const crypto = require('crypto');
const { RARITIES, CATS, ITEM_ID, LIMITS: SHOP_LIMITS, EINSTELLUNGEN, PREIS } = require('./shop');
const { STATUS } = require('./creators');

const now = () => Date.now();
const LIMITS = { reason: 200, list: 100, txList: 200, auditList: 200, searchMax: 50 };
const BUYS = "('buy', 'gift_sent')";

function factory({ fail, cleanText }) {
  const methods = {
    /** Grund pruefen (Pflicht fuer jede Aenderung). */
    _grund(a) {
      const r = cleanText(a.reason, LIMITS.reason);
      if (r.length < 3) fail('Please give a reason (at least 3 characters).');
      return r;
    },

    async _audit(admin, action, target, reason, vorher, nachher) {
      const id = `al_${crypto.randomBytes(9).toString('hex')}`;
      const text = v => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 2000);
      await this.db.run('INSERT INTO admin_log (id, admin, action, target, reason, old_value, new_value, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, admin, action, target || '', reason || '', text(vorher), text(nachher), now()]);
      this.log(`admin: ${this._pub(admin).name} ${action} ${target ? this._pub(target).name !== '?' ? this._pub(target).name : target : ''} -- ${reason}`);
    },

    /** Spieler aus uuid oder name; muss Vortex schon benutzt haben. */
    _zielSpieler(a) {
      const roh = cleanText(a.uuid || a.name || a.to, 40);
      const uuid = /^[0-9a-f]{32}$/i.test(roh.replace(/-/g, '')) ? roh.replace(/-/g, '').toLowerCase() : this.byName.get(roh.toLowerCase());
      if (!uuid || !this.users.has(uuid)) fail('Player not found.');
      return uuid;
    },

    _spielerZeile(uuid, w) {
      const u = this.users.get(uuid);
      const c = this.creators.get(uuid);
      return {
        uuid, name: u?.name || '?', created: u?.created || 0, lastSeen: u?.lastSeen || 0, online: this.conns.has(uuid),
        balance: w ? Number(w.balance) : 0, minutes: w ? Number(w.minutes) : 0, earned: w ? Number(w.earned) : 0,
        creator: c ? c.status : 'none', code: c?.code || '', banned: this.bans.has(uuid), admin: this.shopAdmins.has(uuid)
      };
    },

    _itemAdmin(it) { return { ...it }; },

    /** Item aus einer Anfrage zusammensetzen (fehlende Felder vom alten Item). */
    _itemAusAnfrage(a) {
      const id = String(a.id || '').toLowerCase();
      if (!ITEM_ID.test(id)) fail('The item id must look like "cape:my_cape".');
      const cat = id.split(':')[0];
      if (!CATS.includes(cat)) fail(`Unknown category "${cat}".`);
      const alt = this.shop.get(id);
      const wert = (k, d) => (a[k] === undefined ? (alt ? alt[k] : d) : a[k]);
      const price = Math.round(Number(wert('price', PREIS.common)));
      if (!Number.isFinite(price) || price < 0 || price > SHOP_LIMITS.priceMax) fail('Invalid price.');
      const rarity = String(wert('rarity', 'common'));
      if (!RARITIES.includes(rarity)) fail('Invalid rarity.');
      const name = cleanText(wert('name', ''), SHOP_LIMITS.nameMax);
      if (!name) fail('The item needs a name.');
      const zeit = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
      const starts = zeit(wert('starts', 0)), ends = zeit(wert('ends', 0));
      if (starts && ends && ends <= starts) fail('The end must be after the start.');
      return {
        id, cat, name, price, rarity, description: cleanText(wert('description', ''), SHOP_LIMITS.descMax),
        giftable: Boolean(wert('giftable', true)), limited: Boolean(wert('limited', false)), active: Boolean(wert('active', true)),
        featured: Boolean(wert('featured', false)), creatorOnly: Boolean(wert('creatorOnly', false)), starts, ends,
        deleted: false, created: alt?.created || now()
      };
    },

    _allenMelden(ev, data) { for (const uuid of this.conns.keys()) this.emit(uuid, ev, data); },

    async _bansLaden() {
      this.bans = new Map();
      for (const r of await this.db.all('SELECT * FROM bans')) this.bans.set(r.uuid, { reason: r.reason, admin: r.admin, created: Number(r.created) });
    },

    /** Gutschrift/Abzug durch einen Admin (eine ID bucht hoechstens einmal). */
    async _adminCoins(me, ziel, betrag, grund, anfrage) {
      if (!Number.isFinite(betrag) || !betrag || Math.abs(betrag) > SHOP_LIMITS.grantMax) fail('Invalid amount.');
      const txId = /^[A-Za-z0-9_-]{8,64}$/.test(String(anfrage || '')) ? `adm_${me.slice(0, 8)}_${anfrage}` : null;
      if (!txId) fail('Missing request id.');
      return this._shopSperre(ziel, async () => {
        const w = await this._konto(ziel);
        if (await this.db.get('SELECT id FROM coin_tx WHERE id = ?', [txId])) return { balance: Number(w.balance), duplicate: true };
        const vorher = Number(w.balance);
        if (!(await this._tx(ziel, betrag > 0 ? 'admin' : 'admin_remove', betrag, '', me, txId))) return { balance: vorher, duplicate: true };
        if (betrag < 0) {
          if (!(await this._abbuchen(ziel, -betrag))) {
            await this.db.run('DELETE FROM coin_tx WHERE id = ?', [txId]);
            fail('The player does not have that many coins.');
          }
        } else await this._gutschrift(ziel, betrag);
        const nach = Number((await this.db.get('SELECT balance FROM wallets WHERE uuid = ?', [ziel])).balance);
        await this._audit(me, betrag > 0 ? 'coins_add' : 'coins_remove', ziel, grund, { balance: vorher }, { balance: nach, amount: betrag });
        await this._shopMelden(ziel);
        return { balance: nach };
      });
    }
  };

  const OPS = {
    /* ------------------------------------------------------------ Uebersicht */

    async 'admin.overview'(me) {
      this._shopAdmin(me);
      const woche = now() - 7 * 86400000;
      let neue = 0;
      for (const u of this.users.values()) if (u.created >= woche) neue++;
      const items = [...this.shop.values()].filter(it => !it.deleted);
      const zahl = async (sql, p = []) => Number((await this.db.get(sql, p))?.n) || 0;
      const verkauft = await zahl(`SELECT COUNT(*) AS n FROM coin_tx WHERE kind IN ${BUYS}`);
      const ausgegeben = await zahl(`SELECT COALESCE(SUM(-amount), 0) AS n FROM coin_tx WHERE kind IN ${BUYS}`);
      const verdient = await zahl('SELECT COALESCE(SUM(earned), 0) AS n FROM wallets');
      let creator = 0, offen = 0;
      for (const c of this.creators.values()) { if (c.status === 'accepted') creator++; if (c.status === 'pending') offen++; }
      return {
        players: this.users.size, online: this.conns.size, newPlayers: neue, cosmetics: items.length,
        pets: items.filter(it => it.cat === 'pet').length, creators: creator, pendingApplications: offen,
        sales: verkauft, coinsEarned: verdient, coinsSpent: ausgegeben, banned: this.bans.size,
        messages: (this.logPuffer || []).slice(-40).reverse(), admins: [...this.shopAdmins].map(u => this._pub(u))
      };
    },

    /* ------------------------------------------------------------ Spieler */

    async 'admin.players'(me, a) {
      this._shopAdmin(me);
      const q = cleanText(a.q, 40).toLowerCase().replace(/-/g, '');
      const treffer = [];
      for (const u of this.users.values()) {
        if (q && !u.name.toLowerCase().includes(q) && !u.uuid.startsWith(q)) continue;
        treffer.push(u);
      }
      treffer.sort((x, y) => (this.conns.has(y.uuid) - this.conns.has(x.uuid)) || y.lastSeen - x.lastSeen);
      const out = [];
      for (const u of treffer.slice(0, LIMITS.searchMax)) {
        out.push(this._spielerZeile(u.uuid, await this.db.get('SELECT * FROM wallets WHERE uuid = ?', [u.uuid])));
      }
      return { players: out, total: treffer.length };
    },

    async 'admin.player'(me, a) {
      this._shopAdmin(me);
      const uuid = this._zielSpieler(a);
      const w = await this.db.get('SELECT * FROM wallets WHERE uuid = ?', [uuid]);
      const owned = await this.db.all('SELECT item, source, created FROM owned WHERE uuid = ? ORDER BY created DESC', [uuid]);
      const tx = await this.db.all(`SELECT kind, amount, item, other, created FROM coin_tx WHERE uuid = ? ORDER BY created DESC LIMIT ${LIMITS.txList}`, [uuid]);
      const row = await this.db.get('SELECT data FROM cosmetics WHERE uuid = ?', [uuid]);
      let sel = {};
      try { sel = JSON.parse(row?.data || '{}') || {}; } catch (_) {}
      const c = this.creators.get(uuid);
      const s = this.unterstuetzt.get(uuid);
      return {
        player: this._spielerZeile(uuid, w),
        owned: owned.map(o => ({ id: o.item, name: this.shop.get(o.item)?.name || o.item, source: o.source.startsWith('gift:') ? `gift from ${this._pub(o.source.slice(5)).name}` : o.source, at: Number(o.created) })),
        wearing: [...this._itemsDerAuswahl(sel)].map(id => ({ id, name: this.shop.get(id)?.name || id })),
        creator: c || null, supporting: s ? { code: s.code, name: this._pub(s.creator).name, since: s.since } : null,
        ban: this.bans.get(uuid) || null,
        tx: tx.map(t => ({ kind: t.kind, amount: Number(t.amount), item: t.item, itemName: this.shop.get(t.item)?.name || t.item, other: t.other ? this._pub(t.other).name : '', at: Number(t.created) }))
      };
    },

    async 'admin.coins'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      return this._adminCoins(me, ziel, Math.round(Number(a.amount)), this._grund(a), a.requestId);
    },

    async 'admin.grant'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const grund = this._grund(a);
      const it = this.shop.get(String(a.item || ''));
      if (!it) fail('This item does not exist.');
      await this._konto(ziel);
      const r = await this.db.run('INSERT INTO owned (uuid, item, source, created) VALUES (?, ?, ?, ?) ON CONFLICT (uuid, item) DO NOTHING', [ziel, it.id, `admin:${me}`, now()]);
      if (!r.changes) fail('The player already owns this.');
      await this._tx(ziel, 'admin_grant', 0, it.id, me);
      await this._audit(me, 'item_grant', ziel, grund, null, { item: it.id });
      await this._shopMelden(ziel, { owned: it.id });
      return {};
    },

    async 'admin.revoke'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const grund = this._grund(a);
      const id = String(a.item || '');
      const vorher = await this.db.get('SELECT source FROM owned WHERE uuid = ? AND item = ?', [ziel, id]);
      if (!vorher) fail('The player does not own this.');
      await this.db.run('DELETE FROM owned WHERE uuid = ? AND item = ?', [ziel, id]);
      await this._tx(ziel, 'admin_revoke', 0, id, me);
      await this._auswahlNeuPruefen(ziel);
      await this._audit(me, 'item_revoke', ziel, grund, { item: id, source: vorher.source }, null);
      await this._shopMelden(ziel, { owned: id, itemsChanged: true });
      return {};
    },

    async 'admin.ban'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const grund = this._grund(a);
      if (ziel === me) fail('You cannot ban yourself.');
      if (this.shopAdmins.has(ziel)) fail('Admins cannot be banned here.');
      const b = { reason: grund, admin: me, created: now() };
      await this.db.run('INSERT INTO bans (uuid, reason, admin, created) VALUES (?, ?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET reason = excluded.reason, admin = excluded.admin, created = excluded.created',
        [ziel, b.reason, b.admin, b.created]);
      this.bans.set(ziel, b);
      await this.db.run('DELETE FROM tokens WHERE uuid = ?', [ziel]);
      for (const c of this.conns.get(ziel) || []) { try { c.send({ t: 'error', error: 'This account is banned from Vortex.' }); c.ws?.close(); } catch (_) {} }
      await this._audit(me, 'player_ban', ziel, grund, null, { banned: true });
      return {};
    },

    async 'admin.unban'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const grund = this._grund(a);
      const vorher = this.bans.get(ziel);
      if (!vorher) fail('This player is not banned.');
      await this.db.run('DELETE FROM bans WHERE uuid = ?', [ziel]);
      this.bans.delete(ziel);
      await this._audit(me, 'player_unban', ziel, grund, vorher, null);
      return {};
    },

    /* ------------------------------------------------------------ Creator */

    async 'admin.creators'(me, a) {
      this._shopAdmin(me);
      const status = STATUS.includes(a.status) ? a.status : '';
      const q = cleanText(a.q, 40).toLowerCase();
      const out = [];
      for (const c of this.creators.values()) {
        if (status && c.status !== status) continue;
        const u = this.users.get(c.uuid);
        const name = u?.name || '?';
        if (q && !name.toLowerCase().includes(q) && !c.code.toLowerCase().includes(q) && !c.uuid.startsWith(q)) continue;
        const items = await this.db.all("SELECT item FROM owned WHERE uuid = ? AND source = 'creator'", [c.uuid]);
        out.push({ ...c, name, lastActive: this.conns.has(c.uuid) ? now() : u?.lastSeen || 0, online: this.conns.has(c.uuid),
          supporters: this._unterstuetzer(c.uuid), creatorItems: items.length });
      }
      out.sort((x, y) => (x.status === 'pending' ? -1 : 0) - (y.status === 'pending' ? -1 : 0) || y.updated - x.updated);
      return { creators: out, statuses: STATUS };
    },

    async 'admin.creator.set'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const grund = this._grund(a);
      const alt = this.creators.get(ziel);
      const c = alt ? { ...alt } : { uuid: ziel, status: 'none', code: '', codeActive: true, bio: '', note: '', applied: 0, accepted: 0 };
      if (a.status !== undefined) {
        if (!STATUS.includes(a.status)) fail('Unknown creator status.');
        c.status = a.status;
        if (c.status === 'accepted' && !c.accepted) c.accepted = now();
        if (c.status === 'pending' && !c.applied) c.applied = now();
      }
      if (a.code !== undefined) {
        const code = String(a.code || '').trim() ? this._codeSauber(a.code) : '';
        if (code && !this._codeFrei(code, ziel)) fail('This creator code is already taken.');
        c.code = code;
      }
      if (a.codeActive !== undefined) c.codeActive = Boolean(a.codeActive);
      try {
        await this._creatorSpeichern(c);
      } catch (e) {
        if (/unique|constraint/i.test(e.message)) fail('This creator code is already taken.');
        throw e;
      }
      if (alt?.status === 'accepted' && c.status !== 'accepted') await this._auswahlNeuPruefen(ziel);
      const vorher = alt ? { status: alt.status, code: alt.code, codeActive: alt.codeActive } : { status: 'none' };
      const nachher = { status: c.status, code: c.code, codeActive: c.codeActive };
      const aktion = alt?.status !== c.status ? `creator_${c.status}` : 'creator_code';
      await this._audit(me, aktion, ziel, grund, vorher, nachher);
      this.emit(ziel, 'creator', nachher);
      await this._shopMelden(ziel, { itemsChanged: true });
      return { creator: c };
    },

    /* ------------------------------------------------------------ Items */

    async 'admin.items'(me) {
      this._shopAdmin(me);
      const besitzer = new Map();
      for (const r of await this.db.all('SELECT item, COUNT(*) AS n FROM owned GROUP BY item')) besitzer.set(r.item, Number(r.n));
      return { items: [...this.shop.values()].map(it => ({ ...this._itemAdmin(it), owners: besitzer.get(it.id) || 0 })), rarities: RARITIES, cats: CATS, prices: PREIS };
    },

    async 'admin.item.save'(me, a) {
      this._shopAdmin(me);
      const grund = this._grund(a);
      const it = this._itemAusAnfrage(a);
      const alt = this.shop.get(it.id);
      await this._itemSpeichern(it);
      await this._audit(me, alt ? (alt.price !== it.price ? 'item_price' : 'item_edit') : 'item_create', '', grund, alt || null, it);
      this._allenMelden('shop', { itemsChanged: true });
      return { item: it };
    },

    async 'admin.item.delete'(me, a) {
      this._shopAdmin(me);
      const grund = this._grund(a);
      const it = this.shop.get(String(a.id || ''));
      if (!it) fail('This item is not in the shop.');
      await this._itemSpeichern({ ...it, deleted: true, active: false });
      await this._audit(me, 'item_delete', '', grund, it, { id: it.id, deleted: true });
      this._allenMelden('shop', { itemsChanged: true });
      return {};
    },

    /* ------------------------------------------------------------ Wirtschaft */

    async 'admin.tx'(me, a) {
      this._shopAdmin(me);
      const wo = [], p = [];
      if (a.uuid || a.name) { wo.push('uuid = ?'); p.push(this._zielSpieler(a)); }
      if (a.kind) { wo.push('kind = ?'); p.push(cleanText(a.kind, 20)); }
      if (a.item) { wo.push('item = ?'); p.push(cleanText(a.item, 60)); }
      if (Number(a.before) > 0) { wo.push('created < ?'); p.push(Number(a.before)); }
      const limit = Math.max(1, Math.min(LIMITS.txList, Number(a.limit) || 100));
      const rows = await this.db.all(`SELECT * FROM coin_tx ${wo.length ? 'WHERE ' + wo.join(' AND ') : ''} ORDER BY created DESC LIMIT ${limit}`, p);
      const arten = (await this.db.all('SELECT DISTINCT kind FROM coin_tx')).map(r => r.kind);
      return {
        tx: rows.map(t => ({ id: t.id, uuid: t.uuid, player: this._pub(t.uuid).name, kind: t.kind, amount: Number(t.amount), item: t.item,
          itemName: this.shop.get(t.item)?.name || t.item, other: t.other ? this._pub(t.other).name : '', at: Number(t.created) })),
        kinds: arten
      };
    },

    async 'admin.economy'(me) {
      this._shopAdmin(me);
      const g = async sql => (await this.db.get(sql)) || {};
      const w = await g('SELECT COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(earned), 0) AS earned, COUNT(*) AS total FROM wallets');
      const aus = await g(`SELECT COALESCE(SUM(-amount), 0) AS n FROM coin_tx WHERE kind IN ${BUYS}`);
      const plus = await g("SELECT COALESCE(SUM(amount), 0) AS n FROM coin_tx WHERE kind = 'admin'");
      const minus = await g("SELECT COALESCE(SUM(-amount), 0) AS n FROM coin_tx WHERE kind = 'admin_remove'");
      const start = await g("SELECT COALESCE(SUM(amount), 0) AS n FROM coin_tx WHERE kind = 'starter'");
      const anteil = await g("SELECT COALESCE(SUM(amount), 0) AS n FROM coin_tx WHERE kind = 'creator_reward'");
      const anzahl = await g('SELECT COUNT(*) AS n FROM coin_tx');
      const wallets = Number(w.total) || 0;
      return {
        totalCoins: Number(w.balance) || 0, earned: Number(w.earned) || 0, spent: Number(aus.n) || 0, wallets,
        average: wallets ? Math.round((Number(w.balance) || 0) / wallets) : 0, transactions: Number(anzahl.n) || 0,
        adminAdded: Number(plus.n) || 0, adminRemoved: Number(minus.n) || 0, starter: Number(start.n) || 0, creatorRewards: Number(anteil.n) || 0,
        settings: this.einstellungen
      };
    },

    async 'admin.analytics'(me, a) {
      this._shopAdmin(me);
      const tage = Math.max(7, Math.min(90, Number(a.days) || 30));
      const ab = now() - tage * 86400000;
      const tagVon = t => new Date(t).toISOString().slice(0, 10);
      const reihe = new Map();
      for (let i = tage - 1; i >= 0; i--) reihe.set(tagVon(now() - i * 86400000), { day: tagVon(now() - i * 86400000), newPlayers: 0, activePlayers: 0, minutes: 0, sales: 0, spent: 0 });
      for (const u of this.users.values()) { const d = reihe.get(tagVon(u.created)); if (d) d.newPlayers++; }
      for (const r of await this.db.all('SELECT day, COUNT(*) AS total, COALESCE(SUM(minutes), 0) AS minutes FROM earnings WHERE day >= ? GROUP BY day', [tagVon(ab)])) {
        const d = reihe.get(r.day); if (d) { d.activePlayers = Number(r.total); d.minutes = Number(r.minutes); }
      }
      for (const r of await this.db.all(`SELECT created, amount FROM coin_tx WHERE kind IN ${BUYS} AND created >= ?`, [ab])) {
        const d = reihe.get(tagVon(Number(r.created))); if (d) { d.sales++; d.spent += -Number(r.amount); }
      }
      const top = await this.db.all(`SELECT item, COUNT(*) AS total FROM coin_tx WHERE kind IN ${BUYS} AND created >= ? GROUP BY item ORDER BY total DESC LIMIT 10`, [ab]);
      return { days: [...reihe.values()], coinsPerMinute: this.einstellungen.coinsPerMinute,
        topItems: top.map(r => ({ id: r.item, name: this.shop.get(r.item)?.name || r.item, sales: Number(r.total) })) };
    },

    async 'admin.settings'(me) {
      this._shopAdmin(me);
      return { settings: this.einstellungen, limits: EINSTELLUNGEN };
    },

    async 'admin.settings.set'(me, a) {
      this._shopAdmin(me);
      const grund = this._grund(a);
      const vorher = { ...this.einstellungen };
      const werte = a.settings && typeof a.settings === 'object' ? a.settings : {};
      for (const [k, v] of Object.entries(werte)) {
        const d = EINSTELLUNGEN[k];
        const n = Math.round(Number(v));
        if (!d) fail(`Unknown setting "${k}".`);
        if (!Number.isFinite(n) || n < d.min || n > d.max) fail(`${k} must be between ${d.min} and ${d.max}.`);
        this.einstellungen[k] = n;
        await this.db.run('INSERT INTO server_settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [k, String(n)]);
      }
      await this._audit(me, 'settings', '', grund, vorher, this.einstellungen);
      return { settings: this.einstellungen };
    },

    async 'admin.audit'(me, a) {
      this._shopAdmin(me);
      const wo = [], p = [];
      if (a.action) { wo.push('action = ?'); p.push(cleanText(a.action, 40)); }
      if (Number(a.before) > 0) { wo.push('created < ?'); p.push(Number(a.before)); }
      const limit = Math.max(1, Math.min(LIMITS.auditList, Number(a.limit) || 100));
      const q = cleanText(a.q, 40).toLowerCase();
      const rows = await this.db.all(`SELECT * FROM admin_log ${wo.length ? 'WHERE ' + wo.join(' AND ') : ''} ORDER BY created DESC LIMIT ${q ? 1000 : limit}`, p);
      let out = rows.map(r => ({ id: r.id, admin: this._pub(r.admin).name, action: r.action, target: r.target ? this._pub(r.target).name : '',
        targetUuid: r.target, reason: r.reason, before: r.old_value, after: r.new_value, at: Number(r.created) }));
      if (q) out = out.filter(r => `${r.admin} ${r.action} ${r.target} ${r.reason} ${r.before} ${r.after}`.toLowerCase().includes(q)).slice(0, limit);
      const aktionen = (await this.db.all('SELECT DISTINCT action FROM admin_log')).map(r => r.action);
      return { entries: out, actions: aktionen };
    },

    /* ------------------------------------------------------------ Schnellmenue im Spiel (Namen von 1.1) */

    async 'shop.admin.items'(me) {
      this._shopAdmin(me);
      return { items: [...this.shop.values()], rarities: RARITIES, cats: CATS, prices: PREIS };
    },

    async 'shop.admin.save'(me, a) {
      return OPS['admin.item.save'].call(this, me, { reason: 'in-game quick menu', ...a });
    },

    async 'shop.admin.delete'(me, a) {
      return OPS['admin.item.delete'].call(this, me, { reason: 'in-game quick menu', ...a });
    },

    async 'shop.admin.coins'(me, a) {
      this._shopAdmin(me);
      const ziel = this._zielSpieler(a);
      const anfrage = a.requestId || crypto.randomBytes(8).toString('hex');
      return this._adminCoins(me, ziel, Math.round(Number(a.amount)), this._grund({ reason: a.reason || 'in-game quick menu' }), anfrage);
    }
  };

  return { methods, OPS };
}

module.exports = { factory };
