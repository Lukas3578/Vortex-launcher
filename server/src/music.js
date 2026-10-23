'use strict';
/**
 * Musik (Vortex Client 4.24+): Was ein Spieler gerade auf Spotify hoert,
 * damit andere Vortex-Spieler es ueber seinem Kopf sehen und mithoeren
 * koennen.
 *
 * Nur im Speicher -- nichts davon landet in der Datenbank. Ein Eintrag gilt
 * 90 s nach der letzten Meldung (der Client meldet alle 20 s und bei jedem
 * Songwechsel), danach ist er weg. Geht der Spieler offline, auch.
 *
 * Gespeichert wird nur, was Spotify oeffentlich zeigt: Titel, Kuenstler,
 * Album, Cover-Adresse, Track-ID und die Position im Song -- keine Tokens,
 * kein Konto.
 */

const LIMITS = {
  ttlMs: 90 * 1000,
  getMax: 100,
  /** Mindestabstand zwischen zwei Meldungen eines Spielers (sonst ignoriert). */
  setEveryMs: 1500,
  /** Emotes: hoechstens eines je Sekunde */
  emoteEveryMs: 1000
};

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const zahl = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };

/** Song aus der Anfrage pruefen; null = nichts (gueltiges) gemeldet. */
function cleanTrack(a) {
  if (!a || typeof a !== 'object') return null;
  let id = String(a.id || '');
  if (id && !/^[A-Za-z0-9]{22}$/.test(id)) return null;
  const title = clean(a.title, 120);
  if (!title) return null;
  const image = String(a.image || '');
  const durationMs = zahl(a.durationMs, 6 * 3600 * 1000);
  return {
    id,
    title,
    artist: clean(a.artist, 120),
    album: clean(a.album, 120),
    image: /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]{10,64}$/.test(image)
      || /^https:\/\/is[1-5]-ssl\.mzstatic\.com\/image\/thumb\/[A-Za-z0-9/._%-]{10,300}$/.test(image) ? image : '',
    durationMs,
    progressMs: Math.min(zahl(a.progressMs, 6 * 3600 * 1000), durationMs || Infinity),
    playing: Boolean(a.playing)
  };
}

const EMOTE = /^[a-z_]{1,20}$/;

module.exports = { LIMITS, cleanTrack, EMOTE };
