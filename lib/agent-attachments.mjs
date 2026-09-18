// Shared display contract. File IDs are identifiers, never download authority.
export const MAX_ATTACHMENT_FILES = 3;
export const DEFAULT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TURN_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_ONLY_INPUT = "请查看附件。";

export function isSafeFileName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 180 &&
    value === value.trim() && value === value.normalize("NFC") && !value.startsWith(".") &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff/\\%<>:"|?*{}]/u.test(value);
}

export function isFileId(value) {
  return typeof value === "string" && /^file-[A-Za-z0-9_-]{1,240}$/.test(value);
}

// Read-only display migration: old messages cannot authorize file access.
export function hasRetiredAttachment(source) {
  return typeof source === "string" && /\{\{attachment:\/\/|```creekstone-attachments\b|```creekstone-inputs\b[^]*?"files"\s*:\s*\[\s*\{/.test(source);
}

export function attachmentDisplayText(source, hideLocalPaths = false) {
  let text = typeof source === "string" ? source : "";
  text = text.replace(/```creekstone-(?:inputs|attachments)\b[\s\S]*?(?:```|$)/g, "")
    .replace(/\{\{attachment:\/\/[\s\S]*?(?:\}\}|$)/g, "");
  if (hideLocalPaths) {
    // Cards, not sandbox links, provide downloads. Never grants file access.
    text = text.replace(/\[[^\]\n]*\]\((?:sandbox:)?\/(?:workspace\/session|mnt\/data)\/[^)\n]*(?:\)|$)/g, "附件")
      .replace(/`(?:sandbox:)?\/(?:workspace\/session|mnt\/data)\/[^`\n]*(?:`|$)/g, "附件")
      .replace(/(?:sandbox:)?\/(?:workspace\/session|mnt\/data)\/[^\s`<>，。；！？]+/g, "附件");
  }
  return text.trim();
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "File";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
