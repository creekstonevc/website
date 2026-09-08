export type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  ttsTicket?: string;
};

export type StreamHandlers = {
  onThinkingDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
};

export type StreamResult = {
  text: string;
  ttsTicket: string | null;
};

export type ConversationSession = {
  needsBootstrap: boolean;
  messages: Message[];
  nextCursor: string | null;
  sessionKey: string;
  sessions: { key: string; expiresAt: number }[];
};

export type Recovery = { kind: "retry" | "sync" | "connect"; note: string; input?: string; baseline?: number; previousAnswer?: string; bootstrap?: boolean; rebind?: boolean };

export function readSavedDraft(key: string) {
  try { return localStorage.getItem(`creekstone.draft.${key}`)?.slice(0, 4000) || ""; }
  catch { return ""; }
}

export type VoicePhase = "idle" | "loading" | "playing" | "paused" | "error";

export type VoiceState = {
  messageIndex: number | null;
  phase: VoicePhase;
  error?: string;
};

export class AgentRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const waitingMessage: Message = { role: "assistant", content: "" };

export const suggestions = [
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
        id: readString(item.id) || undefined,
        role: item.role,
        content: item.content,
        ...(typeof item.ttsTicket === "string"
          ? { ttsTicket: item.ttsTicket }
          : {}),
      } satisfies Message,
    ];
  });
}

export async function openConversation(options: { reset?: boolean; sessionKey?: string; after?: string } = {}): Promise<ConversationSession> {
  const response = await fetch("/api/agent/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AgentRequestError(response.status, payload?.error?.code || "conversation_unavailable");
  }
  const data: unknown = await response.json();
  if (!isRecord(data)) {
    throw new AgentRequestError(502, "conversation_unavailable");
  }
  return {
    needsBootstrap: data.needsBootstrap === true,
    messages: readHistoryMessages(data.messages),
    nextCursor: readString(data.nextCursor) || null,
    sessionKey: readString(data.sessionKey),
    sessions: Array.isArray(data.sessions) ? data.sessions.filter((item): item is { key: string; expiresAt: number } =>
      isRecord(item) && typeof item.key === "string" && typeof item.expiresAt === "number") : [],
  };
}

export async function streamReply(
  input: string,
  handlers: StreamHandlers,
  { bootstrap = false, sessionKey }: { bootstrap?: boolean; sessionKey?: string } = {},
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
      ...(sessionKey ? { sessionKey } : {}),
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
    // A closed transport or [DONE] without a terminal Responses event is not
    // evidence that this answer completed successfully.
    if (rawData === "[DONE]") return false;

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

    if (["response.failed", "response.incomplete", "error"].includes(type)) {
      throw new AgentRequestError(502, "response_interrupted");
    }

    return false;
  };

  try {
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
    finished = handleFrame(pending);
  }

  if (!finished) throw new AgentRequestError(502, "stream_interrupted");
  if (!(completedOutput || streamedOutput).trim()) throw new AgentRequestError(502, "empty_response");

  return { text: completedOutput || streamedOutput, ttsTicket };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function shouldSendOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }, composing: boolean, sinceComposition: number) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229 && sinceComposition >= 100;
}
