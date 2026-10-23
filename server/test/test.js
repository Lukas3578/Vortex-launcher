'use strict';
/**
 * Durchlauf aller Funktionen mit einer gefaelschten Mojang-Pruefung.
 *   node test/test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { start } = require('../src/server');

const uuidOf = name => crypto.createHash('md5').update(name).digest('hex');
const fakeJoined = async (name) => (name === 'Nobody' ? null : { uuid: uuidOf(name), name });

class Client {
  constructor(url, name, kind = 'launcher') { this.url = url; this.name = name; this.kind = kind; this.events = []; this.n = 0; this.pending = new Map(); this.waiters = []; }
  async connect(token) {
    this.ws = new WebSocket(this.url);
    await new Promise((r, j) => { this.ws.once('open', r); this.ws.once('error', j); });
    return new Promise((resolve, reject) => {
      this.ws.on('message', raw => {
        const m = JSON.parse(String(raw));
        if (m.t === 'challenge') this.ws.send(JSON.stringify({ t: 'login', name: this.name, serverId: m.serverId }));
        else if (m.t === 'ready') { this.me = m; resolve(m); }
        else if (m.t === 'error') reject(new Error(m.error));
        else if (m.t === 'res') { const p = this.pending.get(m.id); this.pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error)); }
        else if (m.t === 'ev') {
          this.events.push(m);
          if (m.ev === 'state') this.state = m.data;
          this.waiters = this.waiters.filter(w => { if (w.ev === m.ev && w.pred(m.data)) { w.resolve(m.data); return false; } return true; });
        }
      });
      this.ws.send(JSON.stringify({ t: 'hello', client: this.kind, version: 'test', token }));
    });
  }
  req(op, args = {}) {
    const id = ++this.n;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ t: 'req', id, op, args })); });
  }
  wait(ev, pred = () => true, ms = 3000) {
    const hit = this.events.find(e => e.ev === ev && pred(e.data) && !e.used);
    if (hit) { hit.used = true; return Promise.resolve(hit.data); }
    return new Promise((resolve, reject) => {
      const w = { ev, pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`timeout waiting for ${ev}`)), ms);
    });
  }
  clear() { this.events = []; }
  close() { this.ws.close(); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rejects = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } throw new Error(`expected rejection ${re}`); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-'));
  const ENV = { ...(process.env.TEST_PG ? { DATABASE_URL: process.env.TEST_PG } : { DATA_DIR: dir }), COSMETIC_ADMINS: 'Dave', SHOP_ADMINS: 'Dave' };
  const fakeLookup = async name => ({ uuid: uuidOf(name), name });
  const srv = await start({ env: ENV, port: 0, hasJoined: fakeJoined, lookup: fakeLookup, shopTakt: 0 });
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  try {
    const alice = new Client(url, 'Alice'); const a = await alice.connect();
    assert.equal(a.uuid, uuidOf('Alice'));
    const bob = new Client(url, 'Bob'); await bob.connect();
    const carl = new Client(url, 'Carl'); await carl.connect();
    await rejects(new Client(url, 'Nobody').connect(), /Mojang could not confirm/);

    const alice2 = new Client(url, 'Alice', 'game'); const r2 = await alice2.connect(a.token);
    assert.equal(r2.uuid, a.uuid);
    alice2.close(); await sleep(100);

    await rejects(alice.req('friend.request', { name: 'Zed' }), /never used Vortex/);
    await rejects(alice.req('friend.request', { name: 'alice' }), /That is you/);
    const r = await alice.req('friend.request', { name: 'bob' });
    assert.equal(r.sent, true);
    await bob.wait('request', d => d.name === 'Alice');
    await rejects(alice.req('friend.request', { name: 'Bob' }), /already sent/);
    await bob.req('friend.accept', { uuid: a.uuid });
    await alice.wait('friendAdded', d => d.name === 'Bob');
    await sleep(50);
    assert.equal(alice.state.friends.length, 1);
    assert.equal(alice.state.friends[0].presence.state, 'online');

    await carl.req('friend.request', { name: 'Alice' });
    const x = await alice.req('friend.request', { name: 'Carl' });
    assert.equal(x.friends, true);

    await bob.req('settings.set', { patch: { privacy: { requests: 'fof' } } });
    const dave = new Client(url, 'Dave'); await dave.connect();
    await rejects(dave.req('friend.request', { name: 'Bob' }), /does not accept friend requests/);
    await carl.req('friend.request', { name: 'Bob' });
    await bob.req('friend.accept', { uuid: carl.me.uuid });

    alice.clear();
    const bobGame = new Client(url, 'Bob', 'game'); await bobGame.connect();
    await bobGame.req('activity', { mode: 'server', address: 'mc.hypixel.net', serverName: 'Hypixel', version: '26.2' });
    const p = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.activity?.mode === 'server');
    assert.equal(p.presence.activity.address, 'mc.hypixel.net');
    assert.equal(p.presence.activity.joinable, true);
    const jc = await alice.req('join.check', { uuid: bob.me.uuid });
    assert.equal(jc.address, 'mc.hypixel.net');

    alice.clear();
    await bob.req('settings.set', { patch: { privacy: { showServer: 'nobody' } } });
    const hidden = await alice.wait('presence', d => d.uuid === bob.me.uuid);
    assert.equal(hidden.presence.activity.mode, 'hidden');
    assert.equal(hidden.presence.activity.address, undefined);
    await rejects(alice.req('join.check', { uuid: bob.me.uuid }), /cannot join/);

    alice.clear();
    await bob.req('settings.set', { patch: { privacy: { showServer: 'favorites' } } });
    await bob.req('friend.update', { uuid: a.uuid, favorite: true, nickname: 'Ali' });
    const fav = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.activity?.mode === 'server');
    assert.equal(fav.presence.activity.address, 'mc.hypixel.net');
    assert.equal(carl.state.friends.find(f => f.name === 'Bob').presence.activity?.address, undefined);

    alice.clear();
    await bob.req('status.set', { mode: 'invisible' });
    const inv = await alice.wait('presence', d => d.uuid === bob.me.uuid);
    assert.equal(inv.presence.state, 'offline');
    await bob.req('status.set', { mode: 'dnd', text: 'Bedwars' });
    const dnd = await alice.wait('presence', d => d.uuid === bob.me.uuid && d.presence.state !== 'offline');
    assert.equal(dnd.presence.mode, 'dnd');
    assert.equal(dnd.presence.text, 'Bedwars');

    const sent = await alice.req('chat.send', { to: bob.me.uuid, body: '  hallo bob  ' });
    assert.equal(sent.message.body, 'hallo bob');
    const got = await bobGame.wait('message', d => d.message.body === 'hallo bob');
    assert.equal(got.conv.unread, 1);
    await bob.req('chat.read', { conv: got.conv.id, upTo: got.message.id });
    const rd = await alice.wait('read', d => d.uuid === bob.me.uuid);
    assert.equal(rd.upTo, got.message.id);
    await bob.req('chat.typing', { conv: got.conv.id });
    await alice.wait('typing', d => d.uuid === bob.me.uuid);
    const e = await alice.req('chat.edit', { id: sent.message.id, body: 'hallo Bob!' });
    assert.equal(e.message.body, 'hallo Bob!');
    await bob.wait('messageUpdate', d => d.message.body === 'hallo Bob!');
    const hist = await bob.req('chat.history', { conv: got.conv.id });
    assert.equal(hist.messages.length, 1);
    await alice.req('chat.delete', { id: sent.message.id });
    const hist2 = await bob.req('chat.history', { conv: got.conv.id });
    assert.equal(hist2.messages[0].deleted, true);
    await rejects(dave.req('chat.send', { to: a.uuid, body: 'hi' }), /does not accept messages/);

    const g = await alice.req('group.create', { name: 'PvP Squad', members: [bob.me.uuid, carl.me.uuid] });
    assert.equal(g.conv.members.length, 3);
    await rejects(alice.req('group.add', { conv: g.conv.id, uuid: dave.me.uuid }), /only add friends/);
    await carl.req('chat.send', { conv: g.conv.id, body: 'gg' });
    await bob.wait('message', d => d.message.body === 'gg');
    await bob.req('group.leave', { conv: g.conv.id });
    await alice.req('group.rename', { conv: g.conv.id, name: 'Squad 2' });
    await rejects(carl.req('group.kick', { conv: g.conv.id, uuid: a.uuid }), /Only the group owner/);

    const invite = await alice.req('invite.send', { to: bob.me.uuid, address: 'play.vortexpvp.eu', version: '26.2' });
    const gotInv = await bobGame.wait('invite', d => d.id === invite.invite.id);
    assert.equal(gotInv.address, 'play.vortexpvp.eu');
    const ans = await bobGame.req('invite.respond', { id: gotInv.id, accept: true });
    assert.equal(ans.address, 'play.vortexpvp.eu');
    await alice.wait('inviteAnswer', d => d.accept === true);
    await rejects(bob.req('invite.respond', { id: gotInv.id, accept: true }), /expired/);
    await bob.req('settings.set', { patch: { privacy: { invites: 'nobody' } } });
    await rejects(alice.req('invite.send', { to: bob.me.uuid, address: 'a.b' }), /does not accept invites/);
    await carl.req('invite.send', { to: a.uuid }).then(() => { throw new Error('should fail'); }, err => assert.match(err.message, /Join a server first/));

    await alice.req('join.ask', { to: bob.me.uuid });
    await bob.wait('joinRequest', d => d.uuid === a.uuid);

    await bob.req('profile.set', { versions: { '26.2': { mods: [{ name: 'Sodium', version: '0.7', id: 'sodium', projectId: 'AANobbMI' }] } } });
    const prof = await alice.req('profile.get', { uuid: bob.me.uuid });
    assert.equal(prof.versions['26.2'].mods[0].name, 'Sodium');
    await bob.req('settings.set', { patch: { privacy: { modProfile: 'nobody' } } });
    await rejects(alice.req('profile.get', { uuid: bob.me.uuid }), /does not share/);

    await alice.req('block', { name: 'Dave' });
    await rejects(dave.req('friend.request', { name: 'Alice' }), /does not accept friend requests/);
    await sleep(50);
    assert.equal(alice.state.blocked[0].name, 'Dave');
    await alice.req('unblock', { uuid: dave.me.uuid });
    await carl.req('block', { uuid: a.uuid });
    await sleep(50);
    assert.equal(alice.state.friends.some(f => f.name === 'Carl'), false, 'block removes friendship');

    const pngKopf = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString('base64'); };
    let cs = await alice.req('cosmetics.set', { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3 });
    assert.equal(cs.cosmetics.cape, '', 'custom cape needs a picture first');
    await rejects(alice.req('cosmetics.image', { image: pngKopf(300, 200) }), /2:1/);
    await rejects(alice.req('cosmetics.image', { image: Buffer.from('hello world').toString('base64') }), /not a PNG or JPEG/);
    await rejects(alice.req('cosmetics.image', { image: Buffer.alloc(90 * 1024).toString('base64') }), /too big/);
    const up = await alice.req('cosmetics.image', { image: pngKopf(512, 256) });
    assert.match(up.hash, /^[0-9a-f]{32}$/);
    await rejects(alice.req('cosmetics.image', { image: pngKopf(1024, 512) }), /wait a moment/);
    cs = await alice.req('cosmetics.set', { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3, extra: 'x' });
    assert.equal(cs.cosmetics.hat, '', 'shop: not owned -> not shown to others');
    await dave.req('shop.admin.coins', { to: 'Alice', amount: 500 });
    await dave.req('shop.admin.coins', { to: 'Bob', amount: 1000 });
    await alice.req('shop.buy', { item: 'hat:crown' });
    await alice.req('shop.buy', { item: 'aura:hearts' });
    for (const item of ['bandana:lightning', 'back:teddy_backpack', 'shield:vortex']) await bob.req('shop.buy', { item });
    cs = await alice.req('cosmetics.set', { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3, extra: 'x' });
    const leer = { bandana: '', face: '', back: '', shield: '', neck: '', nametag: '', pet: '' };
    assert.deepEqual(cs.cosmetics, { cape: 'custom', hat: 'crown', particles: 'hearts', density: 3, ...leer });
    cs = await bob.req('cosmetics.set', { cape: 'vortex_blue', hat: 'Top Hat!', particles: '', density: 99, bandana: 'lightning', face: 'Bad Id', back: 'teddy_backpack', shield: 'vortex' });
    assert.deepEqual(cs.cosmetics, { cape: 'vortex_blue', hat: '', particles: '', density: 2, bandana: 'lightning', face: '', back: 'teddy_backpack', shield: 'vortex', neck: '', nametag: '', pet: '' });
    let cg = await bob.req('cosmetics.get', { uuids: [a.uuid, bob.me.uuid, 'kaputt', carl.me.uuid] });
    assert.equal(cg.players[a.uuid].image, up.hash);
    assert.equal(cg.players[a.uuid].hat, 'crown');
    assert.equal(cg.players[bob.me.uuid].cape, 'vortex_blue');
    assert.equal(cg.players[bob.me.uuid].back, 'teddy_backpack', 'new cosmetics (4.29) reach other players');
    assert.equal(cg.players[carl.me.uuid].hat, '', 'no cosmetics stored for Carl');
    assert.equal(cg.players[carl.me.uuid].badge, 'vortex', 'every Vortex player gets [V]');
    const bild = await bob.req('cosmetics.imageGet', { hash: up.hash });
    assert.equal(bild.image, pngKopf(512, 256));
    cg = await carl.req('cosmetics.get', { uuids: [a.uuid] });
    assert.equal(cg.players[a.uuid].hat, 'crown');
    assert.equal(cg.players[a.uuid].cape, '');
    assert.equal(cg.players[a.uuid].image, null);
    await rejects(carl.req('cosmetics.imageGet', { hash: up.hash }), /not found/);
    assert.equal((await bob.req('cosmetics.report', { uuid: a.uuid })).reported, true);
    await rejects(bob.req('cosmetics.report', { uuid: carl.me.uuid }), /no cape picture/);
    await rejects(bob.req('cosmetics.reports'), /Only cosmetics admins/);
    const rep = await dave.req('cosmetics.reports');
    assert.equal(rep.reports[0].name, 'Alice');
    assert.equal(rep.reports[0].count, 1);
    await dave.req('cosmetics.moderate', { uuid: a.uuid, action: 'ban' });
    cg = await bob.req('cosmetics.get', { uuids: [a.uuid] });
    assert.equal(cg.players[a.uuid].cape, '');
    assert.equal(cg.players[a.uuid].hat, 'crown', 'only the picture is removed');
    await rejects(bob.req('cosmetics.imageGet', { hash: up.hash }), /not found/);
    await sleep(10);
    await rejects(alice.req('cosmetics.image', { image: pngKopf(512, 256) }), /cannot upload/);
    assert.equal((await dave.req('cosmetics.reports')).reports.length, 0);

    const song = { id: '4cOdK2wGLETKBW3PvgPWqT', title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody',
      image: 'https://i.scdn.co/image/ab67616d0000b27315ebbedaacef61af244262a8', durationMs: 213573, progressMs: 42000, playing: true };
    assert.equal((await alice.req('music.set', { track: song })).sharing, true);
    let mg = await bob.req('music.get', { uuids: [a.uuid, bob.me.uuid, 'kaputt'] });
    assert.equal(mg.players[a.uuid].title, 'Never Gonna Give You Up');
    assert.equal(mg.players[a.uuid].progressMs, 42000);
    assert.ok(mg.players[a.uuid].ageMs >= 0 && mg.players[a.uuid].ageMs < 2000);
    assert.equal(mg.players[bob.me.uuid], undefined);
    mg = await carl.req('music.get', { uuids: [a.uuid] });
    assert.equal(mg.players[a.uuid], undefined, 'Carl blocked Alice');
    await bob.req('music.set', { track: { ...song, id: '0VjIjW4GlUZAMYd2vXMi3b', title: 'x'.repeat(500), image: 'https://evil.example/a.png' } });
    mg = await alice.req('music.get', { uuids: [bob.me.uuid] });
    assert.equal(mg.players[bob.me.uuid].image, '');
    assert.equal(mg.players[bob.me.uuid].title.length, 120);
    await sleep(1600);
    await bob.req('music.set', { track: { ...song, id: '', title: 'Aus der App' }, visibility: 'friends' });
    assert.equal(bob.state.friends.some(f => f.name === 'Dave'), false);
    assert.equal((await carl.req('music.get', { uuids: [bob.me.uuid] })).players[bob.me.uuid].title, 'Aus der App');
    assert.equal((await dave.req('music.get', { uuids: [bob.me.uuid] })).players[bob.me.uuid], undefined);
    assert.equal((await bob.req('music.set', { track: { id: 'nope', title: 'x' } })).sharing, false);
    mg = await alice.req('music.get', { uuids: [bob.me.uuid] });
    assert.equal(mg.players[bob.me.uuid], undefined);
    await alice.req('music.clear');
    assert.equal((await bob.req('music.get', { uuids: [a.uuid] })).players[a.uuid], undefined);
    await alice.req('music.set', { track: song });

    const daveGame = new Client(url, 'Dave', 'game'); await daveGame.connect();
    await daveGame.req('activity', { mode: 'server', address: 'mc.hypixel.net', serverName: 'Hypixel', version: '26.2' });
    const carlGame = new Client(url, 'Carl', 'game'); await carlGame.connect();
    await carlGame.req('activity', { mode: 'server', address: 'play.other.net', serverName: 'Other', version: '26.2' });
    const em = await bobGame.req('emote.play', { emote: 'wave' });
    assert.equal(em.sent, 1, 'only Dave is on the same server');
    const gotEmote = await daveGame.wait('emote', d => d.emote === 'wave');
    assert.equal(gotEmote.uuid, bob.me.uuid);
    assert.equal((await bobGame.req('emote.play', { emote: 'wave' })).sent, 0, 'rate limit');
    await rejects(bobGame.req('emote.play', { emote: '<script>' }), /Unknown emote/);
    daveGame.close(); carlGame.close();

    await alice.req('friend.remove', { uuid: bob.me.uuid });
    await sleep(50);
    assert.equal(bob.state.friends.some(f => f.name === 'Alice'), false);

    const s = await alice.req('settings.set', { patch: { privacy: { requests: 'hacker' }, notify: { sound: 'yes' } } });
    assert.equal(s.settings.privacy.requests, 'everyone');
    assert.equal(s.settings.notify.sound, true);

    await sleep(1500);
    const al = new Client(url, 'Alice'); await al.connect();
    const bo = new Client(url, 'Bob'); await bo.connect();
    const ca = new Client(url, 'Carl'); await ca.connect();
    const da = new Client(url, 'Dave'); await da.connect();
    let st = await al.req('shop.state');
    assert.equal(st.balance, 150 + 500 - 200 - 100, 'starter + admin coins - crown - hearts');
    assert.ok(st.items.find(i => i.id === 'hat:crown').owned);
    assert.equal(st.admin, false);
    assert.equal((await da.req('shop.state')).admin, true, 'admin by uuid');
    await rejects(al.req('shop.buy', { item: 'hat:crown' }), /already own/);
    await rejects(ca.req('shop.buy', { item: 'cape:anim_vortex' }), /Not enough coins/);
    await rejects(al.req('shop.buy', { item: 'cape:does_not_exist' }), /not in the shop/);
    const vorher = (await al.req('shop.state')).balance;
    await al.req('shop.buy', { item: 'face:aviators', requestId: 'kauf-12345678' });
    const nachher = (await al.req('shop.buy', { item: 'face:aviators', requestId: 'kauf-12345678' })).balance;
    assert.equal(nachher, vorher - 50, 'same request id is charged once');
    await Promise.all([al.req('shop.buy', { item: 'face:bow' }).catch(() => null), al.req('shop.buy', { item: 'face:bow' }).catch(() => null)]);
    assert.equal((await al.req('shop.state')).balance, vorher - 100, 'double click charges once');
    await al.req('shop.gift', { item: 'face:monocle', to: 'Bob' });
    assert.ok((await bo.req('shop.state')).items.find(i => i.id === 'face:monocle').owned, 'gift arrived');
    await rejects(al.req('shop.gift', { item: 'face:monocle', to: 'Bob' }), /already owns/);
    await rejects(al.req('shop.gift', { item: 'face:bow', to: 'Alice' }), /yourself/);
    await rejects(al.req('shop.gift', { item: 'face:bow', to: 'Zed' }), /never used Vortex/);
    await rejects(bo.req('shop.admin.save', { id: 'special:hack', name: 'Hack', price: 0 }), /Only Vortex admins/);
    await rejects(bo.req('shop.admin.coins', { to: 'Bob', amount: 99999 }), /Only Vortex admins/);
    await da.req('shop.admin.save', { id: 'special:founder', name: 'Founder Badge', price: 10, rarity: 'mythic', limited: true, giftable: false });
    await rejects(al.req('shop.gift', { item: 'special:founder', to: 'Bob' }), /cannot be gifted/);
    await al.req('shop.buy', { item: 'special:founder' });
    await da.req('shop.admin.save', { id: 'hat:crown', price: 0 });
    assert.ok((await ca.req('shop.state')).items.find(i => i.id === 'hat:crown').owned, 'price 0 = free for everyone');
    await da.req('shop.admin.delete', { id: 'special:founder' });
    assert.ok((await al.req('shop.state')).items.some(i => i.id === 'special:founder'), 'owners keep deleted items');
    assert.ok(!(await ca.req('shop.state')).items.some(i => i.id === 'special:founder'), 'deleted items leave the shop');
    await rejects(ca.req('shop.buy', { item: 'special:founder' }), /not in the shop/);
    const kaeufe = await al.req('shop.history');
    assert.ok(kaeufe.tx.some(t => t.kind === 'gift_sent' && t.other === 'Bob'));
    assert.ok(kaeufe.tx.some(t => t.kind === 'starter'));
    assert.ok((await bo.req('shop.history')).tx.some(t => t.kind === 'gift_received' && t.other === 'Alice'));

    const spiel1 = new Client(url, 'Carl', 'game'); await spiel1.connect();
    const spiel2 = new Client(url, 'Carl', 'game'); await spiel2.connect();
    const c0 = (await ca.req('shop.state')).balance;
    await srv.hub.shopTick(60);
    assert.equal((await ca.req('shop.state')).balance, c0, 'main menu does not count');
    await spiel1.req('activity', { mode: 'singleplayer', version: '26.2' });
    await spiel2.req('activity', { mode: 'server', address: 'play.example.net', version: '26.2' });
    await srv.hub.shopTick(30);
    await srv.hub.shopTick(30);
    await srv.hub.shopTick(60);
    const c1 = await ca.req('shop.state');
    assert.equal(c1.balance, c0 + 2, 'one coin per minute, two windows count once');
    assert.equal(c1.minutes, 2);
    spiel1.close(); spiel2.close(); await sleep(100);
    const spiel3 = new Client(url, 'Carl', 'game'); await spiel3.connect();
    await srv.hub.shopTick(60);
    assert.equal((await ca.req('shop.state')).balance, c0 + 2, 'reconnecting gives nothing extra');
    spiel3.close();

    await srv.hub.db.run('INSERT INTO cosmetics (uuid, data, updated) VALUES (?, ?, ?)', [uuidOf('Erin'), JSON.stringify({ hat: 'horns', face: 'aviators--k2n7', back: '' }), 1]);
    const erin = new Client(url, 'Erin'); await erin.connect();
    const es = await erin.req('shop.state');
    for (const id of ['hat:horns', 'face:aviators', 'neck:iced_cuban', 'nametag:rainbow']) assert.ok(es.items.find(i => i.id === id).owned, `kept ${id}`);
    assert.equal(es.balance, 150);
    const packt = await erin.req('cosmetics.set', { face: 'aviators--k3n7', neck: 'diamond_pendant', nametag: 'rainbow' });
    assert.equal(packt.cosmetics.face, 'aviators--n7', 'unowned chain removed from the packed face field');
    assert.equal(packt.cosmetics.neck, '');
    erin.close();

    for (const c of [al, bo, ca, da]) c.close();
    await sleep(1500);

    /* ---------------- Creator-Programm, Admin, Pets (seit 1.2) ---------------- */
    const al2 = new Client(url, 'Alice'); await al2.connect();
    const bo2 = new Client(url, 'Bob'); await bo2.connect();
    const ca2 = new Client(url, 'Carl'); await ca2.connect();
    const da2 = new Client(url, 'Dave'); await da2.connect();
    let cm = await ca2.req('creator.me');
    assert.equal(cm.status, 'none');
    assert.equal(cm.badge, 'vortex');
    assert.match(cm.discord, /discord\.gg\/EQYZTRRp6J/);
    assert.equal((await ca2.req('creator.apply', { discord: 'carl#1' })).status, 'pending');
    await rejects(ca2.req('creator.apply'), /already being reviewed/);
    await rejects(bo2.req('admin.creator.set', { name: 'Carl', status: 'accepted', reason: 'hack' }), /Only Vortex admins/);
    await rejects(bo2.req('admin.overview'), /Only Vortex admins/);
    await rejects(da2.req('admin.creator.set', { name: 'Carl', status: 'accepted' }), /reason/);
    await da2.req('admin.creator.set', { name: 'Carl', status: 'accepted', code: 'carl', reason: 'great videos' });
    await rejects(da2.req('admin.creator.set', { name: 'Erin', status: 'accepted', code: 'CARL', reason: 'test' }), /already taken/);
    await rejects(da2.req('admin.creator.set', { name: 'Erin', code: 'x', reason: 'test' }), /3 to 16/);
    cm = await ca2.req('creator.me');
    assert.equal(cm.status, 'accepted');
    assert.equal(cm.code, 'CARL');
    assert.equal(cm.badge, 'creator');
    assert.ok(cm.profile && cm.profile.creatorItems.some(i => i.id === 'pet:phoenix'));
    assert.equal((await bo2.req('cosmetics.get', { uuids: [ca2.me.uuid] })).players[ca2.me.uuid].badge, 'creator', '[CREATOR] badge for others');
    assert.ok((await al2.req('creator.list')).creators.some(c => c.name === 'Carl' && c.code === 'CARL'));
    assert.equal((await al2.req('creator.profile', { name: 'carl' })).code, 'CARL');
    await rejects(al2.req('creator.profile', { name: 'Bob' }), /not a Vortex Creator/);

    await rejects(al2.req('shop.buy', { item: 'pet:phoenix' }), /Only Vortex Creators/);
    let cst = await ca2.req('shop.state');
    assert.ok(cst.items.find(i => i.id === 'pet:phoenix').owned, 'creators own creator items');
    await ca2.req('shop.buy', { item: 'pet:phoenix' }).catch(() => null);
    assert.equal((await ca2.req('cosmetics.set', { pet: 'phoenix', nametag: 'creator' })).cosmetics.pet, 'phoenix');
    const alSet = await al2.req('cosmetics.set', { pet: 'phoenix', nametag: 'creator' });
    assert.equal(alSet.cosmetics.pet, '', 'creator pet stripped for non-creators');
    assert.equal(alSet.cosmetics.nametag, '', 'creator name effect stripped for non-creators');
    await rejects(al2.req('shop.gift', { item: 'pet:phoenix', to: 'Bob' }), /Only Vortex Creators|cannot be gifted/);

    await rejects(ca2.req('creator.support', { code: 'CARL' }), /own code/);
    await rejects(al2.req('creator.support', { code: 'NOPE' }), /does not exist/);
    assert.equal((await al2.req('creator.support', { code: 'carl' })).supporting.code, 'CARL');
    assert.equal((await al2.req('shop.state')).supporting, 'CARL');
    const carlVorher = (await ca2.req('shop.state')).balance;
    const kauf = await da2.req('admin.coins', { name: 'Alice', amount: 1000, reason: 'test coins', requestId: 'adm-test-0001' });
    const doppelt = await da2.req('admin.coins', { name: 'Alice', amount: 1000, reason: 'test coins', requestId: 'adm-test-0001' });
    assert.equal(doppelt.balance, kauf.balance, 'admin coins with the same request id count once');
    assert.equal(doppelt.duplicate, true);
    await rejects(da2.req('admin.coins', { name: 'Alice', amount: 5, reason: 'x', requestId: 'adm-test-0002' }), /reason/);
    await rejects(da2.req('admin.coins', { name: 'Alice', amount: 5, reason: 'no id' }), /request id/);
    await rejects(da2.req('admin.coins', { name: 'Bob', amount: -999999, reason: 'too much', requestId: 'adm-test-0003' }), /Invalid amount|not have that many/);
    await al2.req('shop.buy', { item: 'pet:bee', requestId: 'kauf-biene-0001' });
    const carlNach = (await ca2.req('shop.state')).balance;
    assert.equal(carlNach, carlVorher + 10, 'creator gets 5 % of a 200 coin purchase');
    assert.ok((await ca2.req('shop.history')).tx.some(t => t.kind === 'creator_reward' && t.amount === 10 && t.other === 'Alice'));
    await al2.req('shop.buy', { item: 'pet:bee', requestId: 'kauf-biene-0001' });
    assert.equal((await ca2.req('shop.state')).balance, carlNach, 'replayed purchase pays no second reward');
    await da2.req('admin.creator.set', { name: 'Erin', status: 'accepted', code: 'ERIN', reason: 'second creator' });
    await rejects(al2.req('creator.support', { code: 'ERIN' }), /again in 7 days/);

    await da2.req('admin.creator.set', { name: 'Carl', status: 'suspended', reason: 'broke rules' });
    assert.equal((await ca2.req('cosmetics.set', { pet: 'phoenix' })).cosmetics.pet, '', 'suspended creators lose creator items');
    assert.equal((await bo2.req('cosmetics.get', { uuids: [ca2.me.uuid] })).players[ca2.me.uuid].badge, 'vortex');
    await sleep(1200);

    await rejects(da2.req('admin.grant', { name: 'Bob', item: 'pet:ghost' }), /reason/);
    await da2.req('admin.grant', { name: 'Bob', item: 'pet:ghost', reason: 'event winner' });
    assert.equal((await bo2.req('cosmetics.set', { pet: 'ghost' })).cosmetics.pet, 'ghost');
    await da2.req('admin.revoke', { name: 'Bob', item: 'pet:ghost', reason: 'mistake' });
    const bobSel = (await al2.req('cosmetics.get', { uuids: [bo2.me.uuid] })).players[bo2.me.uuid];
    assert.equal(bobSel.pet, '', 'revoked item is taken off');

    const zukunft = Date.now() + 86400000;
    await da2.req('admin.item.save', { id: 'pet:slime', starts: zukunft, reason: 'coming soon' });
    await rejects(bo2.req('shop.buy', { item: 'pet:slime' }), /not available yet/);
    await da2.req('admin.item.save', { id: 'face:bow', limited: true, starts: 0, ends: Date.now() - 1000, reason: 'limited ended' });
    assert.ok((await al2.req('shop.state')).items.find(i => i.id === 'face:bow').owned, 'limited items stay owned after the end');
    await rejects(bo2.req('shop.buy', { item: 'face:bow' }), /no longer available/);
    await rejects(da2.req('admin.item.save', { id: 'pet:slime', starts: 2000, ends: 1000, reason: 'bad dates' }), /end must be after/);
    await da2.req('admin.item.save', { id: 'pet:slime', starts: 0, ends: 0, featured: true, description: 'Bouncy!', reason: 'back in shop' });
    const ai = await da2.req('admin.items');
    assert.ok(ai.items.find(i => i.id === 'pet:bee').owners >= 1);
    assert.equal(ai.items.find(i => i.id === 'pet:slime').description, 'Bouncy!');
    await sleep(1200);

    await rejects(da2.req('admin.ban', { name: 'Dave', reason: 'self' }), /yourself/);
    await da2.req('admin.ban', { name: 'Erin', reason: 'cheating' });
    await rejects(new Client(url, 'Erin').connect(), /banned/);
    await da2.req('admin.unban', { name: 'Erin', reason: 'appeal accepted' });
    const erin2 = new Client(url, 'Erin'); await erin2.connect(); erin2.close();

    await rejects(da2.req('admin.settings.set', { settings: { coinsPerMinute: 500 }, reason: 'too much' }), /between/);
    await da2.req('admin.settings.set', { settings: { coinsPerMinute: 2 }, reason: 'double coins weekend' });
    const sp = new Client(url, 'Bob', 'game'); await sp.connect();
    await sp.req('activity', { mode: 'singleplayer', version: '26.2' });
    const b0 = (await bo2.req('shop.state')).balance;
    await srv.hub.shopTick(60);
    assert.equal((await bo2.req('shop.state')).balance, b0 + 2, 'coins per minute setting');
    sp.close();

    const ov = await da2.req('admin.overview');
    assert.equal(ov.creators, 1);
    assert.ok(ov.players >= 5 && ov.pets >= 6 && ov.sales >= 5);
    const eco = await da2.req('admin.economy');
    assert.ok(eco.totalCoins > 0 && eco.creatorRewards === 10 && eco.adminAdded >= 1000);
    const ana = await da2.req('admin.analytics', { days: 14 });
    assert.equal(ana.days.length, 14);
    assert.ok(ana.days[13].sales >= 1);
    const spl = await da2.req('admin.players', { q: 'car' });
    assert.equal(spl.players[0].name, 'Carl');
    assert.equal(spl.players[0].creator, 'suspended');
    const pl = await da2.req('admin.player', { name: 'Alice' });
    assert.ok(pl.owned.some(o => o.id === 'pet:bee') && pl.supporting.code === 'CARL' && pl.tx.length > 0);
    const txs = await da2.req('admin.tx', { kind: 'creator_reward' });
    assert.equal(txs.tx.length, 1);
    await sleep(1200);
    const log = await da2.req('admin.audit', {});
    for (const act of ['creator_accepted', 'coins_add', 'item_grant', 'item_revoke', 'player_ban', 'player_unban', 'settings', 'creator_suspended']) {
      assert.ok(log.entries.some(e => e.action === act), `audit has ${act}`);
    }
    const ban = log.entries.find(e => e.action === 'player_ban');
    assert.equal(ban.admin, 'Dave'); assert.equal(ban.target, 'Erin'); assert.equal(ban.reason, 'cheating');
    assert.equal((await da2.req('admin.audit', { q: 'double coins' })).entries.length, 1, 'audit search');
    await rejects(da2.req('admin.audit.delete', { id: ban.id }), /Unknown request/);
    for (const c of [al2, bo2, ca2, da2]) c.close();
    bob.clear();
    alice.close();
    await sleep(150);
    assert.equal((await bob.req('music.get', { uuids: [a.uuid] })).players[a.uuid], undefined, 'offline: no music');

    await srv.stop();
    const srv2 = await start({ env: ENV, port: 0, hasJoined: fakeJoined, lookup: fakeLookup, shopTakt: 0 });
    const url2 = `ws://127.0.0.1:${srv2.port}/ws`;
    const c2 = new Client(url2, 'Carl'); await c2.connect(carl.me.token);
    await sleep(100);
    assert.equal(c2.state.blocked[0].name, 'Alice');
    assert.ok(c2.state.convs.some(c => c.kind === 'group' && c.name === 'Squad 2'));
    for (const c of [bob, bobGame, carl, dave, c2]) c.close();
    await srv2.stop();
    console.log('ALL TESTS PASSED');
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err);
    await srv.stop().catch(() => {});
    process.exit(1);
  }
})();
