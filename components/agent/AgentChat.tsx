"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./AgentChat.module.css";

type Message = {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
};

type StreamHandlers = {
  onThinkingDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
};

const welcomeMessage: Message = {
  role: "assistant",
  content:
    "你好，我是李一豪的 AI 化身 — the world's first AI VC agent.\n\n聊聊你在 build 什么，或者问我 Creekstone 怎么看 agent-native 的未来。",
};

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

async function createConversation(): Promise<string | null> {
  try {
    const response = await fetch("/api/agent/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { source: "creekstone-web" } }),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isRecord(data) && typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

async function streamReply(
  input: string,
  conversation: string | null,
  handlers: StreamHandlers,
): Promise<string> {
  const response = await fetch("/api/agent/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: "agent:@1633756673-org/liyihao",
      input,
      ...(conversation ? { conversation } : {}),
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Responses API failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error("Responses API did not return a stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let streamedOutput = "";
  let completedOutput = "";
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

  return completedOutput || streamedOutput;
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
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  const resetConversation = () => {
    if (busy) return;
    conversationId.current = null;
    setMessages([welcomeMessage]);
    setValue("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = async (text?: string) => {
    const input = (text ?? value).trim();
    if (!input || busy) return;

    setValue("");
    setBusy(true);
    setMessages((current) => [
      ...current,
      { role: "user", content: input },
      { role: "assistant", content: "" },
    ]);

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
      if (!conversationId.current) {
        conversationId.current = await createConversation();
      }

      const finalText = await streamReply(input, conversationId.current, {
        onOutputDelta: (delta) => {
          pendingOutput += delta;
          queueFlush();
        },
        onThinkingDelta: (delta) => {
          pendingThinking += delta;
          queueFlush();
        },
      });

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      flush();

      setMessages((current) => {
        const last = current[current.length - 1];
        const content = (
          finalText.trim() ? finalText.replace(/^\s+/, "") : last.content
        ).trim();
        return [
          ...current.slice(0, -1),
          {
            ...last,
            content: content || "……（没有收到回复，请再试一次）",
          },
        ];
      });
    } catch {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      pendingOutput = "";
      pendingThinking = "";
      const note =
        "连接出了点问题 — 请稍后再试，或直接邮件 claw@creekstonevc.com。";

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
            style={{
              "--particle-index": index,
              "--particle-angle": `${index * 15}deg`,
            } as React.CSSProperties}
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

      <section className={styles.console} aria-label="Conversation with Yihao AI">
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
              disabled={busy}
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
              disabled={busy}
              maxLength={4000}
              placeholder="Tell me what you’re building…"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="submit" disabled={busy || !value.trim()}>
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
