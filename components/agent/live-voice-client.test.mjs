import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

function harness(fetchImpl) {
  const nodes = [], states = [];
  const exports = {};
  class Context {
    audioWorklet = { addModule: async () => {} }; destination = {};
    async resume() {} async close() {}
  }
  class Worklet {
    chunks = [];
    port = { onmessage: null, postMessage: (data) => {
      if (data.type === "audio") { this.chunks.push(data.samples); this.port.onmessage?.({ data: { type: "playing" } }); }
      if (data.type === "end") this.port.onmessage?.({ data: { type: "ended" } });
    } };
    constructor() { nodes.push(this); }
    connect() {} disconnect() {}
  }
  const source = ts.transpileModule(readFileSync(new URL("./live-voice-client.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(source, { exports, window: { AudioContext: Context }, AudioContext: Context,
    AudioWorkletNode: Worklet, fetch: fetchImpl, crypto: { randomUUID }, performance, setTimeout, clearTimeout,
    AbortController, AbortSignal, TextDecoder, Uint8Array, Float32Array, atob });
  return { player: new exports.LiveVoicePlayer((state) => states.push(state)), nodes, states };
}

test("browser consumes split PCM SSE incrementally before done and preserves odd-byte boundaries", async () => {
  const encoder = new TextEncoder();
  let stream;
  const { player, states, nodes } = harness(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  const id = await player.start("session");
  assert.match(id, /^[0-9a-f-]+$/);
  const event = (name, payload) => stream.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
  event("ready", { format: "pcm_s16le", sampleRate: 24000, channels: 1 });
  event("audio", { data: Buffer.from([0, 128, 255]).toString("base64") });
  event("audio", { data: Buffer.from([127]).toString("base64") });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).phase, "playing");
  assert.equal(nodes[0].chunks[0][0], -1);
  assert.equal(nodes[0].chunks[1][0], 32767 / 32768);
  event("done", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1).phase, "done");
  assert.equal(typeof states.at(-1).firstAudioMs, "number");
  await player.dispose();
});

test("voice network failure is isolated and stale chunks cannot restart cancelled playback", async () => {
  const failed = harness(async () => new Response(null, { status: 503 }));
  assert.equal(await failed.player.start("session"), undefined);
  assert.equal(failed.states.at(-1).phase, "error");
  await failed.player.dispose();

  let stream;
  const active = harness(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  await active.player.start("session");
  active.player.stop();
  stream.enqueue(new TextEncoder().encode('event: audio\ndata: {"data":"AAA="}\n\n'));
  stream.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active.nodes[0].chunks.length, 0);
  assert.equal(active.states.at(-1).phase, "idle");
  await active.player.dispose();
});

test("signed replay and live audio share subtitle/consumed-progress mapping and clear it on stop", async () => {
  let stream, request;
  const { player, nodes, states } = harness(async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  });
  await player.start("session", { ticket: "signed-reply", messageIndex: 3 });
  assert.equal(request.ticket, "signed-reply"); assert.equal(request.videoId, undefined);
  const event = (name, payload) => stream.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
  event("subtitle", { words: [{ text: "你好", startSample: 1200, endSample: 2400 }] });
  event("audio", { data: Buffer.alloc(100).toString("base64") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.playback.getSnapshot().sample, 0);
  assert.equal(player.playback.getSnapshot().messageIndex, 3);
  assert.equal(player.playback.getSnapshot().words[0].startSample, 1200);
  nodes[0].port.onmessage({ data: { type: "progress", sample: 1500 } });
  assert.equal(player.playback.getSnapshot().sample, 1500);
  player.pause(); assert.equal(states.at(-1).phase, 'paused');
  assert.equal(player.playback.getSnapshot().sample, 1500);
  await player.resume(); assert.equal(states.at(-1).phase, 'playing');
  player.stop(); assert.equal(player.playback.getSnapshot().active, false);
  assert.equal(player.playback.getSnapshot().words.length, 0);
  await player.dispose();
});

test("sentence boundaries precede playback and late subtitle data cannot replace the batch timeline", async () => {
  let stream;
  const { player, nodes } = harness(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })));
  await player.start('second-turn', { messageIndex: 3 });
  const event = (name, payload) => stream.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
  event('segment', { text: '这是正文，不包含 thinking。', startSample: 0, endSample: null });
  event('audio', { data: Buffer.alloc(4800).toString('base64') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.playback.getSnapshot().segments[0].startSample, 0);
  assert.equal(player.playback.getSnapshot().words.length, 0);
  nodes[0].port.onmessage({ data: { type: 'progress', sample: 1000 } });
  event('segment', { text: '这是正文，不包含 thinking。', startSample: 0, endSample: 2400 });
  event('segment', { text: '下一组。', startSample: 2400, endSample: null });
  event('subtitle', { words: [{ text: 'late subtitle', startSample: 0, endSample: 2000 }] });
  event('segment', { text: 'stale', startSample: 0, endSample: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.playback.getSnapshot().segments.length, 2);
  assert.equal(player.playback.getSnapshot().segments[0].endSample, 2400);
  assert.equal(player.playback.getSnapshot().sample, 1000);
  player.stop(); assert.equal(player.playback.getSnapshot().segments.length, 0);
  await player.dispose();
});
