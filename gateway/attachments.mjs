import { createHmac, timingSafeEqual } from "node:crypto";
import { GatewayError, readJsonBody } from "./core.mjs";
import {
  ATTACHMENT_ONLY_INPUT, DEFAULT_FILE_BYTES, MAX_ATTACHMENT_FILES,
  MAX_TURN_BYTES, isSafeFileName, isFileId, hasRetiredAttachment,
} from "../lib/agent-attachments.mjs";

const HOUR = 60 * 60_000;
const fail = (status, code, message) => { throw new GatewayError(status, code, message); };
const mac = (value, secret) => createHmac("sha256", secret).update(`creekstone.files.v2\0${value}`).digest("base64url");

export function attachmentConfig(env = {}) {
  return {
    enabled: env.BOIDS_FILES_ENABLED !== "false",
    maxFileBytes: DEFAULT_FILE_BYTES, maxFiles: MAX_ATTACHMENT_FILES,
    maxTotalBytes: MAX_TURN_BYTES, timeoutMs: 30_000,
  };
}

export function attachmentCapabilities(config) {
  const options = config.attachments || attachmentConfig();
  return { enabled: options.enabled, maxFileBytes: options.maxFileBytes, maxFiles: options.maxFiles, maxTotalBytes: options.maxTotalBytes };
}

function signFile(file, kind, conversationId, config) {
  const payload = Buffer.from(JSON.stringify({ v: 2, kind, cid: conversationId, ...file,
    exp: Date.now() + config.conversationTtlMs })).toString("base64url");
  return { ...file, ticket: `${payload}.${mac(payload, config.signingSecret)}` };
}

export function verifyAttachmentTicket(ticket, conversationId, config, requiredKind) {
  if (typeof ticket !== "string" || ticket.length > 6000) fail(403, "invalid_attachment", "Attachment access is invalid");
  const [payload, signature, extra] = ticket.split(".");
  if (extra !== undefined || !/^[\w-]{43}$/.test(signature || "") ||
      !timingSafeEqual(Buffer.from(mac(payload, config.signingSecret)), Buffer.from(signature))) {
    fail(403, "invalid_attachment", "Attachment access is invalid");
  }
  let file;
  try { file = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { fail(403, "invalid_attachment", "Attachment access is invalid"); }
  if (file?.v !== 2 || file.cid !== conversationId || !["inputs", "outputs"].includes(file.kind) ||
      requiredKind && file.kind !== requiredKind || !isSafeFileName(file.name) || !isFileId(file.fileId)) {
    fail(403, "invalid_attachment", "Attachment does not belong to this conversation");
  }
  if (!Number.isFinite(file.exp) || file.exp <= Date.now()) fail(410, "attachment_expired", "Attachment access expired; reload history or attach the file again");
  if (requiredKind === "inputs" && (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > config.attachments.maxFileBytes)) {
    fail(403, "invalid_attachment", "Attachment size is invalid; attach the file again");
  }
  return file;
}

export function requireAttachments(config) {
  if (!config.attachments?.enabled) fail(503, "attachments_unavailable", "Attachments are disabled; text chat remains available");
}

export function buildAttachmentInput(input, tickets, conversationId, config) {
  if (tickets !== undefined && (!Array.isArray(tickets) || tickets.length > MAX_ATTACHMENT_FILES)) fail(400, "invalid_attachments", "Attach at most three files");
  if (tickets?.length) requireAttachments(config);
  const files = (tickets || []).map((ticket) => verifyAttachmentTicket(ticket, conversationId, config, "inputs"));
  if (new Set(files.map((file) => file.fileId)).size !== files.length) fail(400, "invalid_attachments", "The same attachment was included twice");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TURN_BYTES) fail(413, "attachments_too_large", "Combined attachments exceed 10 MB");
  const text = typeof input === "string" ? input.trim() : "";
  const visible = text || (files.length ? ATTACHMENT_ONLY_INPUT : "");
  return { visible, input: files.length ? [{ role: "user", content: [
    { type: "input_text", text: visible },
    ...files.map((file) => ({ type: "input_file", file_id: file.fileId })),
  ] }] : visible };
}

// Only typed content from the authenticated upstream conversation/response can
// confer ownership. Text, paths, URLs and client-supplied file IDs cannot.
export function nativeAttachmentReferences(items, role) {
  const files = new Map();
  for (const item of items || []) {
    if (item?.type !== "message" || item.role !== role || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      const candidates = role === "user" && part?.type === "input_file" ? [part] :
        role === "assistant" && part?.type === "output_text" && Array.isArray(part.annotations)
          ? part.annotations.filter((entry) => entry?.type === "file_path") : [];
      for (const reference of candidates) {
        if (!isFileId(reference.file_id) || files.has(reference.file_id)) continue;
        // Metadata is preferred, but Boids can still serve content when metadata
        // is temporarily unavailable. A sandbox basename is display-only.
        const pathName = typeof part.text === "string" ? /`\/workspace\/session\/([^`/\n]+)`/.exec(part.text)?.[1] : undefined;
        const name = isSafeFileName(reference.filename) ? reference.filename :
          candidates.length === 1 && isSafeFileName(pathName) ? pathName : "Agent attachment";
        files.set(reference.file_id, { fileId: reference.file_id, name });
        if (files.size > MAX_ATTACHMENT_FILES) return [...files.values()];
      }
    }
  }
  return [...files.values()];
}

async function limitedBytes(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    fail(413, "attachment_too_large", "File service response exceeds the size limit");
  }
  if (!response.body) fail(502, "files_invalid_response", "File service returned an empty response");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > maxBytes) fail(413, "attachment_too_large", "File service response exceeds the size limit");
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function fileRequest(path, options, config, fetchImpl, signal, binary = false) {
  const timeout = AbortSignal.timeout(config.attachments.timeoutMs);
  try {
    const response = await fetchImpl(`${config.boidsBaseUrl}/files${path}`, {
      ...options, headers: { Authorization: `Bearer ${config.boidsApiKey}` }, redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) fail(503, "files_permission_denied", "File service credentials or permissions need attention");
      if (response.status === 429) fail(429, "attachment_rate_limited", "File service is busy; retry later");
      if ([404, 410].includes(response.status)) fail(404, "attachment_unavailable", "The file is no longer available");
      if (response.status === 413) fail(413, "attachment_too_large", "File exceeds the service size limit");
      fail(502, "files_unavailable", "File service is unavailable");
    }
    const bytes = await limitedBytes(response, binary ? config.attachments.maxFileBytes : 65536);
    if (binary) return bytes;
    try { return JSON.parse(bytes.toString()); }
    catch { fail(502, "files_invalid_response", "File service returned invalid metadata"); }
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (timeout.aborted || signal?.aborted || ["TimeoutError", "AbortError"].includes(error?.name)) fail(504, "attachment_timeout", "File transfer timed out; its outcome may be unknown");
    fail(502, "files_unavailable", "File service is unavailable");
  }
}

function validMetadata(data, fileId) {
  return data?.object === "file" && isFileId(data.id) && (!fileId || data.id === fileId) &&
    isSafeFileName(data.filename) && Number.isSafeInteger(data.bytes) && data.bytes >= 0;
}

// Bounded cache/concurrency. Metadata improves labels; it never establishes
// ownership, and failures must not block otherwise successful text responses.
export function createFileMetadataLookup(config, fetchImpl) {
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 4 && queue.length) {
      const job = queue.shift();
      active++;
      void job().finally(() => { active--; pump(); });
    }
  };
  return async (fileId) => {
    const cached = cache.get(fileId);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(fileId)) return pending.get(fileId);
    if (pending.size >= 256) return null;
    // Queue small metadata tasks, not file bodies. The five-second deadline
    // includes queue time, so large histories cannot stall behind slow lookups.
    const signal = AbortSignal.timeout(5000);
    const promise = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        cache.delete(fileId);
        cache.set(fileId, { value, expires: Date.now() + (value ? 300_000 : 15_000) });
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        resolve(value);
      };
      const job = async () => {
        let value = null;
        try {
          const data = await fileRequest(`/${encodeURIComponent(fileId)}`, {}, config, fetchImpl, signal);
          if (validMetadata(data, fileId)) value = { name: data.filename, size: data.bytes };
        } catch { /* Content downloads remain available with the signed ID. */ }
        finish(value);
      };
      const abort = () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        finish(null);
      };
      signal.addEventListener("abort", abort, { once: true });
      queue.push(job);
      pump();
    });
    pending.set(fileId, promise);
    try { return await promise; } finally { pending.delete(fileId); }
  };
}

export async function messageAttachments(items, role, conversationId, config, lookup, complete = true) {
  const references = nativeAttachmentReferences(items, role);
  if (!references.length) {
    const retired = items.some((item) => item.content?.some((part) => hasRetiredAttachment(part.text)));
    return retired ? { attachmentWarning: "旧版附件已停用，请重新上传文件，或让 Agent 重新生成。" } : {};
  }
  if (!complete) return { attachmentWarning: "附件尚未生成完成，请稍后同步历史。" };
  if (!config.attachments.enabled) return { attachmentWarning: "附件服务已停用，暂时无法下载。" };
  const attachments = await Promise.all(references.slice(0, MAX_ATTACHMENT_FILES).map(async (reference) => {
    const metadata = await lookup(reference.fileId);
    return signFile({ ...reference, ...metadata }, role === "user" ? "inputs" : "outputs", conversationId, config);
  }));
  return { attachments, ...(references.length > MAX_ATTACHMENT_FILES ? { attachmentWarning: "每条消息最多展示 3 个附件，请让 Agent 分次提供其余文件。" } : {}) };
}

// Admission happens BEFORE buffering file bodies. Limits are process-local;
// Nginx adds per-IP rate limiting. No waiting queue retains upload bodies.
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
    if (usage[category] >= (kind === "upload" ? 10 : 60) || window[category] >= (kind === "upload" ? 120 : 600)) fail(429, "attachment_rate_limited", "File transfer limit reached; retry later");
    usage[category]++; window[category]++; sessions.set(cid, usage);
    active++; activeSessions.add(cid);
    return () => { active--; activeSessions.delete(cid); };
  };
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
      const form = new FormData();
      form.set("purpose", "user_data");
      form.set("file", new Blob([bytes], { type: "application/octet-stream" }), body.name);
      const data = await fileRequest("", { method: "POST", body: form }, config, fetchImpl, controller.signal);
      if (!validMetadata(data) || data.filename !== body.name || data.bytes !== bytes.length || data.purpose !== "user_data" || data.status === "error") {
        fail(502, "files_invalid_response", "File service did not confirm the uploaded file");
      }
      return { file: signFile({ fileId: data.id, name: data.filename, size: data.bytes }, "inputs", conversationId, config) };
    }
    if (Object.keys(body).some((key) => !["sessionKey", "ticket"].includes(key))) fail(400, "invalid_attachment", "Unexpected download fields");
    const file = verifyAttachmentTicket(body.ticket, conversationId, config);
    if (file.size > config.attachments.maxFileBytes) fail(413, "attachment_too_large", "Files must be at most 5 MB");
    const bytes = await fileRequest(`/${encodeURIComponent(file.fileId)}/content`, {}, config, fetchImpl, controller.signal, true);
    if (file.size !== undefined && file.size !== bytes.length) fail(502, "files_invalid_response", "The file size has changed or is invalid");
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
