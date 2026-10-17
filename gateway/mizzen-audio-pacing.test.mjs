import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { MizzenAudio } from "./mizzen-audio.mjs";

const SAMPLE_RATE = 24_000;
const BYTES_PER_MS = 48;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function pcm(milliseconds) {
  const bytes = Buffer.alloc(milliseconds * BYTES_PER_MS);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + (i >>> 8)) & 255;
  return bytes;
}

// All pacing tests use the real adapter and protocol, but a deterministic
// monotonic clock and provider ACKs. No network, credentials or speech content.
function fixture({ packetSamples = 960, window = 8, ackDelay = () => 0,
  sendDelay = () => 0, ready = true } = {}) {
  const clock = { mono: 0, wall: 1_800_000_000_000 };
  const chunks = [], pendingAcks = [], logs = [], ends = [];
  let audio, pendingEnd;
  class Socket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    send(text, callback) {
      const message = JSON.parse(text);
      if (message.type === "audio.chunk") {
        // Model a scheduler/process preemption inside serialization/send.
        const blockedMs = sendDelay(message.seq);
        clock.mono += blockedMs;
        clock.wall += blockedMs;
        const bytes = Buffer.from(message.data, "base64");
        chunks.push({ ...message, data: undefined, bytes, at: clock.mono });
        pendingAcks.push({ due: clock.mono + ackDelay(message.seq),
          seq: message.seq, samples: message.sample_offset + message.sample_count });
      } else if (message.type === "audio.end") {
        ends.push(message);
        pendingEnd = message;
      }
      callback?.();
    }
    terminate() { this.readyState = 3; this.emit("close", 1006); }
  }
  const socket = new Socket();
  const emit = data => socket.emit("message", JSON.stringify({ stream_id: audio.id, ...data }));
  audio = new MizzenAudio("wss://pacing.invalid/audio", "test-only", {
    socketFactory: () => socket,
    now: () => clock.wall,
    monotonicNow: () => clock.mono,
    onProgress: value => logs.push(value),
  });
  socket.emit("open");
  if (ready) emit({ type: "audio.ready", max_chunk_samples: packetSamples, max_inflight_chunks: window });
  clearInterval(audio.timer);
  let peakInflight = 0;
  function ackDue() {
    for (let i = pendingAcks.length - 1; i >= 0; i--) {
      if (pendingAcks[i].due > clock.mono) continue;
      const [{ seq, samples }] = pendingAcks.splice(i, 1);
      emit({ type: "audio.ack", seq, received_samples: samples });
    }
    if (pendingEnd) {
      emit({ type: "audio.input_ended", total_samples: pendingEnd.total_samples });
      pendingEnd = undefined;
      socket.readyState = 3;
      socket.emit("close", 1000);
    }
  }
  function pump() {
    ackDue();
    const before = chunks.length;
    audio.pump();
    assert.ok(chunks.length - before <= 1, "one pump must never burst multiple PCM packets");
    peakInflight = Math.max(peakInflight, audio.inflight.size);
    ackDue();
  }
  function advance(ms, wallMs = ms) {
    clock.mono += ms;
    clock.wall += wallMs;
    pump();
  }
  return { audio, socket, emit, chunks, ends, logs, clock, pump, advance, ackDue,
    peakInflight: () => peakInflight,
    cleanup: () => { clearInterval(audio.timer); if (!audio.closed) audio.cancel(); },
  };
}

async function verifyComplete(f, expected) {
  await f.audio.done;
  assert.equal(f.ends.length, 1);
  assert.equal(f.ends[0].total_samples, expected.length / 2);
  assert.equal(f.audio.samples, expected.length / 2);
  assert.equal(f.audio.queue.length, 0);
  assert.equal(f.audio.inflight.size, 0);
  let offset = 0;
  for (let i = 0; i < f.chunks.length; i++) {
    const chunk = f.chunks[i];
    assert.equal(chunk.seq, i);
    assert.equal(chunk.sample_offset, offset);
    assert.equal(chunk.sample_count * 2, chunk.bytes.length);
    offset += chunk.sample_count;
  }
  assert.equal(offset, expected.length / 2);
  assert.equal(sha256(Buffer.concat(f.chunks.map(chunk => chunk.bytes))), sha256(expected),
    "every input PCM byte must arrive in order, without omission or duplication");
}

for (const scenario of [
  { name: "20/19/21 ms timer jitter", ticks: [20, 19, 21], ackDelay: () => 0 },
  // Production polls every 10ms now. Coarse 20ms polls could repeatedly miss
  // the >=20ms catch-up spacing boundary; the extra wakeups avoid that drift.
  { name: "10ms-poll jitter and delayed/out-of-order ACKs", ticks: [7, 13, 9, 12, 8, 27, 3, 11],
    ackDelay: seq => [0, 80, 140, 60, 200, 30][seq % 6] },
  { name: "repeated 200/400/800ms stalls plus jitter and delayed ACKs", ticks: [7, 13, 9, 12, 8, 27, 3, 11],
    ackDelay: seq => [0, 80, 140, 60, 200, 30][seq % 6], periodicStalls: [200, 400, 800] },
]) test(`five minutes do not accumulate pacing drift with ${scenario.name}`, async t => {
  const f = fixture({ ackDelay: scenario.ackDelay });
  t.after(f.cleanup);
  const durationMs = 300_000;
  const source = pcm(durationMs);
  let sourceOffset = 0, tick = 0, finishStarted = false;
  let nextStallAt = 10_000, stalls = 0, recoveryAt, recovered = 0, maxRecoveredLagMs = 0;
  const feed = () => {
    // Deliberately unaligned source chunks also exercise PCM reassembly. Keep
    // queued input available, so this measures pacing rather than TTS latency.
    while (f.audio.queue.length < 2_000 * BYTES_PER_MS && sourceOffset < source.length) {
      const end = Math.min(source.length, sourceOffset + 33_331);
      f.audio.push(source.subarray(sourceOffset, end));
      sourceOffset = end;
    }
    if (sourceOffset === source.length && !finishStarted) {
      finishStarted = true;
      f.audio.finish();
    }
  };
  feed();
  f.pump();
  while (!f.audio.closed && f.clock.mono < durationMs + 2_000) {
    feed();
    if (scenario.periodicStalls && f.clock.mono >= nextStallAt && nextStallAt < durationMs - 2_000) {
      assert.equal(recoveryAt, undefined, "the preceding stall must recover before the next one");
      f.advance(scenario.periodicStalls[stalls++ % scenario.periodicStalls.length]);
      recoveryAt = f.clock.mono + 2_500;
      nextStallAt += 10_000;
    } else {
      f.advance(scenario.ticks[tick++ % scenario.ticks.length]);
    }
    if (recoveryAt !== undefined && f.clock.mono >= recoveryAt) {
      const last = f.chunks.at(-1);
      const lag = last.at - last.sample_offset / 24;
      assert.ok(lag < 40, `stall ${stalls} left ${lag}ms of permanent delay`);
      assert.equal(f.audio.pacingRebasedMs, 0, "sub-second stalls must be recovered, not forgiven by rebasing");
      maxRecoveredLagMs = Math.max(maxRecoveredLagMs, lag);
      recoveryAt = undefined;
      recovered++;
    }
  }
  assert.equal(f.audio.closed, true, `300s PCM must finish near 300s, not progressively fall behind: ${JSON.stringify({
    elapsedMs: f.clock.mono, sentAudioMs: f.audio.samples / 24, maxLateMs: f.audio.maxLatenessMs,
    rebasedMs: f.audio.pacingRebasedMs, queuedMs: f.audio.queue.length / 48,
  })}`);
  await verifyComplete(f, source);
  assert.equal(f.chunks.length, 7_500);
  assert.ok(f.peakInflight() <= 8);
  const lateness = f.chunks.map(chunk => chunk.at - chunk.sample_offset / 24);
  const maxLateMs = Math.max(...lateness);
  const minLateMs = Math.min(...lateness);
  assert.ok(maxLateMs <= (scenario.periodicStalls ? 1_000 : 80), `maximum scheduling lateness was ${maxLateMs}ms`);
  assert.ok(minLateMs >= -0.001, `audio ran ahead of its fixed sample clock by ${-minLateMs}ms`);
  if (scenario.periodicStalls) {
    assert.equal(stalls, 29);
    assert.equal(recovered, stalls);
    assert.equal(f.audio.pacingRebasedMs, 0);
  } else {
    for (const minute of [1, 2, 3, 4]) {
      const chunk = f.chunks[minute * 1_500];
      assert.ok(chunk.at - minute * 60_000 <= 80, `lateness grew by minute ${minute}`);
    }
  }
  const last = f.chunks.at(-1);
  const sentDurationMs = last.at + last.sample_count / 24;
  assert.ok(sentDurationMs <= durationMs + 80);
  t.diagnostic(JSON.stringify({ simulatedMinutes: 5, packets: f.chunks.length,
    maxLateMs, finalLateMs: sentDurationMs - durationMs, peakInflight: f.peakInflight(),
    ...(scenario.periodicStalls ? { stalls, recovered, maxRecoveredLagMs, rebasedMs: f.audio.pacingRebasedMs } : {}) }));
});

test("a long scheduler stall allows only bounded, spaced catch-up", t => {
  const f = fixture();
  t.after(f.cleanup);
  f.audio.push(pcm(20_000));
  f.pump();
  for (let i = 0; i < 50; i++) f.advance(20);
  f.advance(5_000);
  const resumeAt = f.clock.mono;
  const resumeIndex = f.chunks.length - 1;
  for (let i = 0; i < 50; i++) f.pump();
  assert.equal(f.chunks.length - 1, resumeIndex, "same-time callbacks must not burst packets after a stall");
  for (let i = 0; i < 100; i++) f.advance(20);
  const resumed = f.chunks.slice(resumeIndex);
  for (let i = 1; i < resumed.length; i++) {
    assert.ok(resumed[i].at - resumed[i - 1].at >= 20, "catch-up must not exceed twice real-time");
  }
  const submittedMs = resumed.reduce((sum, chunk) => sum + chunk.sample_count / 24, 0);
  assert.ok(submittedMs <= f.clock.mono - resumeAt + 1_000 + 40,
    "a multi-second stall must not become multi-second catch-up debt");
  const stable = resumed.filter(chunk => chunk.at >= resumeAt + 1_500);
  for (let i = 1; i < stable.length; i++) {
    assert.equal(stable[i].at - stable[i - 1].at, 40, "normal pacing must resume after bounded recovery");
  }
});

test("preemption during send cannot bypass the minimum actual inter-packet gap", t => {
  const f = fixture({ sendDelay: seq => seq === 1 ? 35 : 0 });
  t.after(f.cleanup);
  f.audio.push(pcm(400));
  f.pump();
  f.advance(40);
  assert.equal(f.chunks[1].at, 75);
  f.advance(5);
  assert.equal(f.chunks.length, 2, "a stale pump-start timestamp would allow another send only5ms later");
  f.advance(15);
  assert.equal(f.chunks.length, 3);
  assert.equal(f.chunks[2].at, 95);
  for (let i = 0; i < 100; i++) f.advance(5);
  for (let i = 1; i < f.chunks.length; i++) {
    assert.ok(f.chunks[i].at - f.chunks[i - 1].at >= 20);
  }
});

test("catch-up still honors the provider ACK window and smaller packet limits", t => {
  const f = fixture({ packetSamples: 240, window: 2, ackDelay: () => Infinity });
  t.after(f.cleanup);
  f.audio.push(pcm(5_000));
  f.pump();
  for (let i = 0; i < 100; i++) f.advance(5);
  assert.equal(f.chunks.length, 2);
  assert.equal(f.audio.inflight.size, 2);
  assert.ok(f.chunks.every(chunk => chunk.sample_count === 240));
  const first = f.chunks[0];
  f.emit({ type: "audio.ack", seq: first.seq, received_samples: first.sample_offset + first.sample_count });
  f.pump();
  assert.equal(f.chunks.length, 3);
  for (let i = 0; i < 20; i++) f.pump();
  assert.equal(f.chunks.length, 3);
  assert.equal(f.audio.inflight.size, 2);
});

test("genuine PCM starvation rebases the clock instead of banking catch-up credit", t => {
  const f = fixture();
  t.after(f.cleanup);
  f.audio.push(pcm(40));
  f.pump();
  f.advance(2_000);
  f.audio.push(pcm(400));
  f.pump();
  const restartIndex = f.chunks.length - 1;
  const restartAt = f.chunks[restartIndex].at;
  for (let i = 0; i < 20; i++) f.advance(20);
  const restarted = f.chunks.slice(restartIndex);
  assert.equal(restarted.length, 10);
  assert.deepEqual(restarted.map(chunk => chunk.at - restartAt), Array.from({ length: 10 }, (_, i) => i * 40));
});

test("partial PCM tails drain and finish exactly once under jitter", async t => {
  const f = fixture({ ackDelay: seq => seq % 2 ? 75 : 0 });
  t.after(f.cleanup);
  const source = pcm(107);
  f.audio.push(source.subarray(0, 3));
  f.audio.push(source.subarray(3));
  const drain = f.audio.drain({ tailMs: 17 });
  let drained = false;
  drain.then(() => { drained = true; });
  for (let tick = 0; !drained && tick < 100; tick++) {
    f.advance([20, 19, 21][tick % 3]);
    await Promise.resolve();
  }
  assert.equal(drained, true);
  f.audio.finish();
  for (let i = 0; !f.audio.closed && i < 100; i++) f.advance(20);
  await verifyComplete(f, Buffer.concat([source, Buffer.alloc(17 * BYTES_PER_MS)]));
  assert.equal(f.chunks.length, 4);
  assert.equal(f.chunks.at(-1).sample_count, 96);
});

test("wall-clock jumps change log timestamps, not pacing or protocol timeout clocks", async t => {
  const f = fixture({ ackDelay: () => 120 });
  t.after(f.cleanup);
  const source = pcm(2_000);
  f.audio.push(source);
  f.audio.finish();
  for (let tick = 0; !f.audio.closed && tick < 120; tick++) {
    const wallStep = tick === 5 ? 3_600_000 : tick === 40 ? -7_200_000 : 20;
    f.advance(20, wallStep);
  }
  await verifyComplete(f, source);
  assert.equal(f.chunks.length, 50);
  assert.deepEqual(f.chunks.map(chunk => chunk.at), Array.from({ length: 50 }, (_, i) => i * 40));
  assert.equal(f.logs.find(item => item.stage === "end_sent").at, f.clock.wall);
  assert.ok(f.logs.every(item => item.at > 1_000_000_000_000), "telemetry must retain wall-clock timestamps");
});

test("stream sample duration cap remains 330 seconds", async t => {
  const f = fixture();
  t.after(f.cleanup);
  f.audio.samples = SAMPLE_RATE * 330;
  f.audio.push(pcm(40));
  f.pump();
  await assert.rejects(f.audio.done, { code: "sample_limit" });
  assert.equal(f.chunks.length, 0);
});

test("pacing telemetry separates wall timestamps and numeric ACK waits without private data", t => {
  const f = fixture({ ackDelay: () => Infinity });
  t.after(f.cleanup);
  f.audio.push(pcm(40)); f.pump(); f.advance(5000);
  const beforeAck = f.logs.find(item => item.stage === "pacing");
  assert.equal(beforeAck.at, f.clock.wall);
  assert.equal(beforeAck.elapsedMs, 5000);
  assert.equal(beforeAck.sentAudioMs, 40);
  assert.equal(beforeAck.meanAckMs, null);
  assert.equal(beforeAck.maxAckMs, null);
  f.emit({ type: "audio.ack", seq: 0, received_samples: 960 });
  f.advance(5000);
  const afterAck = f.logs.filter(item => item.stage === "pacing").at(-1);
  assert.equal(afterAck.meanAckMs, 5000);
  assert.equal(afterAck.maxAckMs, 5000);
  assert.equal(afterAck.inflightChunks, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /test-only|pacing\.invalid|"data"/);
});
