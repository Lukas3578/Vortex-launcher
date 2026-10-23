'use strict';
/**
 * Anmeldung ueber Mojang -- genau wie beim Beitreten eines Minecraft-Servers.
 *
 *  1. Der Server schickt eine zufaellige "serverId".
 *  2. Launcher/Spiel melden bei Mojang: "Ich (mit meinem Zugangstoken) trete
 *     serverId bei" (sessionserver .../join).
 *  3. Der Server fragt Mojang: "Ist <Name> serverId beigetreten?" (hasJoined)
 *     und bekommt UUID + Name zurueck.
 *
 * So beweist der Spieler, dass ihm das Konto gehoert -- ohne dass sein
 * Token oder Passwort jemals hierher kommt.
 */
const BASE = process.env.MOJANG_SESSION_URL || 'https://sessionserver.mojang.com';

async function hasJoined(name, serverId) {
  const url = `${BASE}/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${encodeURIComponent(serverId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Mojang answered ${res.status}`);
  const j = await res.json();
  if (!j || !/^[0-9a-f]{32}$/i.test(j.id || '') || !j.name) return null;
  return { uuid: j.id.toLowerCase(), name: String(j.name) };
}

/** UUID zu einem Namen (fuer die Shop-Admins); null, wenn es den Namen nicht gibt. */
async function lookup(name) {
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Mojang answered ${res.status}`);
  const j = await res.json();
  if (!j || !/^[0-9a-f]{32}$/i.test(j.id || '') || !j.name) return null;
  return { uuid: j.id.toLowerCase(), name: String(j.name) };
}

module.exports = { hasJoined, lookup };
