import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createGateway, loadConfig } from "./server.mjs";
import { createConversationCredential } from "./core.mjs";
import { attachmentDirectory, attachmentNamespace, buildAttachmentInput, createAttachmentBudget,
  replyAttachments, restoreAttachmentInput, verifyAttachmentTicket } from "./attachments.mjs";
import { parseAttachmentReply, formatAttachmentReference, attachmentReferencePath, INPUT_FENCE, OUTPUT_FENCE } from "../lib/agent-attachments.mjs";

const origin = "https://creekstonevc.com";
const root = "founder-handoff/Yihao Agent Founder Intake/attachments";
const block = (files, version = 1) => `${OUTPUT_FENCE}\n${JSON.stringify({ version, files })}\n\`\`\``;
const sse = (type, payload) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const configuration = () => loadConfig({
  GATEWAY_SIGNING_SECRET: "attachment-tests-only-secret-1234567890", BOIDS_API_KEY: "test-boids", BOIDS_BASE_URL: "https://boids.example/v1",
  BYTEPLUS_TTS_API_KEY: "test-tts", BYTEPLUS_TTS_SPEAKER_ID: "test-speaker",
  WORKSPACE_API_URL: "https://workspace.example/api/external/workspace", WORKSPACE_API_KEY: `wsk_${"a".repeat(43)}`,
});
const item = (role, text, id = role) => ({ id, type: "message", role, status: "completed", content: [{ type: role === "user" ? "input_text" : "output_text", text }] });

async function fixture(t, overrides = {}) {
  const config = { ...configuration(), ...overrides };
  const storage = new Map();
  const histories = new Map();
  const calls = [];
  const state = { workspaceFault: null, workspaceBody: null, responseFault: null, payload: null };
  let serial = 0;
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = String(rawUrl);
    if (url === config.attachments.url) {
      const operation = JSON.parse(options.body);
      calls.push(operation);
      assert.equal(options.headers.Authorization, `Bearer ${config.attachments.apiKey}`);
      assert.equal(options.redirect, "error");
      if (state.workspaceFault) return state.workspaceFault(operation, options);
      if (operation.command === "write") {
        const bytes = Buffer.from(operation.dataBase64, "base64");
        storage.set(operation.path, bytes);
        return Response.json({ ok: true, path: operation.path, size: bytes.length, action: "created", ...state.workspaceBody });
      }
      const bytes = storage.get(operation.path);
      if (!bytes) return Response.json({ ok: false, error: "Workspace operation failed" }, { status: 400 });
      return Response.json({ ok: true, path: operation.path, size: bytes.length, dataBase64: bytes.toString("base64"), ...state.workspaceBody });
    }
    if (url.endsWith("/conversations")) {
      const id = `conv_${++serial}`;
      histories.set(id, []);
      return Response.json({ id });
    }
    if (url.includes("/items")) {
      const id = new URL(url).pathname.split("/")[3];
      return Response.json({ data: (histories.get(id) || []).slice().reverse(), has_more: false });
    }
    if (url.endsWith("/responses")) {
      const payload = JSON.parse(options.body);
      state.payload = payload;
      if (state.responseFault) return state.responseFault(payload);
      const match = payload.input.split(`${INPUT_FENCE}\n`)[1];
      let answer = "收到。我会先阅读文件，再进行分析。";
      if (match) {
        const manifest = JSON.parse(match.slice(0, -4));
        // Simulates the external Agent's already-existing Workspace CLI.
        for (const file of manifest.files) assert.ok(storage.has(file.path));
        const path = `${manifest.outputDirectory}/分析 报告.html`;
        storage.set(path, Buffer.from("<html><script>alert('download only')</script>结果</html>"));
        answer = `${formatAttachmentReference(path)} ${answer} 文件已生成，请查收。`;
      }
      histories.get(payload.conversation).push(item("user", payload.input, `user_${serial}`), item("assistant", answer, `answer_${serial}`));
      return new Response(sse("response.output_text.delta", { delta: answer }) + sse("response.completed", { type: "response.completed" }));
    }
    throw new Error("Unexpected mock endpoint");
  };
  const server = createGateway({ config, fetchImpl });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, session, headers = {}) => fetch(`${base}${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(session ? { Cookie: session.cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
  const open = async (session, options = {}) => {
    const response = await post("/conversations", options, session);
    assert.equal(response.status, 200);
    return { ...(await response.json()), cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ") };
  };
  const upload = async (session, name = "创业 计划.pdf", content = "pitch bytes") => {
    const response = await post("/attachments/upload", { sessionKey: session.sessionKey, name, dataBase64: Buffer.from(content).toString("base64") }, session);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).file;
  };
  return { config, storage, histories, calls, state, post, open, upload };
}

test("mock round-trip: upload → signed Responses manifest → CLI output → completed reply → authorized forced download → history", async (t) => {
  const f = await fixture(t);
  const session = await f.open();
  assert.equal(session.attachments.enabled, true);
  const file = await f.upload(session);
  const duplicateName = await f.upload(session);
  assert.notEqual(file.path, duplicateName.path);
  assert.match(file.path, /attachments\/inputs\/[a-f0-9]{64}\/[a-f0-9-]{36}\/创业 计划\.pdf$/);
  const response = await f.post("/responses", { sessionKey: session.sessionKey, input: "请帮我分析", attachments: [file.ticket] }, session);
  assert.equal(response.status, 200);
  const wire = await response.text();
  assert.match(f.state.payload.input, /creekstone-inputs/);
  assert.ok(f.state.payload.input.includes(file.path));
  assert.ok(f.state.payload.input.startsWith(`${formatAttachmentReference(file.path)}\n请帮我分析`));
  assert.equal(f.state.payload.conversation, "conv_1");
  assert.equal(f.state.payload.model, "agent:@qq1006775897-1-org/qq1006775897");
  const metadata = JSON.parse(wire.match(/event: creekstone.attachments.ready\ndata: (.*)/)[1]);
  assert.equal(metadata.attachments.length, 1);
  const produced = metadata.attachments[0];
  const downloaded = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: produced.ticket }, session);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "application/octet-stream");
  assert.match(downloaded.headers.get("content-disposition"), /^attachment;.*filename\*=UTF-8''%/);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
  assert.match(downloaded.headers.get("content-security-policy"), /sandbox/);
  assert.match(await downloaded.text(), /结果/);
  const inputDownload = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: file.ticket }, session);
  assert.equal(await inputDownload.text(), "pitch bytes");
  const history = await f.open(session);
  assert.equal(history.messages[0].content, "请帮我分析");
  assert.equal(history.messages[0].attachments[0].path, file.path);
  assert.equal(history.messages[1].attachments[0].path, produced.path);
  const tts = JSON.parse(Buffer.from(history.messages[1].ttsTicket.split(".")[0], "base64url").toString());
  assert.doesNotMatch(tts.text, /attachments|founder-handoff/);
});

test("attachment-only messages and explicit rejected retries reuse the upload, not another file write", async (t) => {
  const f = await fixture(t); const session = await f.open(); const file = await f.upload(session);
  f.state.responseFault = () => new Response(null, { status: 429 });
  const request = { input: "", attachments: [file.ticket], sessionKey: session.sessionKey };
  assert.equal((await f.post("/responses", request, session)).status, 429);
  f.state.responseFault = null;
  const response = await f.post("/responses", request, session); await response.text();
  assert.equal(restoreAttachmentInput(f.state.payload.input, "conv_1", f.config).content, "请查看附件。");
  assert.equal(f.calls.filter((call) => call.command === "write").length, 1);
});

test("signed cookies, selected session and file signatures are all required; switching back restores access", async (t) => {
  const f = await fixture(t); const a = await f.open(); const file = await f.upload(a); const b = await f.open(a, { reset: true });
  const download = (session, ticket = file.ticket) => f.post("/attachments/download", { sessionKey: session.sessionKey, ticket }, session);
  assert.equal((await download(b)).status, 403);
  assert.equal((await f.post("/responses", { input: "read", attachments: [file.ticket] }, b)).status, 403);
  assert.equal((await download(a, file.ticket + "x")).status, 403);
  assert.equal((await download(a, file.ticket.replace(/^./, "!"))).status, 403);
  assert.equal((await f.post("/attachments/download", { sessionKey: a.sessionKey, ticket: file.ticket }, b)).status, 409);
  assert.equal((await f.post("/attachments/download", { ticket: file.ticket })).status, 409);
  assert.equal((await f.post("/attachments/download", { sessionKey: a.sessionKey, ticket: file.ticket }, { cookie: "creekstone_conversation=forged" })).status, 409);
  const back = await f.open(b, { sessionKey: a.sessionKey });
  assert.equal((await download(back)).status, 200);
  assert.equal(f.calls.filter((call) => call.command === "read").length, 1);
});

test("download never accepts raw caller paths, and a valid output ticket cannot be used as an input receipt", async (t) => {
  const f = await fixture(t); const session = await f.open();
  const file = replyAttachments(block([{ name: "result.txt", path: `${attachmentDirectory("outputs", "conv_1", f.config)}/result.txt` }]), "conv_1", f.config).attachments[0];
  assert.equal((await f.post("/attachments/download", { sessionKey: session.sessionKey, path: file.path }, session)).status, 400);
  assert.equal((await f.post("/responses", { input: "read", attachments: [file.ticket] }, session)).status, 403);
  assert.equal(f.calls.length, 0);
});

test("namespace ownership rejects cross-session, traversal, percent encoding, prefixes and absolute paths", () => {
  const config = configuration();
  const allowed = attachmentDirectory("outputs", "conv_a", config);
  for (const path of ["/etc/passwd", "../secret", `${allowed}/../secret`, `${allowed}/%2e%2e/secret`, `${allowed}/a//b`,
    `${allowed}/a\\b`, `${allowed}/.hidden`, `${allowed}/a\u0000b`, `${allowed}-other/file`, `${root}/inputs/anything/file`,
    `${attachmentDirectory("outputs", "conv_b", config)}/file`]) {
    const result = replyAttachments(block([{ name: "file.txt", path }]), "conv_a", config);
    assert.equal(result.attachments, undefined, path);
    assert.ok(result.attachmentWarning);
  }
  assert.notEqual(attachmentNamespace("conv_a", config.signingSecret), attachmentNamespace("conv_b", config.signingSecret));
});

test("strict contract rejects malformed, duplicate, unsupported, non-terminal and incomplete blocks", () => {
  const file = { name: "分析 报告.md", path: "outputs/session/分析 报告.md" };
  const good = `完成\n\n${block([file])}`;
  assert.deepEqual(parseAttachmentReply(good, true).files, [file]);
  for (let i = 0; i < good.length; i++) assert.equal(parseAttachmentReply(good.slice(0, i), false).files.length, 0);
  assert.equal(parseAttachmentReply(good, false).files.length, 0);
  for (const bad of [block([file], 2), block([file, file]), block([]), `${block([file])}\nmore text`,
    `${OUTPUT_FENCE}\nnot JSON\n\`\`\``, block([{ ...file, url: "https://attacker.invalid" }]), good.slice(0, -1)]) {
    assert.equal(parseAttachmentReply(bad, true).state, "invalid");
  }
  assert.equal(parseAttachmentReply("普通 Markdown\n```json\n{}\n```", true).state, "none");
});

test("inline references preserve prose on both sides, support Unicode/spaces, and deduplicate files", () => {
  const path = "Yihao Agent Founder Intake/attachments/outputs/session/修改 后的 BP.pdf";
  const reference = `{{attachment://${path}}}`;
  assert.equal(formatAttachmentReference(`founder-handoff/${path}`), reference);
  assert.deepEqual(parseAttachmentReply(`${reference} 改完了，请查收`, true), {
    text: "改完了，请查收", files: [{ name: "修改 后的 BP.pdf", path }], state: "ready",
  });
  assert.equal(parseAttachmentReply(`这是报告。${reference}请查收。`, true).text, "这是报告。请查收。");
  assert.equal(parseAttachmentReply(`这是报告。${reference}`, true).text, "这是报告。");
  assert.equal(parseAttachmentReply(`${reference}\n${reference}`, true).files.length, 1);
  assert.equal(parseAttachmentReply("普通正文 {{variable}}", true).text, "普通正文 {{variable}}");
});

test("every SSE split hides marker fragments and paths, including closed but not completed references", () => {
  const path = "Yihao Agent Founder Intake/attachments/outputs/session/报告.pdf";
  const reference = formatAttachmentReference(path);
  for (let i = 1; i <= reference.length; i++) {
    const result = parseAttachmentReply(`改好了。${reference.slice(0, i)}`, false);
    assert.equal(result.text, "改好了。", `offset ${i}`);
    assert.equal(result.files.length, 0);
    assert.equal(result.state, "pending");
  }
  const tail = parseAttachmentReply(`${reference}正在补充说明。`, false);
  assert.equal(tail.text, "正在补充说明。"); assert.equal(tail.files.length, 0);
});

test("invalid inline references are hidden and never become authorized paths", () => {
  for (const path of ["/etc/passwd", "../secret", "a/%2e%2e/file", "a/../file", "a\\file", "a\nfile", "a/.hidden", "a/{nested}", "a\u202efile"]) {
    const result = parseAttachmentReply(`{{attachment://${path}}}请查收`, true);
    assert.equal(result.state, "invalid", path);
    assert.equal(result.text, "请查收"); assert.deepEqual(result.files, []);
  }
  const unfinished = parseAttachmentReply("改好了 {{attachment://outputs/incomplete.pdf", true);
  assert.equal(unfinished.state, "invalid"); assert.equal(unfinished.text, "改好了");
  assert.equal(parseAttachmentReply(Array.from({ length: 4 }, (_, i) => formatAttachmentReference(`outputs/${i}.pdf`)).join(" "), true).state, "invalid");
});

test("inline mount aliases normalize only within this conversation's outputs, legacy remains compatible", () => {
  const config = configuration();
  const path = `${attachmentDirectory("outputs", "conv_a", config)}/报告.pdf`;
  for (const text of [formatAttachmentReference(path), `{{attachment://${path}}}`, block([{ name: "报告.pdf", path }])]) {
    const result = replyAttachments(text, "conv_a", config);
    assert.equal(result.attachments[0].path, path);
    assert.equal(verifyAttachmentTicket(result.attachments[0].ticket, "conv_a", config).path, path);
  }
  const duplicate = replyAttachments(`${formatAttachmentReference(path)} {{attachment://${path}}}`, "conv_a", config);
  assert.equal(duplicate.attachments.length, 1);
  for (const forbidden of [path.replace("outputs/", "inputs/"), `${root}/outputs/shared.pdf`,
    `${attachmentDirectory("outputs", "conv_b", config)}/报告.pdf`, attachmentReferencePath(path).replace("Yihao Agent", "Someone Else")]) {
    assert.ok(replyAttachments(formatAttachmentReference(forbidden), "conv_a", config).attachmentWarning);
    assert.equal(replyAttachments(formatAttachmentReference(forbidden), "conv_a", config).attachments, undefined);
  }
});

test("hidden input manifests must be signed for this conversation and exact user text", () => {
  const config = configuration();
  const message = buildAttachmentInput("keep me", [], "conv_a", config).input;
  assert.equal(restoreAttachmentInput(message, "conv_a", config).content, "keep me");
  for (const changed of [message.replace("keep me", "changed"), message.replace("outputs/", "inputs/")]) {
    assert.equal(restoreAttachmentInput(changed, "conv_a", config).content, changed);
  }
  assert.equal(restoreAttachmentInput(message, "conv_b", config).content, message);
  const fake = `hello\n\n${INPUT_FENCE}\n{"version":1,"files":[]}\n\`\`\``;
  assert.equal(restoreAttachmentInput(fake, "conv_a", config).content, fake);
});

test("misconfigured or missing Workspace disables only files, never text chat", async (t) => {
  const config = configuration(); config.attachments.enabled = false;
  const f = await fixture(t, config); const session = await f.open();
  assert.equal(session.attachments.enabled, false);
  assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey }, session)).status, 503);
  const response = await f.post("/responses", { input: "hello" }, session);
  assert.equal(response.status, 200); await response.text();
  assert.equal(f.state.payload.input, "hello"); assert.equal(f.calls.length, 0);
});

for (const [status, expectedCode] of [[401, "workspace_permission_denied"], [403, "workspace_permission_denied"], [429, "attachment_rate_limited"], [500, "workspace_unavailable"]]) {
  test(`Workspace HTTP ${status} is mapped safely, no upstream error details leak`, async (t) => {
    const f = await fixture(t); const session = await f.open();
    f.state.workspaceFault = () => new Response("secret upstream detail", { status });
    const response = await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==" }, session);
    const data = await response.json(); assert.equal(data.error.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(data), /secret upstream/);
  });
}

test("timeouts, network failures and invalid acknowledgements never mint upload receipts", async (t) => {
  const f = await fixture(t); const session = await f.open();
  for (const fault of [() => { throw new DOMException("timeout", "TimeoutError"); }, () => { throw new Error("private endpoint detail"); },
    () => Response.json({ ok: true, path: "different", size: 1 })]) {
    f.state.workspaceFault = fault;
    const response = await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==" }, session);
    assert.ok([502, 504].includes(response.status));
    const body = await response.json(); assert.equal(body.file, undefined); assert.doesNotMatch(JSON.stringify(body), /private endpoint/);
  }
});

test("a committed Workspace write with view_error stays successful, with an honest warning", async (t) => {
  const f = await fixture(t); const session = await f.open(); f.state.workspaceBody = { view_error: "refresh later" };
  const response = await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==" }, session);
  const body = await response.json(); assert.equal(response.status, 200); assert.ok(body.file.ticket); assert.match(body.warning, /不代表已解析/);
});

test("invalid names, empty files, noncanonical Base64 and client paths fail before Workspace", async (t) => {
  const f = await fixture(t); const session = await f.open();
  for (const body of [{ name: "../file", dataBase64: "YQ==" }, { name: "a\r\n.txt", dataBase64: "YQ==" },
    { name: "file", dataBase64: "" }, { name: "file", dataBase64: "%%%=" }, { name: "file", dataBase64: "YR==" },
    { name: "file", dataBase64: "YQ==", path: "client-selected" }, { name: "broken\ud800.txt", dataBase64: "YQ==" }]) {
    assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey, ...body }, session)).status, 400);
  }
  for (const body of [null, []]) assert.equal((await f.post("/attachments/upload", body, session)).status, 400);
  assert.equal(f.calls.length, 0);
});

test("file and aggregate limits, duplicate receipts and attachment count are enforced server-side", async (t) => {
  const f = await fixture(t); const session = await f.open();
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64");
  assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "big.bin", dataBase64: oversized }, session)).status, 413);
  const file = await f.upload(session);
  assert.equal((await f.post("/responses", { input: "x", attachments: [file.ticket, file.ticket] }, session)).status, 400);
  assert.equal((await f.post("/responses", { input: "x", attachments: Array(4).fill(file.ticket) }, session)).status, 400);
  const bigFiles = [];
  for (let i = 0; i < 3; i++) bigFiles.push(await f.upload(session, `file-${i}.bin`, Buffer.alloc(4 * 1024 * 1024)));
  assert.equal((await f.post("/responses", { input: "x", attachments: bigFiles.map((item) => item.ticket) }, session)).status, 413);
  assert.equal(f.state.payload, null);
});

test("oversized downloads are bounded before full buffering and missing files fail clearly", async (t) => {
  const f = await fixture(t); const session = await f.open();
  const output = replyAttachments(block([{ name: "result.txt", path: `${attachmentDirectory("outputs", "conv_1", f.config)}/result.txt` }]), "conv_1", f.config).attachments[0];
  let response = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: output.ticket }, session);
  assert.equal(response.status, 404);
  f.state.workspaceFault = () => new Response("too big", { headers: { "Content-Length": "99999999" } });
  response = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: output.ticket }, session);
  assert.equal(response.status, 413);
  let cancelled = false;
  f.state.workspaceFault = () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }));
  response = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: output.ticket }, session);
  assert.equal(response.status, 413); assert.equal(cancelled, true);
});

test("transfer budgets bound concurrent memory, per-session and global attempts", () => {
  let now = 0; const admit = createAttachmentBudget(() => now);
  const a = admit("a", "upload");
  assert.throws(() => admit("a", "download"), /in progress/);
  const b = admit("b", "upload"); assert.throws(() => admit("c", "upload"), /in progress/);
  a(); b();
  for (let i = 1; i < 10; i++) admit("a", "upload")();
  assert.throws(() => admit("a", "upload"), /limit reached/);
  for (let i = 0; i < 109; i++) admit(`other${i}`, "upload")();
  assert.throws(() => admit("last", "upload"), /limit reached/);
  now = 3600000; assert.doesNotThrow(() => admit("a", "upload")());
});

test("no download metadata is issued from an interrupted response or unfinished history item", async (t) => {
  const f = await fixture(t); const session = await f.open();
  const text = block([{ name: "result.txt", path: `${attachmentDirectory("outputs", "conv_1", f.config)}/result.txt` }]);
  f.state.responseFault = () => new Response(sse("response.output_text.delta", { delta: text }) + "data: [DONE]\n\n");
  const response = await f.post("/responses", { input: "make file" }, session);
  assert.doesNotMatch(await response.text(), /event: creekstone.attachments.ready/);
  f.histories.set("conv_1", [{ ...item("assistant", text), status: "in_progress" }]);
  const restored = await f.open(session);
  assert.equal(restored.messages[0].attachments, undefined); assert.equal(restored.messages[0].complete, false);
});

test("attachment endpoints enforce Origin and HTTP methods; expired credentials do not read Workspace", async (t) => {
  const f = await fixture(t); const session = await f.open();
  assert.equal((await f.post("/attachments/upload", {}, session, { Origin: "https://evil.invalid" })).status, 403);
  const expired = createConversationCredential("conv_1", f.config.signingSecret, { now: 0, ttlMs: 1 });
  assert.equal((await f.post("/attachments/download", {}, { cookie: `creekstone_conversation=${expired}` })).status, 409);
  const expiredFile = replyAttachments(block([{ name: "result.txt", path: `${attachmentDirectory("outputs", "conv_1", f.config)}/result.txt` }]),
    "conv_1", { ...f.config, conversationTtlMs: -1 }).attachments[0];
  const denied = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: expiredFile.ticket }, session);
  assert.equal(denied.status, 410);
  assert.equal(f.calls.length, 0);
  assert.throws(() => verifyAttachmentTicket("not-signed", "conv_1", f.config), /invalid/);
});
