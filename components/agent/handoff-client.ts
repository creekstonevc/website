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
    handoff_submission_disabled: "当前转交入口未开通，本次未发起新的提交。请同步原申请状态。",
    handoff_invalid: "请检查摘要和联系方式，内容不要超过标注的字数限制。",
    invalid_input: "请检查摘要和联系方式，内容不要超过标注的字数限制。",
    draft_stale: "这张卡已有更新，旧版本不能确认。请先同步最新版本。",
    draft_conflict: "已有另一份草稿。请先同步，不会覆盖原有内容。",
    draft_closed: "这份草稿已关闭，不能继续修改。请先同步状态。",
    confirmation_expired: "确认卡已过期。请同步状态，再重新检查内容。",
    confirmation_required: "尚未确认。请在确认卡中检查内容，再点击确认转交。",
    submission_locked: "这份申请正在处理，请稍后同步结果，不要重复提交。",
    draft_not_found: "没有找到这份草稿。请重新打开当前会话。",
    identity_mismatch: "无法访问这份草稿，请重新打开它所属的会话。",
    session_changed: "会话已在另一标签页切换，请重新选择当前会话。",
    conversation_required: "请先连接会话，再打开转交确认卡。",
    handoff_busy: "请求较多，请稍后同步状态。",
    tool_not_configured: "转交服务尚未配置，不能确认已发送。请稍后同步结果。",
    ledger_unavailable: "转交记录暂时无法读取，请稍后同步，不会自动重复提交。",
  };
  return messages[code] || "结果暂时无法确认。请同步状态；不会自动重发，也不要另建申请。";
}

export function handoffStateText(draft: HandoffDraft | null) {
  if (!draft) return "待你填写";
  return ({ awaiting_confirmation: "待你确认", confirmed: "已确认 · 等待转交结果", declined: "暂不转交", expired: "确认卡已过期",
    submitting: "正在转交 · 请勿重复提交", submitted: "已转交 · 待团队审阅", failed: "转交未完成", reconcile_required: "结果待核实" })[draft.state];
}

export function canEditHandoff(draft: HandoffDraft | null) {
  return !draft || ["awaiting_confirmation", "declined", "expired"].includes(draft.state);
}

export function sameHandoffContent(a: HandoffDraft["content"], b: HandoffDraft["content"]) {
  return (Object.keys(a) as (keyof typeof a)[]).every(key => a[key] === b[key]);
}
