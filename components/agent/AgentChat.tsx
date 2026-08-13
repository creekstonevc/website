"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./AgentChat.module.css";

type Message = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  ttsTicket?: string;
};

type StreamHandlers = {
  onThinkingDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
};

type StreamResult = {
  text: string;
  ttsTicket: string | null;
};

type ConversationSession = {
  needsBootstrap: boolean;
  messages: Message[];
};

type VoicePhase = "idle" | "loading" | "playing" | "paused" | "error";

type VoiceState = {
  messageIndex: number | null;
  phase: VoicePhase;
  error?: string;
};

class AgentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const waitingMessage: Message = { role: "assistant", content: "" };

const suggestions = [
  "Creekstone 的投资逻辑是什么？",
  "What do you look for in founders?",
  "我想约真人李一豪聊聊",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractFinalText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const response = isRecord(payload.response) ? payload.response : payload;
  if (!Array.isArray(response.output)) return "";

  const parts: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item)) continue;
    if (item.type && item.type !== "message") continue;
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

function extractFailure(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.response)) return "Stream failed";
  const error = payload.response.error;
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : "Stream failed";
}

function readHistoryMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string" ||
      !item.content.trim()
    ) {
      return [];
    }
    return [
      {
        role: item.role,
        content: item.content,
        ...(typeof item.ttsTicket === "string"
          ? { ttsTicket: item.ttsTicket }
          : {}),
      } satisfies Message,
    ];
  });
}

async function openConversation(reset = false): Promise<ConversationSession> {
  const response = await fetch("/api/agent/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(reset ? { reset: true } : {}),
  });
  if (!response.ok) {
    throw new AgentRequestError(response.status, "conversation_unavailable");
  }
  const data: unknown = await response.json();
  if (!isRecord(data)) {
    throw new AgentRequestError(502, "conversation_unavailable");
  }
  return {
    needsBootstrap: data.needsBootstrap === true,
    messages: readHistoryMessages(data.messages),
  };
}

async function streamReply(
  input: string,
  handlers: StreamHandlers,
  { bootstrap = false }: { bootstrap?: boolean } = {},
): Promise<StreamResult> {
  const response = await fetch("/api/agent/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    credentials: "same-origin",
    body: JSON.stringify({
      ...(bootstrap ? { bootstrap: true } : { input }),
    }),
  });

  if (!response.ok) {
    let code = "agent_unavailable";
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error)) {
        code = readString(payload.error.code) || code;
      }
    } catch {
      // Nginx rate-limit responses may not be JSON.
    }
    throw new AgentRequestError(response.status, code);
  }
  if (!response.body) {
    throw new Error("Responses API did not return a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let streamedOutput = "";
  let completedOutput = "";
  let ttsTicket: string | null = null;
  let finished = false;

  const handleFrame = (frame: string): boolean => {
    let eventName = "";
    const dataLines: string[] = [];

    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    const rawData = dataLines.join("\n");
    if (!rawData) return false;
    if (rawData === "[DONE]") return true;

    let payload: unknown;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return false;
    }

    const payloadType =
      isRecord(payload) && typeof payload.type === "string" ? payload.type : "";
    const type = eventName || payloadType;
    const delta = isRecord(payload) ? readString(payload.delta) : "";

    if (
      type === "creekstone.tts.ready" &&
      isRecord(payload) &&
      typeof payload.ticket === "string"
    ) {
      ttsTicket = payload.ticket;
      return false;
    }

    if (type === "response.output_text.delta" && delta) {
      streamedOutput += delta;
      handlers.onOutputDelta(delta);
      return false;
    }

    if (
      (type.includes("reasoning") || type.includes("thinking")) &&
      type.endsWith(".delta") &&
      delta
    ) {
      handlers.onThinkingDelta(delta);
      return false;
    }

    if (type === "response.completed") {
      completedOutput = extractFinalText(payload) || streamedOutput;
      return true;
    }

    if (type === "response.failed") {
      throw new Error(extractFailure(payload));
    }

    return false;
  };

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() ?? "";
    for (const frame of frames) {
      if (handleFrame(frame)) {
        finished = true;
        break;
      }
    }
  }

  if (finished) {
    await reader.cancel().catch(() => undefined);
  } else if (pending.trim()) {
    handleFrame(pending);
  }

  return { text: completedOutput || streamedOutput, ttsTicket };
}

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
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audioRef.current = null;
      audio?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const disposeAudio = useCallback(() => {
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
              ? "Voice ticket expired · start a new signal"
              : "Voice unavailable · tap to retry";
        throw new AgentRequestError(response.status, message);
      }

      const blob = await response.blob();
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
            pendingThinking += delta;
            queueFlush();
          },
        },
        { bootstrap },
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
      pendingOutput = "";
      pendingThinking = "";
      throw error;
    }
  }, []);

  const initializeConversation = useCallback(
    async (reset = false) => {
      disposeAudio();
      setVoice({ messageIndex: null, phase: "idle" });
      setValue("");
      setReady(false);
      setBusy(true);
      setMessages([waitingMessage]);

      try {
        const session = await openConversation(reset);
        if (session.messages.length) {
          setMessages(session.messages);
        } else if (session.needsBootstrap) {
          try {
            await renderReply("", true);
          } catch (error) {
            const canRestore =
              error instanceof AgentRequestError &&
              ["bootstrap_completed", "conversation_not_empty"].includes(
                error.code,
              );
            if (!canRestore) throw error;
            const restored = await openConversation(false);
            if (!restored.messages.length) throw error;
            setMessages(restored.messages);
          }
        } else {
          throw new AgentRequestError(502, "empty_conversation");
        }
        setReady(true);
      } catch (error) {
        const note =
          error instanceof AgentRequestError && error.status === 429
            ? "当前访问较多 — 请稍等片刻后点击 New signal。"
            : "连接出了点问题 — 请点击 New signal 重试，或直接邮件 claw@creekstonevc.com。";
        setMessages([{ role: "assistant", content: note }]);
      } finally {
        setBusy(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [disposeAudio, renderReply],
  );

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    void initializeConversation(false);
  }, [initializeConversation]);

  const resetConversation = () => {
    if (busy) return;
    void initializeConversation(true);
  };

  const send = async (text?: string) => {
    const input = (text ?? value).trim();
    if (!input || busy || !ready) return;

    disposeAudio();
    setVoice({ messageIndex: null, phase: "idle" });
    setValue("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { role: "user", content: input },
      { role: "assistant", content: "" },
    ]);

    try {
      await renderReply(input);
    } catch (error) {
      const note =
        error instanceof AgentRequestError && error.status === 429
          ? "当前访问较多 — 请稍等片刻后再试。"
          : error instanceof AgentRequestError &&
              error.code === "conversation_required"
            ? "会话已过期 — 请点击 New signal 重新开始。"
            : "连接出了点问题 — 请稍后再试，或直接邮件 claw@creekstonevc.com。";

      setMessages((current) => {
        const last = current[current.length - 1];
        const content = last.content.trim()
          ? `${last.content}\n\n> ⚠ ${note}`
          : note;
        return [...current.slice(0, -1), { ...last, content }];
      });
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
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
          <button type="button" onClick={resetConversation} disabled={busy}>
            New signal
          </button>
        </div>

        <div
          className={styles.transcript}
          ref={transcriptRef}
          aria-live="polite"
          aria-busy={busy}
        >
          <div className={styles.channelIntro}>
            <span>CRK / SIGNAL LOCKED</span>
            <strong>Pitch it. Question it. Challenge it.</strong>
          </div>

          {messages.map((message, index) => (
            <article
              className={`${styles.message} ${
                message.role === "user"
                  ? styles.userMessage
                  : styles.assistantMessage
              }`}
              key={`${message.role}-${index}`}
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
                        Reading the signal
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
        </div>

        <div className={styles.suggestions} aria-label="Suggested prompts">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              disabled={busy || !ready}
              onClick={() => void send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <form className={styles.composer} onSubmit={handleSubmit}>
          <label htmlFor="founder-message">
            <span>Founder input</span>
            <small>Enter to send · Shift + Enter for a new line</small>
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
              disabled={busy || !ready}
              maxLength={4000}
              placeholder="Tell me what you’re building…"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" disabled={busy || !ready || !value.trim()}>
              <span>{busy ? "Listening" : "Transmit"}</span>
              <span aria-hidden="true">{busy ? "···" : "↗"}</span>
            </button>
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
