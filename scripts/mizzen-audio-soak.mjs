// Optional real-time pacing regression, with no vendor connection or credentials.
// Run: node scripts/mizzen-audio-soak.mjs [--seconds=300]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import WebSocket, { WebSocketServer } from "ws";
import { MizzenAudio } from "../gateway/mizzen-audio.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !/^--seconds=\d+$/.test(arg))) {
  throw new Error("Usage: node scripts/mizzen-audio-soak.mjs [--seconds=1..300]");
}
const seconds = args.length ? Number(args[0].split("=")[1]) : 300;
assert(Number.isInteger(seconds) && seconds >= 1 && seconds <= 300, "seconds must be 1..300");
// A brief host stall can exceed normal 40ms pacing. Require bounded recovery,
// not an abort before the scheduler has a chance to catch up at its <=2x rate.
const MAX_TRANSIENT_LAG_MS = 1000;
const MAX_SETTLED_LAG_MS = 80;

const totalSamples = seconds * 24000;
const expectedHash = createHash("sha256");
const receivedHash = createHash("sha256");
const timers = new Set();
const intervals = [];
const failures = [];
const minuteBuckets = new Map();
const recentLags = [];
const eventLoopDelay = monitorEventLoopDelay({ resolution: 10 });
eventLoopDelay.enable();
const clock = () => performance.now();
const startedAt = clock();
let firstSentAt;
let lastSentAt;
let minGapMs = Infinity;
let maxGapMs = 0;
let maxLagMs = 0;
let maxInflight = 0;
let maxQueuedMs = 0;
let sentSamples = 0;
let sentChunks = 0;
let receivedSamples = 0;
let receivedChunks = 0;
let queuedSamples = 0;
let acknowledgedChunks = 0;
let pendingAcks = 0;
let jitterCount = 0;
let ended = false;
let finishing = false;
let audio;
let randomState = 0x1234abcd;

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

function pcm(offset, count) {
  const bytes = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index++) {
    bytes.writeUInt16LE(((offset + index) * 73 + 1907) & 0xffff, index * 2);
  }
  return bytes;
}

function later(callback, delay) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);
  timers.add(timer);
  return timer;
}

function fail(error) {
  failures.push(error instanceof Error ? error.message : String(error));
  if (audio && !audio.closed) audio.cancel();
}

function checked(callback) {
  return (...values) => {
    try { callback(...values); } catch (error) { fail(error); }
  };
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function bucketSummary() {
  return [...minuteBuckets.entries()].map(([minute, bucket]) => ({
    minute, chunks: bucket.count, meanLagMs: round(bucket.sum / bucket.count),
    maxLagMs: round(bucket.max), lastLagMs: round(bucket.last),
    pacingRebasedMs: round(bucket.rebased),
  }));
}

function progress(type) {
  return {
    type, requestedSeconds: seconds, elapsedSeconds: round((clock() - startedAt) / 1000),
    audioSecondsSent: round(sentSamples / 24000), receivedChunks, acknowledgedChunks,
    minSendGapMs: round(minGapMs), maxSendGapMs: round(maxGapMs), maxSendLagMs: round(maxLagMs),
    maxInflightChunks: maxInflight, maxQueuedMs: round(maxQueuedMs), jitterCount,
    pacingRebasedMs: round(audio?.pacingRebasedMs ?? 0), underrunMs: round(audio?.underrunMs ?? 0),
    maxEventLoopDelayMs: round(eventLoopDelay.max / 1e6), p99EventLoopDelayMs: round(eventLoopDelay.percentile(99) / 1e6),
    minuteBuckets: bucketSummary(),
  };
}

const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
server.on("error", fail);
server.on("connection", socket => {
  socket.on("error", fail);
  socket.on("message", checked(raw => {
    const data = JSON.parse(raw.toString());
    assert.equal(data.stream_id, audio.id, "stream identity changed");
    if (data.type === "audio.start") {
      assert.equal(data.sample_rate, 24000);
      assert.equal(data.channels, 1);
      assert.equal(data.format, "pcm_s16le");
      socket.send(JSON.stringify({ type: "audio.ready", stream_id: data.stream_id,
        max_chunk_samples: 960, max_inflight_chunks: 8 }));
    } else if (data.type === "audio.chunk") {
      assert.equal(data.seq, receivedChunks++, "receiver packet sequence changed");
      assert.equal(data.sample_offset, receivedSamples, "receiver sample offset changed");
      assert(Number.isInteger(data.sample_count) && data.sample_count > 0 && data.sample_count <= 960);
      const bytes = Buffer.from(data.data, "base64");
      assert.deepEqual(bytes, pcm(receivedSamples, data.sample_count), "PCM changed or reordered");
      receivedHash.update(bytes);
      receivedSamples += data.sample_count;
      const ackSamples = receivedSamples;
      pendingAcks++;
      assert(pendingAcks <= 8, "receiver ACK window exceeded");
      // Deterministic 5..90ms delays allow ACKs to arrive out of order too.
      const delay = data.seq % 17 === 0 ? 90 : 5 + Math.floor(random() * 86);
      later(checked(() => {
        pendingAcks--;
        acknowledgedChunks++;
        socket.send(JSON.stringify({ type: "audio.ack", stream_id: data.stream_id,
          seq: data.seq, received_samples: ackSamples }));
      }), delay);
    } else if (data.type === "audio.end") {
      assert.equal(pendingAcks, 0, "audio.end preceded outstanding ACKs");
      assert.equal(data.total_samples, totalSamples, "final sample count differs");
      assert.equal(receivedSamples, totalSamples, "audio ended before all PCM arrived");
      ended = true;
      socket.send(JSON.stringify({ type: "audio.input_ended", stream_id: data.stream_id,
        total_samples: receivedSamples }), () => socket.close(1000));
    } else {
      throw new Error(`Unexpected input protocol message: ${data.type}`);
    }
  }));
});

try {
  await once(server, "listening");
  audio = new MizzenAudio(`ws://127.0.0.1:${server.address().port}`, "local-test-only", {
    socketFactory(url, options) {
      const socket = new WebSocket(url, options);
      const send = socket.send.bind(socket);
      socket.send = (raw, ...rest) => {
        try {
          const data = JSON.parse(raw);
          if (data.type === "audio.chunk") {
            const at = clock();
            firstSentAt ??= at;
            const lag = at - firstSentAt - data.sample_offset / 24;
            const gap = lastSentAt === undefined ? undefined : at - lastSentAt;
            assert.equal(data.seq, sentChunks++, "source packet sequence changed");
            assert.equal(data.sample_offset, sentSamples, "source sample offset changed");
            if (gap !== undefined) {
              minGapMs = Math.min(minGapMs, gap);
              maxGapMs = Math.max(maxGapMs, gap);
              assert(gap >= 19, `same-time/excessive catch-up burst: gap ${round(gap)}ms`);
            }
            maxLagMs = Math.max(maxLagMs, lag);
            assert(lag <= MAX_TRANSIENT_LAG_MS,
              `send lag exceeded ${MAX_TRANSIENT_LAG_MS}ms: ${round(lag)}ms`);
            const bucketNumber = Math.floor((at - firstSentAt) / 60000) + 1;
            const bucket = minuteBuckets.get(bucketNumber) ?? { count: 0, sum: 0, max: 0, last: 0 };
            bucket.count++; bucket.sum += lag; bucket.max = Math.max(bucket.max, lag); bucket.last = lag;
            bucket.rebased = audio.pacingRebasedMs ?? 0;
            minuteBuckets.set(bucketNumber, bucket);
            recentLags.push(lag);
            if (recentLags.length > 250) recentLags.shift();
            sentSamples += data.sample_count;
            lastSentAt = at;
            maxInflight = Math.max(maxInflight, audio.inflight.size + 1);
            assert(maxInflight <= 8, "source ACK window exceeded");
          }
          return send(raw, ...rest);
        } catch (error) {
          // MizzenAudio deliberately sanitizes send errors. Preserve this local
          // test assertion separately so a failed soak identifies the invariant.
          failures.push(error instanceof Error ? error.message : String(error));
          throw error;
        }
      };
      return socket;
    },
  });

  function refill() {
    // Never preload the entire recording: keep less than two seconds of PCM.
    while (queuedSamples < totalSamples && audio.queue.length / 48 < 1000) {
      const count = Math.min(12000, totalSamples - queuedSamples);
      const bytes = pcm(queuedSamples, count);
      expectedHash.update(bytes);
      audio.push(bytes);
      queuedSamples += count;
      maxQueuedMs = Math.max(maxQueuedMs, audio.queue.length / 48);
    }
    if (queuedSamples === totalSamples && !finishing) {
      finishing = true;
      void audio.finish();
    }
  }
  refill();
  intervals.push(setInterval(checked(refill), 100));
  intervals.push(setInterval(() => console.log(JSON.stringify(progress("progress"))), 30000));
  // Occasional sleeping (not busy-spin) blocks the event loop like brief GC.
  // 31..49ms every 3.1s: under 1.6% blocked time, with real timer callbacks.
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  intervals.push(setInterval(() => {
    jitterCount++;
    Atomics.wait(waitArray, 0, 0, 31 + Math.floor(random() * 19));
  }, 3100));
  later(() => fail(new Error("Soak exceeded requested duration plus 10s")), seconds * 1000 + 10000);
  console.log(JSON.stringify({ type: "started", seconds, transport: "loopback WebSocket",
    packetMs: 40, ackDelayMs: [5, 90], jitterMs: [31, 49],
    maxAllowedTransientLagMs: MAX_TRANSIENT_LAG_MS, maxAllowedSettledLagMs: MAX_SETTLED_LAG_MS }));
  await audio.done;
  assert(ended, "missing graceful audio.end/input_ended/socket-close lifecycle");
  assert.equal(queuedSamples, totalSamples);
  assert.equal(sentSamples, totalSamples);
  assert.equal(receivedSamples, totalSamples);
  assert.equal(acknowledgedChunks, receivedChunks);
  const expectedDigest = expectedHash.digest("hex");
  const actualDigest = receivedHash.digest("hex");
  assert.equal(actualDigest, expectedDigest, "PCM digest mismatch");
  const buckets = [...minuteBuckets.values()];
  const firstMinuteMean = buckets[0].sum / buckets[0].count;
  const finalTenSecondMean = recentLags.reduce((sum, lag) => sum + lag, 0) / recentLags.length;
  const lagGrowthMs = finalTenSecondMean - firstMinuteMean;
  assert(lagGrowthMs <= 80, `sustained send lag growth: ${round(lagGrowthMs)}ms`);
  assert(finalTenSecondMean < MAX_SETTLED_LAG_MS,
    `send lag did not recover: final 10s mean ${round(finalTenSecondMean)}ms`);
  assert.equal(audio.pacingRebasedMs, 0, "unexpected timeline rebase during bounded jitter soak");
  assert.equal(audio.underrunMs, 0, "bounded source queue unexpectedly ran dry");
  assert.equal(failures.length, 0, failures.join("; "));
  console.log(JSON.stringify({ ...progress("passed"), lagGrowthMs: round(lagGrowthMs),
    finalTenSecondMeanLagMs: round(finalTenSecondMean),
    pcmSha256: actualDigest, gracefulEnd: ended,
    scope: "actual MizzenAudio, real Node timers and loopback WS; not provider/browser playback" }));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.error(JSON.stringify({ ...progress("failed"), failures }));
  process.exitCode = 1;
} finally {
  eventLoopDelay.disable();
  for (const interval of intervals) clearInterval(interval);
  for (const timer of timers) clearTimeout(timer);
  if (audio && !audio.closed) audio.cancel();
  for (const client of server.clients) client.terminate();
  await new Promise(resolve => server.close(resolve));
}
