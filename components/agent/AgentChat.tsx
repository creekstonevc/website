"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./AgentChat.module.css";
import { useTranscriptScroll } from "./useTranscriptScroll";

import { AgentRequestError, openConversation, readSavedDraft, shouldSendOnEnter, streamReply, suggestions, waitingMessage, type Message, type ConversationSession, type Recovery, type VoicePhase, type VoiceState } from "./agent-client";

function VoiceGlyph({ phase }: { phase: VoicePhase }) {
  if (phase === "loading") {
    return (
      <span className={styles.voiceBars} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    );
  }

  return (
    <svg className={styles.voiceIcon} viewBox="0 0 24 24" aria-hidden="true">
      {phase === "playing" ? (
        <>
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </>
      ) : (
        <>
          <path d="M4 9v6h4l5 4V5L8 9H4Z" />
          <path d="M16 9.2c1.35 1.55 1.35 4.05 0 5.6" />
          <path d="M18.6 6.8c2.8 2.9 2.8 7.5 0 10.4" />
        </>
      )}
    </svg>
  );
}

function VoiceControl({
  messageIndex,
  state,
  onToggle,
}: {
  messageIndex: number;
  state: VoiceState;
  onToggle: () => void;
}) {
  const active = state.messageIndex === messageIndex;
  const phase = active ? state.phase : "idle";
  const labels: Record<VoicePhase, string> = {
    idle: "Play voice",
    loading: "Rendering voice",
    playing: "Pause voice",
    paused: "Resume voice",
    error: "Retry voice",
  };

  return (
    <div className={styles.voiceControl} data-phase={phase}>
      <button
        type="button"
        className={styles.voiceButton}
        onClick={onToggle}
        disabled={phase === "loading"}
        aria-label={`${labels[phase]} for Yihao AI response ${messageIndex + 1}`}
        aria-pressed={phase === "playing"}
      >
        <VoiceGlyph phase={phase} />
        <span>{labels[phase]}</span>
      </button>
      <span className={styles.voiceDisclosure}>AI-generated voice</span>
      {active && state.error ? (
        <span className={styles.voiceError} role="status">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = openOverride ?? live;

  useEffect(() => {
    if (live && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [live, text]);

  return (
    <div className={styles.thinking}>
      <button
        type="button"
        className={styles.thinkingHeader}
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
      >
        <span className={live ? styles.thinkingLive : styles.thinkingIdle} />
        <span>Reasoning trace</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className={styles.thinkingBody} ref={bodyRef}>
          {text}
        </div>
      ) : null}
    </div>
  );
}

export function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([waitingMessage]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [voice, setVoice] = useState<VoiceState>({
    messageIndex: null,
    phase: "idle",
  });
  const initializationStarted = useRef(false);
  const { transcriptRef, contentRef, detached, follow, pause } = useTranscriptScroll();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioGeneration = useRef(0);
  const composing = useRef(false);
  const compositionEnded = useRef(0);
  const operation = useRef(false);
  const [sessionKey, setSessionKey] = useState("");
  const sessionKeyRef = useRef("");
  const [sessions, setSessions] = useState<ConversationSession["sessions"]>([]);
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [phase, setPhase] = useState("Restoring your conversation…");
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const transcript = transcriptRef.current;
    if (anchor && transcript) {
      transcript.scrollTop = anchor.top + transcript.scrollHeight - anchor.height;
      prependAnchor.current = null;
    }
  }, [messages, transcriptRef]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    }
    if (!sessionKey) return;
    try {
      if (value) localStorage.setItem(`creekstone.draft.${sessionKey}`, value);
      else localStorage.removeItem(`creekstone.draft.${sessionKey}`);
    } catch { /* Private browsing or storage limits must not block sending. */ }
  }, [value, sessionKey]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audioRef.current = null;
      audio?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const disposeAudio = useCallback(() => {
    audioGeneration.current += 1;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const handleVoiceToggle = async (messageIndex: number, ticket: string) => {
    const currentAudio = audioRef.current;
    if (voice.messageIndex === messageIndex && currentAudio) {
      if (!currentAudio.paused) {
        currentAudio.pause();
        setVoice({ messageIndex, phase: "paused" });
        return;
      }
      try {
        if (currentAudio.ended) currentAudio.currentTime = 0;
        await currentAudio.play();
        setVoice({ messageIndex, phase: "playing" });
      } catch {
        setVoice({
          messageIndex,
          phase: "error",
          error: "Playback was blocked · tap to retry",
        });
      }
      return;
    }

    disposeAudio();
    const generation = audioGeneration.current;
    setVoice({ messageIndex, phase: "loading" });

    try {
      const response = await fetch("/api/agent/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      if (!response.ok) {
        const message =
          response.status === 429
            ? "Voice channel is busy · retry shortly"
            : response.status === 410
              ? "Voice access expired · reload this conversation to refresh"
              : "Voice unavailable · tap to retry";
        throw new AgentRequestError(response.status, message);
      }

      const blob = await response.blob();
      if (generation !== audioGeneration.current) return;
      if (!blob.size) throw new Error("Voice response was empty");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = "auto";
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.addEventListener("ended", () => {
        if (audioRef.current === audio) {
          setVoice({ messageIndex, phase: "idle" });
        }
      });
      audio.addEventListener("error", () => {
        if (audioRef.current === audio) {
          setVoice({
            messageIndex,
            phase: "error",
            error: "Audio could not be played · tap to retry",
          });
        }
      });

      await audio.play();
      setVoice({ messageIndex, phase: "playing" });
    } catch (error) {
      if (generation !== audioGeneration.current) return;
      disposeAudio();
      setVoice({
        messageIndex,
        phase: "error",
        error:
          error instanceof AgentRequestError
            ? error.code
            : "Voice unavailable · tap to retry",
      });
    }
  };

  const renderReply = useCallback(async (input: string, bootstrap = false) => {
    let pendingOutput = "";
    let pendingThinking = "";
    let animationFrame: number | null = null;

    const flush = () => {
      animationFrame = null;
      if (!pendingOutput && !pendingThinking) return;
      const outputDelta = pendingOutput;
      const thinkingDelta = pendingThinking;
      pendingOutput = "";
      pendingThinking = "";

      setMessages((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        next[next.length - 1] = {
          ...last,
          content: last.content
            ? last.content + outputDelta
            : outputDelta.replace(/^\s+/, ""),
          thinking: thinkingDelta
            ? (last.thinking ?? "") + thinkingDelta
            : last.thinking,
        };
        return next;
      });
    };

    const queueFlush = () => {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(flush);
      }
    };

    try {
      const result = await streamReply(
        input,
        {
          onOutputDelta: (delta) => {
            pendingOutput += delta;
            queueFlush();
          },
          onThinkingDelta: (delta) => {
            if (bootstrap) return;
            pendingThinking += delta;
            queueFlush();
          },
        },
        { bootstrap, sessionKey: sessionKeyRef.current },
      );

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      flush();

      setMessages((current) => {
        const last = current[current.length - 1];
        const content = (
          result.text.trim() ? result.text.replace(/^\s+/, "") : last.content
        ).trim();
        return [
          ...current.slice(0, -1),
          {
            ...last,
            content: content || "……（没有收到回复，请再试一次）",
            ttsTicket: result.ttsTicket ?? undefined,
          },
        ];
      });
    } catch (error) {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      flush();
      throw error;
    }
  }, []);

  const applySession = useCallback((session: ConversationSession) => {
    sessionKeyRef.current = session.sessionKey;
    setSessionKey(session.sessionKey);
    setSessions(session.sessions);
    setNextCursor(session.nextCursor);
    setValue(readSavedDraft(session.sessionKey));
    try {
      const titles: Record<string, string> = {};
      for (const item of session.sessions) titles[item.key] = localStorage.getItem(`creekstone.title.${item.key}`) || "Untitled conversation";
      const firstUser = session.messages.find((message) => message.role === "user");
      if (firstUser && titles[session.sessionKey] === "Untitled conversation") {
        titles[session.sessionKey] = firstUser.content.slice(0, 64);
        localStorage.setItem(`creekstone.title.${session.sessionKey}`, titles[session.sessionKey]);
      }
      setSessionTitles(titles);
    } catch { /* A saved-session index is still available without local titles. */ }
  }, []);

  const saveRecovery = useCallback((next: Recovery | null) => {
    setRecovery(next);
    try {
      const key = `creekstone.recovery.${sessionKeyRef.current}`;
      if (next) sessionStorage.setItem(key, JSON.stringify(next));
      else sessionStorage.removeItem(key);
    } catch { /* Recovery remains available in memory. */ }
  }, []);

  const initializeConversation = useCallback(
    async (options: { reset?: boolean; sessionKey?: string } = {}) => {
      if (operation.current) return;
      operation.current = true;
      disposeAudio();
      setVoice({ messageIndex: null, phase: "idle" });
      setReady(false);
      setBusy(true);
      setPhase("Restoring your conversation…");
      setRecovery(null);
      setHistoryError("");

      try {
        const session = await openConversation(options);
        applySession(session);
        follow();
        let pending: Recovery | null = null;
        try { pending = JSON.parse(sessionStorage.getItem(`creekstone.recovery.${session.sessionKey}`) || "null"); } catch { /* No pending request. */ }
        if (session.messages.length) {
          setMessages(session.messages);
        } else {
          setMessages([]);
        }
        if (pending?.kind === "sync") {
          setRecovery(pending);
          if (pending.input && session.messages.at(-1)?.content !== pending.input && session.messages.at(-1)?.role !== "assistant") {
            setMessages((current) => [...current, { role: "user", content: pending!.input! }]);
          }
        } else if (pending?.kind === "retry") {
          setValue(pending.input || "");
          saveRecovery(null);
        } else if (session.needsBootstrap) {
          setMessages([waitingMessage]);
          setPhase("Yihao is preparing a welcome. No need to send a greeting.");
          saveRecovery({ kind: "sync", bootstrap: true, note: "开场白的接收中断了。同步历史即可检查回复，不会重复发送 Hi。" });
          try {
            await renderReply("", true);
            saveRecovery(null);
          } catch (error) {
            const canRestore =
              error instanceof AgentRequestError &&
              ["bootstrap_completed", "conversation_not_empty"].includes(
                error.code,
              );
            if (!canRestore) {
              const rejected = error instanceof AgentRequestError && error.status === 429;
              saveRecovery({ kind: rejected ? "connect" : "sync", bootstrap: true,
                note: rejected ? "当前访问较多，请稍后重试连接。" : "开场白的接收中断了。可以同步历史检查结果，不必新建会话。" });
              return;
            }
            const restored = await openConversation();
            if (!restored.messages.length) throw error;
            applySession(restored);
            setMessages(restored.messages);
            saveRecovery(null);
          }
        }
        setReady(true);
      } catch (error) {
        const note =
          error instanceof AgentRequestError && error.status === 429
            ? "当前访问较多，请稍后重试连接。原有会话和草稿不会被删除。"
            : error instanceof AgentRequestError && error.code === "session_unavailable"
              ? "这段会话已过期或无法访问。可以选择另一段会话，或新建会话。"
              : "暂时无法读取会话，请重试连接。原有会话和草稿不会被删除。";
        setRecovery({ kind: "connect", note });
      } finally {
        setBusy(false);
        operation.current = false;
      }
    },
    [applySession, disposeAudio, follow, renderReply, saveRecovery],
  );

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    void initializeConversation();
  }, [initializeConversation]);

  const resetConversation = () => {
    if (busy || loadingHistory) return;
    void initializeConversation({ reset: true });
  };

  const send = async (text?: string, retry = false) => {
    const input = (text ?? value).trim();
    if (!input || input.length > 4000 || operation.current || busy || loadingHistory || !ready || (recovery && !retry)) return;
    operation.current = true;
    const baseline = retry ? recovery?.baseline : messages.filter((item) => item.role === "user").length;
    const previousAnswer = retry ? recovery?.previousAnswer : messages.findLast((item) => item.role === "assistant")?.content;

    disposeAudio();
    setVoice({ messageIndex: null, phase: "idle" });
    setValue("");
    setBusy(true);
    setPhase("Yihao is thinking…");
    follow();
    saveRecovery({ kind: "sync", input, baseline, previousAnswer,
      note: "这条消息可能已经送达。先同步历史检查结果，避免重复发送。" });
    try {
      if (!localStorage.getItem(`creekstone.title.${sessionKey}`)) {
        localStorage.setItem(`creekstone.title.${sessionKey}`, input.slice(0, 64));
        setSessionTitles((titles) => ({ ...titles, [sessionKey]: input.slice(0, 64) }));
      }
    } catch { /* Sending must also work when browser storage is unavailable. */ }
    setMessages((current) => retry
      ? [...current.slice(0, -1), { role: "assistant", content: "" }]
      : [...current, { role: "user", content: input }, { role: "assistant", content: "" }]);

    try {
      if (retry && recovery?.rebind) await openConversation({ sessionKey: sessionKeyRef.current });
      await renderReply(input);
      saveRecovery(null);
    } catch (error) {
      const rejected = error instanceof AgentRequestError &&
        (error.status === 429 || ["response_rejected", "session_changed", "conversation_busy"].includes(error.code));
      saveRecovery({ kind: rejected ? "retry" : "sync", input,
        baseline, previousAnswer,
        rebind: error instanceof AgentRequestError && error.code === "session_changed",
        note: rejected ? "这条消息未被接收，可以稍后重试发送。"
          : "接收中断了，已收到的文字会保留。先同步历史检查结果，不会自动重发消息。" });
    } finally {
      setBusy(false);
      operation.current = false;
    }
  };

  const syncHistory = async () => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setPhase("Checking saved history…");
    try {
      const session = await openConversation({ sessionKey: sessionKeyRef.current });
      applySession(session);
      // This is a history refresh, not a request to resume/reissue generation.
      const lastUser = session.messages.findLast((item) => item.role === "user");
      const hasAnswer = session.messages.at(-1)?.role === "assistant";
      const resolved = hasAnswer && (recovery?.bootstrap ||
        (lastUser?.content === recovery?.input && (session.messages.at(-1)?.content !== recovery?.previousAnswer ||
          session.messages.filter((item) => item.role === "user").length > (recovery?.baseline ?? Infinity))));
      if (resolved || !recovery?.input && !recovery?.bootstrap) {
        setMessages(session.messages);
        saveRecovery(null);
        setReady(true);
      } else {
        saveRecovery({ ...recovery!, kind: "sync", note: "历史中暂时还没有确认完整回复。可以稍后再同步；不会自动重发。" });
      }
    } catch {
      setRecovery((current) => current && ({ ...current, note: "历史同步暂时失败。已显示的内容不会丢失，请稍后再试。" }));
    } finally {
      setBusy(false);
      operation.current = false;
    }
  };

  const loadEarlier = async () => {
    if (!nextCursor || operation.current) return;
    operation.current = true;
    setLoadingHistory(true);
    setHistoryError("");
    pause();
    disposeAudio();
    setVoice({ messageIndex: null, phase: "idle" });
    try {
      const session = await openConversation({ after: nextCursor, sessionKey: sessionKeyRef.current });
      const node = transcriptRef.current;
      if (node) prependAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id).filter(Boolean));
        return [...session.messages.filter((item) => !item.id || !ids.has(item.id)), ...current];
      });
      setNextCursor(session.nextCursor);
    } catch {
      setHistoryError("暂时无法加载更早的历史。若持续失败，可能是 Boids 尚不支持分页；当前消息不受影响。");
    } finally {
      setLoadingHistory(false);
      operation.current = false;
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldSendOnEnter(event.nativeEvent, composing.current, performance.now() - compositionEnded.current)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <main className={styles.agentShell}>
      <div className={styles.noise} aria-hidden="true" />
      <div className={styles.signalField} aria-hidden="true">
        <span className={styles.signalAxisX} />
        <span className={styles.signalAxisY} />
        <span className={styles.signalOrbitOuter} />
        <span className={styles.signalOrbitInner} />
        <span className={styles.signalSweep} />
        {Array.from({ length: 24 }, (_, index) => (
          <span
            className={styles.signalParticle}
            key={index}
            style={
              {
                "--particle-index": index,
                "--particle-angle": `${index * 15}deg`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <Image
            src="/creekstone-mark.png"
            alt=""
            width={252}
            height={145}
            priority
          />
          <span>
            <strong>Creekstone Ventures</strong>
            <small>Founder Channel / Live</small>
          </span>
        </Link>
        <div className={styles.headerStatus}>
          <span className={styles.liveDot} />
          <span>Agent runtime online</span>
          <span className={styles.headerCode}>YH.AI / 001</span>
        </div>
        <Link className={styles.backLink} href="/#ai-vc-agent">
          <span aria-hidden="true">←</span>
          Back to origin
        </Link>
      </header>

      <section className={styles.identityPanel} aria-label="Agent identity">
        <div className={styles.identityIndex}>
          <span>Identity dossier</span>
          <span>001</span>
        </div>
        <div className={styles.portraitFrame}>
          <Image
            src="/yihao-agent.jpg"
            alt="Yihao Li"
            fill
            sizes="(max-width: 760px) 42vw, 28vw"
            priority
          />
          <span className={styles.portraitScan} aria-hidden="true" />
        </div>
        <div className={styles.identityCopy}>
          <span className={styles.identityLive}>
            <span className={styles.liveDot} />
            Agent online
          </span>
          <h1>Yihao.AI</h1>
          <p>Investor · AI Avatar</p>
        </div>
        <div className={styles.identityNote}>
          <span>World&apos;s First AI VC Agent</span>
          <p>Trained on how we think, invest, and co-build.</p>
        </div>
      </section>

      <section
        className={styles.console}
        aria-label="Conversation with Yihao AI"
      >
        <div className={styles.consoleHeader}>
          <div>
            <span className={styles.consoleLight} />
            Creekstone / encrypted founder channel
          </div>
          <div className={styles.sessionActions}>
            <select aria-label="Saved conversations" value={sessionKey} disabled={busy || loadingHistory}
              onChange={(event) => void initializeConversation({ sessionKey: event.target.value })}
              title="Recent conversations in this browser · up to 10 · 30 days">
              {!sessionKey && <option value="">Conversations</option>}
              {sessions.map((session) => <option key={session.key} value={session.key}>
                {sessionTitles[session.key] || "Untitled conversation"}
              </option>)}
            </select>
            <button type="button" onClick={resetConversation} disabled={busy || loadingHistory}>
              New conversation
            </button>
          </div>
        </div>

        <div className={styles.transcriptPane}>
        <div
          className={styles.transcript}
          ref={transcriptRef}
          tabIndex={0}
          aria-label="Message history"
        >
          <div ref={contentRef}>
          <div className={styles.channelIntro}>
            <span>CRK / SIGNAL LOCKED</span>
            <strong>Pitch it. Question it. Challenge it.</strong>
          </div>

          {nextCursor && <div className={styles.historyControl}>
            <button type="button" disabled={busy || loadingHistory} onClick={() => void loadEarlier()}>
              {loadingHistory ? "Loading earlier messages…" : "Load earlier messages"}
            </button>
            {historyError && <p role="status">{historyError}</p>}
          </div>}

          {messages.map((message, index) => (
            <article
              className={`${styles.message} ${
                message.role === "user"
                  ? styles.userMessage
                  : styles.assistantMessage
              }`}
              key={message.id || `${message.role}-${index}`}
            >
              <div className={styles.messageMeta}>
                <span>
                  {message.role === "assistant" ? "YIHAO.AI" : "FOUNDER"}
                </span>
                <span>{String(index + 1).padStart(3, "0")}</span>
              </div>
              <div className={styles.messageBody}>
                {message.role === "assistant" ? (
                  <>
                    {message.thinking ? (
                      <ThinkingBlock
                        text={message.thinking}
                        live={busy && index === messages.length - 1}
                      />
                    ) : null}
                    {busy &&
                    index === messages.length - 1 &&
                    !message.content &&
                    !message.thinking ? (
                      <span className={styles.waiting}>
                        <span />
                        {phase}
                      </span>
                    ) : (
                      <>
                        <div className={styles.markdown}>
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </Markdown>
                          {busy &&
                          index === messages.length - 1 &&
                          message.content ? (
                            <span className={styles.streamCursor}>▋</span>
                          ) : null}
                        </div>
                        {message.ttsTicket &&
                        !(busy && index === messages.length - 1) ? (
                          <VoiceControl
                            messageIndex={index}
                            state={voice}
                            onToggle={() =>
                              void handleVoiceToggle(index, message.ttsTicket!)
                            }
                          />
                        ) : null}
                      </>
                    )}
                  </>
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            </article>
          ))}
          {recovery && !busy && <div className={styles.recovery} role="status">
            <p>{recovery.note}</p>
            <button type="button" onClick={() => {
              if (recovery.kind === "retry") void send(recovery.input, true);
              else if (recovery.kind === "sync") void syncHistory();
              else void initializeConversation();
            }}>{recovery.kind === "retry" ? "Retry sending" : recovery.kind === "sync" ? "Sync history" : "Retry connection"}</button>
            {recovery.kind === "retry" && <button type="button" onClick={() => {
              setValue(recovery.input || "");
              setMessages((current) => current.slice(0, -2));
              saveRecovery(null);
              inputRef.current?.focus({ preventScroll: true });
            }}>Edit message</button>}
          </div>}
          </div>
        </div>
        {detached && <button type="button" className={styles.jumpToLatest} onClick={follow}>
          Back to latest <span aria-hidden="true">↓</span>
        </button>}
        </div>

        <div className={styles.suggestions} aria-label="Suggested prompts">
          {!messages.some((message) => message.role === "user") && suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              disabled={busy || !ready || loadingHistory || !!recovery}
              onClick={() => void send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <form className={styles.composer} onSubmit={handleSubmit}>
          <label htmlFor="founder-message">
            <span>Founder input</span>
            <small id="composer-hint">{busy ? phase : "Enter to send · Shift + Enter for a new line"}</small>
          </label>
          <div className={styles.composerControl}>
            <span className={styles.promptMark} aria-hidden="true">
              &gt;
            </span>
            <textarea
              id="founder-message"
              ref={inputRef}
              rows={1}
              value={value}
              disabled={busy || !ready || !!recovery}
              maxLength={4000}
              placeholder="Tell me what you’re building…"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; compositionEnded.current = performance.now(); }}
              aria-describedby="composer-hint composer-count"
            />
            <button type="submit" disabled={busy || !ready || loadingHistory || !!recovery || !value.trim()}>
              <span>{busy ? "Listening" : "Transmit"}</span>
              <span aria-hidden="true">{busy ? "···" : "↗"}</span>
            </button>
          </div>
          <div className={styles.composerHint}>
            <span>Drafts stay in this browser.</span>
            <span id="composer-count" role={value.length >= 4000 ? "status" : undefined}>
              {value.length.toLocaleString()} / 4,000{value.length >= 4000 ? " · Character limit reached" : ""}
            </span>
          </div>
        </form>
      </section>

      <footer className={styles.footer}>
        <span>Agent Native / Founder Friendly</span>
        <span>Messages are sent to Creekstone&apos;s AI agent.</span>
        <a href="mailto:claw@creekstonevc.com">claw@creekstonevc.com</a>
      </footer>
    </main>
  );
}
