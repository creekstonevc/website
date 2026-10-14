import assert from "node:assert/strict";
import test from "node:test";
import {
  GatewayError,
  buildBoidsResponsePayload,
  createConversationCredential,
  createTtsTicket,
  decodeBytePlusAudio,
  normalizeConversationHistory,
  parseSseFrame,
  prepareSpeechText,
  verifyConversationCredential,
  verifyTtsTicket,
} from "./core.mjs";

const secret = "test-secret-that-is-long-enough-for-hmac-signing";

test("response payload ignores client model and forces the configured agent", () => {
  const payload = buildBoidsResponsePayload(
    { model: "attacker-model", input: "  hello  ", conversation: "conv_123" },
    "agent:creekstone",
    "conv_server_bound",
  );
  assert.deepEqual(payload, {
    model: "agent:creekstone",
    input: "hello",
    conversation: "conv_server_bound",
    stream: true,
  });
});

test("response payload rejects oversized founder input", () => {
  assert.throws(
    () =>
      buildBoidsResponsePayload({ input: "12345" }, "agent:test", "conv_1", 4),
    (error) => error instanceof GatewayError && error.status === 413,
  );
});

test("conversation credentials bind a server conversation and reject tampering", () => {
  const credential = createConversationCredential("conv_server_bound", secret, {
    now: 1_000,
    ttlMs: 5_000,
  });
  assert.deepEqual(
    verifyConversationCredential(credential, secret, { now: 2_000 }),
    {
      conversationId: "conv_server_bound",
      expiresAt: 6_000,
    },
  );
  assert.equal(
    verifyConversationCredential(`${credential}x`, secret, { now: 2_000 }),
    null,
  );
  assert.equal(
    verifyConversationCredential(credential, secret, { now: 7_000 }),
    null,
  );
});

test("history normalization hides only the oldest internal Hi", () => {
  const items = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hi" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Welcome founder" }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Tell me what you are building" }],
    },
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hi" }],
    },
  ];
  assert.deepEqual(normalizeConversationHistory(items), [
    {
      role: "assistant",
      content: "Welcome founder\n\nTell me what you are building",
    },
    { role: "user", content: "Hi" },
  ]);
  assert.deepEqual(
    normalizeConversationHistory(items, { oldestItemIncluded: false }),
    [
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: "Welcome founder\n\nTell me what you are building",
      },
      { role: "user", content: "Hi" },
    ],
  );
});

test("Chinese and legacy English openings are hidden only on the oldest page, never later or attached greetings", () => {
  const message = (role, text) => ({ type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
  for (const greeting of ["你好", "Hi"]) {
    const items = [message("user", greeting), message("assistant", "开场白"), message("user", "你好"), message("assistant", "继续"), message("user", "Hi")];
    assert.deepEqual(normalizeConversationHistory(items).map(item => item.content), ["开场白", "你好", "继续", "Hi"]);
    assert.equal(normalizeConversationHistory(items, { oldestItemIncluded: false })[0].content, greeting);
    items[0].content.push({ type: "input_file", file_id: "file-user-owned" });
    assert.equal(normalizeConversationHistory(items)[0].content, greeting);
  }
});

test("TTS tickets are signed, expire, and contain speech-normalized text", () => {
  const ticket = createTtsTicket(
    "## Hello\n[Creekstone](https://example.com) **founder**",
    secret,
    {
      now: 1_000,
      ttlMs: 5_000,
    },
  );
  assert.equal(
    verifyTtsTicket(ticket, secret, { now: 2_000 }).text,
    "Hello\nCreekstone founder",
  );
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
  assert.equal(
    prepareSpeechText("Before\n```js\nsecret()\n```\nAfter"),
    "Before\n\nAfter",
  );
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
