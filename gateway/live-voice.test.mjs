import assert from "node:assert/strict";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import { BytePlusLiveVoice, HighlightedLiveVoice, SpeechSegments, encodeVoiceFrame, decodeVoiceFrame } from "./live-voice.mjs";

const flushBatches = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

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

test("a fragmented ordered-list marker is not spoken as a separate sentence", () => {
  const spoken = [], parser = new SpeechSegments(text => spoken.push(text));
  for (const char of '1. 先把问题讲清楚。\n2. 然后一起讨论。') parser.push(char);
  parser.push('', true);
  assert.deepEqual(spoken, ['先把问题讲清楚。', '然后一起讨论。']);
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

test("pure-audio subtitles opt in explicitly; validated absolute word times pass through without affecting video", () => {
  for (const subtitles of [false, true]) {
    const socket = new EventEmitter(), sent = [], events = [];
    Object.assign(socket, { readyState: 1, bufferedAmount: 0, send: packet => sent.push(decodeVoiceFrame(packet)), close() {}, terminate() {} });
    const voice = new BytePlusLiveVoice({ bytePlusSpeakerId: 'speaker' }, (event, data) => events.push({ event, data }),
      { subtitles, socketFactory: () => socket });
    const receive = (event, payload = {}) => socket.emit('message', encodeVoiceFrame(event, payload, 'test'));
    try {
      voice.push('Hello founder. '); receive(50);
      assert.equal(sent.find(frame => frame.event === 100).payload.req_params.audio_params.enable_subtitle, subtitles ? true : undefined);
      receive(150);
      receive(364, { words: [
        { word: 'Hello', startTime: 0.1, endTime: 0.6 },
        { word: 'bad', startTime: -1, endTime: 1 },
        { word: 'founder.', startTime: 0.7, endTime: 1.2 },
        { word: 'invalid', startTime: '1', endTime: 2 },
      ] });
      receive(364, { words: [{ word: 'Hello', startTime: 0.1, endTime: 0.6 }, { word: 'Next.', startTime: 3.4, endTime: 4.1 }] });
      const metadata = events.filter(entry => entry.event === 'subtitle');
      if (!subtitles) assert.equal(metadata.length, 0);
      else {
        assert.equal(metadata.length, 2);
        assert.deepEqual(metadata.flatMap(entry => entry.data.words), [
          { text: 'Hello', startSample: 2400, endSample: 14400 },
          { text: 'founder.', startSample: 16800, endSample: 28800 },
          { text: 'Next.', startSample: 81600, endSample: 98400 },
        ]);
      }
      receive(152); assert.equal(events.at(-1).event, 'done');
    } finally { voice.cancel(); }
  }
});

test("highlighted audio announces exact sentence boundaries before PCM, without waiting for subtitles or LLM completion", async () => {
  const events = [], children = [];
  const voice = new HighlightedLiveVoice({}, (event, data) => events.push({ event, data }), {
    makeVoice(emit) {
      const child = { emit, text: '', finished: false, cancelled: false,
        push(text) { this.text += text; }, finish() { this.finished = true; }, cancel() { this.cancelled = true; } };
      children.push(child); return child;
    },
  });
  const first = '你好。我们先一起聊一聊你现在最关心的创业问题，然后再继续。';
  voice.push(first);
  const spokenFirst = '你好。 我们先一起聊一聊你现在最关心的创业问题，然后再继续。';
  assert.equal(children.length, 1); assert.equal(children[0].text, spokenFirst);
  assert.equal(children[0].finished, true); assert.equal(voice.ending, false);
  children[0].emit('audio', { data: Buffer.alloc(4800).toString('base64') });
  await flushBatches();
  assert.deepEqual(events.map(x => x.event), ['segment', 'audio']);
  assert.deepEqual(events[0].data, { text: spokenFirst, startSample: 0, endSample: null });
  // Only one look-ahead may synthesize; even if it finishes first its samples
  // must wait behind the current batch.
  voice.push('第二组里包含足够长的文字，我们继续认真讨论之前提到的问题。');
  voice.finish(); assert.equal(children.length, 2);
  children[1].emit('audio', { data: Buffer.alloc(1200).toString('base64') });
  children[1].emit('done', {});
  await flushBatches();
  assert.equal(events.filter(x => x.event === 'audio').length, 1);
  children[0].emit('subtitle', { words: [{ text: '错误的最后一句', startSample: 0, endSample: 100 }] });
  children[0].emit('audio', { data: Buffer.alloc(2400).toString('base64') });
  children[0].emit('done', {});
  await flushBatches();
  assert.equal(children.length, 2);
  assert.deepEqual(events.filter(x => x.event === 'segment')[1].data, { text: spokenFirst, startSample: 0, endSample: 3600 });
  assert.equal(events.filter(x => x.event === 'segment')[2].data.startSample, 3600);
  assert.equal(events.at(-1).event, 'done');
  assert.equal(events.filter(x => x.event === 'segment').at(-1).data.endSample, 4200);
  assert.equal(events.some(x => x.event === 'subtitle'), false);
});

test("highlighted audio bounds long groups, flushes the short tail, and cancels queued synthesis", async () => {
  const children = [], events = [];
  const voice = new HighlightedLiveVoice({ maxTtsCharacters: 500 }, (event, data) => events.push({ event, data }), {
    makeVoice(emit) {
      const child = { emit, push(text) { this.text = text; }, finish() {}, cancel() { this.cancelled = true; } };
      children.push(child); return child;
    },
  });
  voice.push('好'); assert.equal(children.length, 0);
  voice.push('这'.repeat(400) + '。最后。'); voice.finish();
  assert.ok(children[0].text.length <= 160);
  children[0].emit('audio', { data: Buffer.alloc(2).toString('base64') });
  children[0].emit('done', {});
  voice.cancel();
  await flushBatches();
  assert.equal(children.length, 2); assert.equal(voice.queue.length, 0);
  assert.equal(children[1].cancelled, true);
  const length = events.length; children[0].emit('audio', { data: 'AAA=' });
  assert.equal(events.length, length);

  const tail = [];
  const short = new HighlightedLiveVoice({}, () => {}, { makeVoice: () => ({ push: text => tail.push(text), finish() {}, cancel() {} }) });
  short.push('你好。'); assert.equal(tail.length, 0); short.finish();
  assert.deepEqual(tail, ['你好。']); short.cancel();
});

test("highlighted audio fails safely and never starts the next batch after provider failure", async () => {
  const events = []; let child;
  const voice = new HighlightedLiveVoice({}, (event, data) => events.push({ event, data }), { makeVoice(emit) {
    child = { emit, push() {}, finish() {}, cancel() { this.cancelled = true; } }; return child;
  } });
  voice.push('这里是一段足够长的测试文本，我们希望它可以在发生错误后安全退出。');
  child.emit('error', { code: 'voice_unavailable' });
  voice.push('不能再触发。'); voice.finish();
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(voice.closed, true); assert.equal(child.cancelled, true);
  assert.deepEqual(events, [{ event: 'error', data: { code: 'voice_unavailable' } }]);
});
