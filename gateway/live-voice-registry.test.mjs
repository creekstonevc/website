import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLiveVoiceRegistry } from "./live-voice.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class ResponseSink extends EventEmitter {
  frames = []; destroyed = false; writableEnded = false; writableLength = 0;
  writeHead() {}
  flushHeaders() {}
  write(frame) { this.frames.push(frame); }
  end() { this.writableEnded = true; this.destroyed = true; this.emit("close"); }
}

test("cancel waits for empty and partially generated replies to finish safe cleanup before done or slot reuse", async t => {
  for (const text of ["", "Already generated speech."]) await t.test(text ? "partial reply" : "zero PCM reply", async () => {
    const gate = deferred(), voices = [];
    const registry = createLiveVoiceRegistry({}, emit => {
      const voice = { text: [], cancellations: 0, push: value => voice.text.push(value), finish() {},
        cancel: () => { voice.cancellations++; return gate.promise; }, emit };
      voices.push(voice); return voice;
    });
    const id = randomUUID(), response = new ResponseSink();
    try {
      await registry.open(id, "owner", response);
      const claimed = registry.claim(id, "owner");
      if (text) claimed.push(text);
      const ending = claimed.cancel();
      assert.equal(registry.cancel(id, "owner"), ending);
      assert.equal(registry.claim(id, "owner"), null);
      let settled = false; void ending.then(() => { settled = true; });
      await tick();
      assert.equal(settled, false); assert.equal(response.destroyed, false);
      assert.equal(voices[0].cancellations, 1);
      assert.doesNotMatch(response.frames.join(""), /event: done/);
      claimed.push("Late LLM delta"); voices[0].emit("audio", { data: "must not send" });
      assert.deepEqual(voices[0].text, text ? [text] : []);
      gate.resolve(); await ending;
      assert.equal(response.destroyed, true);
      assert.match(response.frames.join(""), /event: done\ndata: \{"interrupted":true\}/);
      assert.doesNotMatch(response.frames.join(""), /must not send/);
      await registry.cancel(id, "owner");
      assert.equal(voices[0].cancellations, 1);
    } finally { gate.resolve(); await registry.close(); }
  });
});

test("replacement waits for the old input and serializes concurrent opens for the same owner", async () => {
  const gate = deferred(), voices = [];
  const registry = createLiveVoiceRegistry({}, () => {
    const first = voices.length === 0;
    const voice = { push() {}, finish() {}, cancel: () => first ? gate.promise : undefined };
    voices.push(voice); return voice;
  });
  const first = new ResponseSink(), next = new ResponseSink();
  try {
    await registry.open(randomUUID(), "owner", first);
    const id = randomUUID(), opening = registry.open(id, "owner", next);
    await tick();
    assert.equal(voices.length, 1); assert.equal(first.destroyed, false); assert.equal(next.frames.length, 0);
    await assert.rejects(registry.open(randomUUID(), "owner", new ResponseSink()), { code: "voice_busy" });
    await assert.rejects(registry.open(id, "other-owner", new ResponseSink()), { code: "voice_busy" });
    gate.resolve(); await opening;
    assert.equal(first.destroyed, true); assert.equal(voices.length, 2);
    assert.match(next.frames.join(""), /event: ready/);
  } finally { gate.resolve(); await registry.close(); }
});

test("failed media cleanup rejects cancellation, emits error rather than done, and cannot leak raw failure", async () => {
  const gate = deferred();
  const registry = createLiveVoiceRegistry({}, () => ({ push() {}, finish() {}, cancel: () => gate.promise }));
  const response = new ResponseSink(), id = randomUUID();
  try {
    await registry.open(id, "owner", response);
    const ending = registry.cancel(id, "owner");
    gate.reject(new Error("private upstream details"));
    await assert.rejects(ending);
    assert.equal(response.destroyed, true);
    assert.match(response.frames.join(""), /event: error/);
    assert.doesNotMatch(response.frames.join(""), /event: done|private upstream/);
  } finally { await registry.close(); }
});

test("natural SSE disconnect safely ends its input before accepting the replacement", async () => {
  const gate = deferred(); let made = 0;
  const registry = createLiveVoiceRegistry({}, () => ({ push() {}, finish() {}, cancel: ++made === 1 ? () => gate.promise : () => {} }));
  const response = new ResponseSink();
  try {
    await registry.open(randomUUID(), "owner", response);
    response.destroyed = true; response.emit("close");
    const next = registry.open(randomUUID(), "owner", new ResponseSink());
    await tick(); assert.equal(made, 1);
    gate.resolve(); await next; assert.equal(made, 2);
    assert.doesNotMatch(response.frames.join(""), /event: done/);
  } finally { gate.resolve(); await registry.close(); }
});

test("reply_error is nonterminal and an interrupt waits for done cleanup as well as the media end", async () => {
  const gate = deferred(); let emit;
  const registry = createLiveVoiceRegistry({}, send => {
    emit = send;
    return { push() {}, finish() {}, cancel: () => gate.promise,
      interrupt: async () => { emit("done", { interrupted: true }); } };
  });
  const response = new ResponseSink(), id = randomUUID();
  try {
    await registry.open(id, "owner", response);
    emit("reply_error", { code: "voice_unavailable" });
    assert.match(response.frames.join(""), /event: reply_error/);
    assert.equal(response.destroyed, false);
    let settled = false;
    const ended = registry.interrupt(id, "owner").then(() => { settled = true; });
    await tick(); assert.equal(settled, false); assert.equal(response.destroyed, false);
    gate.resolve(); await ended;
    assert.equal(response.destroyed, true); assert.match(response.frames.join(""), /event: done/);
  } finally { gate.resolve(); await registry.close(); }
});

test("the 330-second reply limit safely ends video input but remains fatal for pure audio", async t => {
  for (const mode of ["video", "video cleanup failure", "pure audio"]) await t.test(mode, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const gate = deferred(); let cancellations = 0;
    const registry = createLiveVoiceRegistry({}, () => ({ push() {}, finish() {},
      cancel: () => { cancellations++; return gate.promise; } }));
    const response = new ResponseSink(), id = randomUUID();
    const video = mode !== "pure audio";
    try {
      await registry.open(id, "owner", response, video ? { videoId: randomUUID() } : {});
      t.mock.timers.tick(329999);
      assert.doesNotMatch(response.frames.join(""), /voice_timeout/);
      t.mock.timers.tick(1);
      await tick();
      assert.equal(cancellations, 1);
      assert.equal(response.destroyed, false);
      assert.doesNotMatch(response.frames.join(""), /event: done|event: error/);
      if (video) assert.match(response.frames.join(""), /event: reply_error\ndata: \{"code":"voice_timeout"\}/);
      else assert.doesNotMatch(response.frames.join(""), /event: reply_error/);
      const cleanup = registry.cancel(id, "owner");
      if (mode === "video cleanup failure") {
        const failed = assert.rejects(cleanup);
        gate.reject(new Error("private cleanup failure"));
        await failed;
        assert.match(response.frames.join(""), /event: error/);
        assert.doesNotMatch(response.frames.join(""), /event: done|private cleanup failure/);
      } else {
        gate.resolve(); await cleanup;
        if (video) {
          assert.match(response.frames.join(""), /event: done\ndata: \{"interrupted":true\}/);
          assert.doesNotMatch(response.frames.join(""), /event: error/);
          await registry.open(randomUUID(), "owner", new ResponseSink(), { videoId: randomUUID() });
        } else {
          assert.match(response.frames.join(""), /event: error\ndata: \{"code":"voice_timeout"\}/);
          assert.doesNotMatch(response.frames.join(""), /event: done/);
        }
      }
      assert.equal(response.destroyed, true);
    } finally { gate.resolve(); await registry.close(); t.mock.timers.reset(); }
  });
});
