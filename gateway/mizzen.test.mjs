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
function managerFixture(extra = {}) {
  const calls = []; let closed = false, ttsEmit;
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
    makeAudio: () => ({ push() {}, finish: () => Promise.resolve(), done: new Promise(() => {}), cancel() {} }),
    makeTts: emit => { ttsEmit = emit; return { push() {}, finish() {}, cancel() {} }; }, ...extra,
  });
  return { manager, calls, emit: (...args) => ttsEmit(...args) };
}
test("video credentials absent is a no-upstream preview; keys never appear in capabilities", async () => {
  const manager = createMizzenManager({}, { fetchImpl: () => { throw new Error("must not fetch"); } });
  try { assert.deepEqual(await manager.handle("capabilities", "a", {}), { enabled: false, reason: "credentials_missing" });
    await assert.rejects(manager.handle("open", "a", {}), { code: "video_not_configured" }); }
  finally { await manager.close(); }
});
test("video session ownership, separate keys, offer-once, PCM routing and input-end keep playback alive", async () => {
  const { manager, calls, emit } = managerFixture();
  try {
    const opened = await manager.handle("open", "alice", {});
    assert.deepEqual(Object.keys(opened).sort(), ["iceServers", "videoId"]);
    await assert.rejects(manager.handle("heartbeat", "bob", opened), { code: "video_expired" });
    assert.throws(() => manager.voice(() => {}, "alice", opened.videoId), { code: "video_not_ready" });
    await manager.handle("offer", "alice", { ...opened, sdp: "v=0\r\n" });
    await assert.rejects(manager.handle("offer", "alice", { ...opened, sdp: "v=0\r\n" }), { code: "video_busy" });
    await manager.handle("ready", "alice", opened);
    const events = [], voice = manager.voice((event, data) => events.push({ event, data }), "alice", opened.videoId);
    emit("audio", { data: Buffer.alloc(1920).toString("base64") }); emit("done", {}); await pause(0);
    assert.deepEqual(events, [{ event: "done", data: {} }]);
    voice.cancel(); assert.equal(calls.some(call => call.method === "DELETE"), false);
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
