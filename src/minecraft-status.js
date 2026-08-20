const dns = require('dns').promises;
const net = require('net');

const DEFAULT_PORT = 25565;
const STATUS_PROTOCOL = 767;
const CONNECT_TIMEOUT_MS = 7000;
const MAX_PACKET_SIZE = 2 * 1024 * 1024;
const MAX_DESCRIPTION_LENGTH = 240;

function encodeVarInt(value) {
  const parts = [];
  let current = Number(value) >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current) byte |= 0x80;
    parts.push(byte);
  } while (current);
  return Buffer.from(parts);
}

function decodeVarInt(buffer, offset = 0) {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value, size: index + 1 };
    shift += 7;
  }
  throw new Error('Ungültige Minecraft-VarInt-Antwort.');
}

function minecraftString(value) {
  const data = Buffer.from(String(value), 'utf8');
  return Buffer.concat([encodeVarInt(data.length), data]);
}

function minecraftPacket(payload) {
  return Buffer.concat([encodeVarInt(payload.length), payload]);
}

function parseAddress(address) {
  const input = String(address || '').trim().toLowerCase();
  const split = input.lastIndexOf(':');
  const hasPort = split > -1 && input.indexOf(':') === split;
  const host = hasPort ? input.slice(0, split) : input;
  const port = hasPort ? Number(input.slice(split + 1)) : DEFAULT_PORT;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültige Serveradresse.');
  return { host, port, hasPort };
}

async function resolveEndpoint(address) {
  const parsed = parseAddress(address);
  if (parsed.hasPort) return parsed;
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${parsed.host}`);
    const candidate = records.sort((left, right) => left.priority - right.priority)[0];
    if (candidate?.name && Number.isInteger(candidate.port)) {
      return { host: candidate.name.replace(/\.$/, ''), port: candidate.port, hasPort: false, handshakeHost: parsed.host };
    }
  } catch (_) {
    // Ein fehlender SRV-Eintrag ist bei Minecraft-Servern normal. Dann wird der Standardport verwendet.
  }
  return parsed;
}

function flattenDescription(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenDescription).join('');
  if (!value || typeof value !== 'object') return '';
  const ownText = typeof value.text === 'string' ? value.text : '';
  const translated = typeof value.translate === 'string' ? value.translate : '';
  return `${ownText || translated}${flattenDescription(value.extra)}`;
}

function normaliseDescription(value) {
  const text = flattenDescription(value)
    .replace(/§[0-9A-FK-ORX]/gi, '')
    .replace(/&(?:#[0-9a-f]{6}|[0-9a-fk-or])/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, MAX_DESCRIPTION_LENGTH);
}

function safeFavicon(value) {
  const favicon = String(value || '');
  if (!favicon.startsWith('data:image/png;base64,')) return null;
  const encoded = favicon.slice('data:image/png;base64,'.length);
  if (encoded.length < 32 || encoded.length > 1024 * 1024 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return null;
  return favicon;
}

function receiveStatus(socket) {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error('Der Server hat nicht rechtzeitig geantwortet.')));
    socket.once('error', () => fail(new Error('Der Minecraft-Server ist nicht erreichbar.')));
    socket.on('data', chunk => {
      if (settled) return;
      received = Buffer.concat([received, chunk]);
      if (received.length > MAX_PACKET_SIZE) return fail(new Error('Die Serverantwort ist zu groß.'));
      try {
        const packetLength = decodeVarInt(received);
        if (!packetLength) return;
        if (packetLength.value < 1 || packetLength.value > MAX_PACKET_SIZE) return fail(new Error('Ungültige Serverantwort.'));
        const packetStart = packetLength.size;
        if (received.length < packetStart + packetLength.value) return;
        const payload = received.subarray(packetStart, packetStart + packetLength.value);
        const packetId = decodeVarInt(payload);
        if (!packetId || packetId.value !== 0) return fail(new Error('Ungültige Minecraft-Statusantwort.'));
        const jsonLength = decodeVarInt(payload, packetId.size);
        if (!jsonLength || jsonLength.value < 2 || jsonLength.value > MAX_PACKET_SIZE) return fail(new Error('Ungültige Serverbeschreibung.'));
        const start = packetId.size + jsonLength.size;
        const end = start + jsonLength.value;
        if (end > payload.length) return fail(new Error('Unvollständige Serverbeschreibung.'));
        const raw = payload.subarray(start, end).toString('utf8');
        finish(JSON.parse(raw));
      } catch (error) {
        fail(new Error(`Minecraft-Status konnte nicht gelesen werden: ${error.message}`));
      }
    });
  });
}

async function requestStatus(endpoint, handshakeHost) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    socket.once('connect', async () => {
      try {
        const handshake = Buffer.concat([
          encodeVarInt(0),
          encodeVarInt(STATUS_PROTOCOL),
          minecraftString(handshakeHost),
          Buffer.from([(endpoint.port >>> 8) & 0xff, endpoint.port & 0xff]),
          encodeVarInt(1)
        ]);
        socket.write(minecraftPacket(handshake));
        socket.write(minecraftPacket(encodeVarInt(0)));
        resolve(await receiveStatus(socket));
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.once('error', () => reject(new Error('Der Minecraft-Server ist nicht erreichbar.')));
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => reject(new Error('Der Server hat nicht rechtzeitig geantwortet.')));
  });
}

async function pingMinecraftServer(address) {
  const endpoint = await resolveEndpoint(address);
  const requestedHost = parseAddress(address).host;
  const startedAt = Date.now();
  let status;
  try {
    status = await requestStatus(endpoint, endpoint.host);
  } catch (firstError) {
    if (endpoint.host === requestedHost) throw firstError;
    status = await requestStatus(endpoint, requestedHost);
  }

  const description = normaliseDescription(status.description);
  return {
    online: true,
    description: description || 'Der Server hat keine Beschreibung hinterlegt.',
    favicon: safeFavicon(status.favicon),
    hasFavicon: Boolean(safeFavicon(status.favicon)),
    players: {
      online: Math.max(0, Number(status.players?.online) || 0),
      max: Math.max(0, Number(status.players?.max) || 0)
    },
    version: String(status.version?.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Unbekannte Version',
    latency: Date.now() - startedAt,
    checkedAt: new Date().toISOString()
  };
}

async function getMinecraftServerStatus(address) {
  try {
    return await pingMinecraftServer(address);
  } catch (error) {
    return {
      online: false,
      description: 'Serverstatus momentan nicht erreichbar.',
      favicon: null,
      hasFavicon: false,
      players: { online: 0, max: 0 },
      version: null,
      latency: null,
      checkedAt: new Date().toISOString(),
      error: error.message || 'Der Minecraft-Server ist nicht erreichbar.'
    };
  }
}

module.exports = { getMinecraftServerStatus, pingMinecraftServer };
