import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createGateway, loadConfig } from "./server.mjs";
import { createConversationArchive, createConversationCredential, createTtsTicket } from "./core.mjs";
import { stripWebsiteCapability } from "./handoff-proposal.mjs";

async function harness(run) {
  const voices = [], logs = [];
  const config = loadConfig({ GATEWAY_SIGNING_SECRET: "test-local-voice-secret-at-least-32-characters", BOIDS_API_KEY: "test-boids",
    BYTEPLUS_TTS_API_KEY: "test-voice", BYTEPLUS_TTS_SPEAKER_ID: "test-speaker" });
  let serial = 0;
  const server = createGateway({ config, log: event => logs.push(event),
    makeLiveVoice: (emit) => {
      const voice = { text: [], cancelled: false,
        push: (s) => { voice.text.push(s); emit("audio", { data: Buffer.from([1, 0, 2, 0]).toString("base64") }); },
        finish: () => emit("done", {}), cancel: () => { voice.cancelled = true; } };
      voices.push(voice); return voice;
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/conversations")) return Response.json({ id: `conv_${++serial}` });
      if (url.includes("/items")) return Response.json({ data: [], has_more: false });
      const body = JSON.parse(options.body);
      assert.equal(body.liveVoiceId, undefined);
      const frames = [
        'event: response.reasoning.delta\ndata: {"delta":"PRIVATE reasoning"}',
        'event: creekstone.fake\ndata: {"value":"untrusted"}',
        'event: response.output_text.delta\ndata: {"delta":"Hello founder."}',
        ...(stripWebsiteCapability(body.input) === "disconnect" ? [] : ['event: response.completed\ndata: {"type":"response.completed"}']),
      ];
      return new Response(frames.join("\n\n") + "\n\n");
    },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie = "", signal) => fetch(base + path, { method: "POST",
    headers: { Origin: "http://localhost:3100", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal });
  const session = async (body = {}, cookie = "") => {
    const response = await post("/conversations", body, cookie);
    assert.equal(response.status, 200);
    return { cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; "), ...await response.json() };
  };
  try { await run({ post, session, voices, logs, config }); }
  finally { server.emit("close"); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test("video endpoints enforce conversation ownership and disabled preview does not alter text chat", () => harness(async ({ post, session, voices }) => {
  const a = await session(), b = await session();
  assert.equal((await post("/video/capabilities", { sessionKey: a.sessionKey })).status, 409);
  assert.equal((await post("/video/open", { sessionKey: b.sessionKey }, a.cookie)).status, 409);
  const response = await post("/video/capabilities", { sessionKey: a.sessionKey }, a.cookie);
  assert.deepEqual(await response.json(), { enabled: false, reason: "credentials_missing" });
  assert.equal((await post("/video/open", { sessionKey: a.sessionKey }, a.cookie)).status, 503);
  assert.equal((await post("/voice/stream", { id: randomUUID(), sessionKey: a.sessionKey, videoId: randomUUID() }, a.cookie)).status, 409);
  const text = await post("/responses", { sessionKey: a.sessionKey, input: "hello" }, a.cookie);
  assert.match(await text.text(), /response.completed/); assert.equal(voices.length, 0);
}));

test("media keeps its signed conversation ownership after another tab changes the active cookie", () => harness(async ({ post, session, voices }) => {
  const first = await session(), id = randomUUID();
  const audio = await post("/voice/stream", { id, sessionKey: first.sessionKey }, first.cookie);
  const next = await session({ reset: true }, first.cookie);
  assert.notEqual(next.sessionKey, first.sessionKey);
  assert.equal((await post("/video/capabilities", { sessionKey: first.sessionKey }, next.cookie)).status, 200);
  // Selecting the new conversation cannot cancel media owned by the old one.
  assert.equal((await post("/voice/cancel", { id, sessionKey: next.sessionKey }, next.cookie)).status, 200);
  assert.equal(voices[0].cancelled, false);
  assert.equal((await post("/voice/cancel", { id, sessionKey: first.sessionKey }, next.cookie)).status, 200);
  assert.equal(voices[0].cancelled, true);
  await audio.text();
  assert.equal((await post("/voice/cancel", { id, sessionKey: first.sessionKey }, next.cookie)).status, 200);
  // Media credential fallback must not change the Responses active-tab rule.
  const reply = await post("/responses", { input: "hello", sessionKey: first.sessionKey }, next.cookie);
  assert.equal(reply.status, 409);
  assert.equal((await reply.json()).error.code, "session_changed");
  const replay = await post("/voice/stream", { id: randomUUID(), sessionKey: first.sessionKey,
    ticket: createTtsTicket("Still the old conversation", "test-local-voice-secret-at-least-32-characters") }, next.cookie);
  assert.equal(replay.status, 200);
  assert.match(await replay.text(), /event: audio/);
}));

test("media archive authorization is signed, non-expired and never granted by the public key alone", () => harness(async ({ post, config, logs }) => {
  const cid = "conv_media_archive", key = createHash("sha256").update(cid).digest("hex").slice(0, 24);
  const archiveName = `${config.conversationCookieName}_archive`;
  const now = Date.now();
  const valid = createConversationArchive([{ cid, exp: now + 60000 }], config.signingSecret);
  const expired = createConversationArchive([{ cid, exp: now - 1000 }], config.signingSecret, now - 2000);
  const otherCookie = `${config.conversationCookieName}=${createConversationCredential("conv_unrelated", config.signingSecret)}`;
  assert.equal((await post("/video/capabilities", { sessionKey: key }, `${archiveName}=${valid}`)).status, 200);
  for (const cookie of ["", `${archiveName}=${valid}x`, `${archiveName}=${expired}`,
    `${otherCookie}; ${archiveName}=${valid}x`, `${otherCookie}; ${archiveName}=${expired}`]) {
    for (const route of ["/video/capabilities", "/voice/cancel", "/voice/interrupt"]) {
      const response = await post(route, { id: randomUUID(), sessionKey: key, text: "PRIVATE_MESSAGE" }, cookie);
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.ok(["conversation_required", "session_changed"].includes(body.error.code));
      const event = logs.at(-1);
      assert.equal(event.event, "gateway.media_conflict");
      assert.equal(event.requestId, body.error.requestId);
      assert.equal(event.route, route);
    }
  }
  const videoId = randomUUID();
  await post("/video/close", { videoId, sessionKey: key }, otherCookie);
  assert.equal(logs.at(-1).videoId, videoId);
  await post("/video/close", { videoId: "PRIVATE_CONTENT", sessionKey: key }, otherCookie);
  assert.equal(logs.at(-1).videoId, undefined);
  const serialized = JSON.stringify(logs);
  for (const secret of [key, cid, valid, config.signingSecret, "PRIVATE"]) assert.equal(serialized.includes(secret), false);
}));

test("signed replay supports pure audio without weakening conversation or ticket validation", () => harness(async ({ post, session, voices }) => {
  const user = await session();
  const invalid = await post("/voice/stream", { id: randomUUID(), sessionKey: user.sessionKey, videoId: randomUUID(), ticket: "untrusted" }, user.cookie);
  assert.notEqual(invalid.status, 200);
  const ticket = createTtsTicket("Hello founder.", "test-local-voice-secret-at-least-32-characters");
  const noVideo = await post("/voice/stream", { id: randomUUID(), sessionKey: user.sessionKey, ticket }, user.cookie);
  assert.equal(noVideo.status, 200);
  assert.match(await noVideo.text(), /event: audio/);
  assert.equal(voices.length, 1);
  assert.deepEqual(voices[0].text, ["Hello founder."]);
}));

test("live audio is opt-in, server-generated only, and independent of text completion", () => harness(async ({ post, session, voices }) => {
  const user = await session();
  const id = randomUUID();
  const audio = await post("/voice/stream", { id, sessionKey: user.sessionKey }, user.cookie);
  assert.equal(audio.status, 200);
  const reply = await post("/responses", { input: "hello", sessionKey: user.sessionKey, liveVoiceId: id }, user.cookie);
  assert.match(await reply.text(), /response.completed/);
  const stream = await audio.text();
  assert.match(stream, /event: audio/); assert.match(stream, /event: done/);
  assert.deepEqual(voices[0].text, ["Hello founder."]);
  const silentReply = await post("/responses", { input: "hello", sessionKey: user.sessionKey }, user.cookie);
  await silentReply.text(); assert.equal(voices.length, 1);
}));

test("live voice requires signed conversation, matching session and one-time ownership", () => harness(async ({ post, session, voices }) => {
  const a = await session(), b = await session();
  const id = randomUUID();
  assert.equal((await post("/voice/stream", { id, sessionKey: a.sessionKey })).status, 409);
  assert.equal((await post("/voice/stream", { id, sessionKey: b.sessionKey }, a.cookie)).status, 409);
  const audio = await post("/voice/stream", { id, sessionKey: a.sessionKey }, a.cookie);
  assert.equal((await post("/voice/stream", { id, sessionKey: a.sessionKey }, a.cookie)).status, 409);
  await (await post("/responses", { input: "hello", liveVoiceId: id, sessionKey: b.sessionKey }, b.cookie)).text();
  assert.deepEqual(voices[0].text, []);
  await post("/voice/cancel", { id, sessionKey: b.sessionKey }, b.cookie);
  assert.equal(voices[0].cancelled, false);
  assert.equal((await post('/voice/interrupt', { id, sessionKey: a.sessionKey })).status, 409);
  assert.equal((await post('/voice/interrupt', { id, sessionKey: b.sessionKey }, a.cookie)).status, 409);
  assert.equal((await post('/voice/interrupt', { id, sessionKey: b.sessionKey }, b.cookie)).status, 200);
  assert.equal(voices[0].cancelled, false);
  assert.equal((await post('/voice/interrupt', { id, sessionKey: a.sessionKey }, a.cookie)).status, 400, 'non-video voice is not soft-interruptible');
  await post("/voice/cancel", { id, sessionKey: a.sessionKey }, a.cookie);
  assert.equal(voices[0].cancelled, true);
  await audio.text();
}));

test("interrupted text closes its voice channel and a replaced subscription cancels old audio", () => harness(async ({ post, session, voices }) => {
  const user = await session(), id = randomUUID();
  const old = await post("/voice/stream", { id, sessionKey: user.sessionKey }, user.cookie);
  const nextId = randomUUID();
  const audio = await post("/voice/stream", { id: nextId, sessionKey: user.sessionKey }, user.cookie);
  await old.text(); assert.equal(voices[0].cancelled, true);
  await (await post("/responses", { input: "disconnect", sessionKey: user.sessionKey, liveVoiceId: nextId }, user.cookie)).text();
  assert.match(await audio.text(), /event: done/);
  assert.equal(voices[1].cancelled, true);
}));
