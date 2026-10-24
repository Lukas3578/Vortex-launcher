'use strict';
/**
 * Coins und Cosmetic-Shop (seit Friends-Server 1.1, erweitert in 1.2).
 *
 * COINS      Pro Minute, in der das SPIEL (Vortex Client) verbunden ist und man in einer Welt
 *            spielt (Einzelspieler, Server, Realms), gibt es Coins (Standard 1, Einstellung
 *            coinsPerMinute) -- das Hauptmenue zaehlt nicht. Gezaehlt wird hier auf dem Server
 *            je Spieler (nicht je Verbindung): mehrere Fenster oder Neu-Verbinden bringen nichts.
 * SHOP       Alle Cosmetics mit Preis und Seltenheit (Start-Katalog shop-katalog.json; Admins
 *            aendern danach). Gekauft wird atomar: Abzug nur, wenn genug da ist (eine
 *            SQL-Anweisung), Freischaltung nur einmal (Primaerschluessel), und eine Anfrage-ID
 *            verhindert doppelte Kaeufe, wenn der Client nach einem Abbruch noch einmal schickt.
 * ZEITRAUM   Items koennen ab/bis einem Zeitpunkt zu kaufen sein (starts/ends). Wer ein
 *            limitiertes Item hat, behaelt es fuer immer -- auch nach dem Ende.
 * CREATOR    Creator-Items (creatorOnly) koennen nur akzeptierte Creator holen und tragen.
 *            Wer einen Creator-Code unterstuetzt, bringt dem Creator bei jedem Kauf einen
 *            Anteil (creatorRewardPercent) -- bezahlt vom Server, dem Kaeufer kostet es nichts.
 * BESTAND    Wer zum ersten Mal kommt, behaelt alles, was er gerade traegt (Quelle "legacy"),
 *            und bekommt ein Startguthaben.
 * DURCHSETZEN cosmetics.set nimmt nur, was einem gehoert -- alles andere sehen die anderen
 *            Spieler nicht. Unbekannte Cosmetics und Items mit Preis 0 sind frei (ausser
 *            Creator-Items).
 * ADMINS     nur nach UUID (siehe admin.js). SHOP_ADMINS darf Namen oder UUIDs enthalten; Namen
 *            werden einmal bei Mojang nachgeschlagen und die UUID festgehalten.
 */
const crypto = require('crypto');
const KATALOG = require('./shop-katalog.json');

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const PREIS = { common: 50, uncommon: 100, rare: 200, epic: 400, legendary: 800, mythic: 1500 };
const CATS = ['cape', 'back', 'hat', 'aura', 'face', 'neck', 'bandana', 'shield', 'nametag', 'pet', 'trail', 'special'];
const ADMINS_STANDARD = ['Lukas3577', 'M_rc'];
const ITEM_ID = /^[a-z]{2,12}:[a-z0-9_-]{1,40}$/;
const WELT = new Set(['singleplayer', 'server', 'realms']);
const FELD_KAT = { cape: 'cape', hat: 'hat', particles: 'aura', bandana: 'bandana', face: 'face', back: 'back', shield: 'shield', neck: 'neck', nametag: 'nametag', pet: 'pet' };
const LIMITS = { history: 50, days: 30, priceMax: 1000000, grantMax: 100000, nameMax: 40, descMax: 160 };
/** Einstellungen, die Admins aendern koennen (Tabelle server_settings). */
const EINSTELLUNGEN = {
  coinsPerMinute: { standard: 1, min: 0, max: 100 },
  starterCoins: { standard: 150, min: 0, max: 100000 },
  creatorRewardPercent: { standard: 5, min: 0, max: 50 },
  supportCooldownDays: { standard: 7, min: 0, max: 365 }
};
/** Reihenfolge der Ketten und Namens-Effekte im gepackten Face-Feld (wie im Client). */
const NECK_IDS = ['gold_chain', 'silver_chain', 'iced_cuban', 'diamond_pendant', 'vortex_pendant', 'heart_locket', 'pearl_necklace', 'dog_tags',
  'moon_charm', 'skull_chain', 'fire_opal', 'emerald_amulet', 'event_horizon', 'star_charm', 'sun_medallion', 'thunder_bolt'];
const NAMETAG_IDS = ['shaking', 'waving', 'iterating', 'flipping', 'skewing', 'growing', 'gradient', 'rainbow', 'metallic', 'fade', 'shimmer',
  'blinking', 'chromatic', 'fire', 'outline', 'glowing', 'creator'];

const now = () => Date.now();
const tag = t => new Date(t).toISOString().slice(0, 10);
const basis = v => String(v || '').split('--')[0];

function factory({ fail, cleanText }) {
  const methods = {
    /** Beim Start: Katalog laden und ergaenzen, Einstellungen und Admins laden. */
    async _shopLaden(adminListe) {
      this.shop = new Map();
      this.shopAdmins = new Set();
      this.shopOffen = new Map();
      this.shopSperren = new Map();
      this.einstellungen = {};
      for (const [k, d] of Object.entries(EINSTELLUNGEN)) this.einstellungen[k] = d.standard;
      for (const r of await this.db.all('SELECT k, v FROM server_settings')) {
        const d = EINSTELLUNGEN[r.k];
        const n = Number(r.v);
        if (d && Number.isFinite(n)) this.einstellungen[r.k] = Math.max(d.min, Math.min(d.max, n));
      }
      for (const r of await this.db.all('SELECT * FROM shop_items')) this.shop.set(r.id, this._itemAusZeile(r));
      let neu = 0;
      for (const k of KATALOG.items) {
        if (this.shop.has(k.id) || !ITEM_ID.test(k.id)) continue;
        const it = {
          id: k.id, cat: k.cat, name: k.name, price: k.price !== undefined ? k.price : PREIS[k.rarity] || 100, rarity: k.rarity,
          giftable: !k.creatorOnly, limited: false, active: true, deleted: false, description: k.description || '',
          featured: Boolean(k.featured), creatorOnly: Boolean(k.creatorOnly), starts: 0, ends: 0, created: now()
        };
        await this._itemSpeichern(it);
        neu++;
      }
      this.shopAdminWunsch = (adminListe && adminListe.length ? adminListe : ADMINS_STANDARD).map(s => String(s).trim()).filter(Boolean);
      const wunsch = new Set(this.shopAdminWunsch.map(w => w.replace(/-/g, '').toLowerCase()));
      for (const r of await this.db.all('SELECT * FROM shop_admins')) {
        if (wunsch.has(r.uuid) || wunsch.has(String(r.name).toLowerCase())) this.shopAdmins.add(r.uuid);
      }
      this.log(`Shop: ${this.shop.size} item(s)${neu ? ` (${neu} new)` : ''}, ${this.shopAdmins.size} admin(s).`);
    },

    /** Admin-Namen einmal nach UUID aufloesen und festhalten (laeuft im Hintergrund). */
    async _shopAdminsAufloesen(lookup) {
      for (const w of this.shopAdminWunsch || []) {
        try {
          let uuid = null, name = w;
          if (/^[0-9a-f]{32}$/i.test(w.replace(/-/g, ''))) uuid = w.replace(/-/g, '').toLowerCase();
          else {
            const vorhanden = await this.db.get('SELECT uuid FROM shop_admins WHERE LOWER(name) = ?', [w.toLowerCase()]);
            if (vorhanden) { this.shopAdmins.add(vorhanden.uuid); continue; }
            const r = await lookup(w);
            if (!r) { this.log(`Shop: admin "${w}" not found at Mojang.`); continue; }
            uuid = r.uuid; name = r.name;
          }
          await this.db.run('INSERT INTO shop_admins (uuid, name, created) VALUES (?, ?, ?) ON CONFLICT (uuid) DO NOTHING', [uuid, name, now()]);
          this.shopAdmins.add(uuid);
        } catch (e) { this.log(`Shop: admin "${w}": ${e.message}`); }
      }
    },

    _itemAusZeile(r) {
      return {
        id: r.id, cat: r.cat, name: r.name, price: Number(r.price), rarity: r.rarity, giftable: Boolean(r.giftable),
        limited: Boolean(r.limited), active: Boolean(r.active), deleted: Boolean(r.deleted), description: r.description || '',
        featured: Boolean(r.featured), creatorOnly: Boolean(r.creator_only), starts: Number(r.starts) || 0, ends: Number(r.ends) || 0,
        created: Number(r.created) || 0
      };
    },

    async _itemSpeichern(it) {
      await this.db.run(`INSERT INTO shop_items (id, cat, name, price, rarity, giftable, limited, active, deleted, updated,
          description, featured, creator_only, starts, ends, created)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET cat = excluded.cat, name = excluded.name,
        price = excluded.price, rarity = excluded.rarity, giftable = excluded.giftable, limited = excluded.limited, active = excluded.active,
        deleted = excluded.deleted, updated = excluded.updated, description = excluded.description, featured = excluded.featured,
        creator_only = excluded.creator_only, starts = excluded.starts, ends = excluded.ends`,
      [it.id, it.cat, it.name, it.price, it.rarity, it.giftable ? 1 : 0, it.limited ? 1 : 0, it.active ? 1 : 0, it.deleted ? 1 : 0, now(),
        it.description || '', it.featured ? 1 : 0, it.creatorOnly ? 1 : 0, it.starts || 0, it.ends || 0, it.created || now()]);
      this.shop.set(it.id, it);
    },

    _shopAdmin(me) { if (!this.shopAdmins.has(me)) fail('Only Vortex admins can do that.'); },

    /** Nacheinander je Spieler (Kaeufe, Geschenke, Gutschriften). */
    _shopSperre(uuid, fn) {
      const vorher = this.shopSperren.get(uuid) || Promise.resolve();
      const lauf = vorher.catch(() => {}).then(fn);
      const ende = lauf.catch(() => {});
      this.shopSperren.set(uuid, ende);
      ende.then(() => { if (this.shopSperren.get(uuid) === ende) this.shopSperren.delete(uuid); });
      return lauf;
    },

    async _tx(uuid, kind, amount, item = '', other = '', id = null) {
      const txId = id || `tx_${crypto.randomBytes(9).toString('hex')}`;
      const r = await this.db.run('INSERT INTO coin_tx (id, uuid, kind, amount, item, other, created) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
        [txId, uuid, kind, amount, item, other, now()]);
      return r.changes > 0;
    },

    /** Konto holen; beim ersten Mal anlegen: Startguthaben und alles, was man gerade traegt. */
    async _konto(uuid) {
      let w = await this.db.get('SELECT * FROM wallets WHERE uuid = ?', [uuid]);
      if (w) return w;
      const start = this.einstellungen.starterCoins;
      const r = await this.db.run('INSERT INTO wallets (uuid, balance, earned, minutes, created, updated) VALUES (?, ?, 0, 0, ?, ?) ON CONFLICT (uuid) DO NOTHING',
        [uuid, start, now(), now()]);
      if (r.changes > 0) {
        if (start > 0) await this._tx(uuid, 'starter', start);
        const row = await this.db.get('SELECT data FROM cosmetics WHERE uuid = ?', [uuid]);
        let sel = {};
        try { sel = JSON.parse(row?.data || '{}') || {}; } catch (_) {}
        for (const id of this._itemsDerAuswahl(sel)) {
          if (this.shop.get(id)?.creatorOnly) continue;
          await this.db.run('INSERT INTO owned (uuid, item, source, created) VALUES (?, ?, ?, ?) ON CONFLICT (uuid, item) DO NOTHING', [uuid, id, 'legacy', now()]);
        }
      }
      return this.db.get('SELECT * FROM wallets WHERE uuid = ?', [uuid]);
    },

    /** Shop-Items einer Cosmetics-Auswahl (auch Kette/Namens-Effekt aus dem gepackten Face-Feld). */
    _itemsDerAuswahl(sel) {
      const out = new Set();
      for (const [feld, cat] of Object.entries(FELD_KAT)) {
        const v = basis(sel?.[feld]);
        if (v && this.shop.has(`${cat}:${v}`)) out.add(`${cat}:${v}`);
      }
      const face = String(sel?.face || '');
      const i = face.indexOf('--');
      if (i >= 0) {
        for (const m of face.slice(i + 2).matchAll(/([kn])(\d{1,3})/g)) {
          const id = m[1] === 'k' ? NECK_IDS[Number(m[2])] : NAMETAG_IDS[Number(m[2])];
          const cat = m[1] === 'k' ? 'neck' : 'nametag';
          if (id && this.shop.has(`${cat}:${id}`)) out.add(`${cat}:${id}`);
        }
      }
      return out;
    },

    /**
     * Was einem gehoert. Creator-Items, die man als Creator geholt hat (Quelle "creator"),
     * zaehlen nur, solange man Creator ist -- von einem Admin geschenkte bleiben.
     */
    async _besitz(uuid) {
      const out = new Set();
      for (const r of await this.db.all('SELECT item, source FROM owned WHERE uuid = ?', [uuid])) {
        if (r.source === 'creator' && this.shop.get(r.item)?.creatorOnly) continue;
        out.add(r.item);
      }
      return out;
    },

    /** Darf uuid dieses Item tragen? Creator-Items nur Creator, sonst frei bei Preis 0 oder Besitz. */
    _darf(uuid, itemId, hat) {
      const it = this.shop.get(itemId);
      if (!it) return true;
      if (it.creatorOnly) return hat.has(itemId) || this._istCreator(uuid);
      return it.price <= 0 || hat.has(itemId);
    },

    /** Auswahl auf das beschraenken, was einem gehoert (fuer cosmetics.set). */
    async _auswahlPruefen(uuid, sel) {
      await this._konto(uuid);
      const hat = await this._besitz(uuid);
      const darf = id => this._darf(uuid, id, hat);
      const out = { ...sel };
      for (const [feld, cat] of Object.entries(FELD_KAT)) {
        const v = basis(out[feld]);
        if (!v || feld === 'face') continue;
        if (!darf(`${cat}:${v}`)) out[feld] = '';
      }
      const face = String(out.face || '');
      const i = face.indexOf('--');
      const fb = i >= 0 ? face.slice(0, i) : face;
      if (fb && !darf(`face:${fb}`)) {
        out.face = '';
      } else if (i >= 0) {
        const rest = face.slice(i + 2).replace(/([kn])(\d{1,3})/g, (m, k, n) => {
          const id = k === 'k' ? NECK_IDS[Number(n)] : NAMETAG_IDS[Number(n)];
          return id && !darf(`${k === 'k' ? 'neck' : 'nametag'}:${id}`) ? '' : m;
        });
        out.face = rest ? `${fb}--${rest}` : fb;
      }
      return out;
    },

    /** Gespeicherte Auswahl neu pruefen und speichern (nach Entzug eines Items oder Creator-Status). */
    async _auswahlNeuPruefen(uuid) {
      const row = await this.db.get('SELECT data FROM cosmetics WHERE uuid = ?', [uuid]);
      if (!row) return;
      let sel = {};
      try { sel = JSON.parse(row.data || '{}') || {}; } catch (_) {}
      const neu = await this._auswahlPruefen(uuid, sel);
      if (JSON.stringify(neu) !== JSON.stringify(sel)) {
        await this.db.run('UPDATE cosmetics SET data = ?, updated = ? WHERE uuid = ?', [JSON.stringify(neu), now(), uuid]);
      }
    },

    /** Ist das Item gerade zu haben (im Verkauf und im Zeitraum)? */
    _imZeitraum(it, t = now()) {
      return (!it.starts || t >= it.starts) && (!it.ends || t < it.ends);
    },

    _itemPub(it, hat, uuid) {
      return {
        id: it.id, cat: it.cat, key: it.id.slice(it.cat.length + 1), name: it.name, price: it.price, rarity: it.rarity,
        giftable: it.giftable && !it.creatorOnly, limited: it.limited, forSale: it.active && !it.deleted && this._imZeitraum(it),
        owned: hat.has(it.id) || (!it.creatorOnly && it.price <= 0) || (it.creatorOnly && this._istCreator(uuid)),
        description: it.description || '', featured: it.featured, creatorOnly: it.creatorOnly, starts: it.starts, ends: it.ends,
        created: it.created
      };
    },

    async _shopStand(me) {
      const w = await this._konto(me);
      const hat = await this._besitz(me);
      const items = [...this.shop.values()].filter(it => !it.deleted || hat.has(it.id)).map(it => this._itemPub(it, hat, me));
      const c = this.creators?.get(me);
      return {
        enabled: true, balance: Number(w.balance), earned: Number(w.earned), minutes: Number(w.minutes), admin: this.shopAdmins.has(me),
        creator: this._istCreator(me), creatorStatus: c ? c.status : 'none', supporting: this.unterstuetzt?.get(me)?.code || '',
        coinsPerMinute: this.einstellungen.coinsPerMinute, rarities: RARITIES, cats: CATS, items
      };
    },

    async _shopMelden(uuid, extra = {}) {
      const w = await this.db.get('SELECT balance, earned, minutes FROM wallets WHERE uuid = ?', [uuid]);
      if (w) this.emit(uuid, 'shop', { balance: Number(w.balance), earned: Number(w.earned), minutes: Number(w.minutes), ...extra });
    },

    /**
     * Spielzeit zaehlen (server.js ruft das alle `sek` Sekunden auf). Pro Spieler EIN Zaehler,
     * egal wie viele Verbindungen; nur, wer in einer Welt spielt.
     */
    async shopTick(sek = 15) {
      const proMinute = this.einstellungen.coinsPerMinute;
      for (const [uuid, set] of this.conns) {
        const spielt = [...set].some(c => c.kind === 'game' && c.activity && WELT.has(c.activity.mode));
        if (!spielt) continue;
        const offen = (this.shopOffen.get(uuid) || 0) + sek;
        if (offen < 60) { this.shopOffen.set(uuid, offen); continue; }
        this.shopOffen.set(uuid, offen - 60);
        await this._shopSperre(uuid, async () => {
          await this._konto(uuid);
          await this.db.run('UPDATE wallets SET balance = balance + ?, earned = earned + ?, minutes = minutes + 1, updated = ? WHERE uuid = ?', [proMinute, proMinute, now(), uuid]);
          await this.db.run('INSERT INTO earnings (uuid, day, minutes) VALUES (?, ?, 1) ON CONFLICT (uuid, day) DO UPDATE SET minutes = earnings.minutes + 1', [uuid, tag(now())]);
        }).catch(e => this.log(`Shop tick: ${e.message}`));
        await this._shopMelden(uuid).catch(() => {});
      }
      for (const uuid of this.shopOffen.keys()) if (!this.conns.has(uuid)) this.shopOffen.delete(uuid);
    },

    _anfrageId(me, a) {
      const r = String(a.requestId || '');
      return /^[A-Za-z0-9_-]{8,64}$/.test(r) ? `tx_${me.slice(0, 12)}_${r}` : null;
    },

    /** Coins abziehen -- nur wenn genug da ist (eine Anweisung, also atomar). */
    async _abbuchen(uuid, preis) {
      if (preis <= 0) return true;
      const r = await this.db.run('UPDATE wallets SET balance = balance - ?, updated = ? WHERE uuid = ? AND balance >= ?', [preis, now(), uuid, preis]);
      return r.changes > 0;
    },

    async _gutschrift(uuid, betrag) {
      await this.db.run('UPDATE wallets SET balance = balance + ?, updated = ? WHERE uuid = ?', [betrag, now(), uuid]);
    },

    /** Kaufbar fuer `me`? (Im Shop, im Verkauf, im Zeitraum, Creator-Items nur fuer Creator.) */
    async _kaufbar(id, me) {
      const it = this.shop.get(String(id || ''));
      if (!it || it.deleted) fail('This item is not in the shop.');
      if (!it.active) fail('This item is not for sale right now.');
      if (it.starts && now() < it.starts) fail('This item is not available yet.');
      if (it.ends && now() >= it.ends) fail('This item is no longer available.');
      if (it.creatorOnly && !this._istCreator(me)) fail('Only Vortex Creators can get this item.');
      return it;
    },

    /** Anteil fuer den unterstuetzten Creator (vom Server bezahlt, einmal je Kauf). */
    async _creatorAnteil(kaeufer, preis, txId) {
      const s = this.unterstuetzt?.get(kaeufer);
      if (!s || s.creator === kaeufer || !this._istCreator(s.creator) || !this.creators.get(s.creator)?.codeActive) return;
      const anteil = Math.floor(preis * this.einstellungen.creatorRewardPercent / 100);
      if (anteil <= 0) return;
      await this._shopSperre(s.creator, async () => {
        await this._konto(s.creator);
        const neu = await this._tx(s.creator, 'creator_reward', anteil, '', kaeufer, txId ? `${txId}_cr` : null);
        if (neu) await this._gutschrift(s.creator, anteil);
      });
      await this._shopMelden(s.creator).catch(() => {});
    }
  };

  const OPS = {
    async 'shop.state'(me) { return this._shopStand(me); },

    async 'shop.history'(me) {
      await this._konto(me);
      const tx = await this.db.all(`SELECT kind, amount, item, other, created FROM coin_tx WHERE uuid = ? ORDER BY created DESC LIMIT ${LIMITS.history}`, [me]);
      const days = await this.db.all(`SELECT day, minutes FROM earnings WHERE uuid = ? ORDER BY day DESC LIMIT ${LIMITS.days}`, [me]);
      return {
        tx: tx.map(t => ({ kind: t.kind, amount: Number(t.amount), item: t.item, itemName: this.shop.get(t.item)?.name || t.item,
          other: t.other ? this._pub(t.other).name : '', at: Number(t.created) })),
        days: days.map(d => ({ day: d.day, minutes: Number(d.minutes), coins: Number(d.minutes) * this.einstellungen.coinsPerMinute }))
      };
    },

    async 'shop.buy'(me, a) {
      const it = await this._kaufbar(a.item, me);
      const txId = this._anfrageId(me, a);
      return this._shopSperre(me, async () => {
        await this._konto(me);
        if (txId && await this.db.get('SELECT id FROM coin_tx WHERE id = ?', [txId])) return this._shopStand(me);
        const hat = await this._besitz(me);
        if (hat.has(it.id) || (it.price <= 0 && !it.creatorOnly)) fail('You already own this.');
        if (!(await this._abbuchen(me, it.price))) fail('Not enough coins.');
        const quelle = it.creatorOnly ? 'creator' : 'buy';
        const r = await this.db.run('INSERT INTO owned (uuid, item, source, created) VALUES (?, ?, ?, ?) ON CONFLICT (uuid, item) DO NOTHING', [me, it.id, quelle, now()]);
        if (!r.changes) { await this._gutschrift(me, it.price); fail('You already own this.'); }
        await this._tx(me, it.creatorOnly && it.price <= 0 ? 'claim' : 'buy', -it.price, it.id, '', txId);
        this.log(`shop: ${this._pub(me).name} bought ${it.id} for ${it.price}`);
        if (it.price > 0) await this._creatorAnteil(me, it.price, txId);
        await this._shopMelden(me, { owned: it.id });
        return this._shopStand(me);
      });
    },

    async 'shop.gift'(me, a) {
      const it = await this._kaufbar(a.item, me);
      if (!it.giftable || it.creatorOnly) fail('This item cannot be gifted.');
      const zielName = cleanText(a.to, 16);
      const ziel = /^[0-9a-f]{32}$/i.test(zielName) ? zielName.toLowerCase() : this.byName.get(zielName.toLowerCase());
      if (!ziel || !this.users.has(ziel)) fail('This player has never used Vortex.');
      if (ziel === me) fail('You cannot gift yourself.');
      if (this.hasBlocked(ziel, me)) fail('This player does not accept gifts from you.');
      const txId = this._anfrageId(me, a);
      const [erst, dann] = me < ziel ? [me, ziel] : [ziel, me];
      return this._shopSperre(erst, () => this._shopSperre(dann, async () => {
        await this._konto(me);
        await this._konto(ziel);
        if (txId && await this.db.get('SELECT id FROM coin_tx WHERE id = ?', [txId])) return this._shopStand(me);
        const hat = await this._besitz(ziel);
        if (it.price <= 0 || hat.has(it.id)) fail(`${this._pub(ziel).name} already owns this.`);
        if (!(await this._abbuchen(me, it.price))) fail('Not enough coins.');
        const r = await this.db.run('INSERT INTO owned (uuid, item, source, created) VALUES (?, ?, ?, ?) ON CONFLICT (uuid, item) DO NOTHING', [ziel, it.id, `gift:${me}`, now()]);
        if (!r.changes) { await this._gutschrift(me, it.price); fail(`${this._pub(ziel).name} already owns this.`); }
        await this._tx(me, 'gift_sent', -it.price, it.id, ziel, txId);
        await this._tx(ziel, 'gift_received', 0, it.id, me);
        this.log(`shop: ${this._pub(me).name} gifted ${it.id} to ${this._pub(ziel).name}`);
        await this._shopMelden(me);
        await this._shopMelden(ziel, { owned: it.id, gift: { from: this._pub(me).name, item: it.name } });
        return this._shopStand(me);
      })).then(async st => { await this._creatorAnteil(me, it.price, txId ? `${txId}_g` : null); return st; });
    }
  };

  return { methods, OPS };
}

module.exports = { factory, RARITIES, PREIS, CATS, ITEM_ID, LIMITS, EINSTELLUNGEN, ADMINS_STANDARD, NAMETAG_IDS };
