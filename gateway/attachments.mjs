import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { GatewayError, readJsonBody } from "./core.mjs";
import {
  ATTACHMENT_ONLY_INPUT, DEFAULT_FILE_BYTES, INPUT_FENCE, MAX_ATTACHMENT_FILES,
  MAX_TURN_BYTES, isSafeFileName, isWorkspacePath, parseAttachmentReply,
  attachmentReferencePath, formatAttachmentReference,
} from "../lib/agent-attachments.mjs";

const DEFAULT_ROOT = "founder-handoff/Yihao Agent Founder Intake/attachments";
const HOUR = 60 * 60_000;
const fail = (status, code, message) => { throw new GatewayError(status, code, message); };
const mac = (value, secret) => createHmac("sha256", secret).update(`creekstone.attachments.v1\0${value}`).digest("base64url");
function matches(value, signature, secret) {
  if (typeof signature !== "string" || !/^[\w-]{43}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(mac(value, secret)), Buffer.from(signature));
}

export function attachmentConfig(env = {}) {
  const url = env.WORKSPACE_API_URL?.trim() || "";
  const apiKey = env.WORKSPACE_API_KEY?.trim() || "";
  const root = env.WORKSPACE_ATTACHMENT_ROOT?.trim() || DEFAULT_ROOT;
  let validUrl = false;
  try {
    const target = new URL(url);
    validUrl = !target.username && !target.password && !target.search && !target.hash &&
      (target.protocol === "https:" || target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname));
  } catch { /* Missing configuration disables attachments, never ordinary chat. */ }
  return {
    url, apiKey, root,
    enabled: Boolean(validUrl && /^wsk_[\w-]{43}$/.test(apiKey) && isWorkspacePath(root)),
    maxFileBytes: DEFAULT_FILE_BYTES,
    maxFiles: MAX_ATTACHMENT_FILES,
    maxTotalBytes: MAX_TURN_BYTES,
    timeoutMs: 30_000,
  };
}

export function attachmentCapabilities(config) {
  const options = config.attachments || attachmentConfig();
  return { enabled: options.enabled, maxFileBytes: options.maxFileBytes, maxFiles: options.maxFiles, maxTotalBytes: options.maxTotalBytes };
}

export function attachmentNamespace(conversationId, secret) {
  return createHmac("sha256", secret).update(`workspace-session\0${conversationId}`).digest("hex");
}

export function attachmentDirectory(kind, conversationId, config) {
  return `${config.attachments.root}/${kind}/${attachmentNamespace(conversationId, config.signingSecret)}`;
}

function inDirectory(path, kind, conversationId, config) {
  return isWorkspacePath(path) && path.startsWith(`${attachmentDirectory(kind, conversationId, config)}/`);
}

function signFile(file, kind, conversationId, config) {
  const payload = Buffer.from(JSON.stringify({ v: 1, kind, cid: conversationId, ...file,
    exp: Date.now() + config.conversationTtlMs })).toString("base64url");
  return { ...file, ticket: `${payload}.${mac(payload, config.signingSecret)}` };
}

export function verifyAttachmentTicket(ticket, conversationId, config, requiredKind) {
  if (typeof ticket !== "string" || ticket.length > 6000) fail(403, "invalid_attachment", "Attachment access is invalid");
  const [payload, signature, extra] = ticket.split(".");
  if (extra !== undefined || !matches(payload, signature, config.signingSecret)) fail(403, "invalid_attachment", "Attachment access is invalid");
  let file;
  try { file = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { fail(403, "invalid_attachment", "Attachment access is invalid"); }
  if (file?.v !== 1 || file.cid !== conversationId || !["inputs", "outputs"].includes(file.kind) ||
      requiredKind && file.kind !== requiredKind || !isSafeFileName(file.name) ||
      !inDirectory(file.path, file.kind, conversationId, config)) fail(403, "invalid_attachment", "Attachment does not belong to this conversation");
  if (!Number.isFinite(file.exp) || file.exp <= Date.now()) fail(410, "attachment_expired", "Attachment access expired; reload history or attach the file again");
  if (file.kind === "inputs" && (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > config.attachments.maxFileBytes)) {
    fail(403, "invalid_attachment", "Attachment size is invalid");
  }
  return file;
}

export function requireAttachments(config) {
  if (!config.attachments?.enabled) fail(503, "attachments_unavailable", "Attachments are not configured; text chat remains available");
}

export function buildAttachmentInput(input, tickets, conversationId, config) {
  if (tickets !== undefined && (!Array.isArray(tickets) || tickets.length > MAX_ATTACHMENT_FILES)) {
    fail(400, "invalid_attachments", "Attach at most three files");
  }
  if (tickets?.length) requireAttachments(config);
  const files = (tickets || []).map((ticket) => {
    const file = verifyAttachmentTicket(ticket, conversationId, config, "inputs");
    return { name: file.name, path: file.path, size: file.size };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) fail(400, "invalid_attachments", "The same attachment was included twice");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TURN_BYTES) fail(413, "attachments_too_large", "Combined attachments exceed 10 MB");
  const text = typeof input === "string" ? input.trim() : "";
  const visible = text || (files.length ? ATTACHMENT_ONLY_INPUT : "");
  if (!config.attachments?.enabled || !visible) return { visible, input: visible };
  const manifest = { version: 1, files, outputDirectory: attachmentDirectory("outputs", conversationId, config), referenceFormat: "attachment-uri-v1" };
  const references = files.map((file) => formatAttachmentReference(file.path)).join(" ");
  const wireText = references ? `${references}\n${visible}` : visible;
  const signature = mac(JSON.stringify({ conversationId, text: wireText, manifest }), config.signingSecret);
  return { visible, input: `${wireText}\n\n${INPUT_FENCE}\n${JSON.stringify({ ...manifest, signature })}\n\`\`\`` };
}

// Only a gateway-authored, signed suffix may be hidden when restoring history.
// A user's lookalike block remains ordinary text, never attachment authority.
export function restoreAttachmentInput(source, conversationId, config) {
  const at = source.lastIndexOf(`\n\n${INPUT_FENCE}\n`);
  if (at < 0 || !source.endsWith("\n```")) return { content: source };
  try {
    const data = JSON.parse(source.slice(at + INPUT_FENCE.length + 3, -4));
    const { signature, ...manifest } = data;
    let content = source.slice(0, at);
    if (!matches(JSON.stringify({ conversationId, text: content, manifest }), signature, config.signingSecret) ||
        manifest.version !== 1 || !Array.isArray(manifest.files)) return { content: source };
    const files = manifest.files.filter((file) => isSafeFileName(file.name) && Number.isSafeInteger(file.size) &&
      inDirectory(file.path, "inputs", conversationId, config));
    if (manifest.referenceFormat === "attachment-uri-v1" && files.length) {
      const prefix = `${files.map((file) => formatAttachmentReference(file.path)).join(" ")}\n`;
      if (!content.startsWith(prefix)) return { content: source };
      content = content.slice(prefix.length);
    }
    return { content, attachments: files.map((file) => signFile(file, "inputs", conversationId, config)) };
  } catch { return { content: source }; }
}

export function replyAttachments(text, conversationId, config, complete = true) {
  const parsed = parseAttachmentReply(text, complete);
  if (parsed.state === "none") return {};
  if (parsed.state === "pending") return { attachmentWarning: "附件信息尚未接收完整，请先同步历史。" };
  if (parsed.state === "invalid") return { attachmentWarning: "附件信息格式不完整或不受支持，请让 Agent 重新提供附件。" };
  if (!config.attachments?.enabled) return { attachmentWarning: "附件服务尚未配置，暂时无法下载。" };
  // Map only the configured mount alias. Never decode, resolve .., guess a
  // filename in another session, or fall back to a shared outputs directory.
  const root = config.attachments.root;
  const alias = attachmentReferencePath(root);
  const files = parsed.files.map((file) => ({ ...file,
    path: file.path.startsWith(`${root}/`) ? file.path :
      file.path.startsWith(`${alias}/`) ? `${root}/${file.path.slice(alias.length + 1)}` : file.path,
  }));
  if (files.some((file) => !inDirectory(file.path, "outputs", conversationId, config))) {
    return { attachmentWarning: "附件路径不属于当前会话，已阻止下载。请让 Agent 保存到本会话的输出目录。" };
  }
  return { attachments: [...new Map(files.map((file) => [file.path, file])).values()]
    .map((file) => signFile(file, "outputs", conversationId, config)) };
}

// Bound admission BEFORE buffering Base64. No upload queue retains file bodies.
// Limits are process-local abuse brakes; Nginx additionally rate-limits by IP.
export function createAttachmentBudget(now = Date.now) {
  const sessions = new Map();
  const activeSessions = new Set();
  let active = 0;
  let window = { at: now(), uploads: 0, downloads: 0 };
  return (cid, kind) => {
    const time = now();
    if (time - window.at >= HOUR) { window = { at: time, uploads: 0, downloads: 0 }; sessions.clear(); }
    if (active >= 2 || activeSessions.has(cid)) fail(429, "attachment_busy", "A file transfer is in progress; retry shortly");
    if (!sessions.has(cid) && sessions.size >= 2048) fail(429, "attachment_rate_limited", "File transfers are busy; retry later");
    const usage = sessions.get(cid) || { uploads: 0, downloads: 0 };
    const category = kind === "upload" ? "uploads" : "downloads";
    if (usage[category] >= (kind === "upload" ? 10 : 60) || window[category] >= (kind === "upload" ? 120 : 600)) {
      fail(429, "attachment_rate_limited", "File transfer limit reached; retry later");
    }
    usage[category]++; window[category]++; sessions.set(cid, usage);
    active++; activeSessions.add(cid);
    return () => { active--; activeSessions.delete(cid); };
  };
}

async function limitedJson(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    fail(413, "attachment_too_large", "The file exceeds the 5 MB download limit");
  }
  if (!response.body) fail(502, "workspace_invalid_response", "File service returned an empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > maxBytes) fail(413, "attachment_too_large", "The file exceeds the 5 MB download limit");
      chunks.push(result.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { fail(502, "workspace_invalid_response", "File service returned an invalid response"); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function workspaceOperation(operation, config, fetchImpl, signal) {
  const options = config.attachments;
  try {
    const response = await fetchImpl(options.url, {
      method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(operation), redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) fail(503, "workspace_permission_denied", "File service credentials or permissions need attention");
      if (response.status === 429) fail(429, "attachment_rate_limited", "File service is busy; retry later");
      // Workspace currently uses 400 for missing files as well as invalid operations.
      if (operation.command === "read" && [400, 404].includes(response.status)) fail(404, "attachment_unavailable", "The file is unavailable; ask the Agent to save it again");
      fail(502, "workspace_unavailable", "File service is unavailable");
    }
    const maxBytes = operation.command === "read" ? Math.ceil(options.maxFileBytes / 3) * 4 + 65536 : 65536;
    const result = await limitedJson(response, maxBytes);
    if (result?.ok !== true || result.path !== operation.path) fail(502, "workspace_invalid_response", "File service did not confirm the requested file");
    return result;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || signal.aborted) {
      fail(504, "attachment_timeout", "File transfer timed out; its outcome may be unknown");
    }
    fail(502, "workspace_unavailable", "File service is unavailable");
  }
}

function decodeFile(value, maxBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(maxBytes / 3) * 4) fail(413, "attachment_too_large", "Files must be at most 5 MB");
  if (!value.length || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail(400, "invalid_attachment_data", "File data is invalid or empty");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > maxBytes) fail(413, "attachment_too_large", "Files must be at most 5 MB");
  if (bytes.toString("base64") !== value) fail(400, "invalid_attachment_data", "File data is invalid");
  return bytes;
}

export async function transferAttachment({ request, response, config, conversationId, expectedSessionKey, kind, fetchImpl, budget }) {
  requireAttachments(config);
  const release = budget(conversationId, kind);
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", onClose);
  const timer = setTimeout(() => { controller.abort(); request.destroy(); }, 45_000);
  try {
    const maxBytes = kind === "upload" ? Math.ceil(config.attachments.maxFileBytes / 3) * 4 + 65536 : 8192;
    if (Number(request.headers["content-length"]) > maxBytes) fail(413, "request_too_large", "File request is too large");
    const body = await readJsonBody(request, maxBytes);
    if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "invalid_attachment", "File request must be a JSON object");
    if (body.sessionKey !== expectedSessionKey) fail(409, "session_changed", "The active conversation changed; reopen it before transferring files");
    if (kind === "upload") {
      if (Object.keys(body).some((key) => !["sessionKey", "name", "dataBase64"].includes(key))) fail(400, "invalid_attachment", "Unexpected upload fields");
      if (!isSafeFileName(body.name) || Buffer.byteLength(body.name) > 240) fail(400, "invalid_filename", "Use a filename without path separators or control characters");
      const bytes = decodeFile(body.dataBase64, config.attachments.maxFileBytes);
      const file = { name: body.name, size: bytes.length,
        path: `${attachmentDirectory("inputs", conversationId, config)}/${randomUUID()}/${body.name}` };
      const result = await workspaceOperation({ command: "write", path: file.path, dataBase64: body.dataBase64 }, config, fetchImpl, controller.signal);
      if (result.size !== bytes.length) fail(502, "workspace_invalid_response", "File service did not confirm the uploaded size");
      return { file: signFile(file, "inputs", conversationId, config),
        ...(result.view_error ? { warning: "文件已保存；Agent 的读取视图尚待刷新，不代表已解析。" } : {}) };
    }
    if (Object.keys(body).some((key) => !["sessionKey", "ticket"].includes(key))) fail(400, "invalid_attachment", "Unexpected download fields");
    const file = verifyAttachmentTicket(body.ticket, conversationId, config);
    const result = await workspaceOperation({ command: "read", path: file.path }, config, fetchImpl, controller.signal);
    if (!Number.isSafeInteger(result.size) || result.size < 0 || result.size > config.attachments.maxFileBytes) fail(413, "attachment_too_large", "Files must be at most 5 MB");
    const bytes = result.size === 0 && result.dataBase64 === "" ? Buffer.alloc(0) : decodeFile(result.dataBase64, config.attachments.maxFileBytes);
    if (bytes.length !== result.size || file.kind === "inputs" && file.size !== bytes.length) fail(502, "workspace_invalid_response", "The file size has changed or is invalid");
    const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    response.writeHead(200, {
      "Content-Type": "application/octet-stream", "Content-Length": bytes.length,
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
    });
    response.end(bytes);
    return null;
  } finally { clearTimeout(timer); response.off("close", onClose); release(); }
}
