// Local-only host-contract simulation, no Workspace/client/provider requests.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HANDOFF_PURPOSE } from "../lib/handoff.mjs";

export function createFakeHandoffHost({ dropSubmitReply = false } = {}) {
  const drafts = new Map();
  const calls = [];
  let writes = 0;
  const error = (request, code) => ({ version: 1, request_id: request.request_id, ok: false, error: { code, retryable: false } });
  const newNonce = () => randomBytes(32).toString("base64url");
  const invoke = async request => {
    calls.push(structuredClone(request));
    const { operation, identity, data } = request;
    const owner = `${identity.principal_id}:${identity.conversation_id}`;
    let draft = drafts.get(owner);
    const ok = () => ({ version: 1, request_id: request.request_id, ok: true, draft: draft ? structuredClone(draft) : null,
      ...(operation === "submit" && draft?.result ? { result: draft.result } : {}) });
    if (identity.channel !== "user") return error(request, "operation_not_allowed");
    if (data.draft_id && draft?.draft_id !== data.draft_id) return error(request, "draft_not_found");
    if (operation === "status") return ok();
    if (operation === "prepare") {
      const content = { founder_name: "", project_name: "", contact: "", ...data };
      if (draft && !["declined", "expired"].includes(draft.state)) {
        if (Object.keys(content).some(key => draft.content[key] !== content[key])) return error(request, "draft_conflict");
        return ok();
      }
      draft = { draft_id: draft?.draft_id || `hd_${randomUUID().replaceAll("-", "")}`, revision: draft ? draft.revision + 1 : 1, state: "awaiting_confirmation", content,
        purpose: HANDOFF_PURPOSE, expires_at_ms: Date.now() + 86400000, confirmation_nonce: newNonce() };
      drafts.set(owner, draft); return ok();
    }
    if (!draft) return error(request, "draft_not_found");
    if (draft.revision !== data.revision) return error(request, "draft_stale");
    if (operation === "update") {
      if (!["awaiting_confirmation", "confirmed", "declined", "expired"].includes(draft.state)) return error(request, "submission_locked");
      const content = Object.fromEntries(Object.entries(data).filter(([key]) => !["draft_id", "revision"].includes(key)));
      Object.assign(draft, { revision: draft.revision + 1, content, state: "awaiting_confirmation", confirmation_nonce: newNonce() });
      return ok();
    }
    if (operation === "decision") {
      if (draft.confirmation_nonce !== data.confirmation_nonce) return error(request, "confirmation_expired");
      if (draft.state === "submitted" && data.action === "confirm") return ok();
      if (["submitting", "submitted", "reconcile_required"].includes(draft.state)) return error(request, "submission_locked");
      if (data.action === "confirm" && !draft.content.contact) return error(request, "invalid_input");
      draft.state = data.action === "confirm" ? "confirmed" : "declined";
      return ok();
    }
    if (operation === "submit") {
      if (draft.state === "submitted") return ok();
      if (draft.state !== "confirmed") return error(request, "confirmation_required");
      writes++;
      draft.state = "submitted";
      draft.result = { status: "submitted", reference_id: `ext_${createHash("sha256").update(`local-fixture-${writes}`).digest("hex")}`, notified: false };
      if (dropSubmitReply) throw new Error("Synthetic lost submit reply");
      return ok();
    }
    return error(request, "invalid_input");
  };
  return { invoke, calls, drafts, get writes() { return writes; }, snapshot: () => ({ writes, operations: calls.map(call => call.operation) }) };
}
