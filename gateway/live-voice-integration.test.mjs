import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createGateway, loadConfig } from "./server.mjs";
import { createTtsTicket } from "./core.mjs";

async function harness(run) {
  const voices = [];
  const config = loadConfig({ GATEWAY_SIGNING_SECRET: "test-local-voice-secret-at-least-32-characters", BOIDS_API_KEY: "test-boids",
    BYTEPLUS_TTS_API_KEY: "test-voice", BYTEPLUS_TTS_SPEAKER_ID: "test-speaker" });
  let serial = 0;
  const server = createGateway({ config,
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
        ...(body.input === "disconnect" ? [] : ['event: response.completed\ndata: {"type":"response.completed"}']),
      ];
      return new Response(frames.join("\n\n") + "\n\n");
    },
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, cookie = "", signal) => fetch(base + path, { method: "POST",
    headers: { Origin: "http://localhost:3100", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body), signal });
  const session = async () => {
    const response = await post("/conversations", {});
    assert.equal(response.status, 200);
    return { cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; "), ...await response.json() };
  };
  try { await run({ post, session, voices }); }
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

test("opening replay rejects unsigned content and requires video", () => harness(async ({ post, session, voices }) => {
  const user = await session();
  const invalid = await post("/voice/stream", { id: randomUUID(), sessionKey: user.sessionKey, videoId: randomUUID(), ticket: "untrusted" }, user.cookie);
  assert.notEqual(invalid.status, 200);
  const ticket = createTtsTicket("Hello founder.", "test-local-voice-secret-at-least-32-characters");
  const noVideo = await post("/voice/stream", { id: randomUUID(), sessionKey: user.sessionKey, ticket }, user.cookie);
  assert.equal(noVideo.status, 400);
  assert.equal(voices.length, 0);
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
