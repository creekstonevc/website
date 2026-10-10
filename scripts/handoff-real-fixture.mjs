// Local UI integration fixture: actual Python ledger, loopback-only synthetic
// Workspace. Never loads project envfiles or accepts a real Workspace URL/key.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoffHost } from "../gateway/handoff-host.mjs";

export async function createRealQaHandoffHost(command) {
  assert.ok(command.startsWith("/"));
  const collection = "founder-handoff/Yihao Agent Founder Intake";
  const index = `${collection}/import-index.json`;
  const records = new Map([[index, { version: 1, records: {} }]]);
  const secret = `wsk_${"a".repeat(43)}`;
  let writes = 0, calls = 0;
  const workspace = createServer(async (request, response) => {
    if (request.url !== "/api/external/workspace" || request.headers.authorization !== `Bearer ${secret}`) return response.writeHead(403).end();
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const op = JSON.parse(Buffer.concat(chunks)); calls++;
    const paths = [`${collection}/records/ext_*.json`];
    let result;
    if (op.command === "status") result = { reachable: true, access: { read: [index, ...paths], create: paths } };
    else if (op.command === "list") result = { folders: [], resources: [], skipped: [], files: [...records.keys()].filter(path => path.includes(op.query)).map(path => ({ path })) };
    else if (op.command === "read" && records.has(op.path)) {
      const bytes = Buffer.from(JSON.stringify(records.get(op.path)));
      result = { path: op.path, size: bytes.length, dataBase64: bytes.toString("base64") };
    } else if (op.command === "write" && op.path.startsWith(`${collection}/records/ext_`)) {
      if (records.has(op.path)) return response.writeHead(409).end();
      records.set(op.path, JSON.parse(op.text)); writes++; result = { path: op.path };
    } else return response.writeHead(400).end();
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, ...result }));
  });
  workspace.listen(0, "127.0.0.1"); await once(workspace, "listening");
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "creekstone-handoff-ui-")));
  const environment = { CREEKSTONE_HANDOFF_WORKSPACE_URL: `http://127.0.0.1:${workspace.address().port}/api/external/workspace`,
    CREEKSTONE_HANDOFF_WORKSPACE_API_KEY: secret, CREEKSTONE_HANDOFF_LEDGER_PATH: join(directory, "ledger.sqlite") };
  return {
    invoke: createHandoffHost({ command, readEnvironment: () => environment }),
    snapshot: () => ({ fixture: "real Python host / loopback fake Workspace", calls, writes, records: [...records.values()].filter(record => !record.records) }),
    close: () => workspace.close(),
  };
}
