'use strict';
/**
 * Cosmetics (Cape, Hut, Aura/Partikel, Bandana, Face, Back, Schild) -- Hilfen fuer den Freunde-Server.
 *
 * Jeder Spieler legt seine Auswahl ab; alle Vortex-Spieler duerfen sie lesen
 * (sie sehen die Cosmetics ja ohnehin im Spiel). Eigene Cape-Bilder kommen
 * als JPEG oder PNG; hier wird nur geprueft, ob es wirklich so ein Bild in
 * Cape-Form (2:1, hoechstens 1024 breit) ist -- dekodiert wird es erst beim
 * Client. Wer jemanden blockiert, bekommt dessen Bild nicht.
 */

const ID = /^[a-z0-9_-]{1,40}$/;
const LIMITS = { imageBytes: 80 * 1024, uploadEveryMs: 30 * 1000, getMax: 100, reasonLength: 200 };

/** Auswahl saeubern: unbekannte Felder fallen weg, kaputte Werte werden leer. */
function cleanSelection(a) {
  const id = v => (typeof v === 'string' && (v === '' || ID.test(v)) ? v : '');
  const d = Number(a?.density);
  return {
    cape: id(a?.cape), hat: id(a?.hat), particles: id(a?.particles), density: d >= 1 && d <= 3 ? Math.round(d) : 2,
    bandana: id(a?.bandana), face: id(a?.face), back: id(a?.back), shield: id(a?.shield),
    neck: id(a?.neck), nametag: id(a?.nametag),
  };
}

/** Groesse eines PNG (IHDR) oder JPEG (SOFn) lesen; null = kein solches Bild. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Base64 -> geprueftes Bild (Buffer); wirft mit Text fuer den Spieler. */
function checkImage(b64, fail) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) fail('This is not a picture.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > LIMITS.imageBytes) fail('This picture is too big (max 80 KB).');
  const s = imageSize(buf);
  if (!s) fail('This is not a PNG or JPEG picture.');
  if (s.w !== s.h * 2 || s.w < 64 || s.w > 1024 || s.w % 64 !== 0) fail('The cape picture must be 2:1 (e.g. 512 x 256).');
  return buf;
}

module.exports = { cleanSelection, imageSize, checkImage, LIMITS };
