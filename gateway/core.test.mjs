import assert from "node:assert/strict";
import test from "node:test";
import {
  GatewayError,
  buildBoidsResponsePayload,
  createTtsTicket,
  decodeBytePlusAudio,
  parseSseFrame,
  prepareSpeechText,
  verifyTtsTicket,
} from "./core.mjs";

const secret = "test-secret-that-is-long-enough-for-hmac-signing";

test("response payload ignores client model and forces the configured agent", () => {
  const payload = buildBoidsResponsePayload(
    { model: "attacker-model", input: "  hello  ", conversation: "conv_123" },
    "agent:creekstone",
  );
  assert.deepEqual(payload, {
    model: "agent:creekstone",
    input: "hello",
    conversation: "conv_123",
    stream: true,
  });
});

test("response payload rejects oversized founder input", () => {
  assert.throws(
    () => buildBoidsResponsePayload({ input: "12345" }, "agent:test", 4),
    (error) => error instanceof GatewayError && error.status === 413,
  );
});

test("TTS tickets are signed, expire, and contain speech-normalized text", () => {
  const ticket = createTtsTicket("## Hello\n[Creekstone](https://example.com) **founder**", secret, {
    now: 1_000,
    ttlMs: 5_000,
  });
  assert.equal(verifyTtsTicket(ticket, secret, { now: 2_000 }).text, "Hello\nCreekstone founder");
  assert.throws(
    () => verifyTtsTicket(`${ticket}x`, secret, { now: 2_000 }),
    (error) => error instanceof GatewayError && error.status === 403,
  );
  assert.throws(
    () => verifyTtsTicket(ticket, secret, { now: 7_000 }),
    (error) => error instanceof GatewayError && error.status === 410,
  );
});

test("speech normalization removes code blocks and truncates safely", () => {
  assert.equal(prepareSpeechText("Before\n```js\nsecret()\n```\nAfter"), "Before\n\nAfter");
  assert.equal(prepareSpeechText("1234567890", 6), "12345…");
});

test("SSE frames expose event type and JSON payload", () => {
  assert.deepEqual(
    parseSseFrame('event: response.output_text.delta\ndata: {"delta":"Hi"}'),
    {
      type: "response.output_text.delta",
      payload: { delta: "Hi" },
      done: false,
    },
  );
  assert.equal(parseSseFrame("data: [DONE]").done, true);
});

test("BytePlus NDJSON audio chunks are decoded and concatenated", () => {
  const audio = decodeBytePlusAudio(
    `${JSON.stringify({ data: Buffer.from("first").toString("base64") })}\n` +
      `${JSON.stringify({ data: Buffer.from("second").toString("base64") })}\n`,
  );
  assert.equal(audio.toString(), "firstsecond");
});
