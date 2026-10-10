// Shared public schema. No principal, submission key, host path or credentials.
export const HANDOFF_PURPOSE = "将以上摘要和联系方式交给 Creekstone 团队审阅，以便评估后续交流；不代表已安排会面。";
export const HANDOFF_LIMITS = Object.freeze({ summary: 1200, contact: 240, founder_name: 120, project_name: 160 });
export const HANDOFF_STATES = ["awaiting_confirmation", "confirmed", "declined", "expired", "submitting", "submitted", "failed", "reconcile_required"];
export const EMPTY_HANDOFF = Object.freeze({ summary: "", contact: "", founder_name: "", project_name: "" });
export const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
export const isDraftId = value => typeof value === "string" && /^hd_[a-f0-9]{32}$/.test(value);
export const isRevision = value => Number.isSafeInteger(value) && value > 0;

export function handoffContent(value) {
  if (!isRecord(value) || Object.keys(value).some(key => !Object.hasOwn(HANDOFF_LIMITS, key))) return null;
  const result = {};
  for (const [key, limit] of Object.entries(HANDOFF_LIMITS)) {
    const text = value[key] ?? "";
    if (typeof text !== "string" || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return null;
    result[key] = text.trim();
    if ([...result[key]].length > limit) return null;
  }
  return result.summary ? result : null;
}

export function handoffResult(value) {
  if (!isRecord(value) || !["submitted", "rejected", "failed"].includes(value.status) || value.notified !== false) return null;
  if (value.status === "submitted" && (typeof value.reference_id !== "string" || !/^(?:ext_[a-f0-9]{64}|rec[A-Za-z0-9_-]{1,157})$/.test(value.reference_id))) return null;
  return { status: value.status, notified: false,
    ...(value.status === "submitted" ? { reference_id: value.reference_id } : {}),
    ...(typeof value.error === "string" && /^[a-z_]{1,80}$/.test(value.error) ? { error: value.error } : {}) };
}

export function handoffDraft(value) {
  if (!isRecord(value) || !isDraftId(value.draft_id) || !isRevision(value.revision) || !HANDOFF_STATES.includes(value.state)) return null;
  const content = handoffContent(value.content);
  if (!content || value.purpose !== HANDOFF_PURPOSE || !Number.isSafeInteger(value.expires_at_ms) || value.expires_at_ms <= 0) return null;
  if (value.confirmation_nonce !== undefined && (typeof value.confirmation_nonce !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(value.confirmation_nonce))) return null;
  const result = value.result === undefined ? undefined : handoffResult(value.result);
  if (value.result !== undefined && !result || value.state === "submitted" && result?.status !== "submitted") return null;
  return { draft_id: value.draft_id, revision: value.revision, state: value.state, content, purpose: value.purpose,
    expires_at_ms: value.expires_at_ms,
    ...(value.confirmation_nonce ? { confirmation_nonce: value.confirmation_nonce } : {}), ...(result ? { result } : {}) };
}
