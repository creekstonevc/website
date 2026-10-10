// Run only against a separately installed host runtime and loopback synthetic
// Workspace. Never loads .env, production credentials or production user data.
// node scripts/handoff-host-smoke.mjs /absolute/venv/bin/creekstone-handoff-host
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoffHost } from "../gateway/handoff-host.mjs";
import { createHandoffManager } from "../gateway/handoff.mjs";

const command = process.argv[2];
assert.ok(command?.startsWith("/"), "Pass an absolute local QA host executable");
const collection = "founder-handoff/Yihao Agent Founder Intake";
const index = `${collection}/import-index.json`;
const records = new Map([[index, { version: 1, records: {} }]]);
const secret = `wsk_${"a".repeat(43)}`;
let writes = 0, calls = 0;
const workspace = createServer(async (request, response) => {
  if (request.url !== "/api/external/workspace" || request.headers.authorization !== `Bearer ${secret}`) return response.writeHead(403).end();
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const operation = JSON.parse(Buffer.concat(chunks).toString());
  calls++;
  const writePaths = [`${collection}/records/ext_*.json`];
  let result;
  if (operation.command === "status") result = { reachable: true, access: { read: [index, ...writePaths], create: writePaths } };
  else if (operation.command === "list") result = { folders: [], resources: [], skipped: [], files: [...records.keys()].filter(path => path.includes(operation.query)).map(path => ({ path })) };
  else if (operation.command === "read" && records.has(operation.path)) {
    const bytes = Buffer.from(JSON.stringify(records.get(operation.path)));
    result = { path: operation.path, size: bytes.length, dataBase64: bytes.toString("base64") };
  } else if (operation.command === "write" && operation.path.startsWith(`${collection}/records/ext_`)) {
    assert.equal(records.has(operation.path), false, "Must never overwrite a submitted record");
    records.set(operation.path, JSON.parse(operation.text)); writes++;
    result = { path: operation.path, view_error: "synthetic refresh failure" };
  } else return response.writeHead(400).end();
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, ...result }));
});
workspace.listen(0, "127.0.0.1"); await once(workspace, "listening");
const qaDir = realpathSync(mkdtempSync(join(tmpdir(), "creekstone-handoff-ledger-")));
const environment = { CREEKSTONE_HANDOFF_WORKSPACE_URL: `http://127.0.0.1:${workspace.address().port}/api/external/workspace`,
  CREEKSTONE_HANDOFF_WORKSPACE_API_KEY: secret, CREEKSTONE_HANDOFF_LEDGER_PATH: join(qaDir, "ledger.sqlite") };
const config = { signingSecret: "local-qa-identity-secret-only", handoff: { enabled: true, submitEnabled: true } };
const makeManager = () => createHandoffManager(config, { invokeHost: createHandoffHost({ command, readEnvironment: () => environment }) });
const manager = makeManager();
const fields = { summary: "[本地合成测试] 申请讨论产品。", contact: "qa@example.invalid", founder_name: "测试用户", project_name: "Synthetic only" };
const decision = draft => ({ draft_id: draft.draft_id, revision: draft.revision, confirmation_nonce: draft.confirmation_nonce, action: "confirm" });
try {
  const first = (await manager.handle("prepare", "conv_smoke", { content: fields })).draft;
  const second = (await manager.handle("prepare", "conv_smoke", { draft_id: first.draft_id, revision: first.revision, content: { ...fields, summary: "[本地合成测试] 已修改的摘要。" } })).draft;
  assert.equal(second.revision, 2);
  await assert.rejects(manager.handle("decision", "conv_smoke", decision(first)), { code: "draft_stale" });
  await assert.rejects(manager.handle("decision", "conv_foreign", decision(second)), { code: "draft_not_found" });
  assert.equal(calls, 0, "Unconfirmed operations must perform ZERO Workspace access");
  const results = await Promise.all([manager.handle("decision", "conv_smoke", decision(second)), makeManager().handle("decision", "conv_smoke", decision(second))]);
  assert.equal(writes, 1);
  assert.equal(results[0].draft.result.reference_id, results[1].draft.result.reference_id);
  const beforeRestore = writes;
  const restored = await makeManager().handle("status", "conv_smoke", {});
  assert.equal(restored.draft.state, "submitted"); assert.equal(writes, beforeRestore);
  // Simulate losing a successful submit reply, then restarting the gateway.
  const bridge = createHandoffHost({ command, readEnvironment: () => environment });
  const uncertain = createHandoffManager(config, { invokeHost: async request => { const result = await bridge(request); if (request.operation === "submit") throw new Error("synthetic lost response"); return result; } });
  const third = (await uncertain.handle("prepare", "conv_lost", { content: fields })).draft;
  await assert.rejects(uncertain.handle("decision", "conv_lost", decision(third)));
  assert.equal((await makeManager().handle("status", "conv_lost", {})).draft.state, "submitted");
  assert.equal(writes, 2, "A single write for each of two synthetic conversations");
  console.log(JSON.stringify({ ok: true, runtime: "actual Python bridge", workspace: "loopback fake only", zeroUnconfirmedAccess: true,
    staleCardRejected: true, foreignSessionRejected: true, concurrentDuplicateWrites: 0, lostResponseRecovered: true, syntheticRecords: writes }));
} finally { workspace.close(); }
