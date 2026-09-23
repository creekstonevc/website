import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import WebSocket, { WebSocketServer } from 'ws';

export function asrPacket(type, flags, data, json = false) {
  const payload = gzipSync(data);
  const header = Buffer.from([0x11, (type << 4) | flags, (json ? 0x10 : 0) | 1, 0, 0, 0, 0, 0]);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

export function parseAsrPacket(data) {
  if (data.length < 8 || data[0] >> 4 !== 1) throw new Error('protocol');
  const type = data[1] >> 4, flags = data[1] & 15;
  let offset = (data[0] & 15) * 4;
  if (offset < 4 || offset + 4 > data.length) throw new Error('protocol');
  if (type === 15) return { error: data.readUInt32BE(offset) };
  if (type !== 9) throw new Error('protocol');
  if (flags & 1) offset += 4;
  if (offset + 4 > data.length) throw new Error('protocol');
  const size = data.readUInt32BE(offset); offset += 4;
  if (size > 65536 || offset + size !== data.length) throw new Error('protocol');
  let payload = data.subarray(offset);
  if ((data[2] & 15) === 1) payload = gunzipSync(payload, { maxOutputLength: 65536 });
  else if ((data[2] & 15) !== 0) throw new Error('protocol');
  const result = JSON.parse(payload.toString());
  if (result.code && ![0, 20000000].includes(result.code)) return { error: Number(result.code) || 1 };
  return { final: !!(flags & 2), text: typeof result.result?.text === 'string' ? result.result.text.slice(0, 4000) : '' };
}

// Browser audio is ephemeral: no recording, transcript or credential is logged.
export function createAsrBridge(config, authenticate, { connect = (url, options) => new WebSocket(url, options),
  log = event => process.stderr.write(`${JSON.stringify(event)}\n`) } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const active = new Map(), rates = new Map();
  function upgrade(request, socket, head) {
    let owner;
    try {
      owner = authenticate(request);
      const now = Date.now();
      for (const [key, rate] of rates) if (now - rate.at > 60000) rates.delete(key);
      const rate = rates.get(owner) || { at: now, count: 0 };
      if (++rate.count > 12 || rates.size > 2048 || (!active.has(owner) && active.size >= 8)) throw new Error('limit');
      rates.set(owner, rate);
    } catch {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(request, socket, head, client => {
      active.get(owner)?.();
      let upstream, ended = false, finishing = false, started = false, bytes = 0, lastAudio = Date.now();
      let finishTimer;
      const id = randomUUID();
      const send = data => { if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 65536) client.send(JSON.stringify(data)); };
      const close = () => {
        if (ended) return; ended = true;
        clearTimeout(lifetime); clearTimeout(finishTimer); clearInterval(idle);
        upstream?.terminate(); client.close();
        if (active.get(owner) === close) active.delete(owner);
      };
      const fail = code => { log({ event: 'asr.failed', id, code }); send({ type: 'error', message: 'Speech recognition unavailable. Please retry or type your message.' }); close(); };
      const lifetime = setTimeout(() => fail('duration_limit'), 75000);
      const idle = setInterval(() => { if (!finishing && Date.now() - lastAudio > 10000) fail('audio_timeout'); }, 2000);
      active.set(owner, close);
      client.on('close', close); client.on('error', close);
      try {
        upstream = connect('wss://voice.ap-southeast-1.bytepluses.com/api/v3/sauc/bigmodel_async', {
          headers: { 'X-Api-Key': config.bytePlusApiKey, 'X-Api-Resource-Id': 'volc.bigasr.sauc.duration', 'X-Api-Connect-Id': id },
          handshakeTimeout: 8000, maxPayload: 65536, perMessageDeflate: false,
        });
      } catch { fail('connect'); return; }
      upstream.on('unexpected-response', (_, response) => { response.resume(); fail(`http_${response.statusCode}`); });
      upstream.on('upgrade', response => {
        const logId = response.headers['x-tt-logid'];
        log({ event: 'asr.connected', id, logId: typeof logId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(logId) ? logId : null });
      });
      upstream.on('error', () => { if (!ended) fail('upstream_connection'); });
      upstream.on('close', () => { if (!ended) fail('upstream_closed'); });
      upstream.on('open', () => {
        if (ended) return;
        upstream.send(asrPacket(1, 0, Buffer.from(JSON.stringify({ user: { uid: id },
          audio: { format: 'pcm', codec: 'raw', rate: 16000, bits: 16, channel: 1 },
          request: { model_name: 'bigmodel', result_type: 'full', enable_itn: true, enable_punc: true, enable_nonstream: true },
        })), true));
        started = true; lastAudio = Date.now(); send({ type: 'ready' });
      });
      upstream.on('message', data => {
        if (ended) return;
        try {
          const result = parseAsrPacket(data);
          if (result.error) { fail(`provider_${result.error}`); return; }
          send({ type: result.final ? 'final' : 'partial', text: result.text });
          if (result.final) close();
        } catch { fail('protocol'); }
      });
      client.on('message', (data, binary) => {
        if (ended) return;
        try {
          if (!started || finishing || upstream.readyState !== WebSocket.OPEN) throw new Error('not_ready');
          if (binary) {
            bytes += data.length; lastAudio = Date.now();
            if (!data.length || data.length % 2 || bytes > 1920000 || upstream.bufferedAmount > 128000) throw new Error('audio_limit');
            upstream.send(asrPacket(2, 0, data));
          } else {
            const command = JSON.parse(data.toString());
            if (command.type !== 'finish') throw new Error('command');
            finishing = true; upstream.send(asrPacket(2, 2, Buffer.alloc(0)));
            finishTimer = setTimeout(() => fail('final_timeout'), 10000);
          }
        } catch { fail('invalid_input'); }
      });
    });
  }
  return { upgrade, close: () => { for (const close of active.values()) close(); wss.close(); } };
}
