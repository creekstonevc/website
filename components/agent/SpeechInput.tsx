import { useEffect, useRef, useState } from 'react';
import { AsrCapture, type AsrState } from './asr-client';
import styles from './AgentChat.module.css';

export function SpeechInput({ sessionKey, disabled, onText, onFinal, onCaptureStart, onActiveChange }: {
  sessionKey: string; disabled: boolean; onText: (text: string) => void;
  onFinal: (text: string) => void;
  onCaptureStart: () => void; onActiveChange: (active: boolean) => void;
}) {
  const [state, setState] = useState<AsrState>({ phase: 'idle', message: 'Hold Space to speak · release to send' });
  const current = useRef<AsrCapture | null>(null);
  const held = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus({ preventScroll: true }); }, []);
  const callbacks = useRef({ onText, onFinal, onCaptureStart, onActiveChange });
  useEffect(() => { callbacks.current = { onText, onFinal, onCaptureStart, onActiveChange }; }, [onText, onFinal, onCaptureStart, onActiveChange]);
  const actions = useRef({ start: () => {}, finish: () => {} });
  useEffect(() => {
    const cancel = () => { held.current = false; current.current?.cancel(); current.current = null; callbacks.current.onActiveChange(false); };
    const start = () => {
      if (disabled || !sessionKey || held.current) return;
      cancel(); held.current = true;
      callbacks.current.onCaptureStart(); callbacks.current.onActiveChange(true);
      const capture = new AsrCapture(next => {
        setState(next);
        callbacks.current.onActiveChange(next.phase === 'preparing' || next.phase === 'recording' || next.phase === 'finishing');
      }, (text, final) => {
        callbacks.current.onText(text);
        if (final) {
          held.current = false;
          if (text.trim()) callbacks.current.onFinal(text);
        }
      });
      current.current = capture;
      void capture.start(sessionKey);
    };
    const finish = () => { if (!held.current) return; held.current = false; current.current?.finish(); };
    actions.current = { start, finish };
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.code !== 'Space' || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
          target?.closest('textarea, input, select, a, [contenteditable="true"], button:not([data-hold-to-talk])')) return;
      event.preventDefault(); start();
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space' && held.current) { event.preventDefault(); finish(); } };
    const blur = () => { cancel(); setState({ phase: 'idle', message: 'Recording cancelled · hold Space to retry' }); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancel(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility);
    };
  }, [disabled, sessionKey]);
  return <div className={styles.speechInput} data-phase={state.phase}>
    <button ref={button} type="button" data-hold-to-talk disabled={disabled} aria-label="Hold to speak, release to send"
      aria-pressed={state.phase === 'recording'}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); actions.current.start(); }}
      onPointerUp={() => actions.current.finish()} onLostPointerCapture={() => actions.current.finish()}
      onPointerCancel={() => { held.current = false; current.current?.cancel(); callbacks.current.onActiveChange(false); setState({ phase: 'idle', message: 'Recording cancelled' }); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" /></svg>
      <span>{state.phase === 'recording' ? 'Listening' : state.phase === 'preparing' ? 'Connecting' : 'Hold to speak'}</span>
      <kbd>Space</kbd>
    </button>
    <p role="status">{disabled ? 'Available when Yihao finishes replying' : state.message}</p>
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

export function VideoSessionDetails({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <details className={styles.videoSessionDetails}>
    <summary>Video session</summary>
    <code>{sessionId}</code>
    <button type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(sessionId); setCopied(true); setFailed(false); }
      catch { setFailed(true); }
    }}>{copied ? 'Copied' : 'Copy session ID'}</button>
    <span role="status">{failed ? 'Select the session ID above to copy it manually.' : copied ? 'Session ID copied.' : ''}</span>
  </details>;
}
