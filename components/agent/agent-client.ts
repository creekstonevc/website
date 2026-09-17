import { DEFAULT_FILE_BYTES, MAX_ATTACHMENT_FILES, MAX_TURN_BYTES, isSafeFileName, isWorkspacePath, type AttachmentFile, type AttachmentCapabilities } from "../../lib/agent-attachments.mjs";
export type { AttachmentFile, AttachmentCapabilities } from "../../lib/agent-attachments.mjs";

export type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  ttsTicket?: string;
  attachments?: AttachmentFile[];
  attachmentWarning?: string;
  complete?: boolean;
};

export type StreamHandlers = {
  onThinkingDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
};

export type StreamResult = {
  text: string;
  ttsTicket: string | null;
  attachments?: AttachmentFile[];
  attachmentWarning?: string;
};

export type ConversationSession = {
  needsBootstrap: boolean;
  messages: Message[];
  nextCursor: string | null;
  sessionKey: string;
  sessions: { key: string; expiresAt: number }[];
  attachments: AttachmentCapabilities;
};

export type Recovery = { kind: "retry" | "sync" | "connect"; note: string; input?: string; baseline?: number; previousAnswer?: string; bootstrap?: boolean; rebind?: boolean; attachments?: AttachmentFile[] };

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

export function readAttachmentFiles(value: unknown): AttachmentFile[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_FILES) return [];
  return value.filter((file): file is AttachmentFile => isRecord(file) &&
    isSafeFileName(file.name) && isWorkspacePath(file.path) && typeof file.ticket === "string" && file.ticket.length <= 6000 &&
    (file.size === undefined || typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= DEFAULT_FILE_BYTES));
}

export const defaultAttachmentCapabilities: AttachmentCapabilities = {
  enabled: false, maxFileBytes: DEFAULT_FILE_BYTES, maxFiles: MAX_ATTACHMENT_FILES, maxTotalBytes: MAX_TURN_BYTES,
};

export function attachmentError(error: unknown): string {
  const code = error instanceof AgentRequestError ? error.code : "";
  const messages: Record<string, string> = {
    attachments_unavailable: "附件服务尚未配置，文字聊天仍可使用。",
    attachment_too_large: "单个文件不能超过 5 MB，请缩小文件后重新选择。",
    attachments_too_large: "每条消息的附件总大小不能超过 10 MB。",
    request_too_large: "文件过大，单个文件不能超过 5 MB。",
    invalid_filename: "文件名不能含路径分隔符或控制字符，请重命名后重新选择。",
    invalid_attachment_data: "文件为空或数据无效，请重新选择。",
    invalid_attachment: "附件凭据无效或不属于当前会话，请重新选择文件。",
    attachment_expired: "附件凭据已过期。已发送的附件可刷新历史后下载；待发送附件请重新选择。",
    invalid_attachments: "附件列表无效，每条消息最多 3 个文件。",
    session_changed: "当前会话已在另一标签页切换。请重新打开此会话后重试。",
    conversation_required: "请先连接会话，再上传或下载附件。",
    workspace_permission_denied: "附件服务权限不足，请联系 Creekstone 检查配置；文字聊天不受影响。",
    attachment_busy: "另一个文件正在传输，请稍后重试。",
    attachment_rate_limited: "文件传输次数已达限制，请稍后重试。",
    attachment_unavailable: "文件暂时无法读取，请让 Agent 确认已写回本会话的输出目录。",
    attachment_timeout: "文件传输超时，结果尚未确认。可以重试；未发送的文件不会自动交给 Agent。",
    workspace_unavailable: "附件服务暂时不可用，请稍后重试。",
    workspace_invalid_response: "附件服务未确认文件，请稍后重试。",
  };
  return messages[code] || (error instanceof AgentRequestError && error.status === 429
    ? "文件传输次数已达限制，请稍后重试。" : "文件传输失败，请检查连接后重试。");
}

async function attachmentRequest(path: "upload" | "download", body: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/agent/attachments/${path}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AgentRequestError(response.status, payload?.error?.code || "workspace_unavailable");
  }
  return response;
}

export async function uploadAttachment(file: File, sessionKey: string, signal?: AbortSignal): Promise<{ file: AttachmentFile; warning?: string }> {
  const name = file.name.normalize("NFC");
  if (!isSafeFileName(name)) throw new AgentRequestError(400, "invalid_filename");
  if (file.size > DEFAULT_FILE_BYTES) throw new AgentRequestError(413, "attachment_too_large");
  if (!file.size) throw new AgentRequestError(400, "invalid_attachment_data");
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32768) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  const response = await attachmentRequest("upload", { sessionKey, name, dataBase64: btoa(chunks.join("")) }, signal);
  const result = await response.json();
  const uploaded = readAttachmentFiles([result.file])[0];
  if (!uploaded || uploaded.name !== name || uploaded.size !== file.size) throw new AgentRequestError(502, "workspace_invalid_response");
  return { file: uploaded, ...(typeof result.warning === "string" ? { warning: result.warning } : {}) };
}

export async function downloadAttachment(file: AttachmentFile, sessionKey: string, signal?: AbortSignal): Promise<Blob> {
  const response = await attachmentRequest("download", { sessionKey, ticket: file.ticket }, signal);
  return response.blob();
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
        attachments: readAttachmentFiles(item.attachments),
        attachmentWarning: readString(item.attachmentWarning) || undefined,
        complete: item.complete !== false,
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
    attachments: { ...defaultAttachmentCapabilities, enabled: isRecord(data.attachments) && data.attachments.enabled === true },
    sessions: Array.isArray(data.sessions) ? data.sessions.filter((item): item is { key: string; expiresAt: number } =>
      isRecord(item) && typeof item.key === "string" && typeof item.expiresAt === "number") : [],
  };
}

export async function streamReply(
  input: string,
  handlers: StreamHandlers,
  { bootstrap = false, sessionKey, attachments }: { bootstrap?: boolean; sessionKey?: string; attachments?: AttachmentFile[] } = {},
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
      ...(!bootstrap && attachments?.length ? { attachments: attachments.map((file) => file.ticket) } : {}),
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
  let attachmentMetadata: { attachments?: AttachmentFile[]; attachmentWarning?: string } = {};

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

    if (type === "creekstone.attachments.ready" && isRecord(payload)) {
      attachmentMetadata = { attachments: readAttachmentFiles(payload.attachments),
        ...(typeof payload.attachmentWarning === "string" ? { attachmentWarning: payload.attachmentWarning } : {}) };
      return false;
    }

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

  return { text: completedOutput || streamedOutput, ttsTicket, ...attachmentMetadata };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function shouldSendOnEnter(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }, composing: boolean, sinceComposition: number) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229 && sinceComposition >= 100;
}
