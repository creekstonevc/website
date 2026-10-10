import assert from "node:assert/strict";
import test from "node:test";
import { canEditHandoff, canPrefillHandoff, HandoffError, handoffErrorText, handoffStateText, requestHandoff, sameHandoffContent } from "./handoff-client.ts";
import { handoffDraft, handoffResult, HANDOFF_PURPOSE } from "../../lib/handoff.mjs";

const draft = { draft_id: `hd_${"a".repeat(32)}`, revision: 1, state: "awaiting_confirmation", purpose: HANDOFF_PURPOSE, expires_at_ms: 2000000000000,
  confirmation_nonce: "n".repeat(43), content: { summary: "测试摘要", contact: "qa@example.invalid", founder_name: "", project_name: "" } };

test("proposal prefill never overwrites edits, saved/submitted drafts or unknown state", () => {
  assert.equal(canPrefillHandoff({ available: true, canSubmit: true, draft: null }, false, false), true);
  assert.equal(canPrefillHandoff({ available: false, canSubmit: false, draft: null }, false, false), true);
  assert.equal(canPrefillHandoff(null, false, false), false);
  assert.equal(canPrefillHandoff({ draft: null }, true, false), false);
  assert.equal(canPrefillHandoff({ draft: null }, false, true), false);
  for (const state of ["awaiting_confirmation", "submitted", "declined", "submitting"]) assert.equal(canPrefillHandoff({ draft: { ...draft, state } }, false, false), false);
});

test("handoff requests use only same-origin cookies, never transport model consent or identity", async t => {
  const calls = []; t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options }); return Response.json({ available: true, canSubmit: true, draft });
  });
  await requestHandoff("decision", "real-session", { sessionKey: "forged", draft_id: draft.draft_id, revision: draft.revision, action: "confirm", confirmation_nonce: draft.confirmation_nonce });
  assert.equal(calls[0].url, "/api/agent/handoff/decision");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(JSON.parse(calls[0].options.body).sessionKey, "real-session");
  assert.deepEqual(calls[0].options.headers, { "Content-Type": "application/json" });
});
test("malformed completion/receipt and changed purpose are never shown as successful transfer", async t => {
  assert.equal(handoffDraft({ ...draft, purpose: "偷偷提交全部聊天" }), null);
  assert.equal(handoffDraft({ ...draft, state: "submitted" }), null);
  assert.equal(handoffResult({ status: "submitted", reference_id: "ext_test", notified: true }), null);
  for (const reference_id of ["wsk_secret", "success", "ext_test", `ext_${"z".repeat(64)}`, "https://example.invalid/private"]) {
    assert.equal(handoffResult({ status: "submitted", reference_id, notified: false }), null);
  }
  for (const reference_id of [`ext_${"a".repeat(64)}`, "recLegacy_001"]) {
    assert.equal(handoffResult({ status: "submitted", reference_id, notified: false }).reference_id, reference_id);
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ available: true, canSubmit: true, draft: { ...draft, state: "submitted" } }));
  await assert.rejects(requestHandoff("status", "s"), { code: "handoff_outcome_unknown" });
});
test("disabling submission never asserts that a historical request was not sent", () => {
  const message = handoffErrorText(new HandoffError("handoff_submission_disabled"));
  assert.match(message, /重新查询原申请状态/);
  assert.doesNotMatch(message, /没有发送|未发送|未转交/);
});
test("receipt in a successful envelope must agree with its submitted snapshot", async t => {
  const result = { status: "submitted", reference_id: `ext_${"a".repeat(64)}`, notified: false };
  t.mock.method(globalThis, "fetch", async () => Response.json({ available: true, canSubmit: true,
    draft: { ...draft, state: "submitted", result }, result: { ...result, reference_id: `ext_${"b".repeat(64)}` } }));
  await assert.rejects(requestHandoff("status", "s"), { code: "handoff_outcome_unknown" });
});
test("lost response remains uncertain, is not retried and cannot be described as failure or success", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network"); });
  await assert.rejects(requestHandoff("decision", "s"), { code: "handoff_outcome_unknown" });
  assert.equal(mock.mock.callCount(), 1);
  assert.match(handoffErrorText(new Error()), /结果暂时无法确认/);
});
test("editing differs from confirmed version; in-flight/uncertain/submitted content stays frozen", () => {
  assert.equal(sameHandoffContent(draft.content, { ...draft.content, summary: "修改后" }), false);
  for (const state of ["confirmed", "submitting", "submitted", "failed", "reconcile_required"]) assert.equal(canEditHandoff({ ...draft, state }), false);
  for (const state of ["awaiting_confirmation", "declined", "expired"]) assert.equal(canEditHandoff({ ...draft, state }), true);
  assert.equal(handoffStateText({ ...draft, state: "submitted" }), "申请已提交，等待团队审阅。");
});
