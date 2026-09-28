import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the component's real event handlers/effects with deterministic hooks
// and a controllable ASR transport. No microphone, network or browser permission.
function fixture() {
  const hooks = [], effects = [], captures = [], submissions = [], activity = [], ready = [];
  const windowEvents = new Map(), documentEvents = new Map();
  let index = 0, tree, draft = 'Existing typed draft';
  const react = {
    useRef(value) { const i = index++; return hooks[i] ||= { current: value }; },
    useState(value) { const i = index++; hooks[i] ||= { value }; return [hooks[i].value, next => { hooks[i].value = next; }]; },
    useId() { index++; return 'speech-hint'; },
    useEffect(effect, deps) {
      const i = index++, old = hooks[i];
      if (!old || deps.some((value, d) => value !== old.deps[d])) effects.push(() => {
        old?.cleanup?.(); hooks[i] = { deps, cleanup: effect() };
      });
    },
  };
  class Capture {
    constructor(update, transcript, onReady) { Object.assign(this, { update, transcript, onReady }); captures.push(this); }
    start() { this.update({ phase: 'preparing', message: 'Preparing microphone' }); }
    ready() { this.onReady(); this.update({ phase: 'recording', message: 'Listening' }); }
    finish() { this.finishes = (this.finishes || 0) + 1; this.update({ phase: 'finishing', message: 'Finalizing' }); }
    cancel() { this.cancelled = true; }
    partial(text) { this.transcript(text, false); }
    final(text) { this.update({ phase: 'idle', message: 'Hold to speak' }); this.transcript(text, true); }
  }
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('./SpeechInput.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const events = map => ({ addEventListener: (name, fn) => map.set(name, fn), removeEventListener: name => map.delete(name) });
  const document = { ...events(documentEvents), hidden: false };
  runInNewContext(source, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
    if (name === './asr-client') return { AsrCapture: Capture };
    if (name === './AgentChat.module.css') return { default: {} };
    throw new Error(name);
  }, window: events(windowEvents), document });
  const element = { focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 10, top: 10, right: 210, bottom: 70 }) };
  const props = { sessionKey: 'session-one', disabled: false,
    onText: text => { draft = text; }, onFinal: text => submissions.push(text),
    onCaptureReady: () => ready.push(true), onActiveChange: value => activity.push(value) };
  const render = () => {
    index = 0; tree = exports.SpeechInput({ ...props, draft });
    tree.props.children.find(child => child.type === 'button').props.ref.current = element;
    while (effects.length) effects.shift()();
    return tree;
  };
  const act = fn => { fn(); render(); };
  render();
  return {
    captures, submissions, activity, ready, props, document,
    get draft() { return draft; }, get tree() { return tree; },
    get button() { return tree.props.children.find(child => child.type === 'button'); },
    get status() { return tree.props.children.find(child => child.props.id === 'speech-hint'); },
    get cancelHint() { return tree.props.children.find(child => child.props.id === 'speech-hint-cancel'); },
    render, act,
    pointer(name, options = {}) {
      const event = { button: 0, isPrimary: true, pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 40,
        currentTarget: element, preventDefault() {}, ...options };
      act(() => tree.props.children.find(child => child.type === 'button').props[name](event));
    },
    key(name, key, options = {}) {
      const event = { key, code: key === ' ' ? 'Space' : key, repeat: false, isComposing: false,
        target: { closest: () => null }, preventDefault() { this.prevented = true; }, ...options };
      act(() => windowEvents.get(name)?.(event)); return event;
    },
    blur: () => act(() => windowEvents.get('blur')?.()),
    hide: () => act(() => { document.hidden = true; documentEvents.get('visibilitychange')?.(); }),
    destroy: () => { hooks.forEach(hook => hook?.cleanup?.()); },
  };
}

test('touch: leaving arms cancel without stopping; outside release discards partials and ignores late final', () => {
  const f = fixture();
  f.pointer('onPointerDown'); const c = f.captures[0];
  f.act(() => { c.ready(); c.partial('Discard this speech'); });
  f.pointer('onPointerMove', { clientY: 0 });
  assert.equal(f.tree.props['data-cancel-pending'], true);
  assert.equal(c.cancelled, undefined, 'move back must remain possible');
  f.pointer('onPointerUp', { clientY: 0 });
  assert.equal(c.cancelled, true); assert.equal(c.finishes, undefined);
  assert.equal(f.draft, 'Existing typed draft'); assert.equal(f.activity.at(-1), false);
  f.act(() => { c.ready(); c.final('Late cancelled result'); });
  assert.equal(f.ready.length, 1); assert.deepEqual(f.submissions, []);
  assert.equal(f.draft, 'Existing typed draft');
  f.destroy();
});

test('touch: slide out, slide back, release sends exactly once; lost capture after release is harmless', () => {
  const f = fixture();
  f.pointer('onPointerDown'); const c = f.captures[0]; f.act(() => c.ready());
  f.pointer('onPointerMove', { clientX: 240 }); f.pointer('onPointerMove');
  assert.equal(f.tree.props['data-cancel-pending'], false);
  f.pointer('onPointerUp'); f.pointer('onLostPointerCapture');
  assert.equal(c.finishes, 1); assert.equal(c.cancelled, undefined);
  f.act(() => { c.final('Send this'); c.final('Duplicate'); });
  assert.deepEqual(f.submissions, ['Send this']);
  f.destroy();
});

test('touch: outside release is cancelled even without a final move event, also during setup', () => {
  const f = fixture();
  f.pointer('onPointerDown'); const c = f.captures[0];
  f.pointer('onPointerUp', { clientX: 0 });
  f.act(() => { c.ready(); c.final('Must not send'); });
  assert.equal(c.cancelled, true); assert.deepEqual(f.ready, []); assert.deepEqual(f.submissions, []);
  f.destroy();
});

test('ESC and Backspace cancel preparing, recording and finalizing; Space release/repeat cannot resend', () => {
  for (const key of ['Escape', 'Backspace']) for (const phase of ['preparing', 'recording', 'finishing']) {
    const f = fixture(); f.key('keydown', ' '); const c = f.captures[0];
    if (phase !== 'preparing') f.act(() => { c.ready(); c.partial('Draft to discard'); });
    if (phase === 'finishing') f.key('keyup', ' ');
    assert.equal(f.key('keydown', key).prevented, true);
    f.key('keydown', ' ', { repeat: true }); f.key('keyup', ' ');
    f.act(() => c.final('Late text'));
    assert.equal(c.cancelled, true); assert.equal(f.captures.length, 1);
    assert.equal(f.draft, 'Existing typed draft'); assert.deepEqual(f.submissions, []);
    f.key('keydown', ' '); assert.equal(f.captures.length, 2, 'fresh press still works');
    f.destroy();
  }
});

test('unrelated keyboard events and secondary pointers cannot start, finish or cancel a hold', () => {
  const f = fixture();
  assert.equal(f.key('keydown', 'Backspace').prevented, undefined);
  f.key('keydown', ' ', { target: { closest: () => ({}) } });
  f.key('keydown', ' ', { isComposing: true });
  f.pointer('onPointerDown', { isPrimary: false, pointerId: 2 });
  assert.equal(f.captures.length, 0);
  f.pointer('onPointerDown'); const c = f.captures[0];
  f.pointer('onPointerMove', { pointerId: 2, clientY: 0 });
  f.pointer('onPointerUp', { pointerId: 2 }); f.key('keyup', ' ');
  assert.equal(c.finishes, undefined); assert.equal(f.tree.props['data-cancel-pending'], false);
  assert.equal(f.key('keydown', 'Backspace', { isComposing: true }).prevented, undefined);
  f.destroy();
});

test('pointer cancellation, unexpected capture loss, blur and tab hiding discard rather than send', () => {
  for (const reason of ['onPointerCancel', 'onLostPointerCapture', 'blur', 'hide']) {
    const f = fixture(); f.pointer('onPointerDown'); const c = f.captures[0];
    f.act(() => { c.ready(); c.partial('Discard'); });
    if (reason.startsWith('on')) f.pointer(reason); else f[reason]();
    f.act(() => c.final('Late'));
    assert.equal(c.cancelled, true); assert.equal(c.finishes, undefined);
    assert.equal(f.draft, 'Existing typed draft'); assert.deepEqual(f.submissions, []);
    f.destroy();
  }
});

test('pending touch cancellation wins over the recording limit / unsolicited ASR final', () => {
  for (const finish of [false, true]) {
    const f = fixture(); f.pointer('onPointerDown'); const c = f.captures[0]; f.act(() => c.ready());
    f.pointer('onPointerMove', { clientY: 0 });
    f.act(() => { if (finish) c.finish(); c.final('Timed out speech'); });
    assert.equal(c.cancelled, true); assert.deepEqual(f.submissions, []);
    f.pointer('onPointerUp', { clientY: 0 }); f.destroy();
  }
});

test('conversation changes clean up without restoring a previous conversation draft', () => {
  const f = fixture(); f.key('keydown', ' '); const c = f.captures[0];
  f.act(() => { c.ready(); c.partial('Session one partial'); });
  f.props.onText('Session two draft'); f.props.sessionKey = 'session-two'; f.render();
  f.act(() => c.final('Stale session one'));
  assert.equal(c.cancelled, true); assert.equal(f.draft, 'Session two draft');
  assert.deepEqual(f.submissions, []); f.destroy();
});

test('touch cancellation hint stays above the button, including when sliding out and back', () => {
  const f = fixture(); f.pointer('onPointerDown'); f.act(() => f.captures[0].ready());
  assert.ok(f.button.props['aria-describedby'].includes(f.cancelHint.props.id));
  assert.equal(f.tree.props['data-input'], 'touch');
  assert.match(JSON.stringify(f.cancelHint), /Slide off the button to cancel/);
  assert.ok(f.tree.props.children.indexOf(f.cancelHint) < f.tree.props.children.indexOf(f.button));
  assert.doesNotMatch(JSON.stringify(f.status), /cancel/);
  assert.doesNotMatch(JSON.stringify(f.status), /Backspace/);
  assert.doesNotMatch(JSON.stringify(f.tree), /Backspace|Esc|Space/);
  assert.match(JSON.stringify(f.status), /Lift your finger to send/);
  assert.equal(f.cancelHint.props['data-visible'], true);
  f.pointer('onPointerMove', { clientY: 0 });
  assert.equal(f.button.props['aria-label'], 'Release to cancel recording');
  assert.match(JSON.stringify(f.cancelHint), /Lift your finger to cancel/);
  assert.match(JSON.stringify(f.cancelHint), /Lift to cancel · slide back to resume/);
  assert.doesNotMatch(JSON.stringify(f.status), /cancel/);
  f.pointer('onPointerMove');
  assert.match(JSON.stringify(f.cancelHint), /Slide off the button to cancel/);
  f.destroy();
});

test('desktop cancellation shortcut is above the button during setup, recording and finalizing', () => {
  const f = fixture();
  assert.equal(f.cancelHint.props['data-visible'], false);
  f.key('keydown', ' '); const c = f.captures[0];
  for (const next of [() => {}, () => c.ready(), () => f.key('keyup', ' ')]) {
    f.act(next);
    assert.equal(f.cancelHint.props['data-visible'], true);
    assert.equal(f.cancelHint.props['aria-hidden'], false);
    assert.ok(f.tree.props.children.indexOf(f.cancelHint) < f.tree.props.children.indexOf(f.button));
    assert.match(JSON.stringify(f.cancelHint), /Esc/);
    assert.match(JSON.stringify(f.cancelHint), /Backspace/);
    assert.ok(f.button.props['aria-describedby'].includes(f.cancelHint.props.id));
    assert.doesNotMatch(JSON.stringify(f.status), /Backspace/);
    assert.doesNotMatch(JSON.stringify(f.tree), /Slide off|Move off|Lift your finger/);
  }
  f.key('keydown', 'Escape');
  assert.equal(f.cancelHint.props['data-visible'], false);
  f.destroy();
});

test('mouse-button hold uses move-off instructions, not Space cancellation instructions', () => {
  const f = fixture(); f.pointer('onPointerDown', { pointerType: 'mouse' });
  f.act(() => f.captures[0].ready());
  assert.equal(f.tree.props['data-input'], 'mouse');
  assert.match(JSON.stringify(f.cancelHint), /Move off the button to cancel/);
  assert.ok(f.tree.props.children.indexOf(f.cancelHint) < f.tree.props.children.indexOf(f.button));
  assert.doesNotMatch(JSON.stringify(f.status), /cancel/);
  assert.doesNotMatch(JSON.stringify(f.tree), /Backspace|Esc|Space|Slide off/);
  assert.equal(f.cancelHint.props['data-visible'], true);
  f.pointer('onPointerMove', { pointerType: 'mouse', clientY: 0 });
  assert.match(JSON.stringify(f.cancelHint), /Release to cancel/);
  assert.match(JSON.stringify(f.cancelHint), /Release to cancel · move back to resume/);
  f.destroy();
});

test('touch → Space → mouse switches instructions per hold without leaking old copy', () => {
  const f = fixture();
  f.pointer('onPointerDown'); f.act(() => f.captures[0].ready());
  assert.match(JSON.stringify(f.cancelHint), /Slide off/);
  f.pointer('onPointerUp', { clientY: 0 });
  f.key('keydown', ' '); f.act(() => f.captures[1].ready());
  assert.match(JSON.stringify(f.status), /Release Space to send/);
  assert.equal(f.cancelHint.props['data-visible'], true);
  assert.doesNotMatch(JSON.stringify(f.tree), /Slide off|Move off/);
  f.key('keydown', 'Escape'); f.key('keyup', ' ');
  f.pointer('onPointerDown', { pointerType: 'mouse' }); f.act(() => f.captures[2].ready());
  assert.match(JSON.stringify(f.cancelHint), /Move off/);
  assert.doesNotMatch(JSON.stringify(f.tree), /Backspace|Esc|Space/);
  f.destroy();
});

test('shared hint slot switches between cancellation guidance and status for touch and keyboard', () => {
  const f = fixture();
  const check = cancel => {
    assert.equal(f.tree.props['data-cancel-hint'], cancel);
    assert.equal(f.cancelHint.props['data-visible'], cancel);
    assert.equal(f.button.props['aria-describedby'], cancel ? f.cancelHint.props.id : f.status.props.id);
  };
  check(false);
  f.pointer('onPointerDown'); check(true);
  const capture = f.captures[0];
  f.act(() => capture.ready()); check(true);
  f.pointer('onPointerMove', { clientY: 0 }); check(true);
  f.pointer('onPointerUp', { clientY: 0 }); check(false);
  assert.match(JSON.stringify(f.status), /Recording cancelled · nothing sent/);
  assert.deepEqual(f.submissions, []);
  f.pointer('onPointerDown'); check(true);
  f.pointer('onPointerUp'); check(false);
  assert.match(JSON.stringify(f.status), /Recognizing/);
  f.act(() => f.captures[1].update({ phase: 'error', message: 'Microphone unavailable' })); check(false);
  assert.match(JSON.stringify(f.status), /Microphone unavailable/);
  f.props.disabled = true; f.render(); check(false);
  assert.match(JSON.stringify(f.status), /Available when Yihao finishes replying/);
  f.props.disabled = false; f.render();
  f.key('keydown', ' '); check(true);
  assert.match(JSON.stringify(f.cancelHint), /Esc/);
  assert.match(JSON.stringify(f.cancelHint), /Backspace/);
  f.act(() => f.captures[2].ready()); check(true);
  f.key('keyup', ' '); check(true);
  f.key('keydown', 'Escape'); check(false);
  assert.match(JSON.stringify(f.status), /Recording cancelled · nothing sent/);
  f.destroy();
});
