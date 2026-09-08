import assert from "node:assert/strict";
import test from "node:test";
import { streamReply, shouldSendOnEnter, openConversation } from "./agent-client.ts";

const handlers = { onOutputDelta() {}, onThinkingDelta() {} };
const event = (type, data = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

test("IME candidate confirmation, Safari 229 and compositionend Enter never submit", () => {
  const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(shouldSendOnEnter(enter, false, 101), true);
  assert.equal(shouldSendOnEnter(enter, true, 101), false);
  assert.equal(shouldSendOnEnter({ ...enter, isComposing: true }, false, 101), false);
  assert.equal(shouldSendOnEnter({ ...enter, keyCode: 229 }, false, 101), false);
  assert.equal(shouldSendOnEnter(enter, false, 0), false);
  assert.equal(shouldSendOnEnter({ ...enter, shiftKey: true }, false, 101), false);
});

test("stream completion survives split UTF-8 frames and produces a voice ticket", async (t) => {
  const wire = new TextEncoder().encode(event("response.output_text.delta", { delta: "你好" }) +
    event("creekstone.tts.ready", { ticket: "signed" }) + event("response.completed"));
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { for (const byte of wire) controller.enqueue(Uint8Array.of(byte)); controller.close(); },
  })));
  let text = "";
  const result = await streamReply("hello", { ...handlers, onOutputDelta: (delta) => { text += delta; } });
  assert.equal(text, "你好");
  assert.deepEqual(result, { text: "你好", ttsTicket: "signed" });
});

for (const suffix of ["", "data: [DONE]\n\n", event("response.incomplete"), event("response.failed"), event("error")]) {
  test(`unterminated or failed response is not success: ${suffix.slice(0, 35)}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(event("response.output_text.delta", { delta: "partial" }) + suffix));
    let partial = "";
    await assert.rejects(streamReply("hello", { ...handlers, onOutputDelta: (delta) => { partial += delta; } }));
    assert.equal(partial, "partial");
  });
}

test("HTTP rejection is surfaced without automatically resending", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await assert.rejects(streamReply("hello", handlers), (error) => error.status === 429);
  assert.equal(mock.mock.callCount(), 1);
});

test("history passes the cursor and keeps stable ids without restoring reasoning", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    request = JSON.parse(options.body);
    return Response.json({ sessionKey: "public-key", sessions: [], nextCursor: "msg_previous", messages: [
      { id: "msg_answer", role: "assistant", content: "Welcome", thinking: "must not restore" },
    ] });
  });
  const result = await openConversation({ after: "msg_cursor" });
  assert.deepEqual(request, { after: "msg_cursor" });
  assert.equal(result.nextCursor, "msg_previous");
  assert.equal(result.messages[0].id, "msg_answer");
  assert.equal(result.messages[0].thinking, undefined);
});
