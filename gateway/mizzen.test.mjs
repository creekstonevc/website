import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MizzenAudio } from "./mizzen-audio.mjs";
import { createMizzenManager } from "./mizzen.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  terminate() { this.readyState = 3; this.emit("close"); }
}
function audioFixture() {
  const socket = new Socket();
  const audio = new MizzenAudio("wss://fixture.invalid/audio", "input-secret", { socketFactory: (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer input-secret"); return socket;
  } });
  socket.emit("open");
  const emit = data => socket.emit("message", JSON.stringify({ stream_id: audio.id, ...data }));
  emit({ type: "audio.ready", max_chunk_samples: 2400, max_inflight_chunks: 2 });
  return { socket, audio, emit };
}
test("Mizzen PCM preserves unaligned chunks, paces 40ms, ACK-gates end and retains exact sample counts", async () => {
  const { audio, socket, emit } = audioFixture();
  try {
    audio.push(Buffer.alloc(1)); audio.push(Buffer.alloc(1919)); audio.push(Buffer.alloc(2000));
    const done = audio.finish(); audio.pump();
    const first = socket.sent.at(-1); assert.equal(first.type, "audio.chunk"); assert.equal(first.sample_count, 960);
    audio.pump(); assert.equal(socket.sent.filter(x => x.type === "audio.chunk").length, 1);
    await pause(45); audio.pump();
    assert.equal(socket.sent.filter(x => x.type === "audio.chunk").length, 2);
    await pause(45); audio.pump(); assert.equal(socket.sent.filter(x => x.type === "audio.chunk").length, 2);
    emit({ type: "audio.ack", seq: 0, received_samples: 960 }); audio.pump();
    assert.equal(socket.sent.at(-1).sample_count, 40);
    assert.equal(socket.sent.at(-1).sample_offset, 1920);
    assert.equal(socket.sent.some(x => x.type === "audio.end"), false);
    emit({ type: "audio.ack", seq: 1, received_samples: 1920 }); emit({ type: "audio.ack", seq: 2, received_samples: 1960 });
    await pause(5); audio.pump(); assert.equal(socket.sent.at(-1).total_samples, 1960);
    emit({ type: "audio.input_ended", total_samples: 1960 }); socket.emit("close"); await done;
    assert.deepEqual(Object.keys(socket.sent[0]).sort(), ["channels", "format", "protocol_version", "sample_rate", "stream_id", "type"]);
  } finally { audio.cancel(); }
});
test("Mizzen rejects malformed ACKs and incomplete final PCM samples", async () => {
  const a = audioFixture(); a.audio.push(Buffer.alloc(1920)); a.audio.pump();
  a.emit({ type: "audio.ack", seq: 0, received_samples: 1 }); await assert.rejects(a.audio.done);
  const b = audioFixture(); b.audio.push(Buffer.alloc(1)); const done = b.audio.finish(); b.audio.pump(); await assert.rejects(done);
});

test('reply tail appends exactly 300ms silence, paces packets, waits for ACK and never ends the session', async () => {
  let now = 0;
  const socket = new Socket(), logs = [];
  const audio = new MizzenAudio('wss://fixture.invalid/audio', 'test', { socketFactory: () => socket, now: () => now });
  try {
    socket.emit('open');
    socket.emit('message', JSON.stringify({ stream_id: audio.id, type: 'audio.ready', max_chunk_samples: 960, max_inflight_chunks: 2 }));
    const speech = Buffer.alloc(2000, 1);
    audio.push(speech);
    let drained = false;
    const done = audio.drain({ tailMs: 300, onProgress: item => logs.push(item) }).then(() => { drained = true; });
    const chunks = [];
    while (audio.queue.length || audio.inflight.size) {
      const chunk = socket.sent.at(-1);
      assert.equal(chunk.type, 'audio.chunk');
      chunks.push(Buffer.from(chunk.data, 'base64'));
      const count = socket.sent.length;
      audio.pump(); assert.equal(socket.sent.length, count);
      assert.equal(drained, false);
      socket.emit('message', JSON.stringify({ stream_id: audio.id, type: 'audio.ack', seq: chunk.seq, received_samples: chunk.sample_offset + chunk.sample_count }));
      now += 40; audio.pump();
    }
    await done;
    const pcm = Buffer.concat(chunks);
    assert.deepEqual(pcm.subarray(0, speech.length), speech);
    assert.deepEqual(pcm.subarray(speech.length), Buffer.alloc(14400));
    assert.deepEqual(logs.map(item => item.stage), ['tail_queued', 'speech_tail_sent', 'silence_tail_sent', 'tail_acked']);
    assert.equal(socket.sent.some(item => item.type === 'audio.end'), false);
    assert.equal(audio.closed, false);
    audio.push(Buffer.alloc(1920)); now += 40; audio.pump();
    assert.equal(socket.sent.at(-1).sample_offset, 8200);
  } finally { audio.cancel(); }
});
test("idle audio survives 150 seconds with silence and multiple replies never end the session input", async () => {
  let now = 0;
  const socket = new Socket();
  const audio = new MizzenAudio("wss://fixture.invalid/audio", "test", { socketFactory: () => socket, now: () => now });
  const ack = () => {
    const chunk = socket.sent.at(-1);
    socket.emit("message", JSON.stringify({ stream_id: audio.id, type: "audio.ack", seq: chunk.seq, received_samples: chunk.sample_offset + chunk.sample_count }));
  };
  try {
    socket.emit("open");
    socket.emit("message", JSON.stringify({ stream_id: audio.id, type: "audio.ready", max_chunk_samples: 2400, max_inflight_chunks: 2 }));
    for (let step = 0; step < 10; step++) {
      now += 15000; audio.pump();
      const chunk = socket.sent.at(-1);
      assert.equal(chunk.type, 'audio.chunk');
      assert.equal(Buffer.from(chunk.data, 'base64').some(byte => byte !== 0), false);
      ack(); audio.pump(); assert.equal(audio.closed, false);
    }
    for (let reply = 0; reply < 2; reply++) {
      now += 100; audio.push(Buffer.alloc(100, 1));
      let drained = false; const done = audio.drain().then(() => { drained = true; });
      assert.equal(drained, false);
      ack(); audio.pump(); await done;
      assert.equal(audio.closed, false);
    }
    assert.equal(socket.sent.filter(frame => frame.type === 'audio.start').length, 1);
    assert.equal(socket.sent.some(frame => frame.type === 'audio.end'), false);
    audio.cancel(); const count = socket.sent.length; now += 15000; audio.pump();
    assert.equal(socket.sent.length, count);
  } finally { audio.cancel(); }
});
function managerFixture(extra = {}) {
  const calls = [], audioConnections = []; let closed = false, ttsEmit;
  const manager = createMizzenManager({ mizzen: { base: "https://avatar.fixture.invalid", inputKey: "input-secret", playbackKey: "playback-secret" } }, {
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push({ path, ...options });
      assert.equal(options.headers.Authorization, `Bearer ${path.startsWith("/v2") ? "playback-secret" : "input-secret"}`);
      if (path === "/v1/sessions") { assert.match(options.headers["Idempotency-Key"], /^[a-f0-9-]{36}$/); return Response.json({ session_id: "12345678-1234-1234-1234-123456789012", state: "ready" }); }
      if (options.method === "DELETE") closed = true;
      if (path.endsWith("/playback")) return Response.json({ iceServers: [] });
      if (path.endsWith("/offer")) return Response.json({ type: "answer", sdp: "v=0\r\n", generation: 1 });
      return Response.json({ state: closed ? "closed" : "ready" });
    },
    makeAudio: () => {
      const audio = { push() {}, drain: () => Promise.resolve(), finish: () => { throw new Error('must not end input between replies'); }, done: new Promise(() => {}), cancel() {} };
      audioConnections.push(audio); return audio;
    },
    makeTts: emit => { ttsEmit = emit; return { push() {}, finish() {}, cancel() {} }; }, ...extra,
  });
  return { manager, calls, audioConnections, emit: (...args) => ttsEmit(...args) };
}
test("video credentials absent is a no-upstream preview; keys never appear in capabilities", async () => {
  const manager = createMizzenManager({}, { fetchImpl: () => { throw new Error("must not fetch"); } });
  try { assert.deepEqual(await manager.handle("capabilities", "a", {}), { enabled: false, reason: "credentials_missing" });
    await assert.rejects(manager.handle("open", "a", {}), { code: "video_not_configured" }); }
  finally { await manager.close(); }
});
test("video session ownership, separate keys, offer-once, PCM routing and input-end keep playback alive", async () => {
  const { manager, calls, emit, audioConnections } = managerFixture();
  try {
    const opened = await manager.handle("open", "alice", {});
    assert.deepEqual(Object.keys(opened).sort(), ["expiresAt", "iceServers", "serverNow", "sessionId", "videoId"]);
    assert.ok(opened.expiresAt - opened.serverNow <= 550000 && opened.expiresAt > opened.serverNow);
    await assert.rejects(manager.handle("heartbeat", "bob", opened), { code: "video_expired" });
    assert.throws(() => manager.voice(() => {}, "alice", opened.videoId), { code: "video_not_ready" });
    await manager.handle("offer", "alice", { ...opened, sdp: "v=0\r\n" });
    await assert.rejects(manager.handle("offer", "alice", { ...opened, sdp: "v=0\r\n" }), { code: "video_busy" });
    await manager.handle("ready", "alice", opened);
    const events = [], voice = manager.voice((event, data) => events.push({ event, data }), "alice", opened.videoId);
    emit("audio", { data: Buffer.alloc(1920).toString("base64") }); emit("done", {}); await pause(0);
    assert.deepEqual(events, [{ event: "done", data: {} }]);
    voice.cancel(); assert.equal(calls.some(call => call.method === "DELETE"), false);
    const second = manager.voice((event, data) => events.push({ event, data }), 'alice', opened.videoId);
    emit('audio', { data: Buffer.alloc(1920).toString('base64') }); emit('done', {}); await pause(0);
    second.cancel();
    assert.equal(audioConnections.length, 1);
    assert.equal(events.filter(event => event.event === 'done').length, 2);
    await manager.handle("close", "alice", opened); assert.equal(calls.filter(call => call.method === "DELETE").length, 1);
  } finally { await manager.close(); }
});
test("uncertain session creation quarantines further allocation instead of blindly duplicating sessions", async () => {
  let calls = 0;
  const { manager } = managerFixture({ fetchImpl: async () => { calls++; throw new Error("secret provider detail"); } });
  try { await assert.rejects(manager.handle("open", "a", {}), { code: "video_network" });
    await assert.rejects(manager.handle("open", "a", {}), { code: "video_cleanup" }); assert.equal(calls, 1); }
  finally { await manager.close(); }
});

test('stats uses owned upstream session and playback auth, validates counts and bounds request frequency', async () => {
  const { manager, calls } = managerFixture();
  try {
    const opened = await manager.handle('open', 'alice', {});
    await manager.handle('offer', 'alice', { ...opened, sdp: 'v=0\r\n' });
    const stats = { frames_decoded: 250, frames_dropped: 2, packets_lost: -3, rtt_seconds: .08 };
    await assert.rejects(manager.handle('stats', 'bob', { ...opened, stats }), { code: 'video_expired' });
    await assert.rejects(manager.handle('stats', 'alice', { ...opened, stats: { ...stats, frames_decoded: -1 } }), { code: 'video_stats_invalid' });
    await assert.rejects(manager.handle('stats', 'alice', { ...opened, stats: { packets_lost: 0 } }), { code: 'video_stats_invalid' });
    await manager.handle('stats', 'alice', { ...opened, session_id: 'foreign', stats });
    const sent = calls.find(call => call.path.endsWith('/stats'));
    assert.equal(sent.headers.Authorization, 'Bearer playback-secret');
    assert.equal(sent.path, `/v2/sessions/${opened.sessionId}/stats`);
    assert.deepEqual(JSON.parse(sent.body), { session_id: opened.sessionId, ...stats,
      freeze_count: null, concealed_samples: null, freeze_seconds: null, jitter_seconds: null });
    assert.deepEqual(await manager.handle('stats', 'alice', { ...opened, stats }), { accepted: false });
    assert.equal(calls.filter(call => call.path.endsWith('/stats')).length, 1);
  } finally { await manager.close(); }
});

test('client diagnostics are owner-bound, whitelisted, bounded and included on close', async () => {
  const logs = [], { manager } = managerFixture({ log: item => logs.push(item) });
  try {
    const opened = await manager.handle('open', 'alice', {});
    const diagnostics = { stage: 'ice_started', reason: 'none', elapsedMs: 3, iceElapsedMs: 1,
      candidates: { host: 1, relay: 0 }, gathering: 'gathering', connection: 'new',
      iceErrorCodes: [701], sdp: 'PRIVATE_SDP', url: 'PRIVATE_URL', credential: 'PRIVATE_SECRET' };
    await assert.rejects(manager.handle('diagnostics', 'bob', { ...opened, diagnostics }), { code: 'video_expired' });
    await manager.handle('diagnostics', 'alice', { ...opened, diagnostics });
    await manager.handle('close', 'alice', { ...opened, diagnostics: { ...diagnostics, stage: 'closed', reason: 'ice_timeout' } });
    const reports = logs.filter(item => item.event === 'video.client_diagnostics');
    assert.equal(reports.length, 2);
    assert.equal(reports[1].reason, 'ice_timeout');
    assert.equal(reports[1].upstreamSession, opened.sessionId);
    assert.equal(reports[1].offerSent, false);
    assert.deepEqual(reports[1].iceErrorCodes, [701]);
    assert.equal(JSON.stringify(reports).includes('PRIVATE'), false);
  } finally { await manager.close(); }
});

test("heartbeat preserves the original failure; delayed cleanup does not quarantine other seats", async () => {
  let abnormal = false, cleanup = false, gets = 0, serial = 0;
  const logs = [];
  const manager = createMizzenManager({ mizzen: { base: "https://fixture.invalid", inputKey: "input", playbackKey: "playback" } }, {
    pollMs: 1, log: event => logs.push(event),
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/sessions')) return Response.json({ session_id: `12345678-1234-1234-1234-${String(++serial).padStart(12, '0')}`, state: 'ready' });
      if (url.endsWith('/playback')) return Response.json({ iceServers: [] });
      if (options.method === 'DELETE') { cleanup = true; return Response.json({}); }
      if (cleanup) { gets++; return Response.json({ state: gets < 4 ? 'closing' : 'closed' }); }
      return Response.json({ state: abnormal ? 'failed' : 'ready', error: abnormal ? 'SESSION_ENDED' : null });
    },
  });
  try {
    const first = await manager.handle('open', 'alice', {}); abnormal = true;
    await assert.rejects(manager.handle('heartbeat', 'alice', first), { code: 'video_expired', status: 409 });
    await pause(20);
    assert.ok(logs.some(event => event.event === 'video.heartbeat_state' && event.code === 'SESSION_ENDED'));
    assert.ok(logs.some(event => event.event === 'video.cleanup_pending'));
    const second = await manager.handle('open', 'bob', {});
    assert.ok(second.videoId);
    // Reconnecting the owner retries its retained lease and recovers capacity.
    const recovered = await manager.handle('open', 'alice', {});
    assert.ok(recovered.videoId);
  } finally { await manager.close(); }
});

test("terminal sessions with retained media errors release seats; pending cleanup permits bounded reconnect", async () => {
  let serial = 0, terminal = false;
  const logs = [];
  const manager = createMizzenManager({ mizzen: { base: "https://fixture.invalid", inputKey: "secret-input", playbackKey: "secret-playback" } }, {
    pollMs: 1, log: event => logs.push(event),
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/sessions')) return Response.json({ session_id: `12345678-1234-1234-1234-${String(++serial).padStart(12, '0')}`, state: 'ready' });
      if (url.endsWith('/playback')) return Response.json({ iceServers: [] });
      if (options.method === 'DELETE') return Response.json({});
      return Response.json({ state: terminal ? 'failed' : 'closing', error: 'MEDIA_UNAVAILABLE' });
    },
  });
  try {
    const first = await manager.handle('open', 'alice', {});
    await assert.rejects(manager.handle('close', 'alice', first), { code: 'video_cleanup' });
    const second = await manager.handle('open', 'alice', {});
    assert.notEqual(second.videoId, first.videoId);
    const third = await manager.handle('open', 'alice', {});
    assert.notEqual(third.videoId, second.videoId);
    await assert.rejects(manager.handle('open', 'alice', {}), { code: 'video_busy' });
    terminal = true;
    await manager.close();
    assert.ok(logs.some(event => event.event === 'video.cleanup_state' && event.state === 'failed' && event.code === 'MEDIA_UNAVAILABLE'));
    // A different owner avoids the per-owner reconnect rate limit and proves all seats were released.
    assert.ok((await manager.handle('open', 'bob', {})).videoId);
    assert.ok(!JSON.stringify(logs).includes('secret-'));
  } finally { terminal = true; await manager.close(); }
});
