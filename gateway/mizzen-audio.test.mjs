import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MizzenAudio } from "./mizzen-audio.mjs";

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  terminate() { this.readyState = 3; this.emit("close", 1006); }
}
function fixture({ ready = true } = {}) {
  let now = 0;
  const socket = new Socket(), logs = [];
  const audio = new MizzenAudio("wss://private.invalid/audio", "private-key", {
    socketFactory: () => socket, now: () => now, onProgress: progress => logs.push(progress),
  });
  const emit = data => socket.emit("message", JSON.stringify({ stream_id: audio.id, ...data }));
  socket.emit("open");
  if (ready) emit({ type: "audio.ready", max_chunk_samples: 960, max_inflight_chunks: 8 });
  return { audio, socket, logs, emit, advance: ms => { now += ms; audio.pump(); } };
}
async function failed(f, code, stage = "interrupted") {
  await assert.rejects(f.audio.done, error => error.code === code);
  assert.equal(f.audio.closed, true);
  const progress = f.logs.at(-1);
  assert.equal(progress.reason, code);
  assert.equal(progress.stage, stage);
  assert.equal(f.logs.filter(item => item.stage === "interrupted" || item.stage === "cancelled").length, 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-key|private\.invalid|raw-provider-secret/);
  return progress;
}

test("audio protocol failures expose fixed codes without provider content", async t => {
  const cases = [
    ["invalid_json", f => f.socket.emit("message", "raw-provider-secret")],
    ["invalid_message", f => f.socket.emit("message", "null")],
    ["stream_mismatch", f => f.emit({ stream_id: "raw-provider-secret", type: "audio.ready" })],
    ["invalid_limits", f => f.emit({ type: "audio.ready", max_chunk_samples: 0, max_inflight_chunks: 8 }), false],
    ["invalid_ack", f => f.emit({ type: "audio.ack", seq: 99, received_samples: 1 })],
    ["invalid_end", f => f.emit({ type: "audio.input_ended", total_samples: 0 })],
    ["provider_error", f => f.emit({ type: "error", message: "raw-provider-secret", code: "raw-provider-secret" })],
  ];
  for (const [code, trigger, ready = true] of cases) await t.test(code, async () => {
    const f = fixture({ ready });
    trigger(f);
    const progress = await failed(f, code);
    assert.equal(progress.phase, ready ? "streaming" : "waiting_ready");
  });
});

test("audio readiness, ACK, end acknowledgement and socket close timeouts are distinct", async t => {
  await t.test("ready_timeout", async () => {
    const f = fixture({ ready: false }); f.advance(10001);
    assert.equal((await failed(f, "ready_timeout")).phase, "waiting_ready");
  });
  await t.test("ack_timeout snapshots the queue before discarding it", async () => {
    const f = fixture(); f.audio.push(Buffer.alloc(3840)); f.audio.pump(); f.advance(10001);
    const progress = await failed(f, "ack_timeout");
    assert.equal(progress.queuedSamples, 960);
    assert.equal(progress.queuedMs, 40);
    assert.equal(progress.inflightChunks, 1);
    assert.equal(progress.oldestAckAgeMs, 10001);
    assert.equal(progress.samples, 960);
    assert.equal(f.audio.queue.length, 0);
  });
  for (const acknowledged of [false, true]) await t.test(acknowledged ? "close_timeout" : "end_timeout", async () => {
    const f = fixture(); f.audio.finish();
    if (acknowledged) f.emit({ type: "audio.input_ended", total_samples: 0 });
    f.advance(25001);
    const progress = await failed(f, acknowledged ? "close_timeout" : "end_timeout");
    assert.equal(progress.phase, acknowledged ? "waiting_close" : "waiting_end");
  });
});

test("audio capacity limits remain unchanged and log separate bounded causes", async t => {
  await t.test("queue_overflow", async () => {
    const f = fixture(); f.audio.push(Buffer.alloc(48000)); f.audio.push(Buffer.alloc(48000 * 120));
    const progress = await failed(f, "queue_overflow");
    assert.equal(progress.queuedMs, 1000);
    assert.equal(progress.incomingSamples, 24000 * 120);
  });
  await t.test("sample_limit", async () => {
    const f = fixture(); f.audio.samples = 7920000; f.audio.push(Buffer.alloc(1920)); f.audio.pump();
    await failed(f, "sample_limit");
    assert.equal(f.socket.sent.some(item => item.type === "audio.chunk"), false);
  });
  await t.test("incomplete_sample", async () => {
    const f = fixture(); f.audio.push(Buffer.alloc(1)); f.audio.finish();
    const progress = await failed(f, "incomplete_sample");
    assert.ok(progress.queuedMs > 0);
    assert.equal(progress.queuedSamples, 0);
  });
});

test("socket diagnostics omit raw errors and close reasons", async t => {
  await t.test("socket_error", async () => {
    const f = fixture(); f.socket.emit("error", new Error("raw-provider-secret"));
    await failed(f, "socket_error");
  });
  await t.test("socket_closed", async () => {
    const f = fixture(); f.socket.readyState = 3; f.socket.emit("close", 1011, Buffer.from("raw-provider-secret"));
    const progress = await failed(f, "socket_closed");
    assert.equal(progress.socketCloseCode, 1011);
    assert.equal(progress.socketState, 3);
  });
  await t.test("invalid close codes are not recorded", async () => {
    const f = fixture(); f.socket.emit("close", "raw-provider-secret");
    assert.equal((await failed(f, "socket_closed")).socketCloseCode, null);
  });
});

test("failed socket sends never advance PCM sequence or report audio as sent", async t => {
  const cases = [
    ["socket_not_open", f => { f.socket.readyState = 3; }],
    ["socket_backpressure", f => { f.socket.bufferedAmount = 65537; }],
    ["socket_send_failed", f => { f.socket.send = () => { throw new Error("raw-provider-secret"); }; }],
    ["socket_send_failed", f => { f.socket.send = (_text, callback) => callback(new Error("raw-provider-secret")); }],
  ];
  for (const [code, prepare] of cases) await t.test(code, async () => {
    const f = fixture(); f.audio.push(Buffer.alloc(1920)); prepare(f); f.audio.pump();
    const progress = await failed(f, code);
    assert.equal(progress.queuedSamples, 960);
    assert.equal(f.audio.seq, 0);
    assert.equal(f.audio.samples, 0);
    assert.equal(f.audio.inflight.size, 0);
    assert.equal(f.logs.some(item => item.stage === "first_pcm_sent"), false);
    if (code === "socket_backpressure") assert.equal(progress.socketBufferedBytes, 65537);
  });
});

test("intentional local cancellation is not reported as a transport interruption", async () => {
  const f = fixture(); f.audio.push(Buffer.alloc(3840));
  const drain = f.audio.drain();
  f.audio.cancel(); f.audio.cancel();
  await assert.rejects(drain, error => error.code === "local_cancel");
  await failed(f, "local_cancel", "cancelled");
  assert.equal(f.logs.some(item => item.stage === "interrupted"), false);
  f.socket.emit("message", "raw-provider-secret");
  f.advance(30000);
  assert.equal(f.logs.at(-1).stage, "cancelled");
});
