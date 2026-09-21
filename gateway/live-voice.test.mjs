import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import { BytePlusLiveVoice, SpeechSegments, encodeVoiceFrame, decodeVoiceFrame } from "./live-voice.mjs";

test("voice binary codec preserves UTF-8 text and session IDs", () => {
  const raw = encodeVoiceFrame(200, { req_params: { text: "你好，founder。" } }, "test-session");
  const decoded = decodeVoiceFrame(raw);
  assert.equal(decoded.event, 200);
  assert.equal(decoded.payload.req_params.text, "你好，founder。");
  assert.throws(() => decodeVoiceFrame(raw.subarray(0, raw.length - 1)));
});

test("speech strips fragmented code, attachments, URLs, links and paths", () => {
  const input = "你好。```js\nprivate_code()\n```接下来。`/workspace/session/private.txt`附件 {{attachment://private/path.pdf}} [下载](https://secret.example/file.pdf) https://secret.example/a。b\n/workspace/private.pdf 完成。";
  for (const width of [1, 2, 5, 12, 50]) {
    const spoken = [];
    const parser = new SpeechSegments((part) => spoken.push(part));
    for (let i = 0; i < input.length; i += width) parser.push(input.slice(i, i + width));
    parser.push("", true);
    const output = spoken.join("");
    assert.match(output, /你好。接下来。/);
    assert.match(output, /完成。/);
    assert.doesNotMatch(output, /private|secret|workspace|attachment|https|下载/);
  }
});

test("speech holds unfinished constructs and enforces text budget", () => {
  const output = [];
  const parser = new SpeechSegments((s) => output.push(s), 5);
  parser.push("你好。还有更多的文字。`do not speak", true);
  assert.equal(output.join("").length, 5);
});

test("synchronous voice setup failure cannot break the text stream", () => {
  const events = [];
  const voice = new BytePlusLiveVoice({}, (event, data) => events.push({ event, data }), {
    socketFactory: () => { throw new Error("Do not expose provider configuration"); },
  });
  assert.doesNotThrow(() => voice.push("Hello founder. "));
  assert.equal(voice.closed, true);
  assert.equal(events.at(-1).data.code, "voice_unavailable");
  assert.doesNotMatch(JSON.stringify(events), /provider configuration/);
});

test("bidirectional session receives audio BEFORE text is finished", async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const received = [];
  server.on("connection", (socket, request) => {
    assert.equal(request.headers["x-api-key"], "test-key");
    socket.on("message", (bytes) => {
      const { event, payload } = decodeVoiceFrame(bytes); received.push({ event, payload });
      const reply = (id, data = {}) => { const packet = encodeVoiceFrame(id, data, "test"); packet[1] = 0x94; socket.send(packet); };
      if (event === 1) reply(50);
      if (event === 100) reply(150);
      if (event === 200) {
        const pcm = Buffer.from([0, 0, 255, 127]);
        const frame = encodeVoiceFrame(352, {}, "test");
        const start = frame.length - 2;
        frame[1] = 0xb4; frame[2] = 0;
        frame.writeUInt32BE(pcm.length, start - 4);
        socket.send(Buffer.concat([frame.subarray(0, start), pcm]));
      }
      if (event === 102) reply(152);
    });
  });
  const events = [];
  let firstAudio;
  const audio = new Promise((resolve) => { firstAudio = resolve; });
  let ended;
  const finished = new Promise((resolve) => { ended = resolve; });
  const voice = new BytePlusLiveVoice({ bytePlusApiKey: "test-key", bytePlusResourceId: "seed-icl-2.0",
    bytePlusSpeakerId: "test-speaker", bytePlusLiveUrl: `ws://127.0.0.1:${server.address().port}` }, (event, data) => {
    events.push({ event, data }); if (event === "audio") firstAudio(); if (event === "done") ended();
  });
  try {
    voice.push("你好，创业者。 ");
    await Promise.race([audio, new Promise((_, reject) => setTimeout(() => reject(new Error("No streamed audio")), 2000).unref())]);
    assert.equal(received.some((f) => f.event === 102), false);
    voice.push("第二句话。 "); voice.finish();
    await finished;
    assert.equal(events.filter((e) => e.event === "audio").length, 2);
    assert.equal(received.find((e) => e.event === 100).payload.req_params.audio_params.format, "pcm");
  } finally { voice.cancel(); for (const socket of server.clients) socket.terminate(); server.close(); }
});
