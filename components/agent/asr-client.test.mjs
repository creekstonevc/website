import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { AsrCapture } from './asr-client.ts';

function fixture() {
  const names = ['navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket', 'location'];
  const saved = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let grant; const sockets = [], contexts = [], nodes = [], states = [], texts = [], submissions = [];
  const track = { stopped: false, stop() { this.stopped = true; } };
  class Context {
    constructor() { contexts.push(this); }
    audioWorklet = { addModule: async () => {} };
    resume = async () => {}; close = async () => { this.closed = true; };
    createMediaStreamSource = () => ({ connect() {} });
    createGain = () => ({ gain: {}, connect() {} });
  }
  class Node {
    constructor() { nodes.push(this); }
    port = { postMessage: value => { if (value === 'stop') this.port.onmessage({ data: 'stopped' }); } };
    connect = value => value; disconnect() {}
  }
  class Socket {
    static OPEN = 1; readyState = 1; bufferedAmount = 0; sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); } close() { this.closed = true; }
  }
  const replacements = { navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } },
    AudioContext: Context, AudioWorkletNode: Node, WebSocket: Socket, location: { href: 'https://fixture.invalid/agent/', protocol: 'https:' } };
  for (const name of names) Object.defineProperty(globalThis, name, { value: replacements[name], configurable: true });
  const capture = new AsrCapture(state => states.push(state), (text, final) => {
    texts.push(text);
    if (final && text.trim()) {
      assert.equal(states.at(-1).phase, 'idle', 'recording lock must be released before submission');
      assert.ok(track.stopped);
      submissions.push(text);
    }
  });
  return { capture, sockets, contexts, nodes, states, texts, submissions, track,
    grant: () => grant({ getTracks: () => [track] }),
    restore: () => { capture.cancel(); for (const name of names) { if (saved[name]) Object.defineProperty(globalThis, name, saved[name]); else delete globalThis[name]; } },
  };
}

test('release while permission is pending stops late microphone and never opens ASR', async () => {
  const f = fixture();
  try {
    const start = f.capture.start('session'); await Promise.resolve();
    f.capture.finish(); f.grant(); await start;
    assert.ok(f.track.stopped); assert.ok(f.contexts[0].closed); assert.equal(f.sockets.length, 0);
  } finally { f.restore(); }
});

test('partial text arrives live; release flushes microphone; stale callbacks cannot overwrite a new capture', async () => {
  const f = fixture();
  try {
    const start = f.capture.start('session'); await Promise.resolve(); f.grant(); await start;
    const socket = f.sockets[0]; socket.onmessage({ data: JSON.stringify({ type: 'ready' }) });
    assert.equal(f.states.at(-1).phase, 'recording');
    socket.onmessage({ data: JSON.stringify({ type: 'partial', text: 'hello' }) });
    assert.deepEqual(f.texts, ['hello']);
    assert.deepEqual(f.submissions, []);
    f.nodes[0].port.onmessage({ data: new ArrayBuffer(3200) });
    f.capture.finish(); assert.ok(f.track.stopped); assert.ok(f.contexts[0].closed);
    assert.equal(socket.sent.at(-1), '{"type":"finish"}');
    const late = socket.onmessage;
    socket.onmessage({ data: JSON.stringify({ type: 'final', text: 'Hello founder.' }) });
    assert.equal(f.states.at(-1).phase, 'idle'); assert.ok(socket.closed);
    late({ data: JSON.stringify({ type: 'partial', text: 'STALE' }) });
    late({ data: JSON.stringify({ type: 'final', text: 'Duplicate' }) });
    assert.deepEqual(f.texts, ['hello', 'Hello founder.']);
    assert.deepEqual(f.submissions, ['Hello founder.']);
  } finally { f.restore(); }
});

test('blank final and cancelled captures never submit', async () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    try {
      const start = f.capture.start('session'); await Promise.resolve(); f.grant(); await start;
      const socket = f.sockets[0]; socket.onmessage({ data: JSON.stringify({ type: 'ready' }) });
      const late = socket.onmessage;
      if (cancel) f.capture.cancel(); else f.capture.finish();
      late({ data: JSON.stringify({ type: 'final', text: cancel ? 'Cancelled text' : '   ' }) });
      assert.deepEqual(f.submissions, []);
    } finally { f.restore(); }
  }
});

test('worklet resamples 48kHz into 16kHz PCM and flushes the final short frame', () => {
  let Processor; const messages = [];
  vm.runInNewContext(readFileSync(new URL('../../public/asr-capture.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: data => messages.push(data) }; },
    sampleRate: 48000, registerProcessor: (_name, value) => { Processor = value; },
  });
  const p = new Processor(); p.process([[new Float32Array(4800).fill(.5)]]);
  assert.equal(messages[0].byteLength, 3200); assert.equal(new Int16Array(messages[0])[0], 16384);
  p.process([[new Float32Array(300).fill(.25)]]); p.port.onmessage({ data: 'stop' });
  assert.equal(messages[1].byteLength, 200); assert.equal(messages[2], 'stopped');
  assert.equal(p.process([[new Float32Array(4800)]]), false);
});
