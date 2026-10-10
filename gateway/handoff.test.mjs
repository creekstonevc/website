import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import test from "node:test";
import { createHandoffManager, handoffConfig, handoffIdentity, parseHandoffJson } from "./handoff.mjs";
import { createHandoffHost } from "./handoff-host.mjs";
import { createFakeHandoffHost } from "../scripts/handoff-fixture.mjs";
import { createGateway } from "./server.mjs";
import { createConversationCredential } from "./core.mjs";
import { handoffContent } from "../lib/handoff.mjs";

const secret = "handoff-tests-only-signing-secret-at-least-32";
// Run all consent, ownership, idempotency and recovery regressions in the new
// risk-accepted mode WITHOUT claiming that old writer isolation was verified.
const config = { signingSecret: secret, handoff: handoffConfig({ HANDOFF_ENABLED: "true",
  HANDOFF_SUBMIT_ENABLED: "true", HANDOFF_WRITE_ISOLATION_VERIFIED: "false", HANDOFF_LEGACY_WRITER_RISK_ACCEPTED: "true" }) };
const content = { summary: "[本地仿真] 创业项目交流，非真实线索。", contact: "qa@example.invalid", founder_name: "", project_name: "" };
const setup = (overrides = {}, invoke) => { const fake = createFakeHandoffHost(); return { fake, manager: createHandoffManager({ ...config, ...overrides }, { invokeHost: invoke || fake.invoke }) }; };
const card = async manager => (await manager.handle("prepare", "conv_one", { sessionKey: "s", content })).draft;
const confirm = draft => ({ sessionKey: "s", draft_id: draft.draft_id, revision: draft.revision, confirmation_nonce: draft.confirmation_nonce, action: "confirm" });

test("handoff is fail-closed by default and requires an explicit operator writer policy", async () => {
  assert.equal(handoffConfig().enabled, false);
  assert.equal(handoffConfig({ HANDOFF_SUBMIT_ENABLED: "true" }).submitEnabled, false);
  const { fake, manager } = setup({ handoff: handoffConfig() });
  assert.deepEqual(await manager.handle("status", "conv_one", { sessionKey: "s" }), { available: false, canSubmit: false, toolAvailable: false, draft: null });
  await assert.rejects(manager.handle("prepare", "conv_one", { content }), { code: "handoff_unavailable" });
  assert.equal(fake.calls.length, 0);
});

test("operator risk acceptance is an alternative to isolation, never a replacement for either enable switch", async () => {
  for (const enabled of [false, true]) for (const submit of [false, true]) {
    for (const isolated of [false, true]) for (const accepted of [false, true]) {
      const options = handoffConfig({ HANDOFF_ENABLED: String(enabled), HANDOFF_SUBMIT_ENABLED: String(submit),
        HANDOFF_WRITE_ISOLATION_VERIFIED: String(isolated), HANDOFF_LEGACY_WRITER_RISK_ACCEPTED: String(accepted) });
      const { fake, manager } = setup({ handoff: options });
      assert.equal((await manager.handle("status", "conv_one", {})).canSubmit, enabled && submit && (isolated || accepted));
      if (!enabled) {
        await assert.rejects(card(manager), { code: "handoff_unavailable" });
        assert.equal(fake.calls.length, 0);
      } else {
        const draft = await card(manager);
        if (submit && (isolated || accepted)) {
          assert.equal((await manager.handle("decision", "conv_one", confirm(draft))).draft.state, "submitted");
          assert.equal(fake.writes, 1);
        } else {
          await assert.rejects(manager.handle("decision", "conv_one", confirm(draft)), { code: "handoff_submission_disabled" });
          assert.equal(fake.calls.some(call => call.operation === "decision"), false);
          assert.equal(fake.writes, 0);
        }
      }
    }
  }
  for (const value of [undefined, "", "false", "TRUE", "1", " true ", true]) {
    assert.equal(handoffConfig({ HANDOFF_SUBMIT_ENABLED: "true", HANDOFF_LEGACY_WRITER_RISK_ACCEPTED: value }).submitEnabled, false);
  }
});

test("browser/model fields cannot accept legacy writer risk when the operator has not", async () => {
  const { fake, manager } = setup({ handoff: handoffConfig({ HANDOFF_ENABLED: "true", HANDOFF_SUBMIT_ENABLED: "true" }) });
  const draft = await card(manager);
  for (const field of ["HANDOFF_LEGACY_WRITER_RISK_ACCEPTED", "legacyWriterRiskAccepted", "HANDOFF_WRITE_ISOLATION_VERIFIED", "writeIsolationVerified"]) {
    await assert.rejects(manager.handle("decision", "conv_one", { ...confirm(draft), [field]: true }), { code: "handoff_invalid" });
    await assert.rejects(manager.handle("prepare", "conv_one", { content, [field]: true }), { code: "handoff_invalid" });
  }
  await assert.rejects(manager.handle("decision", "conv_one", confirm(draft)), { code: "handoff_submission_disabled" });
  assert.equal(fake.writes, 0);
});

test("prepare/update/defer/status never submit; only cookie-authorized decision then same revision submits", async () => {
  const { fake, manager } = setup(); const draft = await card(manager);
  await manager.handle("status", "conv_one", { sessionKey: "s" });
  assert.equal(fake.writes, 0);
  const result = await manager.handle("decision", "conv_one", confirm(draft));
  assert.equal(result.draft.state, "submitted"); assert.equal(result.result.notified, false); assert.equal(fake.writes, 1);
  assert.deepEqual(fake.calls.slice(-2).map(call => call.operation), ["decision", "submit"]);
  assert.deepEqual(fake.calls.at(-1).data, { draft_id: draft.draft_id, revision: draft.revision });
  const identity = handoffIdentity("conv_one", secret);
  assert.deepEqual(fake.calls.at(-1).identity, identity);
  assert.equal(identity.channel, "user");
  assert.notEqual(identity.principal_id, handoffIdentity("conv_other", secret).principal_id);
});

test("repeated confirmation and state recovery report one genuine receipt without duplicate writes", async () => {
  const { fake, manager } = setup(); const draft = await card(manager);
  const first = await manager.handle("decision", "conv_one", confirm(draft));
  const repeated = await manager.handle("decision", "conv_one", confirm(draft));
  const restored = await manager.handle("status", "conv_one", {});
  assert.equal(fake.writes, 1); assert.equal(first.result.reference_id, repeated.draft.result.reference_id);
  assert.equal(restored.draft.result.reference_id, first.result.reference_id);
});

test("editing rotates revision and nonce; stale cards and altered nonce cannot confirm", async () => {
  const { fake, manager } = setup(); const old = await card(manager);
  const updated = await manager.handle("prepare", "conv_one", { draft_id: old.draft_id, revision: old.revision, content: { ...content, summary: "新版摘要" } });
  assert.equal(updated.draft.revision, 2); assert.notEqual(updated.draft.confirmation_nonce, old.confirmation_nonce);
  await assert.rejects(manager.handle("decision", "conv_one", confirm(old)), { code: "draft_stale" });
  await assert.rejects(manager.handle("decision", "conv_one", { ...confirm(updated.draft), confirmation_nonce: old.confirmation_nonce }), { code: "confirmation_expired" });
  assert.equal(fake.writes, 0);
});

test("unknown fields, model-supplied identity/consent, direct submit, blank contact and foreign drafts fail closed", async () => {
  const { fake, manager } = setup(); const draft = await card(manager);
  for (const field of ["identity", "conversation_id", "confirmed", "idempotency_key", "purpose", "content", "HANDOFF_LEGACY_WRITER_RISK_ACCEPTED", "legacyWriterRiskAccepted"]) {
    await assert.rejects(manager.handle("decision", "conv_one", { ...confirm(draft), [field]: true }));
  }
  await assert.rejects(manager.handle("submit", "conv_one", confirm(draft)));
  await assert.rejects(manager.handle("tool", "conv_one", { operation: "decision", data: confirm(draft) }), { code: "handoff_tool_unavailable" });
  await assert.rejects(manager.handle("decision", "conv_other", confirm(draft)), { code: "draft_not_found" });
  await assert.rejects(manager.handle("decision", "conv_one", { ...confirm(draft), revision: true }));
  const empty = await manager.handle("prepare", "conv_empty", { content: { ...content, contact: "" } });
  await assert.rejects(manager.handle("decision", "conv_empty", confirm(empty.draft)), { code: "invalid_input" });
  assert.equal(fake.writes, 0);
});

test("defer is real host state, not a submission; preparing does not authorize submit", async () => {
  const { fake, manager } = setup(); const draft = await card(manager);
  const declined = await manager.handle("decision", "conv_one", { ...confirm(draft), action: "defer" });
  assert.equal(declined.draft.state, "declined"); assert.equal(fake.writes, 0);
  assert.equal((await manager.handle("status", "conv_one", {})).draft.state, "declined");
});

test("submission switch blocks decision before persisting consent, without blocking local drafts", async () => {
  const { fake, manager } = setup({ handoff: { enabled: true, submitEnabled: false } }); const draft = await card(manager);
  await assert.rejects(manager.handle("decision", "conv_one", confirm(draft)), { code: "handoff_submission_disabled" });
  assert.equal(fake.calls.some(call => call.operation === "decision"), false); assert.equal(fake.writes, 0);
});

test("lost submit response never invents success; status restores committed result with no new submit", async () => {
  const fake = createFakeHandoffHost();
  const manager = createHandoffManager(config, { invokeHost: async request => {
    const result = await fake.invoke(request);
    if (request.operation === "submit") throw new Error("lost connection");
    return result;
  } });
  const draft = await card(manager);
  await assert.rejects(manager.handle("decision", "conv_one", confirm(draft)));
  const restored = await manager.handle("status", "conv_one", {});
  assert.equal(restored.draft.state, "submitted"); assert.equal(fake.writes, 1);
  assert.equal(fake.calls.filter(call => call.operation === "submit").length, 1);
});

test("duplicate JSON keys, prototype fields and excessive nesting are rejected", () => {
  for (const raw of ['{"revision":1,"revision":2}', '{"content":{"summary":"a","summary":"b"}}', '{"revision":1,"revisio\\u006e":2}', '{"x":[[[[[[[[[0]]]]]]]]]}']) assert.throws(() => parseHandoffJson(raw));
  assert.deepEqual(parseHandoffJson('{"content":{"summary":"a: {b}","contact":"x"},"revision":1}'), { content: { summary: "a: {b}", contact: "x" }, revision: 1 });
  assert.equal(handoffContent({ ...content, toString: "bad" }), null);
});

test("malformed host responses cannot forge public success or leak host details", async () => {
  for (const result of [undefined, { ok: true }, { version: 1, ok: true, request_id: "wrong", draft: null }]) {
    const manager = createHandoffManager(config, { invokeHost: async () => result });
    await assert.rejects(manager.handle("status", "conv_one", {}), { code: "handoff_outcome_unknown" });
  }
});

test("a root receipt cannot contradict the confirmed draft snapshot", async () => {
  const fake = createFakeHandoffHost();
  const manager = createHandoffManager(config, { invokeHost: async request => {
    const response = await fake.invoke(request);
    if (request.operation === "submit") response.result = { ...response.result, reference_id: `ext_${"b".repeat(64)}` };
    return response;
  } });
  const draft = await card(manager);
  await assert.rejects(manager.handle("decision", "conv_one", confirm(draft)), { code: "handoff_outcome_unknown" });
  assert.equal(fake.writes, 1);
  assert.equal((await manager.handle("status", "conv_one", {})).draft.state, "submitted");
});

test("public routes require Origin, a signed cookie and matching session selector; tool cannot confirm", async t => {
  const fake = createFakeHandoffHost();
  const origin = "https://creekstonevc.com";
  const server = createGateway({ config: { ...config, allowedOrigins: new Set([origin]), conversationCookieName: "test_session", ticketTtlMs: 60000 }, invokeHandoffHost: fake.invoke });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => server.close());
  const cookie = `test_session=${createConversationCredential("conv_one", secret)}`;
  const sessionKey = createHash("sha256").update("conv_one").digest("hex").slice(0, 24);
  const post = (path, headers, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post("/handoff/prepare", { Cookie: cookie }, { sessionKey, content })).status, 403);
  assert.equal((await post("/handoff/prepare", { Origin: origin }, { sessionKey, content })).status, 409);
  assert.equal((await post("/handoff/prepare", { Origin: origin, Cookie: cookie }, { sessionKey: "forged", content })).status, 409);
  assert.equal((await post("/handoff/tool", { Authorization: "Bearer arbitrary" }, { operation: "decision", identity: { conversation_id: "conv_one" } })).status, 503);
  assert.equal(fake.calls.length, 0);
  const prepared = await post("/handoff/prepare", { Origin: origin, Cookie: cookie }, { sessionKey, content });
  assert.equal(prepared.status, 200);
  assert.equal((await prepared.json()).draft.content.summary, content.summary);
  assert.equal(fake.writes, 0);
});

function fakeChild() { const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.kill = () => { child.killed = true; }; return child; }
test("bridge uses fixed executable, stdin and a minimal env; never a shell or inherited secrets", async () => {
  let captured; const child = fakeChild();
  const invoke = createHandoffHost({ command: "/trusted/host", envFile: "/private/host.env", readEnvironment: () => ({ CREEKSTONE_HANDOFF_LEDGER_PATH: "/var/lib/creekstone-handoff/db" }), spawnImpl: (...args) => { captured = args; return child; } });
  const request = { version: 1, request_id: "request", operation: "status", data: {} };
  const promise = invoke(request);
  child.stdout.write(JSON.stringify({ ok: true, draft: null })); child.emit("close", 0);
  await promise;
  assert.equal(captured[0], "/trusted/host"); assert.deepEqual(captured[1], []); assert.equal(captured[2].shell, false);
  assert.equal(captured[2].env.BOIDS_API_KEY, undefined);
  assert.deepEqual(JSON.parse(child.stdin.read().toString()), request);
});
test("bridge timeout/oversized stdout are uncertain, not false rejection/success", async () => {
  const child = fakeChild();
  const invoke = createHandoffHost({ command: "/trusted/host", timeoutMs: 5, readEnvironment: () => ({}), spawnImpl: () => child });
  await assert.rejects(invoke({}), { code: "handoff_outcome_unknown" }); assert.equal(child.killed, true);
  const large = fakeChild(); const other = createHandoffHost({ command: "/trusted/host", readEnvironment: () => ({}), spawnImpl: () => large });
  const promise = other({}); large.stdout.write(Buffer.alloc(129 * 1024));
  await assert.rejects(promise, { code: "handoff_outcome_unknown" });
});
