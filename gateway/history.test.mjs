import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createGateway } from "./server.mjs";
import { createConversationArchive, verifyConversationArchive, createConversationCredential, createTtsTicket } from "./core.mjs";

const secret = "a-long-enough-test-secret-for-signing-only";
const config = {
  allowedOrigins: new Set(["http://localhost:3100"]), signingSecret: secret,
  conversationCookieName: "creekstone_conversation", conversationTtlMs: 2592000000,
  conversationHistoryLimit: 2, bootstrapPrompt: "Hi", requestMaxBytes: 65536,
  boidsBaseUrl: "https://test.invalid/v1", boidsApiKey: "test-only", boidsModel: "agent:test",
  ticketTtlMs: 60000, maxTtsCharacters: 8000, maxInputCharacters: 4000,
  bytePlusUrl: "https://voice.invalid/", bytePlusApiKey: "test-only",
  bytePlusResourceId: "test-resource", bytePlusSpeakerId: "test-speaker",
};
const message = (id, role, text) => ({ id, type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
async function run(fakeFetch, check) {
  const server = createGateway({ config, fetchImpl: fakeFetch }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const cookie = `creekstone_conversation=${createConversationCredential("conv_test", secret)}`;
  const post = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/${path}`, {
    method: "POST", headers: { Origin: "http://localhost:3100", Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try { await check(post); } finally { server.closeAllConnections(); server.close(); await once(server, "close"); }
}

test("archive is bounded, signed, expired entries excluded, no arbitrary session authority", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({ cid: `conv_${i}`, exp: 10000 }));
  const token = createConversationArchive(entries, secret, 1000);
  assert.ok(token.length <= 3500);
  assert.equal(verifyConversationArchive(token, secret, 1000).length, 10);
  assert.deepEqual(verifyConversationArchive(`${token}x`, secret, 1000), []);
  assert.deepEqual(verifyConversationArchive(token, secret, 10001), []);
});

test("descending cursor pages preserve order and hide only the actual first Hi", async () => {
  const items = [message("m4", "assistant", "Answer"), message("m3", "user", "Hi"), message("m2", "assistant", "Welcome"), message("m1", "user", "Hi")];
  await run(async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("order"), "desc");
    assert.equal(parsed.searchParams.get("limit"), "2");
    const after = parsed.searchParams.get("after");
    return Response.json({ data: after ? items.slice(2) : items.slice(0, 2), has_more: !after });
  }, async (post) => {
    const recent = await (await post("conversations", {})).json();
    assert.equal(recent.nextCursor, "m3");
    assert.deepEqual(recent.messages.map((m) => m.content), ["Hi", "Answer"]);
    const earlier = await (await post("conversations", { after: recent.nextCursor })).json();
    assert.equal(earlier.nextCursor, null);
    assert.deepEqual(earlier.messages.map((m) => m.content), ["Welcome"]);
    assert.equal(earlier.needsBootstrap, false);
  });
});

test("upstream ignoring cursor fails explicitly instead of looping the first page", async () => {
  await run(async () => Response.json({ data: [message("m3", "user", "hello")], has_more: true }), async (post) => {
    const response = await post("conversations", { after: "m3" });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "pagination_unavailable");
  });
});

test("missing upstream session never silently creates a replacement", async () => {
  await run(async () => new Response(null, { status: 404 }), async (post) => {
    assert.equal((await post("conversations", {})).status, 404);
  });
});

test("a stale tab cannot send into another tab's active conversation", async () => {
  await run(async () => { throw new Error("Must not submit upstream"); }, async (post) => {
    const response = await post("responses", { input: "hello", sessionKey: "another-session" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "session_changed");
  });
});

test("a second request cannot remove the first request's concurrency lock", async () => {
  let resolve;
  const gate = new Promise((r) => { resolve = r; });
  let upstreamCount = 0;
  let started;
  const didStart = new Promise((r) => { started = r; });
  await run(async () => {
    upstreamCount += 1;
    started();
    await gate;
    return new Response('event: response.completed\ndata: {"type":"response.completed"}\n\n');
  }, async (post) => {
    const first = post("responses", { input: "one" });
    await didStart;
    try {
      assert.equal((await post("responses", { input: "two" })).status, 409);
      assert.equal((await post("responses", { input: "three" })).status, 409);
      assert.equal(upstreamCount, 1);
    } finally { resolve(); await (await first).text(); }
  });
});

test("recent expired signed voice tickets work for an active session, forged tickets do not", async () => {
  await run(async () => new Response(JSON.stringify({ data: Buffer.from("audio").toString("base64") })), async (post) => {
    const ticket = createTtsTicket("Hello founder", secret, { now: Date.now() - 120000, ttlMs: 60000 });
    assert.equal((await post("tts", { ticket })).status, 200);
    assert.equal((await post("tts", { ticket: `${ticket}x` })).status, 403);
    const old = createTtsTicket("Hello", secret, { now: Date.now() - 172800000, ttlMs: 60000 });
    assert.equal((await post("tts", { ticket: old })).status, 410);
  });
});
