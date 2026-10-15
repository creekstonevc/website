import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { MizzenAudio } from "./mizzen-audio.mjs";
import { PacedVideoTts } from "./video-tts.mjs";

// Real adapters with only the external services/time mocked. All PCM queue
// measurements below come from MizzenAudio, never from a stand-in buffer count.
function environment() {
  let now = 0, nextTimer = 0;
  const timers = new Map(), streams = [];
  const setTimer = (callback, delay) => {
    const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id;
  };
  const clearTimer = id => timers.delete(id);
  const step = async () => {
    now += 40;
    for (const stream of streams) stream.socket.deliverDue();
    for (const [id, timer] of [...timers]) if (timer.at <= now) {
      timers.delete(id); timer.callback();
    }
    for (const stream of streams) { stream.audio.pump(); stream.observe(); }
    // Allow drain() -> finish() and done() chains to run between real PCM ticks.
    await Promise.resolve(); await Promise.resolve();
  };
  const until = async (predicate, maxSteps = 10000) => {
    for (let i = 0; i < maxSteps && !predicate(); i++) await step();
    assert.ok(predicate(), "audio pipeline did not complete within its bounded duration");
  };
  const createStream = () => {
    const actualHash = createHash("sha256"), expectedHash = createHash("sha256");
    const progress = [], events = [], batches = [];
    let samples = 0, sequence = 0, previousSendAt = null, emittedBytes = 0, expectedBytes = 0;
    let endFrame = null, starts = 0, activeTts = 0, peakTts = 0;
    let peakQueueMs = 0, peakBufferedMs = 0, ttsDone = false, drainPromise;
    class Socket extends EventEmitter {
      readyState = 1; bufferedAmount = 0; pending = [];
      send(text) {
        const frame = JSON.parse(text);
        if (frame.type === "audio.start") { starts++; return; }
        if (frame.type === "audio.chunk") {
          assert.equal(frame.seq, sequence++);
          assert.equal(frame.sample_offset, samples);
          assert.ok(frame.sample_count > 0 && frame.sample_count <= 960);
          const bytes = Buffer.from(frame.data, "base64");
          assert.equal(bytes.length, frame.sample_count * 2);
          if (previousSendAt !== null) assert.ok(now - previousSendAt >= 40, "PCM must not burst ahead of real-time pacing");
          previousSendAt = now; samples += frame.sample_count; emittedBytes += bytes.length;
          actualHash.update(bytes);
          this.pending.push({ at: now + 40, type: "ack", seq: frame.seq, samples });
        } else if (frame.type === "audio.end") {
          assert.equal(endFrame, null, "an input can end only once");
          assert.equal(frame.total_samples, samples);
          assert.equal(this.pending.some(item => item.type === "ack"), false, "end requires every PCM ACK");
          endFrame = frame;
          this.pending.push({ at: now + 40, type: "end" });
        } else assert.fail(`Unexpected audio frame type: ${frame.type}`);
      }
      deliverDue() {
        while (this.pending[0]?.at <= now) {
          const next = this.pending.shift();
          if (this.readyState !== 1) continue;
          if (next.type === "ack") this.emit("message", JSON.stringify({
            type: "audio.ack", stream_id: audio.id, seq: next.seq, received_samples: next.samples,
          }));
          else {
            this.emit("message", JSON.stringify({ type: "audio.input_ended", stream_id: audio.id, total_samples: samples }));
            this.readyState = 3; this.emit("close", 1000);
          }
        }
      }
      terminate() { this.readyState = 3; this.emit("close", 1006); }
    }
    const socket = new Socket();
    const audio = new MizzenAudio("wss://fixture.invalid/audio", "fixture-input", {
      socketFactory: () => socket, now: () => now, onProgress: item => progress.push(item),
    });
    clearInterval(audio.timer); // Drive the real pump at controlled 40 ms ticks.
    socket.emit("open");
    socket.emit("message", JSON.stringify({ type: "audio.ready", stream_id: audio.id, max_chunk_samples: 960, max_inflight_chunks: 8 }));
    const observe = () => {
      peakQueueMs = Math.max(peakQueueMs, audio.queue.length / 48);
      peakBufferedMs = Math.max(peakBufferedMs, audio.queue.length / 48 + audio.inflight.size * 40);
    };
    const tts = new PacedVideoTts({ maxTtsCharacters: 8000 }, (event, data) => {
      events.push(event);
      if (event === "audio") { audio.push(Buffer.from(data.data, "base64")); observe(); }
      else if (event === "done") {
        ttsDone = true;
        const tail = Buffer.alloc(300 * 48); expectedHash.update(tail); expectedBytes += tail.length;
        drainPromise = audio.drain({ tailMs: 300 }).then(() => audio.finish());
        // A failure must be reported by assertions, not an unhandled rejection.
        drainPromise.catch(() => {}); observe();
      }
    }, {
      setTimer, clearTimer,
      bufferedMs: () => audio.queue.length / 48 + audio.inflight.size * 40,
      makeTts: emit => {
        activeTts++; peakTts = Math.max(peakTts, activeTts);
        let text = "", finished = false;
        return {
          push(part) { text += part; },
          finish() {
            // 50ms of speech per character, produced instantly per batch.
            const bytes = Buffer.alloc(text.length * 2400, (batches.length * 17 + 1) % 256);
            batches.push(text); expectedHash.update(bytes); expectedBytes += bytes.length;
            emit("audio", { data: bytes.toString("base64") });
            finished = true; activeTts--; emit("done", {});
          },
          cancel() { if (!finished) { finished = true; activeTts--; } },
        };
      },
    });
    const stream = {
      audio, socket, tts, progress, events, batches, observe, actualHash, expectedHash,
      get samples() { return samples; }, get emittedBytes() { return emittedBytes; },
      get expectedBytes() { return expectedBytes; }, get endFrame() { return endFrame; },
      get peakQueueMs() { return peakQueueMs; }, get peakBufferedMs() { return peakBufferedMs; },
      get peakTts() { return peakTts; }, get starts() { return starts; },
      get ttsDone() { return ttsDone; }, get drained() { return drainPromise; },
    };
    streams.push(stream); return stream;
  };
  return { createStream, until, step, get timerCount() { return timers.size; } };
}

test("real video PCM adapter consumes five minutes of instant TTS at 40ms pace without overflowing", async () => {
  const env = environment(), stream = env.createStream();
  try {
    const text = "测试流控".repeat(1500);
    stream.tts.push(text); stream.tts.finish();
    await env.until(() => stream.audio.closed);
    await stream.drained; await stream.audio.done;
    assert.equal(stream.ttsDone, true);
    assert.equal(stream.batches.join(""), text);
    assert.ok(stream.batches.every(text => text.length <= 160));
    assert.equal(stream.peakTts, 1);
    assert.equal(stream.starts, 1);
    assert.ok(stream.peakQueueMs <= 12300, "video queue includes at most 12s speech plus the 300ms final tail");
    assert.ok(stream.peakBufferedMs <= 12300);
    assert.ok(stream.samples / 24000 >= 300);
    assert.equal(stream.samples, text.length * 1200 + 7200);
    assert.equal(stream.endFrame.total_samples, stream.samples);
    assert.equal(stream.emittedBytes, stream.expectedBytes);
    assert.equal(stream.actualHash.digest("hex"), stream.expectedHash.digest("hex"), "all generated PCM bytes and final silence must remain in order");
    assert.equal(stream.events.filter(type => type === "done").length, 1);
    assert.equal(stream.events.includes("error"), false);
    assert.equal(stream.progress.some(item => item.stage === "interrupted"), false);
    assert.equal(stream.progress.at(-1).stage, "closed");
    assert.equal(env.timerCount, 0);
  } finally { stream.tts.cancel(); stream.audio.cancel(); }
});

test("soft cancelling a paced reply ACK-ends its stream, then a fresh audio stream continues", async () => {
  const env = environment(), old = env.createStream();
  let next;
  try {
    old.tts.push("上一段还没读完的话。".repeat(250)); old.tts.finish();
    for (let i = 0; i < 60; i++) await env.step();
    assert.ok(old.audio.queue.length > 0);
    assert.ok(old.tts.pendingText.length > 0);
    const transmitted = old.samples, generated = old.batches.length;
    old.tts.cancel();
    const interrupted = old.audio.interrupt();
    await env.until(() => old.audio.closed, 20); await interrupted;
    assert.equal(old.samples, transmitted, "discarded PCM must never be emitted after soft interruption");
    assert.equal(old.endFrame.total_samples, transmitted);
    assert.equal(old.batches.length, generated);
    assert.equal(old.events.includes("done"), false);
    assert.equal(old.progress.some(item => item.stage === "interrupted"), false);
    assert.ok(old.progress.find(item => item.stage === "soft_interrupt").discardedSamples > 0);
    assert.equal(env.timerCount, 0);

    next = env.createStream();
    assert.notEqual(next.audio.id, old.audio.id, "each new utterance requires its own stream id");
    next.tts.push("接下来正常继续回答。"); next.tts.finish();
    await env.until(() => next.audio.closed); await next.drained;
    assert.equal(next.emittedBytes, next.expectedBytes);
    assert.equal(next.actualHash.digest("hex"), next.expectedHash.digest("hex"));
    assert.equal(next.starts, 1);
    assert.equal(next.endFrame.total_samples, next.samples);
    assert.equal(next.events.includes("error"), false);
    assert.equal(next.progress.some(item => item.stage === "interrupted"), false);
    assert.equal(old.batches.length, generated, "old queued text cannot restart during a new stream");
    assert.equal(env.timerCount, 0);
  } finally { old.tts.cancel(); old.audio.cancel(); next?.tts.cancel(); next?.audio.cancel(); }
});
