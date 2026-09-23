import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { asrPacket, parseAsrPacket, createAsrBridge } from './asr.mjs';
import { createGateway, loadConfig } from './server.mjs';

test('ASR binary frames decode full and final transcripts; malformed frames fail closed', () => {
  assert.deepEqual(parseAsrPacket(asrPacket(9, 0, Buffer.from(JSON.stringify({ result: { text: '你好' } })), true)), { final: false, text: '你好' });
  assert.deepEqual(parseAsrPacket(asrPacket(9, 2, Buffer.from(JSON.stringify({ result: { text: 'Hello.' } })), true)), { final: true, text: 'Hello.' });
  assert.throws(() => parseAsrPacket(Buffer.from([0x11])));
  const frame = asrPacket(9, 0, Buffer.from('{}'), true); frame.writeUInt32BE(9999, 4);
  assert.throws(() => parseAsrPacket(frame));
  assert.throws(() => parseAsrPacket(asrPacket(9, 0, Buffer.from('x'.repeat(70000)), true)));
});

test('ASR streams through server, supersedes previous capture, finishes and never exposes key', async () => {
  const upstreams = [], logs = [];
  const bridge = createAsrBridge({ bytePlusApiKey: 'private-fixture-key' }, () => 'owner', {
    log: value => logs.push(value),
    connect: (_url, options) => {
      assert.equal(options.headers['X-Api-Key'], 'private-fixture-key');
      const upstream = new EventEmitter(); upstream.readyState = WebSocket.OPEN; upstream.bufferedAmount = 0;
      upstream.frames = []; upstream.terminate = () => { upstream.terminated = true; };
      upstream.send = data => {
        upstream.frames.push(data);
        if ((data[1] >> 4) === 2) queueMicrotask(() => upstream.emit('message', asrPacket(9, data[1] & 2, Buffer.from(JSON.stringify({ result: { text: 'hello founder' } })), true)));
      };
      upstreams.push(upstream); queueMicrotask(() => upstream.emit('open')); return upstream;
    },
  });
  const server = createServer(); server.on('upgrade', bridge.upgrade); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/asr/stream`;
  const a = new WebSocket(url), aReady = once(a, 'message');
  let b;
  try {
    assert.equal(JSON.parse((await aReady)[0]).type, 'ready');
    const closed = once(a, 'close'); b = new WebSocket(url);
    await once(b, 'message'); await closed; assert.ok(upstreams[0].terminated);
    const partial = once(b, 'message'); b.send(Buffer.alloc(3200));
    assert.deepEqual(JSON.parse((await partial)[0]), { type: 'partial', text: 'hello founder' });
    const final = once(b, 'message'); b.send(JSON.stringify({ type: 'finish' }));
    assert.deepEqual(JSON.parse((await final)[0]), { type: 'final', text: 'hello founder' });
    assert.ok(!JSON.stringify(logs).includes('private-fixture-key'));
  } finally { a.terminate(); b?.terminate(); bridge.close(); await new Promise(resolve => server.close(resolve)); }
});

test('ASR upgrade rejects missing cookie, mismatched conversation and foreign origin before upstream', async () => {
  const config = loadConfig({ GATEWAY_SIGNING_SECRET: 'asr-test-signing-secret-32-characters', BOIDS_API_KEY: 'test', BYTEPLUS_TTS_API_KEY: 'test', BYTEPLUS_TTS_SPEAKER_ID: 'test' });
  const server = createGateway({ config, fetchImpl: async url => Response.json(url.endsWith('/conversations') ? { id: 'conv_asr_test' } : { data: [] }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`http://${base}/conversations`, { method: 'POST', headers: { Origin: 'http://localhost:3100', 'Content-Type': 'application/json' }, body: '{}' });
    const session = await response.json(), cookie = response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
    for (const [key, headers] of [[session.sessionKey, { Origin: 'http://localhost:3100' }], ['wrong', { Origin: 'http://localhost:3100', Cookie: cookie }], [session.sessionKey, { Origin: 'https://evil.invalid', Cookie: cookie }]]) {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${base}/asr/stream?sessionKey=${key}`, { headers });
        ws.on('open', () => reject(new Error('unauthorized accepted')));
        ws.on('error', () => {});
        ws.on('unexpected-response', (_, res) => { assert.equal(res.statusCode, 403); res.resume(); ws.terminate(); resolve(); });
      });
    }
  } finally { await server.stopMedia(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
