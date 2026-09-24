import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptScroller } from './transcript-scroll.ts';

function fixture({ height = 1000, top = 600, reduced = false } = {}) {
  const node = new EventTarget();
  Object.assign(node, { scrollHeight: height, clientHeight: 400, scrollTop: top });
  let detached = false, serial = 0, time = 0;
  const frames = new Map();
  const controller = createTranscriptScroller(node, value => { detached = value; }, {
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
  return { node, controller, event, move, step, settle, detached: () => detached, frames };
}

test('downward wheel, End, clicks and taps at bottom never expose Back to latest', () => {
  const f = fixture();
  try {
    for (const [type, data] of [['wheel', { deltaY: 160 }], ['keydown', { key: 'End' }],
      ['keydown', { key: 'ArrowDown' }], ['pointerdown', {}], ['touchstart', { touches: [{ clientY: 200 }] }]]) {
      f.event(type, data); assert.equal(f.detached(), false);
    }
    f.node.scrollHeight += 200; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 800); assert.equal(f.detached(), false);
  } finally { f.controller.destroy(); }
});
test('upward intent alone is hidden; actual movement pauses streaming; reaching bottom resumes', () => {
  const f = fixture();
  try {
    f.event('wheel', { deltaY: -80 }); assert.equal(f.detached(), false);
    f.move(520); assert.equal(f.detached(), true);
    f.node.scrollHeight += 100; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 520);
    f.move(700); assert.equal(f.detached(), false);
    f.node.scrollHeight += 100; f.controller.resize(); f.settle();
    assert.equal(f.node.scrollTop, 800);
    f.event('wheel', { deltaY: 160 }); assert.equal(f.detached(), false);
  } finally { f.controller.destroy(); }
});
test('touch movement pauses only when leaving latest; bottom overscroll stays hidden', () => {
  const f = fixture();
  try {
    f.event('touchstart', { touches: [{ clientY: 200 }] });
    f.event('touchmove', { touches: [{ clientY: 240 }] });
    f.move(560); assert.equal(f.detached(), true);
    f.event('touchmove', { touches: [{ clientY: 100 }] });
    f.move(610); assert.equal(f.detached(), false);
    f.move(600); assert.equal(f.detached(), false);
    f.event('wheel', { deltaY: 100 }); f.settle();
    assert.equal(f.detached(), false);
  } finally { f.controller.destroy(); }
});
test('manual scrollbar movement interrupts an active animation; follow resumes smoothly', () => {
  const f = fixture();
  try {
    f.node.scrollHeight += 600; f.controller.resize(); f.step();
    assert.ok(f.node.scrollTop > 600 && f.node.scrollTop < 1200);
    f.move(400); assert.equal(f.detached(), true); assert.equal(f.frames.size, 0);
    f.controller.follow(); assert.equal(f.detached(), false); f.step();
    assert.ok(f.node.scrollTop > 400 && f.node.scrollTop < 1200);
    f.settle(); assert.equal(f.node.scrollTop, 1200);
  } finally { f.controller.destroy(); }
});
test('short content, fractional bottom and layout shrink do not leave a stale button', () => {
  const f = fixture({ height: 300, top: 0 });
  try {
    f.event('wheel', { deltaY: -100 }); f.event('pointerdown'); assert.equal(f.detached(), false);
    f.node.scrollHeight = 1000; f.controller.resize(); f.settle();
    f.event('wheel', { deltaY: -100 }); f.move(450); assert.equal(f.detached(), true);
    f.node.scrollHeight = 850.5; f.controller.resize(); f.settle();
    assert.equal(f.detached(), false); assert.equal(f.node.scrollTop, 450.5);
  } finally { f.controller.destroy(); }
});
test('reduced motion jumps directly; destruction cancels pending work and listeners', () => {
  const f = fixture({ reduced: true });
  f.node.scrollHeight = 2000; f.controller.resize(); f.step();
  assert.equal(f.node.scrollTop, 1600); assert.equal(f.frames.size, 0);
  f.controller.follow(); f.controller.destroy();
  assert.equal(f.frames.size, 0);
  f.move(0); assert.equal(f.detached(), false);
});
