import { createHmac, randomUUID } from "node:crypto";
import { GatewayError } from "./core.mjs";
import { createHandoffHost } from "./handoff-host.mjs";
import { handoffContent, handoffDraft, handoffResult, isDraftId, isRecord, isRevision } from "../lib/handoff.mjs";

export function handoffConfig(env = {}) {
  // Operator-only rollout policy, not user consent or proof of isolation.
  // Risk acceptance permits this website's guarded path while legacy writers
  // may still bypass it. Neither value can come from a request or model output.
  const writerPolicyApproved = env.HANDOFF_WRITE_ISOLATION_VERIFIED === "true" ||
    env.HANDOFF_LEGACY_WRITER_RISK_ACCEPTED === "true";
  return {
    enabled: env.HANDOFF_ENABLED === "true",
    submitEnabled: env.HANDOFF_SUBMIT_ENABLED === "true" && writerPolicyApproved,
    command: env.HANDOFF_HOST_COMMAND || "/opt/creekstone-handoff/bin/creekstone-handoff-host",
    envFile: env.HANDOFF_HOST_ENV_FILE || "/etc/creekstone-handoff.env",
  };
}

export function handoffIdentity(conversationId, secret) {
  return { principal_id: createHmac("sha256", secret).update(`handoff-principal\0${conversationId}`).digest("hex"),
    conversation_id: conversationId, channel: "user" };
}

const errors = new Map([
  ["invalid_input", 400], ["identity_mismatch", 403], ["operation_not_allowed", 403], ["draft_not_found", 404],
  ["draft_stale", 409], ["draft_conflict", 409], ["draft_closed", 409], ["confirmation_required", 409],
  ["confirmation_expired", 409], ["submission_locked", 409], ["tool_not_configured", 503], ["ledger_unavailable", 503], ["internal_error", 502],
]);
const reject = (code = "handoff_invalid", status = 400) => { throw new GatewayError(status, code, "Handoff request could not be completed"); };
const only = (value, names) => isRecord(value) && Object.keys(value).every(key => names.includes(key));

// JSON.parse alone silently accepts duplicate keys. Reject them before any
// authorization-sensitive operation; input size/depth are bounded as well.
export function parseHandoffJson(text) {
  let data;
  try { data = JSON.parse(text); } catch { reject(); }
  const stack = [];
  for (const token of text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^,\s{}\[\]:]+/g) || []) {
    if (token === "{" || token === "[") {
      stack.push({ object: token === "{", key: true, seen: new Set() });
      if (stack.length > 8) reject();
    } else if (token === "}" || token === "]") stack.pop();
    else {
      const frame = stack.at(-1);
      if (token === "," && frame?.object) frame.key = true;
      else if (frame?.object && frame.key && token.startsWith('"')) {
        const key = JSON.parse(token);
        if (frame.seen.has(key)) reject();
        frame.seen.add(key); frame.key = false;
      }
    }
  }
  if (!isRecord(data)) reject();
  return data;
}

export async function readHandoffBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) reject();
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) reject("request_too_large", 413);
    chunks.push(chunk);
  }
  return parseHandoffJson(Buffer.concat(chunks).toString("utf8"));
}

export function createHandoffManager(config, { invokeHost } = {}) {
  const options = config.handoff || handoffConfig();
  const invoke = invokeHost || (options.enabled ? createHandoffHost(options) : null);
  const locks = new Set();
  const budget = new Map();
  const capabilities = { available: !!options.enabled, canSubmit: !!options.enabled && !!options.submitEnabled, toolAvailable: false };
  const admission = (identity) => {
    const now = Date.now();
    for (const [key, value] of budget) if (value.until < now) budget.delete(key);
    if (!budget.has(identity.principal_id) && budget.size >= 2048) reject("handoff_busy", 429);
    const usage = budget.get(identity.principal_id) || { count: 0, until: now + 60000 };
    if (++usage.count > 30) reject("handoff_busy", 429);
    budget.set(identity.principal_id, usage);
  };
  async function call(identity, operation, data) {
    const request = { version: 1, request_id: randomUUID(), identity, operation, data };
    const result = await invoke(request);
    if (!isRecord(result) || result.version !== 1 || result.request_id !== request.request_id) reject("handoff_outcome_unknown", 502);
    if (result.ok === false) {
      const code = result.error?.code;
      reject(errors.has(code) ? code : "handoff_outcome_unknown", errors.get(code) || 502);
    }
    if (result.ok !== true) reject("handoff_outcome_unknown", 502);
    const draft = result.draft === null ? null : handoffDraft(result.draft);
    if ((!draft && !(operation === "status" && result.draft === null)) || (data.draft_id && draft?.draft_id !== data.draft_id)) reject("handoff_outcome_unknown", 502);
    const receipt = result.result === undefined ? undefined : handoffResult(result.result);
    if (result.result !== undefined && !receipt) reject("handoff_outcome_unknown", 502);
    if (receipt && (JSON.stringify(receipt) !== JSON.stringify(draft?.result) || (data.revision && draft?.revision !== data.revision))) reject("handoff_outcome_unknown", 502);
    return { ...capabilities, draft, ...(receipt ? { result: receipt } : {}) };
  }
  return {
    async handle(operation, conversationId, body) {
      // /tool is deliberately not wired to model-generated identity. Until a
      // trusted platform can inject a session grant, it is NEVER actionable.
      if (operation === "tool") reject("handoff_tool_unavailable", 503);
      if (!["prepare", "decision", "status"].includes(operation)) reject();
      if (!only(body, operation === "prepare" ? ["sessionKey", "content", "draft_id", "revision"] : operation === "decision"
        ? ["sessionKey", "draft_id", "revision", "action", "confirmation_nonce"] : ["sessionKey", "draft_id"])) reject();
      if (body.draft_id !== undefined && !isDraftId(body.draft_id)) reject();
      if (!options.enabled) {
        if (operation === "status") return { ...capabilities, draft: null };
        reject("handoff_unavailable", 503);
      }
      const identity = handoffIdentity(conversationId, config.signingSecret);
      admission(identity);
      if (operation === "status") return call(identity, "status", body.draft_id ? { draft_id: body.draft_id } : {});
      if (locks.has(identity.principal_id)) reject("submission_locked", 409);
      locks.add(identity.principal_id);
      try {
        if (operation === "prepare") {
          const content = handoffContent(body.content);
          if (!content || (body.draft_id ? !isRevision(body.revision) : body.revision !== undefined)) reject();
          return call(identity, body.draft_id ? "update" : "prepare", { ...content,
            ...(body.draft_id ? { draft_id: body.draft_id, revision: body.revision } : {}) });
        }
        if (!isDraftId(body.draft_id) || !isRevision(body.revision) || !["confirm", "defer"].includes(body.action) ||
            typeof body.confirmation_nonce !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(body.confirmation_nonce)) reject();
        if (body.action === "confirm" && !capabilities.canSubmit) reject("handoff_submission_disabled", 503);
        const data = { draft_id: body.draft_id, revision: body.revision, action: body.action, confirmation_nonce: body.confirmation_nonce };
        const decision = await call(identity, "decision", data);
        if (body.action === "defer") return decision;
        if (decision.draft.revision !== body.revision || !["confirmed", "submitted", "failed", "reconcile_required", "submitting"].includes(decision.draft.state)) reject("draft_stale", 409);
        if (decision.draft.state === "submitted") return decision;
        // No content is supplied here: the host submits its exact confirmed
        // snapshot; its durable ledger owns idempotency across processes.
        return call(identity, "submit", { draft_id: body.draft_id, revision: body.revision });
      } finally { locks.delete(identity.principal_id); }
    },
  };
}
