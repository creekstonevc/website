import { createHmac, timingSafeEqual } from "node:crypto";

export class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

export function prepareSpeechText(value, maxCharacters = 8_000) {
  if (typeof value !== "string") return "";

  const normalized = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~`>|]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (normalized.length <= maxCharacters) return normalized;
  return `${normalized.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifySignature(payload, suppliedValue, secret) {
  const suppliedSignature = Buffer.from(suppliedValue, "base64url");
  const expectedSignature = Buffer.from(sign(payload, secret), "base64url");

  return (
    suppliedSignature.length === expectedSignature.length &&
    timingSafeEqual(suppliedSignature, expectedSignature)
  );
}

export function createConversationCredential(
  conversationId,
  secret,
  { now = Date.now(), ttlMs = 30 * 24 * 60 * 60_000 } = {},
) {
  const id = validateConversationId(conversationId);
  if (!id) throw new Error("Conversation identifier is required");
  if (!secret || secret.length < 32) {
    throw new Error(
      "Gateway signing secret must contain at least 32 characters",
    );
  }

  const payload = Buffer.from(
    JSON.stringify({ v: 1, exp: now + ttlMs, cid: id }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyConversationCredential(
  token,
  secret,
  { now = Date.now() } = {},
) {
  if (typeof token !== "string" || token.length < 32 || token.length > 2_048)
    return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;
  const payload = token.slice(0, separator);
  if (!verifySignature(payload, token.slice(separator + 1), secret))
    return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      decoded?.v !== 1 ||
      typeof decoded.exp !== "number" ||
      decoded.exp <= now
    )
      return null;
    const conversationId = validateConversationId(decoded.cid);
    return conversationId ? { conversationId, expiresAt: decoded.exp } : null;
  } catch {
    return null;
  }
}

export function createTtsTicket(
  sourceText,
  secret,
  { now = Date.now(), ttlMs = 30 * 60_000, maxCharacters = 8_000 } = {},
) {
  if (!secret || secret.length < 32) {
    throw new Error(
      "Gateway signing secret must contain at least 32 characters",
    );
  }

  const text = prepareSpeechText(sourceText, maxCharacters);
  if (!text) return null;

  const payload = Buffer.from(
    JSON.stringify({ v: 1, exp: now + ttlMs, text }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyTtsTicket(ticket, secret, { now = Date.now() } = {}) {
  if (
    typeof ticket !== "string" ||
    ticket.length < 32 ||
    ticket.length > 64_000
  ) {
    throw new GatewayError(
      400,
      "invalid_tts_ticket",
      "Voice ticket is invalid",
    );
  }

  const separator = ticket.lastIndexOf(".");
  if (separator <= 0 || separator === ticket.length - 1) {
    throw new GatewayError(
      400,
      "invalid_tts_ticket",
      "Voice ticket is invalid",
    );
  }

  const payload = ticket.slice(0, separator);
  if (!verifySignature(payload, ticket.slice(separator + 1), secret)) {
    throw new GatewayError(
      403,
      "invalid_tts_ticket",
      "Voice ticket is invalid",
    );
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new GatewayError(
      400,
      "invalid_tts_ticket",
      "Voice ticket is invalid",
    );
  }

  if (
    decoded?.v !== 1 ||
    typeof decoded.exp !== "number" ||
    typeof decoded.text !== "string" ||
    !decoded.text.trim()
  ) {
    throw new GatewayError(
      400,
      "invalid_tts_ticket",
      "Voice ticket is invalid",
    );
  }
  if (decoded.exp <= now) {
    throw new GatewayError(
      410,
      "expired_tts_ticket",
      "Voice ticket has expired",
    );
  }

  return { text: decoded.text, expiresAt: decoded.exp };
}

export function validateConversationId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new GatewayError(
      400,
      "invalid_conversation",
      "Conversation identifier is invalid",
    );
  }
  return value;
}

export function buildBoidsResponsePayload(
  body,
  model,
  conversationId,
  maxInputCharacters = 4_000,
) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError(
      400,
      "invalid_request",
      "Request body must be a JSON object",
    );
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) {
    throw new GatewayError(400, "empty_input", "Founder input is required");
  }
  if (input.length > maxInputCharacters) {
    throw new GatewayError(
      413,
      "input_too_long",
      `Founder input must be ${maxInputCharacters} characters or fewer`,
    );
  }

  const conversation = validateConversationId(conversationId);
  if (!conversation) {
    throw new GatewayError(
      409,
      "conversation_required",
      "Conversation session is required",
    );
  }
  return {
    model,
    input,
    conversation,
    stream: true,
  };
}

function extractMessageText(item) {
  if (!Array.isArray(item?.content)) return "";
  return item.content
    .filter(
      (part) =>
        part &&
        typeof part === "object" &&
        (part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function normalizeConversationHistory(
  items,
  { bootstrapPrompt = "Hi", oldestItemIncluded = true } = {},
) {
  if (!Array.isArray(items)) return [];

  const messages = [];
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      item.type !== "message" ||
      (item.role !== "user" && item.role !== "assistant")
    ) {
      continue;
    }
    const content = extractMessageText(item);
    if (!content) continue;
    const previous = messages[messages.length - 1];
    if (item.role === "assistant" && previous?.role === "assistant") {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      messages.push({ role: item.role, content });
    }
  }

  if (
    oldestItemIncluded &&
    messages[0]?.role === "user" &&
    messages[0].content.trim() === bootstrapPrompt
  ) {
    return messages.slice(1);
  }
  return messages;
}

export function parseSseFrame(frame) {
  let eventName = "";
  const dataLines = [];

  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }

  const rawData = dataLines.join("\n");
  if (!rawData) return { type: eventName, payload: null, done: false };
  if (rawData === "[DONE]")
    return { type: eventName, payload: null, done: true };

  try {
    const payload = JSON.parse(rawData);
    const payloadType = typeof payload?.type === "string" ? payload.type : "";
    return { type: eventName || payloadType, payload, done: false };
  } catch {
    return { type: eventName, payload: null, done: false };
  }
}

export function extractCompletedText(payload, streamedText = "") {
  const response =
    payload?.response && typeof payload.response === "object"
      ? payload.response
      : payload;
  const pieces = [];

  if (Array.isArray(response?.output)) {
    for (const item of response.output) {
      if (
        !item ||
        typeof item !== "object" ||
        (item.type && item.type !== "message")
      )
        continue;
      if (!Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (
          content?.type === "output_text" &&
          typeof content.text === "string"
        ) {
          pieces.push(content.text);
        }
      }
    }
  }

  return pieces.join("\n").trim() || streamedText.trim();
}

export function decodeBytePlusAudio(rawText) {
  const chunks = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^data:\s*/, "");
    if (!line || line === "[DONE]") continue;
    try {
      const payload = JSON.parse(line);
      if (typeof payload.data === "string" && payload.data) {
        chunks.push(Buffer.from(payload.data, "base64"));
      }
    } catch {
      // Ignore non-JSON transport lines. A missing audio result fails below.
    }
  }

  const audio = Buffer.concat(chunks);
  if (!audio.length) {
    throw new GatewayError(
      502,
      "tts_upstream_error",
      "Voice rendering returned no audio",
    );
  }
  return audio;
}

export async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      throw new GatewayError(
        413,
        "request_too_large",
        "Request body is too large",
      );
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayError(
      400,
      "invalid_json",
      "Request body must contain valid JSON",
    );
  }
}
