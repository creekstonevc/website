import test from "node:test";
import assert from "node:assert/strict";
import { SpeechSegments } from "./live-voice.mjs";
import { PacedVideoTts } from "./video-tts.mjs";

function clock(consume = () => {}) {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimer: (callback, delay) => { const key = ++id; timers.set(key, { callback, at: now + delay }); return key; },
    clearTimer: key => timers.delete(key),
    advance(ms) {
      const end = now + ms;
      for (let steps = 0; steps < 100000; steps++) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) { consume(end - now); now = end; return; }
        consume(next[1].at - now); now = next[1].at;
        timers.delete(next[0]); next[1].callback();
      }
      assert.fail("Video TTS scheduling did not settle");
    },
    get pending() { return timers.size; },
  };
}
function fixture({ characters = 8000, bytesPerCharacter = 2400, consume = true, makeTts, options = {} } = {}) {
  let externalMs = 0, peakMs = 0, active = 0, peakActive = 0;
  const events = [], batches = [], expected = [], output = [], voices = [];
  const time = clock(ms => { if (consume) externalMs = Math.max(0, externalMs - ms); });
  const factory = send => {
    active++; peakActive = Math.max(peakActive, active);
    const voice = {
      text: "", cancelled: false, ended: false, send,
      push(text) { this.text += text; },
      finish() {
        const bytes = Buffer.alloc(this.text.length * bytesPerCharacter, (batches.length + 1) % 255);
        batches.push(this.text); expected.push(bytes);
        send("audio", { data: bytes.toString("base64") });
        this.ended = true; active--; send("done", {});
      },
      cancel() { this.cancelled = true; if (!this.ended) { this.ended = true; active--; } },
    };
    voices.push(voice); return voice;
  };
  const tts = new PacedVideoTts({ maxTtsCharacters: characters }, (event, data) => {
    events.push({ event, data });
    if (event === "audio") {
      const bytes = Buffer.from(data.data, "base64"); output.push(bytes);
      externalMs += bytes.length / 48; peakMs = Math.max(peakMs, externalMs);
    }
  }, { ...time, makeTts: makeTts || factory, bufferedMs: () => externalMs, ...options });
  return {
    tts, time, events, batches, expected, output, voices,
    get externalMs() { return externalMs; }, get peakMs() { return peakMs; }, get peakActive() { return peakActive; },
    setExternal(ms) { externalMs = ms; },
  };
}
function speakable(text, limit = 8000) {
  const pieces = [], parser = new SpeechSegments(part => pieces.push(part), limit);
  parser.push(text, true); return pieces.join("");
}

test("long fast-produced speech remains ordered with no loss and never exceeds video PCM high water", () => {
  const f = fixture();
  // Five minutes of instant TTS output would exceed the old 120s adapter queue.
  const text = "你好世界".repeat(1500);
  f.tts.push(text); f.tts.finish();
  f.time.advance(50);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].length, 160);
  f.time.advance(1000);
  assert.ok(f.batches.length < 5, "future batches must stay as text, not synthesized PCM");
  f.time.advance(330000);
  assert.equal(f.events.filter(item => item.event === "done").length, 1);
  assert.equal(f.events.some(item => item.event === "error"), false);
  assert.equal(f.peakActive, 1);
  assert.ok(f.peakMs <= 12000.0001);
  assert.equal(f.batches.join(""), text);
  assert.deepEqual(Buffer.concat(f.output), Buffer.concat(f.expected));
  assert.ok(f.output.every(bytes => bytes.length <= 16384 && bytes.length % 2 === 0));
  assert.equal(f.time.pending, 0);
});

test("high-water blocks PCM delivery, low-water gates the next synthesis, and done waits for internal audio", () => {
  const f = fixture({ consume: false, bytesPerCharacter: 4800 });
  f.setExternal(6000);
  f.tts.push("甲".repeat(320)); f.tts.finish();
  f.time.advance(500); assert.equal(f.batches.length, 0);
  f.setExternal(5000); f.time.advance(100);
  assert.equal(f.batches.length, 1);
  assert.ok(f.externalMs <= 12000.0001);
  assert.ok(f.tts.bufferedBytes > 0);
  assert.equal(f.events.some(item => item.event === "done"), false);
  const count = f.output.length; f.time.advance(500);
  assert.equal(f.output.length, count);
  assert.equal(f.batches.length, 1);
  f.setExternal(0); f.time.advance(50); // Drain the rest of the first 16s batch.
  assert.equal(f.batches.length, 1, "a drained batch must not bypass the synthesis low water");
  f.setExternal(0); f.time.advance(100);
  assert.equal(f.batches.length, 2);
  assert.equal(f.events.some(item => item.event === "done"), false);
  f.setExternal(0); f.time.advance(50);
  assert.equal(f.events.filter(item => item.event === "done").length, 1);
  assert.deepEqual(Buffer.concat(f.output), Buffer.concat(f.expected));
});

test("fragmented Markdown is filtered once before bounded batches without exposing hidden paths", () => {
  const text = "你好。```js\nprivate_code()\n```接下来。`/workspace/private.txt` {{attachment://private/path.pdf}} [下载](https://secret.invalid/a.pdf) https://secret.invalid/a。b\n/workspace/private.pdf 完成。";
  const expected = speakable(text);
  for (const width of [1, 2, 5, 23]) {
    const f = fixture({ bytesPerCharacter: 2, options: { maxBatchCharacters: 12 } });
    for (let index = 0; index < text.length; index += width) {
      f.tts.push(text.slice(index, index + width)); f.time.advance(50);
    }
    f.tts.finish(); f.time.advance(1000);
    assert.equal(f.batches.join(""), expected);
    assert.doesNotMatch(f.batches.join(""), /private|secret|attachment|workspace|下载/);
    assert.ok(f.batches.every(batch => batch.length <= 12));
  }
});

test("unpunctuated multilingual text is bounded without splitting surrogate pairs or losing characters", () => {
  const text = "A😀你🚀B".repeat(90);
  const f = fixture({ bytesPerCharacter: 2, options: { maxBatchCharacters: 17 } });
  f.tts.push(text); f.tts.finish(); f.time.advance(10000);
  assert.equal(f.batches.join(""), speakable(text));
  assert.ok(f.batches.every(batch => batch.length <= 17 && !/[\uD800-\uDBFF]$/.test(batch) && !/^[\uDC00-\uDFFF]/.test(batch)));
});

test("text budget, empty speech and duplicate finish preserve existing semantics", () => {
  const empty = fixture(); empty.tts.push("```hidden``` {{attachment://hidden}} "); empty.tts.finish(); empty.tts.finish();
  empty.time.advance(1000);
  assert.equal(empty.batches.length, 0);
  assert.deepEqual(empty.events, [{ event: "done", data: {} }]);
  const limited = fixture({ characters: 5, bytesPerCharacter: 2 });
  limited.tts.push("你好。还有更多的文字。"); limited.tts.finish(); limited.tts.finish(); limited.tts.push("忽略这个");
  limited.time.advance(1000);
  assert.equal(limited.batches.join(""), speakable("你好。还有更多的文字。", 5));
  assert.equal(limited.events.filter(item => item.event === "done").length, 1);
});

test("cancel removes wait timers and pending batches; late provider callbacks cannot emit or restart", () => {
  let sender, cancelled = 0;
  const f = fixture({ makeTts: send => {
    sender = send;
    return { push() {}, finish() {}, cancel() { cancelled++; send("error", { code: "voice_interrupted" }); } };
  } });
  f.tts.push("第一段。".repeat(100)); f.tts.finish(); f.time.advance(50);
  sender("audio", { data: Buffer.alloc(96000).toString("base64") });
  assert.ok(f.time.pending > 0);
  f.tts.cancel(); f.tts.cancel();
  assert.equal(cancelled, 1); assert.equal(f.time.pending, 0);
  sender("audio", { data: Buffer.alloc(96000).toString("base64") }); sender("done", {});
  f.time.advance(50000);
  assert.equal(f.events.length, 0);
  assert.equal(f.tts.pendingText, ""); assert.equal(f.tts.bufferedBytes, 0);
});

test("cancel before low water starts no TTS factory", () => {
  const f = fixture({ consume: false }); f.setExternal(12000);
  f.tts.push("请不要读出来。"); f.tts.finish(); f.time.advance(50);
  assert.equal(f.batches.length, 0);
  f.tts.cancel(); f.setExternal(0); f.time.advance(1000);
  assert.equal(f.batches.length, 0); assert.equal(f.time.pending, 0);
});

test("PCM is delivered while the current raw TTS is still generating", () => {
  let sender;
  const f = fixture({ makeTts: send => {
    sender = send;
    return { push() {}, finish() {}, cancel() {} };
  } });
  f.tts.push("边生成边播放。"); f.tts.finish(); f.time.advance(50);
  sender("audio", { data: Buffer.alloc(1920).toString("base64") }); f.time.advance(50);
  assert.equal(f.events[0].event, "audio");
  assert.equal(f.events.some(item => item.event === "done"), false);
  sender("done", {}); f.time.advance(50);
  assert.equal(f.events.at(-1).event, "done");
});

test("raw text limit and synchronous construction failure cancel without retaining work", () => {
  const overLimit = fixture();
  overLimit.tts.push("甲".repeat(131073)); overLimit.time.advance(1000);
  assert.deepEqual(overLimit.events, [{ event: "error", data: { code: "voice_limit" } }]);
  assert.equal(overLimit.batches.length, 0); assert.equal(overLimit.time.pending, 0);
  let cancelled = 0;
  const synchronous = fixture({ makeTts: send => {
    send("error", { code: "voice_unavailable" });
    return { push() { assert.fail("failed factory must not receive text"); }, finish() {}, cancel() { cancelled++; } };
  } });
  synchronous.tts.push("你好。"); synchronous.tts.finish(); synchronous.time.advance(1000);
  assert.equal(cancelled, 1); assert.equal(synchronous.time.pending, 0);
  assert.deepEqual(synchronous.events, [{ event: "error", data: { code: "voice_unavailable" } }]);
});

test("bounded PCM and provider errors stop cleanly without exposing provider strings", async t => {
  const cases = [
    ["voice_protocol_error", send => send("audio", { data: "not base64!!" })],
    ["voice_protocol_error", send => send("audio", { data: Buffer.alloc(1).toString("base64") })],
    ["voice_limit", send => send("audio", { data: Buffer.alloc(2000).toString("base64") }), { maxBufferedBytes: 1000 }],
    ["voice_limit", send => { send("audio", { data: Buffer.alloc(600).toString("base64") }); send("audio", { data: Buffer.alloc(600).toString("base64") }); }, { maxTotalBytes: 1000 }],
    ["voice_timeout", send => send("error", { code: "voice_timeout" })],
    ["voice_unavailable", send => send("error", { code: "private-key-and-url" })],
  ];
  for (const [code, signal, options] of cases) await t.test(code, () => {
    let cancelled = 0;
    const f = fixture({ options, makeTts: send => ({ push() {}, finish() { signal(send); }, cancel() { cancelled++; } }) });
    f.tts.push("测试。"); f.tts.finish(); f.time.advance(1000);
    assert.deepEqual(f.events, [{ event: "error", data: { code } }]);
    assert.equal(cancelled, 1); assert.equal(f.time.pending, 0);
    assert.doesNotMatch(JSON.stringify(f.events), /private-key/);
  });
});

test("synchronous factory errors and invalid queue measurements cannot escape into chat", () => {
  const f = fixture({ makeTts: () => { throw new Error("secret provider error"); } });
  assert.doesNotThrow(() => { f.tts.push("你好。"); f.tts.finish(); f.time.advance(1000); });
  assert.deepEqual(f.events, [{ event: "error", data: { code: "voice_unavailable" } }]);
  const invalid = fixture({ options: { bufferedMs: () => NaN } });
  invalid.tts.push("你好。"); invalid.tts.finish(); invalid.time.advance(1000);
  assert.deepEqual(invalid.events, [{ event: "error", data: { code: "voice_unavailable" } }]);
  assert.equal(invalid.batches.length, 0);
});
