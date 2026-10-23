'use strict';
/**
 * Vortex Creator Program (seit Friends-Server 1.2).
 *
 * STATUS     none (nie beworben) -> pending -> accepted | rejected; accepted -> suspended -> accepted.
 *            Beworben wird auf Discord; "creator.apply" merkt nur, dass jemand sich beworben hat
 *            (pending). Alles weitere entscheiden Admins (admin.js) -- der Client kann seinen
 *            Status nie selbst setzen.
 * CODE       Jeder akzeptierte Creator kann einen Code bekommen (A-Z, 0-9, _; 3-16 Zeichen),
 *            eindeutig (eindeutiger Index in der Datenbank, gross geschrieben gespeichert).
 * UNTERSTUETZEN Ein Spieler gibt einmal einen Code an ("Support a creator"). Bei jedem seiner
 *            Kaeufe bekommt der Creator einen Anteil, den der Server bezahlt -- dem Kaeufer kostet
 *            es nichts, es gibt also nichts zu missbrauchen. Den eigenen Code kann man nicht
 *            unterstuetzen; wechseln geht erst nach einer Wartezeit (supportCooldownDays).
 * ABZEICHEN  [CREATOR] fuer akzeptierte Creator, [V] fuer alle anderen Vortex-Spieler.
 */
const DISCORD = 'https://discord.gg/EQYZTRRp6J';
const STATUS = ['none', 'pending', 'accepted', 'rejected', 'suspended'];
const CODE = /^[A-Z0-9_]{3,16}$/;
const LIMITS = { bio: 200, note: 120 };

const now = () => Date.now();

function factory({ fail, cleanText }) {
  const methods = {
    async _creatorsLaden() {
      this.creators = new Map();
      this.unterstuetzt = new Map();
      for (const r of await this.db.all('SELECT * FROM creators')) this.creators.set(r.uuid, this._creatorAusZeile(r));
      for (const r of await this.db.all('SELECT * FROM creator_support')) this.unterstuetzt.set(r.uuid, { creator: r.creator, code: r.code, since: Number(r.since) });
    },

    _creatorAusZeile(r) {
      return {
        uuid: r.uuid, status: STATUS.includes(r.status) ? r.status : 'none', code: r.code || '', codeActive: Boolean(r.code_active),
        bio: r.bio || '', note: r.note || '', applied: Number(r.applied) || 0, accepted: Number(r.accepted) || 0, updated: Number(r.updated) || 0
      };
    },

    async _creatorSpeichern(c) {
      await this.db.run(`INSERT INTO creators (uuid, status, code, code_active, bio, note, applied, accepted, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET status = excluded.status, code = excluded.code,
        code_active = excluded.code_active, bio = excluded.bio, note = excluded.note, applied = excluded.applied,
        accepted = excluded.accepted, updated = excluded.updated`,
      [c.uuid, c.status, c.code, c.codeActive ? 1 : 0, c.bio, c.note, c.applied, c.accepted, now()]);
      this.creators.set(c.uuid, c);
    },

    _istCreator(uuid) { return this.creators?.get(uuid)?.status === 'accepted'; },

    /** Abzeichen fuer die Namensanzeige: 'creator' oder 'vortex'. */
    _abzeichen(uuid) { return this._istCreator(uuid) ? 'creator' : 'vortex'; },

    /** Code saeubern: gross, nur A-Z 0-9 _. */
    _codeSauber(v) {
      const c = String(v || '').trim().toUpperCase();
      if (!CODE.test(c)) fail('A creator code has 3 to 16 letters, numbers or _.');
      return c;
    },

    /** Gehoert der Code schon jemand anderem? */
    _codeFrei(code, fuer) {
      for (const c of this.creators.values()) if (c.code === code && c.uuid !== fuer) return false;
      return true;
    },

    _creatorVonCode(code) {
      const c = String(code || '').trim().toUpperCase();
      if (!c) return null;
      for (const x of this.creators.values()) if (x.code === c) return x;
      return null;
    },

    _unterstuetzer(creatorUuid) {
      let n = 0;
      for (const s of this.unterstuetzt.values()) if (s.creator === creatorUuid) n++;
      return n;
    },

    /** Oeffentliches Creator-Profil (nur akzeptierte Creator haben eins). */
    async _creatorProfil(uuid) {
      const c = this.creators.get(uuid);
      const u = this.users.get(uuid);
      if (!c || c.status !== 'accepted' || !u) return null;
      const row = await this.db.get('SELECT data FROM cosmetics WHERE uuid = ?', [uuid]);
      let sel = {};
      try { sel = JSON.parse(row?.data || '{}') || {}; } catch (_) {}
      const items = [...this.shop.values()].filter(it => it.creatorOnly && !it.deleted).map(it => ({ id: it.id, name: it.name, cat: it.cat }));
      return {
        uuid, name: u.name, code: c.codeActive ? c.code : '', bio: c.bio, since: c.accepted, badge: 'creator',
        supporters: this._unterstuetzer(uuid), creatorItems: items, wearing: [...this._itemsDerAuswahl(sel)].map(id => ({ id, name: this.shop.get(id)?.name || id }))
      };
    }
  };

  const OPS = {
    async 'creator.me'(me) {
      const c = this.creators.get(me);
      const s = this.unterstuetzt.get(me);
      const warten = this.einstellungen.supportCooldownDays * 86400000;
      return {
        status: c ? c.status : 'none', code: c?.code || '', codeActive: Boolean(c?.codeActive), bio: c?.bio || '',
        applied: c?.applied || 0, accepted: c?.accepted || 0, supporters: c ? this._unterstuetzer(me) : 0,
        supporting: s ? { code: s.code, name: this._pub(s.creator).name, since: s.since, changeAt: s.since + warten } : null,
        rewardPercent: this.einstellungen.creatorRewardPercent, cooldownDays: this.einstellungen.supportCooldownDays,
        discord: DISCORD, badge: this._abzeichen(me),
        profile: c?.status === 'accepted' ? await this._creatorProfil(me) : null
      };
    },

    async 'creator.apply'(me, a) {
      const c = this.creators.get(me);
      if (c && ['pending', 'accepted', 'suspended'].includes(c.status)) fail(c.status === 'pending' ? 'Your application is already being reviewed.' : 'You are already part of the creator program.');
      const neu = c ? { ...c } : { uuid: me, status: 'none', code: '', codeActive: true, bio: '', note: '', applied: 0, accepted: 0 };
      neu.status = 'pending';
      neu.applied = now();
      neu.note = cleanText(a.discord, LIMITS.note);
      await this._creatorSpeichern(neu);
      this.log(`creators: ${this._pub(me).name} applied`);
      return { status: 'pending', discord: DISCORD };
    },

    async 'creator.edit'(me, a) {
      const c = this.creators.get(me);
      if (!c || c.status !== 'accepted') fail('Only accepted creators have a profile.');
      await this._creatorSpeichern({ ...c, bio: cleanText(a.bio, LIMITS.bio) });
      return { bio: this.creators.get(me).bio };
    },

    async 'creator.list'() {
      const out = [];
      for (const c of this.creators.values()) {
        if (c.status !== 'accepted') continue;
        out.push({ uuid: c.uuid, name: this._pub(c.uuid).name, code: c.codeActive ? c.code : '', bio: c.bio, since: c.accepted, supporters: this._unterstuetzer(c.uuid) });
      }
      out.sort((x, y) => y.supporters - x.supporters || x.name.localeCompare(y.name));
      return { creators: out };
    },

    async 'creator.profile'(me, a) {
      const name = cleanText(a.name, 16).toLowerCase();
      const uuid = /^[0-9a-f]{32}$/.test(String(a.uuid || '')) ? String(a.uuid) : this.byName.get(name);
      const p = uuid ? await this._creatorProfil(uuid) : null;
      if (!p) fail('This player is not a Vortex Creator.');
      return p;
    },

    async 'creator.support'(me, a) {
      const code = String(a.code || '').trim();
      const alt = this.unterstuetzt.get(me);
      const warten = this.einstellungen.supportCooldownDays * 86400000;
      if (!code) {
        if (!alt) return { supporting: null };
        await this.db.run('DELETE FROM creator_support WHERE uuid = ?', [me]);
        this.unterstuetzt.delete(me);
        return { supporting: null };
      }
      const c = this._creatorVonCode(code);
      if (!c || c.status !== 'accepted' || !c.codeActive) fail('This creator code does not exist.');
      if (c.uuid === me) fail('You cannot support your own code.');
      if (alt && alt.creator === c.uuid) return { supporting: { code: c.code, name: this._pub(c.uuid).name, since: alt.since, changeAt: alt.since + warten } };
      if (alt && now() < alt.since + warten) {
        const tage = Math.ceil((alt.since + warten - now()) / 86400000);
        fail(`You can change your creator code again in ${tage} day${tage === 1 ? '' : 's'}.`);
      }
      const s = { creator: c.uuid, code: c.code, since: now() };
      await this.db.run(`INSERT INTO creator_support (uuid, creator, code, since) VALUES (?, ?, ?, ?)
        ON CONFLICT (uuid) DO UPDATE SET creator = excluded.creator, code = excluded.code, since = excluded.since`, [me, s.creator, s.code, s.since]);
      this.unterstuetzt.set(me, s);
      this.log(`creators: ${this._pub(me).name} supports ${c.code}`);
      return { supporting: { code: c.code, name: this._pub(c.uuid).name, since: s.since, changeAt: s.since + warten } };
    }
  };

  return { methods, OPS };
}

module.exports = { factory, DISCORD, STATUS, CODE };
