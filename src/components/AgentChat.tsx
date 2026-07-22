import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Msg = { role: "user" | "assistant"; content: string; thinking?: string };

const WELCOME: Msg = {
  role: "assistant",
  content: "你好，我是李一豪的 AI 化身 — the world's first AI VC agent. 聊聊你在 build 什么，或者问我 Creekstone 怎么看 agent-native 的未来。",
};

const SUGGESTIONS = [
  "Creekstone 的投资逻辑是什么？",
  "What do you look for in founders?",
  "我想约真人李一豪聊聊",
];

type StreamHandlers = {
  onThinkingDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
};

type StreamResult = { finalText: string };

// Explicit conversation handle for multi-turn context — the API is stateful,
// history is never resent. (previous_response_id is unusable on this backend:
// it demands a dashed UUID and then can't find the stored response.)
async function createConversation(): Promise<string | null> {
  try {
    const res = await fetch("/api/agent/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: { source: "creekstone-web" } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

// response.completed carries {response: <final Responses object>}; the final
// text lives in output[].content[] items of type output_text. Raw JSON has no
// top-level output_text — that is an OpenAI SDK client-side convenience.
function extractFinalText(payload: any): string {
  const response = payload.response ?? payload;
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type && item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}

// Streams one turn from the Boids Responses API (proxied same-origin by nginx,
// which injects the API key).
async function streamReply(
  input: string,
  conversation: string | null,
  handlers: StreamHandlers,
): Promise<StreamResult> {
  const res = await fetch("/api/agent/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      model: "agent:@1633756673-org/liyihao",
      input,
      ...(conversation ? { conversation } : {}),
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Responses API failed (${res.status})`);
  if (!res.body) throw new Error("Responses API did not return a stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let finalText = "";
  let pending = "";
  let terminated = false;

  // Parses one SSE frame; returns true when the stream is finished.
  const handleBlock = (block: string): boolean => {
    let event = "";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue; // keep-alive / comments
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    const data = dataLines.join("\n");
    if (!data) return false;
    if (data === "[DONE]") return true;
    let payload: any;
    try { payload = JSON.parse(data); } catch { return false; }
    const type: string = event || (typeof payload.type === "string" ? payload.type : "");
    const delta: string = typeof payload.delta === "string" ? payload.delta : "";

    if (type === "response.output_text.delta" && delta) {
      output += delta;
      handlers.onOutputDelta(delta);
      return false;
    }
    // Loose match covers response.reasoning_summary_text.delta and any
    // older/alternate thinking frame names. Thinking may be entirely absent
    // (degraded transport falls back to text-only) — never wait for it.
    if ((type.includes("reasoning") || type.includes("thinking")) && type.endsWith(".delta") && delta) {
      handlers.onThinkingDelta(delta);
      return false;
    }
    if (type === "response.completed") {
      finalText = extractFinalText(payload) || output;
      return true;
    }
    if (type === "response.failed") {
      throw new Error(payload.response?.error?.message ?? "Stream failed");
    }
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const blocks = pending.split(/\r?\n\r?\n/); // frames end on a blank line
    pending = blocks.pop() ?? "";
    for (const block of blocks) {
      if (handleBlock(block)) { terminated = true; break; }
    }
    if (terminated) break;
  }
  if (terminated) await reader.cancel().catch(() => undefined);
  else if (pending.trim()) handleBlock(pending);

  return { finalText: finalText || output };
}

// Collapsible live thinking panel: streams open, collapses once the turn
// finishes, stays expandable afterwards.
function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!live) setOpen(false); }, [live]);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [text, live]);

  return (
    <div className="ag-tk">
      <button type="button" className="ag-tk-head" onClick={() => setOpen((o) => !o)}>
        {live && <span className="ag-think-sp"></span>}
        <span>THINKING</span>
        <span className="ag-tk-arrow">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="ag-tk-body" ref={bodyRef}>{text}</div>}
    </div>
  );
}

export default function AgentChat({ standalone = false }: { standalone?: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const convId = useRef<string | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text?: string) => {
    const v = (text ?? value).trim();
    if (!v || busy) return; // per-conversation single-flight
    setValue("");
    setBusy(true);
    // Show the user message plus an empty assistant slot that streaming fills.
    setMessages((cur) => [...cur, { role: "user", content: v }, { role: "assistant", content: "" }]);

    // Batch stream deltas into one state update per animation frame — a
    // per-token setState makes react-markdown re-parse the whole reply on
    // every token and stutters on long answers.
    let pendingOut = "";
    let pendingThink = "";
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (!pendingOut && !pendingThink) return;
      const out = pendingOut, think = pendingThink;
      pendingOut = "";
      pendingThink = "";
      setMessages((cur) => {
        const next = cur.slice();
        const last = next[next.length - 1];
        // The API starts replies with blank lines; trim until real text arrives.
        const merged = last.content ? last.content + out : out.replace(/^\s+/, "");
        next[next.length - 1] = {
          ...last,
          content: merged,
          thinking: think ? (last.thinking ?? "") + think : last.thinking,
        };
        return next;
      });
    };
    const queue = () => { if (rafId === null) rafId = requestAnimationFrame(flush); };

    try {
      // Lazily create the conversation; without one, fall back to stateless turns.
      if (!convId.current) convId.current = await createConversation();
      const { finalText } = await streamReply(v, convId.current, {
        onOutputDelta: (d) => { pendingOut += d; queue(); },
        onThinkingDelta: (d) => { pendingThink += d; queue(); },
      });
      if (rafId !== null) cancelAnimationFrame(rafId);
      flush();
      // response.completed's text is authoritative; the delta buffer is the fallback.
      setMessages((cur) => {
        const last = cur[cur.length - 1];
        const content = (finalText.trim() ? finalText.replace(/^\s+/, "") : last.content).trim();
        if (!content) return [...cur.slice(0, -1), { ...last, content: "……（没有收到回复，请再试一次）" }];
        return [...cur.slice(0, -1), { ...last, content }];
      });
    } catch {
      if (rafId !== null) cancelAnimationFrame(rafId);
      pendingOut = "";
      pendingThink = "";
      const note = "连接出了点问题 — 请稍后再试，或直接邮件 claw@creekstonevc.com。";
      // If partial output already rendered, annotate it instead of replacing it.
      setMessages((cur) => {
        const last = cur[cur.length - 1];
        const content = last.content.trim() ? `${last.content}\n\n> ⚠ ${note}` : note;
        return [...cur.slice(0, -1), { ...last, content }];
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="agent" className={standalone ? "ag-standalone" : undefined}>
      <div className="ag-inner">
        <div className="sl fi">{standalone ? "Creekstone · Live Agent" : "02 · Flagship"}</div>
        <h2 className="ag-h2 fi d1">World's First <span className="gg">AI VC Agent.</span></h2>
        <p className="ag-sub fi d2">
          Yihao's AI avatar — trained on how we think, invest, and co-build.
          Pitch it, question it, challenge it. <span className="ag-sub-cn">全球第一个 AI 风险投资人，在线。</span>
        </p>

        <div className="ag-layout fi d3">
          <div className="ag-left">
            <div className="ag-photo">
              <img src="/images/extracted/tavtr-yl.jpg" alt="Yihao Li" />
              <div className="ag-photo-grad"></div>
              <div className="ag-photo-meta">
                <div className="ag-live"><span className="ag-dot"></span>AGENT ONLINE</div>
                <div className="ag-name">Yihao Li</div>
                <div className="ag-role">Investor · AI Avatar</div>
              </div>
            </div>
          </div>

          <div className="ag-chat">
            <div className="t-bar">
              <div className="t-dot r"></div><div className="t-dot y"></div><div className="t-dot g"></div>
              <span className="t-title">yihao.agent — creekstone/live</span>
            </div>
            <div className="ag-body" ref={bodyRef}>
              {messages.map((m, i) => (
                <div className={`ag-msg ${m.role}`} key={i}>
                  {m.role === "assistant" && <div className="ag-msg-tag">YIHAO.AI</div>}
                  <div className={`ag-bubble ${m.role === "assistant" ? "ag-md" : ""}`}>
                    {m.role === "assistant" ? (
                      <>
                        {m.thinking && (
                          <ThinkingBlock text={m.thinking} live={busy && i === messages.length - 1} />
                        )}
                        {busy && i === messages.length - 1 && !m.content && !m.thinking ? (
                          <span className="ag-think">
                            <span className="ag-think-sp"></span>
                            正在思考，请稍候<span className="ag-think-dots"></span>
                          </span>
                        ) : (
                          <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                        )}
                      </>
                    ) : (
                      m.content
                    )}
                    {busy && i === messages.length - 1 && m.content && <span className="ag-cur">█</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="ag-sugg">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ag-chip" disabled={busy} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
            <div className="t-form">
              <span className="t-fp">founder@you:~$ </span>
              <input
                className="t-in"
                type="text"
                placeholder="Ask the agent anything..."
                autoComplete="off"
                value={value}
                disabled={busy}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              />
              <button className="t-snd" disabled={busy} onClick={() => send()}>{busy ? "…" : "SEND →"}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
