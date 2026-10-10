import { handoffDraft, handoffResult, isRecord, type HandoffContent, type HandoffDraft, type HandoffResult } from "../../lib/handoff.mjs";

export type HandoffOpenRequest = { sessionKey: string; sequence: number; proposal?: HandoffContent; notice?: string };
export function canPrefillHandoff(snapshot: HandoffSnapshot | null, dirty: boolean, uncertain: boolean) {
  return !!snapshot && !snapshot.draft && !dirty && !uncertain;
}

export type HandoffSnapshot = { available: boolean; canSubmit: boolean; draft: HandoffDraft | null; result?: HandoffResult };
export class HandoffError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export async function requestHandoff(operation: "prepare" | "decision" | "status", sessionKey: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<HandoffSnapshot> {
  let response;
  try {
    response = await fetch(`/api/agent/handoff/${operation}`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, sessionKey }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(190000)]) : AbortSignal.timeout(190000),
    });
  } catch { throw new HandoffError("handoff_outcome_unknown"); }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new HandoffError(isRecord(value) && isRecord(value.error) && typeof value.error.code === "string" ? value.error.code : "handoff_outcome_unknown");
  if (!isRecord(value) || typeof value.available !== "boolean" || typeof value.canSubmit !== "boolean") throw new HandoffError("handoff_outcome_unknown");
  const draft = value.draft === null ? null : handoffDraft(value.draft);
  if (value.draft !== null && !draft) throw new HandoffError("handoff_outcome_unknown");
  const result = value.result === undefined ? undefined : handoffResult(value.result);
  if (value.result !== undefined && !result) throw new HandoffError("handoff_outcome_unknown");
  if (result && JSON.stringify(result) !== JSON.stringify(draft?.result)) throw new HandoffError("handoff_outcome_unknown");
  return { available: value.available, canSubmit: value.canSubmit, draft, ...(result ? { result } : {}) };
}

export function handoffErrorText(error: unknown) {
  const code = error instanceof HandoffError ? error.code : "handoff_outcome_unknown";
  const messages: Record<string, string> = {
    handoff_unavailable: "转交服务尚未开通。可以继续聊天；这里的编辑尚未保存或转交。",
    handoff_submission_disabled: "当前暂不能提交申请，本次未发起新的提交。请重新查询原申请状态。",
    handoff_invalid: "请检查摘要和联系方式，内容不要超过标注的字数限制。",
    invalid_input: "请检查摘要和联系方式，内容不要超过标注的字数限制。",
    draft_stale: "这份申请已有更新。请重新查询，核对内容后再确认。",
    draft_conflict: "已有另一份草稿。请重新查询，不会自动覆盖你的编辑。",
    draft_closed: "这份草稿已关闭，不能继续修改。请重新查询状态。",
    confirmation_expired: "确认卡已过期。请重新查询，再核对内容。",
    confirmation_required: "尚未确认。请在确认卡中检查内容，再点击确认转交。",
    submission_locked: "这份申请正在处理，请稍后重新查询，不要重复提交。",
    draft_not_found: "没有找到这份草稿。请重新打开当前会话。",
    identity_mismatch: "无法访问这份草稿，请重新打开它所属的会话。",
    session_changed: "会话已在另一标签页切换，请重新选择当前会话。",
    conversation_required: "请先连接会话，再打开转交确认卡。",
    handoff_busy: "请求较多，请稍后重新查询。",
    tool_not_configured: "转交服务暂不可用，无法确认是否已提交。请稍后重新查询。",
    ledger_unavailable: "申请记录暂时无法读取，请稍后重新查询，不会自动重复提交。",
  };
  return messages[code] || "结果暂时无法确认。请重新查询；不会自动重发，也不要另建申请。";
}

export function handoffStateText(draft: HandoffDraft | null) {
  if (!draft) return "填写后保存，再核对确认。";
  return ({ awaiting_confirmation: "草稿已保存，请核对后确认。", confirmed: "申请正在处理，请稍后查询结果。", declined: "暂不转交，草稿未提交。", expired: "确认卡已过期，请重新保存并核对。",
    submitting: "申请正在处理，请勿重复提交。", submitted: "申请已提交，等待团队审阅。", failed: "申请未提交成功，请查询状态后再试。", reconcile_required: "暂时无法确认提交结果，请重新查询。" })[draft.state];
}

// Presentation only: request validation, consent and recovery stay in the caller.
export function handoffPresentation(snapshot: HandoffSnapshot | null, dirty: boolean, uncertain: boolean, pending: string, locallyDeferred: boolean) {
  const draft = snapshot?.draft || null;
  const status = pending === "confirm" ? "正在提交申请…" : pending === "save" ? "正在保存草稿…" : pending === "status" ? "正在查询申请…"
    : uncertain ? "申请状态暂时无法确认。" : locallyDeferred ? "暂不转交，内容未提交。" : !snapshot ? "正在查询申请…"
    : dirty ? draft ? "修改尚未保存，请保存后重新核对。" : "尚未保存，请先核对内容。" : handoffStateText(draft);
  const showQuery = uncertain || !!draft && ["confirmed", "submitting", "failed", "reconcile_required"].includes(draft.state);
  return { status, showQuery };
}

export function canEditHandoff(draft: HandoffDraft | null) {
  return !draft || ["awaiting_confirmation", "declined", "expired"].includes(draft.state);
}

export function sameHandoffContent(a: HandoffDraft["content"], b: HandoffDraft["content"]) {
  return (Object.keys(a) as (keyof typeof a)[]).every(key => a[key] === b[key]);
}
