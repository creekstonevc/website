import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

function player(rate) {
  let Processor;
  const events = [];
  runInNewContext(readFileSync(new URL("../../public/audio/pcm-player.js", import.meta.url), "utf8"), {
    AudioWorkletProcessor: class { port = { postMessage: (event) => events.push(event) }; },
    sampleRate: rate,
    registerProcessor: (_name, value) => { Processor = value; },
  });
  const instance = new Processor();
  const send = (data) => instance.port.onmessage({ data });
  return { instance, events, send };
}

test("PCM starts before the end signal, resamples and drains once", () => {
  for (const rate of [24000, 44100, 48000]) {
    const { instance, send, events } = player(rate);
    send({ type: "audio", samples: new Float32Array(4800).fill(0.25) });
    const block = new Float32Array(128);
    assert.equal(instance.process([], [[block]]), true);
    assert.equal(block[0], 0.25);
    assert.equal(events[0].type, "playing");
    send({ type: "end" });
    let blocks = 1;
    while (instance.process([], [[block]])) { if (++blocks > 200) assert.fail("Did not drain"); }
    assert.equal(events.filter((e) => e.type === "ended").length, 1);
    assert.ok(Math.abs((blocks + 1) * 128 / rate - 0.2) < 0.01);
  }
});

test("PCM underflow is silent, re-buffers, handles short clips and stop", () => {
  const { instance, send, events } = player(24000);
  const block = new Float32Array(128);
  instance.process([], [[block]]);
  assert.ok(block.every((v) => v === 0));
  send({ type: "audio", samples: new Float32Array(50).fill(0.5) });
  instance.process([], [[block]]);
  assert.equal(events.length, 0);
  send({ type: "end" });
  assert.equal(instance.process([], [[block]]), false);
  assert.equal(block[0], 0.5);
  const stopped = player(24000);
  stopped.send({ type: "stop" });
  assert.equal(stopped.instance.process([], [[block]]), false);
});

test("PCM queue is bounded", () => {
  const { instance, send, events } = player(24000);
  send({ type: "audio", samples: new Float32Array(24000 * 120) });
  assert.equal(events[0].type, "error");
  assert.equal(instance.finished, true);
});
