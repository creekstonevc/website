import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptScroller } from './transcript-scroll.ts';

function fixture({ height = 1000, top = 600, reduced = false } = {}) {
  const node = new EventTarget();
  Object.assign(node, { scrollHeight: height, clientHeight: 400, scrollTop: top, getBoundingClientRect: () => ({ top: 0 }) });
  let returnVisible = false, serial = 0, time = 0;
  const frames = new Map();
  const controller = createTranscriptScroller(node, value => { returnVisible = value; }, {
    requestFrame: fn => { frames.set(++serial, fn); return serial; },
    cancelFrame: id => frames.delete(id), now: () => time, reducedMotion: () => reduced,
  });
  const event = (type, data = {}) => node.dispatchEvent(Object.assign(new Event(type), data));
  const move = top => { node.scrollTop = top; event('scroll'); };
  const step = () => {
    time += 16; const callbacks = [...frames.values()]; frames.clear();
    for (const callback of callbacks) callback(time);
    event('scroll');
  };
  const settle = () => { for (let i = 0; frames.size && i < 100; i++) step(); assert.equal(frames.size, 0); };
  return { node, controller, event, move, step, settle, returnVisible: () => returnVisible, frames };
}

test('downward wheel, End, clicks and taps at bottom never expose Back to latest', () => {
  const f = fixture();
  try {
    for (const [type, data] of [['wheel', { deltaY: 160 }], ['keydown', { key: 'End' }],
      ['keydown', { key: 'ArrowDown' }], ['pointerdown', {}], ['touchstart', { touches: [{ clientY: 200 }] }]]) {
      f.event(type, data); assert.equal(f.returnVisible(), false);
    }
    f.node.scrollHeight += 200; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 800); assert.equal(f.returnVisible(), false);
  } finally { f.controller.destroy(); }
});
test('small movement pauses streaming without a return button; reaching bottom resumes', () => {
  const f = fixture();
  try {
    f.event('wheel', { deltaY: -80 }); assert.equal(f.returnVisible(), false);
    f.move(520); assert.equal(f.returnVisible(), false);
    f.node.scrollHeight += 100; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 520);
    f.move(700); assert.equal(f.returnVisible(), false);
    f.node.scrollHeight += 100; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 800);
    f.event('wheel', { deltaY: 160 }); assert.equal(f.returnVisible(), false);
  } finally { f.controller.destroy(); }
});
test('touch movement pauses only when leaving latest; bottom overscroll stays hidden', () => {
  const f = fixture();
  try {
    f.event('touchstart', { touches: [{ clientY: 200 }] });
    f.event('touchmove', { touches: [{ clientY: 240 }] });
    f.move(560); assert.equal(f.returnVisible(), false);
    f.event('touchmove', { touches: [{ clientY: 100 }] });
    f.move(610); assert.equal(f.returnVisible(), false);
    f.move(600); assert.equal(f.returnVisible(), false);
    f.event('wheel', { deltaY: 100 }); f.settle();
    assert.equal(f.returnVisible(), false);
  } finally { f.controller.destroy(); }
});
test('manual scrollbar movement interrupts an active animation; follow resumes smoothly', () => {
  const f = fixture();
  try {
    f.node.scrollHeight += 600; f.controller.resize(); f.step();
    assert.ok(f.node.scrollTop > 600 && f.node.scrollTop < 1200);
    f.move(400); assert.equal(f.returnVisible(), true); assert.equal(f.frames.size, 0);
    f.controller.follow(); assert.equal(f.returnVisible(), false); f.step();
    assert.ok(f.node.scrollTop > 400 && f.node.scrollTop < 1200);
    f.settle(); assert.equal(f.node.scrollTop, 1200);
  } finally { f.controller.destroy(); }
});
test('short content, fractional bottom and layout shrink do not leave a stale button', () => {
  const f = fixture({ height: 300, top: 0 });
  try {
    f.event('wheel', { deltaY: -100 }); f.event('pointerdown'); assert.equal(f.returnVisible(), false);
    f.node.scrollHeight = 1000; f.controller.resize(); f.settle();
    f.event('wheel', { deltaY: -100 }); f.move(150); assert.equal(f.returnVisible(), true);
    f.move(450); assert.equal(f.returnVisible(), false);
    f.node.scrollHeight = 850.5; f.controller.resize(); f.settle();
    assert.equal(f.returnVisible(), false); assert.equal(f.node.scrollTop, 450.5);
  } finally { f.controller.destroy(); }
});

test('return control appears only beyond one viewport from the bottom and hides on return', () => {
  const f = fixture({ height: 2000, top: 1600 });
  try {
    f.event('wheel', { deltaY: -200 });
    f.move(1201); assert.equal(f.returnVisible(), false);
    f.move(1200); assert.equal(f.returnVisible(), false, 'exactly one screen remains hidden');
    f.move(1199); assert.equal(f.returnVisible(), true);
    f.move(1200); assert.equal(f.returnVisible(), false);
    f.node.scrollHeight += 100; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 1200, 'hidden button does not resume follow');
    assert.equal(f.returnVisible(), true, 'streaming growth refreshes distance');
    f.node.clientHeight = 600; f.controller.resize();
    assert.equal(f.returnVisible(), false, 'viewport growth refreshes threshold');
    f.node.clientHeight = 300; f.controller.resize();
    assert.equal(f.returnVisible(), true);
    f.controller.follow(); assert.equal(f.returnVisible(), false);
    f.settle(); assert.equal(f.node.scrollTop, 1800);
  } finally { f.controller.destroy(); }
});

test('speech detachment keeps the one-screen visibility threshold without silently resuming', () => {
  const f = fixture({ height: 2400, top: 1820 });
  try {
    f.controller.setSpeech(true); f.controller.setSpeechTarget([speechTarget(f, 2000)]); f.settle();
    f.event('wheel', { deltaY: -200 }); f.move(1700);
    assert.equal(f.returnVisible(), false, 'paused near bottom, no return control');
    f.move(1600); assert.equal(f.returnVisible(), false);
    f.move(1599); assert.equal(f.returnVisible(), true);
    f.move(1650); assert.equal(f.returnVisible(), false);
    f.controller.setSpeechTarget([speechTarget(f, 2100)]); f.settle();
    assert.equal(f.node.scrollTop, 1650, 'new target cannot reattach');
    f.move(1599); assert.equal(f.returnVisible(), true);
    f.controller.follow(); assert.equal(f.returnVisible(), false);
    f.settle(); assert.ok(Math.abs(f.node.scrollTop - 1920) <= 1, 'return targets speech, not bottom');
  } finally { f.controller.destroy(); }
});
test('reduced motion jumps directly; destruction cancels pending work and listeners', () => {
  const f = fixture({ reduced: true });
  f.node.scrollHeight = 2000; f.controller.resize(); f.step();
  assert.equal(f.node.scrollTop, 1600); assert.equal(f.frames.size, 0);
  f.controller.follow(); f.controller.destroy();
  assert.equal(f.frames.size, 0);
  f.move(0); assert.equal(f.returnVisible(), false);
});

function speechTarget(f, offset) {
  return { isConnected: true, getBoundingClientRect: () => ({ top: offset - f.node.scrollTop, bottom: offset + 40 - f.node.scrollTop }) };
}
test('speech follows the highlighted group center, not the expanding message bottom', () => {
  const f = fixture({ height: 2200, top: 0 });
  try {
    f.controller.setSpeech(true); f.controller.setSpeechTarget([speechTarget(f, 800)]);
    f.step(); assert.ok(f.node.scrollTop > 0 && f.node.scrollTop < 620);
    f.settle(); assert.ok(Math.abs(f.node.scrollTop - 620) <= 1);
    f.node.scrollHeight += 1000; f.controller.resize(); f.settle();
    assert.ok(Math.abs(f.node.scrollTop - 620) <= 1);
    f.controller.setSpeechTarget([speechTarget(f, 1200)]); f.settle();
    assert.ok(Math.abs(f.node.scrollTop - 1020) <= 1);
  } finally { f.controller.destroy(); }
});
test('manual speech scrolling in either direction detaches; only central re-entry resumes', () => {
  for (const direction of [-1, 1]) {
    const f = fixture({ height: 2400, top: 620 });
    try {
      f.controller.setSpeech(true); f.controller.setSpeechTarget([speechTarget(f, 800)]); f.settle();
      f.event('wheel', { deltaY: direction * 20 }); f.move(620 + direction * 20);
      assert.equal(f.returnVisible(), true, 'movement still inside center band does not snap back');
      f.controller.resize(); f.settle(); assert.equal(f.node.scrollTop, 620 + direction * 20);
      f.move(620 + direction * 180); assert.equal(f.returnVisible(), true);
      f.node.scrollHeight += 200; f.controller.resize(); f.settle();
      assert.equal(f.node.scrollTop, 620 + direction * 180);
      f.move(620 + direction * 30); assert.equal(f.returnVisible(), false);
      f.settle(); assert.ok(Math.abs(f.node.scrollTop - 620) <= 1);
    } finally { f.controller.destroy(); }
  }
});
test('new speech cues cannot reattach a detached reader; explicit return works and next playback resets', () => {
  const f = fixture({ height: 2400, top: 620 });
  try {
    f.controller.setSpeech(true); f.controller.setSpeechTarget([speechTarget(f, 800)]);
    f.event('wheel', { deltaY: 200 }); f.move(820);
    f.controller.setSpeechTarget([speechTarget(f, 1000)]); f.controller.resize(); f.settle();
    assert.equal(f.returnVisible(), true); assert.equal(f.node.scrollTop, 820);
    f.controller.setSpeechTarget([speechTarget(f, 1400)]); f.settle();
    assert.equal(f.node.scrollTop, 820);
    f.controller.follow(); f.settle(); assert.equal(f.returnVisible(), false);
    f.move(400); assert.equal(f.returnVisible(), true, 'scrollbar movement also detaches');
    f.controller.setSpeech(false); f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 400);
    f.controller.setSpeech(true); f.controller.setSpeechTarget([speechTarget(f, 1400)]); f.settle();
    assert.ok(Math.abs(f.node.scrollTop - 1220) <= 1);
  } finally { f.controller.destroy(); }
});
