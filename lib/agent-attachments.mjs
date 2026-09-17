// Shared wire contract only. No credentials or server-only authorization here.
export const ATTACHMENT_VERSION = 1;
export const MAX_ATTACHMENT_FILES = 3;
export const DEFAULT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TURN_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ONLY_INPUT = "请查看附件。";
export const OUTPUT_FENCE = "```creekstone-attachments";
export const INPUT_FENCE = "```creekstone-inputs";
export const ATTACHMENT_MARKER = "{{attachment://";

export function isSafeFileName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    value === value.trim() && value === value.normalize("NFC") && !value.startsWith(".") &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff/\\%<>:"|?*{}]/u.test(value);
}

export function isWorkspacePath(value) {
  return typeof value === "string" && value.length <= 1200 &&
    value.split("/").every(isSafeFileName);
}

// The public reference omits the Workspace's mounting directory. It is not a
// URL: do not URI-decode it or use it as a fetch target.
export function attachmentReferencePath(path) {
  return path.replace(/^founder-handoff\//, "");
}

export function formatAttachmentReference(path) {
  if (!isWorkspacePath(path)) throw new Error("Invalid attachment path");
  return `${ATTACHMENT_MARKER}${attachmentReferencePath(path)}}}`;
}

function parseInlineAttachments(source, complete) {
  let visible = "";
  let cursor = 0;
  let found = false;
  let invalid = false;
  const files = new Map();
  for (;;) {
    const start = source.indexOf(ATTACHMENT_MARKER, cursor);
    if (start < 0) break;
    found = true;
    visible += source.slice(cursor, start);
    const end = source.indexOf("}}", start + ATTACHMENT_MARKER.length);
    if (end < 0) {
      invalid = true;
      cursor = source.length;
      break;
    }
    const path = source.slice(start + ATTACHMENT_MARKER.length, end);
    if (!isWorkspacePath(path)) invalid = true;
    else files.set(path, { name: path.split("/").at(-1), path });
    cursor = end + 2;
    while (source[cursor] === "}") { invalid = true; cursor++; }
  }
  let tail = source.slice(cursor);
  // SSE can split even the opening delimiter. Hold that tiny suffix so a
  // path never flashes on screen as its first characters arrive.
  if (!complete) {
    for (let size = Math.min(tail.length, ATTACHMENT_MARKER.length - 1); size > 0; size--) {
      if (tail.endsWith(ATTACHMENT_MARKER.slice(0, size))) {
        tail = tail.slice(0, -size);
        found = true;
        break;
      }
    }
  }
  visible += tail;
  if (!found) return { text: source, files: [], state: "none" };
  const text = visible.trim();
  if (!complete) return { text, files: [], state: "pending" };
  if (invalid || files.size > MAX_ATTACHMENT_FILES) return { text, files: [], state: "invalid" };
  return { text, files: [...files.values()], state: "ready" };
}

// Retained for history created before the inline attachment:// contract.
function parseLegacyReply(source, complete) {
  const text = typeof source === "string" ? source : "";
  const match = /(^|\n)```creekstone-attachments/.exec(text);
  if (!match) {
    if (!complete) {
      const lastLine = text.slice(text.lastIndexOf("\n") + 1);
      if (lastLine && OUTPUT_FENCE.startsWith(lastLine)) {
        return { text: text.slice(0, text.length - lastLine.length).trimEnd(), files: [], state: "pending" };
      }
    }
    return { text, files: [], state: "none" };
  }
  const start = match.index + match[1].length;
  const visible = text.slice(0, start).trimEnd();
  if (!complete) return { text: visible, files: [], state: "pending" };
  const block = text.slice(start);
  const full = /^```creekstone-attachments\r?\n([\s\S]{1,16000})\r?\n```\s*$/.exec(block);
  const invalid = { text: visible, files: [], state: "invalid" };
  if (!full) return invalid;
  try {
    const data = JSON.parse(full[1]);
    if (!data || Object.keys(data).sort().join(",") !== "files,version" || data.version !== ATTACHMENT_VERSION ||
        !Array.isArray(data.files) || !data.files.length || data.files.length > MAX_ATTACHMENT_FILES) return invalid;
    const paths = new Set();
    for (const file of data.files) {
      if (!file || Object.keys(file).sort().join(",") !== "name,path" ||
          !isSafeFileName(file.name) || !isWorkspacePath(file.path) || paths.has(file.path)) return invalid;
      paths.add(file.path);
    }
    return { text: visible, files: data.files, state: "ready" };
  } catch { return invalid; }
}

// A complete marker/fence is NOT response completion. Both Gateway and UI use
// this parser; only the Gateway may grant download authority to its results.
export function parseAttachmentReply(source, complete = false) {
  const legacy = parseLegacyReply(source, complete);
  const inline = parseInlineAttachments(legacy.text, complete);
  if (inline.state === "none") return legacy;
  if (legacy.state === "none") return inline;
  if (!complete) return { text: inline.text, files: [], state: "pending" };
  if (legacy.state === "invalid" || inline.state === "invalid") return { text: inline.text, files: [], state: "invalid" };
  const files = [...new Map([...inline.files, ...legacy.files].map((file) => [file.path, file])).values()];
  return files.length > MAX_ATTACHMENT_FILES ? { text: inline.text, files: [], state: "invalid" } :
    { text: inline.text, files, state: "ready" };
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "File";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
