import { useEffect, useId, useRef, useState } from 'react';
import { AsrCapture, type AsrState } from './asr-client';
import styles from './AgentChat.module.css';

export function SpeechInput({ sessionKey, disabled, draft, onText, onFinal, onCaptureReady, onActiveChange }: {
  sessionKey: string; disabled: boolean; draft: string; onText: (text: string) => void;
  onFinal: (text: string) => void;
  onCaptureReady: () => void; onActiveChange: (active: boolean) => void;
}) {
  const [state, setState] = useState<AsrState>({ phase: 'idle', message: 'Hold to speak · release to send' });
  const [cancelPending, setCancelPending] = useState(false);
  const [inputKind, setInputKind] = useState<'keyboard' | 'touch' | 'mouse'>('keyboard');
  const hintId = useId();
  const current = useRef<AsrCapture | null>(null);
  const held = useRef(false);
  const active = useRef(false);
  const cancelIntent = useRef(false);
  const pointer = useRef<number | null>(null);
  const keyboardHold = useRef(false);
  const previousDraft = useRef('');
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  const callbacks = useRef({ draft, onText, onFinal, onCaptureReady, onActiveChange });
  useEffect(() => { callbacks.current = { draft, onText, onFinal, onCaptureReady, onActiveChange }; }, [draft, onText, onFinal, onCaptureReady, onActiveChange]);
  const actions = useRef<{ start: () => boolean; finish: () => void; cancel: () => boolean }>({ start: () => false, finish: () => {}, cancel: () => false });
  const setCancelIntent = (outside: boolean) => { cancelIntent.current = outside; setCancelPending(outside); };
  const outsideButton = (event: { clientX: number; clientY: number; currentTarget: HTMLButtonElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  };
  useEffect(() => {
    const resetGesture = () => {
      held.current = false; keyboardHold.current = false; pointer.current = null;
      cancelIntent.current = false; setCancelPending(false);
    };
    const cancel = (notify = true, restoreDraft = true) => {
      const wasActive = active.current;
      // Invalidate before closing: neither late ASR results nor pointer-up may send.
      const capture = current.current; current.current = null; active.current = false;
      resetGesture(); capture?.cancel();
      if (wasActive) {
        if (restoreDraft) callbacks.current.onText(previousDraft.current);
        callbacks.current.onActiveChange(false);
        if (notify) setState({ phase: 'idle', message: 'Recording cancelled · nothing sent' });
      }
      return wasActive;
    };
    const start = () => {
      if (disabled || !sessionKey || held.current) return false;
      const savedDraft = active.current ? previousDraft.current : callbacks.current.draft;
      cancel(false); held.current = true; active.current = true; previousDraft.current = savedDraft;
      callbacks.current.onActiveChange(true);
      const capture = new AsrCapture(next => {
        if (current.current !== capture) return;
        // The recording limit can finalize without pointer-up. A pending cancel
        // must still win, even if an ASR final arrives before the finger lifts.
        if ((next.phase === 'finishing' || next.phase === 'idle') && cancelIntent.current) { cancel(); return; }
        setState(next);
        active.current = next.phase === 'preparing' || next.phase === 'recording' || next.phase === 'finishing';
        if (next.phase === 'error') { current.current = null; resetGesture(); }
        callbacks.current.onActiveChange(next.phase === 'preparing' || next.phase === 'recording' || next.phase === 'finishing');
      }, (text, final) => {
        if (current.current !== capture) return;
        callbacks.current.onText(text);
        if (final) {
          current.current = null; resetGesture();
          if (text.trim()) callbacks.current.onFinal(text);
        }
      }, () => { if (current.current === capture) callbacks.current.onCaptureReady(); });
      current.current = capture;
      void capture.start(sessionKey);
      return true;
    };
    const finish = () => { if (!held.current) return; resetGesture(); current.current?.finish(); };
    actions.current = { start, finish, cancel };
    const down = (event: KeyboardEvent) => {
      if ((event.key === 'Escape' || event.key === 'Backspace') && active.current && !event.isComposing &&
          !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); cancel(); return;
      }
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
          target?.closest('textarea, input, select, a, [contenteditable="true"], button:not([data-hold-to-talk])')) return;
      event.preventDefault();
      if (start()) { keyboardHold.current = true; setInputKind('keyboard'); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space' && keyboardHold.current) { event.preventDefault(); finish(); } };
    const blur = () => { cancel(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      // Conversation changes own their draft; do not restore an old draft into
      // a newly selected conversation during effect cleanup.
      cancel(true, false); actions.current = { start: () => false, finish: () => {}, cancel: () => false };
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
    };
  }, [disabled, sessionKey]);
  const capturing = state.phase === 'preparing' || state.phase === 'recording';
  const keyboardInput = inputKind === 'keyboard';
  const showCancelHint = !disabled && (capturing || (keyboardInput && state.phase === 'finishing'));
  const cancelHintId = `${hintId}-cancel`;
  return <div className={styles.speechInput} data-phase={state.phase} data-cancel-pending={cancelPending} data-input={inputKind} data-cancel-hint={showCancelHint}>
    <p id={cancelHintId} className={styles.speechCancelHint} data-visible={showCancelHint} aria-hidden={!showCancelHint} role="status">
      {showCancelHint && (keyboardInput ? <><kbd>Esc</kbd><span> / </span><kbd>Backspace</kbd><span> to cancel</span></>
        : cancelPending ? <>
          <span className={styles.speechCancelDetail}>{inputKind === 'touch' ? 'Lift your finger to cancel · slide back to continue' : 'Release to cancel · move back to continue'}</span>
          <span className={styles.speechCancelCompact}>{inputKind === 'touch' ? 'Lift to cancel · slide back to resume' : 'Release to cancel · move back to resume'}</span>
        </> : <span>{inputKind === 'touch' ? 'Slide off the button to cancel' : 'Move off the button to cancel'}</span>)}
    </p>
    <button ref={button} type="button" data-hold-to-talk disabled={disabled}
      aria-label={cancelPending ? 'Release to cancel recording' : 'Hold to speak, release to send'}
      aria-describedby={showCancelHint ? cancelHintId : hintId}
      aria-pressed={state.phase === 'recording'}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        if (!actions.current.start()) return;
        pointer.current = event.pointerId; setInputKind(event.pointerType === 'mouse' ? 'mouse' : 'touch');
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (pointer.current === event.pointerId && held.current) setCancelIntent(outsideButton(event));
      }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        if (outsideButton(event)) actions.current.cancel(); else actions.current.finish();
      }}
      onLostPointerCapture={event => { if (pointer.current === event.pointerId) actions.current.cancel(); }}
      onPointerCancel={event => { if (pointer.current === event.pointerId) actions.current.cancel(); }}
      onContextMenu={event => event.preventDefault()}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{cancelPending ? <path d="m6 6 12 12M18 6 6 18" /> : <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" /></>}</svg>
      <span>{cancelPending ? 'Release to cancel' : state.phase === 'recording' ? 'Listening' : state.phase === 'preparing' ? 'Connecting' : state.phase === 'finishing' ? 'Recognizing…' : 'Hold to speak'}</span>
      {keyboardInput && <kbd>Space</kbd>}
    </button>
    <p id={hintId} className={styles.speechStatus} role="status">{disabled ? 'Available when Yihao finishes replying' : cancelPending
      ? ''
      : capturing ? state.phase === 'preparing' ? 'Connecting · keep holding'
        : keyboardInput ? 'Release Space to send' : inputKind === 'touch' ? 'Lift your finger to send' : 'Release to send'
      : state.phase === 'finishing' ? 'Recognizing…' : state.message}</p>
  </div>;
}

export function VideoExpiry({ expiresAt }: { expiresAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (seconds >= 60) return null;
  return <span className={styles.videoCountdown} role="timer" aria-live="off">
    {seconds ? `Video ends in 0:${String(seconds).padStart(2, '0')}` : 'Video session ending'} · chat stays open
  </span>;
}

export function VideoSessionDetails({ sessionId }: { sessionId?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className={styles.videoSessionDetails} role="group" aria-label="Video session">
    <span className={styles.videoSessionLabel}>Video session</span>
    <div className={styles.videoSessionRow}>
    <code>{sessionId || 'Awaiting session ID…'}</code>
    <button className={styles.copySession} type="button" disabled={!sessionId} aria-label={copied ? 'Session ID copied' : 'Copy session ID'}
      title={copied ? 'Copied' : 'Copy session ID'} onClick={async () => {
      if (!sessionId) return;
      try { await navigator.clipboard.writeText(sessionId); setCopied(true); setFailed(false); }
      catch { setCopied(false); setFailed(true); }
    }}><svg viewBox="0 0 24 24" aria-hidden="true">{copied ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></>}</svg></button>
    </div>
    <span className={failed ? undefined : styles.copyStatusHidden} role="status">{failed ? 'Select the session ID above to copy it manually.' : copied ? 'Session ID copied.' : ''}</span>
  </div>;
}
