import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createGateway, loadConfig } from "./server.mjs";
import { createConversationCredential, normalizeConversationHistory, verifyTtsTicket } from "./core.mjs";
import { attachmentConfig, buildAttachmentInput, createAttachmentBudget, createFileMetadataLookup,
  nativeAttachmentReferences, messageAttachments, verifyAttachmentTicket } from "./attachments.mjs";
import { attachmentDisplayText, isFileId, hasRetiredAttachment } from "../lib/agent-attachments.mjs";

const origin = "https://creekstonevc.com";
const sse = (type, payload) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const configuration = () => loadConfig({
  GATEWAY_SIGNING_SECRET: "attachment-tests-only-secret-1234567890", BOIDS_API_KEY: "test-boids", BOIDS_BASE_URL: "https://boids.example/v1",
  BYTEPLUS_TTS_API_KEY: "test-tts", BYTEPLUS_TTS_SPEAKER_ID: "test-speaker",
});
const outputId = "file-out-97d83c8927ae4d02b66328fb085244a4-c68c449819f44930b9f840b64d7559b1";
const outputName = "笑话.txt";
const outputText = "文件已生成：`/workspace/session/笑话.txt`";
const message = (role, text, id = role) => ({ id, type: "message", role, status: "completed", content: [{ type: role === "user" ? "input_text" : "output_text", text }] });
const outputItem = (text = outputText) => ({ ...message("assistant", text, "97d83c89-27ae-4d02-b663-28fb085244a4"),
  object: "conversation.item", content: [{ type: "output_text", text, annotations: [{ type: "file_path", file_id: outputId, index: 0 }] }] });
const ready = (wire) => {
  const match = /event: creekstone.attachments.ready\ndata: ([^\n]+)/.exec(wire);
  return match ? JSON.parse(match[1]) : {};
};

async function fixture(t, overrides = {}) {
  const config = { ...configuration(), ...overrides };
  const storage = new Map([[outputId, { name: outputName, bytes: Buffer.from("原生文件内容\0\u00ff") }]]);
  const histories = new Map();
  const calls = [];
  const state = { filesFault: null, uploadOverrides: {}, responseFault: null, payload: null };
  let serial = 0;
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    assert.equal(url.origin, "https://boids.example");
    assert.equal(options.headers.Authorization, "Bearer test-boids");
    if (url.pathname.startsWith("/v1/files")) {
      calls.push({ url: url.pathname, options });
      assert.equal(options.redirect, "error");
      if (state.filesFault) { const result = await state.filesFault(url, options); if (result) return result; }
      if (url.pathname === "/v1/files" && options.method === "POST") {
        assert.ok(options.body instanceof FormData);
        assert.equal(options.body.get("purpose"), "user_data");
        assert.equal(options.headers["Content-Type"], undefined, "fetch must generate the multipart boundary");
        const upload = options.body.get("file");
        const fileId = `file-upload-${++serial}`;
        const bytes = Buffer.from(await upload.arrayBuffer());
        storage.set(fileId, { name: upload.name, bytes });
        return Response.json({ id: fileId, object: "file", filename: upload.name, bytes: bytes.length, purpose: "user_data", status: "processed", ...state.uploadOverrides });
      }
      const fileId = url.pathname.split("/")[3];
      const data = storage.get(fileId);
      if (!data) return new Response(null, { status: 404 });
      if (url.pathname.endsWith("/content")) return new Response(data.bytes, { headers: { "Content-Type": "text/html" } });
      return Response.json({ id: fileId, object: "file", filename: data.name, bytes: data.bytes.length });
    }
    if (url.pathname.endsWith("/conversations")) {
      const id = `conv_${++serial}`; histories.set(id, []); return Response.json({ id });
    }
    if (url.pathname.endsWith("/items")) {
      const id = url.pathname.split("/")[3];
      return Response.json({ data: (histories.get(id) || []).slice().reverse(), has_more: false });
    }
    if (url.pathname.endsWith("/responses")) {
      const payload = JSON.parse(options.body); state.payload = payload;
      if (state.responseFault) return state.responseFault(payload);
      const input = Array.isArray(payload.input) ? { ...payload.input[0], type: "message", id: `user_${++serial}` } : message("user", payload.input);
      histories.get(payload.conversation).push(input, outputItem());
      return new Response(sse("response.output_text.delta", { delta: outputText }) +
        sse("response.completed", { response: { output: [outputItem()] } }));
    }
    throw new Error("Unexpected mock endpoint");
  };
  const server = createGateway({ config, fetchImpl });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, session, headers = {}) => fetch(`${base}${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(session ? { Cookie: session.cookie } : {}), ...headers }, body: JSON.stringify(body),
  });
  const open = async (session, options = {}) => {
    const response = await post("/conversations", options, session);
    assert.equal(response.status, 200);
    return { ...(await response.json()), cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ") };
  };
  const upload = async (session, name = "创业 计划.pdf", content = Buffer.from("pitch bytes")) => {
    const response = await post("/attachments/upload", { sessionKey: session.sessionKey, name, dataBase64: Buffer.from(content).toString("base64") }, session);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).file;
  };
  return { config, storage, histories, calls, state, post, open, upload, base, fetchImpl };
}

test("native round-trip: multipart upload → input_file → annotation → forced binary download → history", async (t) => {
  const f = await fixture(t); const session = await f.open();
  assert.equal(session.attachments.enabled, true);
  const bytes = Buffer.from([0, 255, 128, 42, 13, 10]);
  const file = await f.upload(session, "创业 计划.pdf", bytes);
  assert.deepEqual(f.storage.get(file.fileId).bytes, bytes);
  assert.equal(file.path, undefined);
  const input = { input: "请帮我分析", sessionKey: session.sessionKey, attachments: [file.ticket] };
  const response = await f.post("/responses", input, session);
  const wire = await response.text();
  assert.deepEqual(f.state.payload, { model: f.config.boidsModel, conversation: "conv_1", stream: true,
    input: [{ role: "user", content: [{ type: "input_text", text: input.input }, { type: "input_file", file_id: file.fileId }] }] });
  const output = ready(wire).attachments[0];
  assert.equal(output.fileId, outputId); assert.equal(output.name, outputName);
  const tts = JSON.parse(/event: creekstone.tts.ready\ndata: ([^\n]+)/.exec(wire)[1]);
  assert.doesNotMatch(verifyTtsTicket(tts.ticket, f.config.signingSecret).text, /session|file-out/);
  for (const attachment of [file, output]) {
    const download = await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: attachment.ticket }, session);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.match(download.headers.get("content-disposition"), /attachment;.*filename\*=UTF-8''/);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-security-policy"), /sandbox/);
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), f.storage.get(attachment.fileId).bytes);
  }
  const history = await f.open(session);
  assert.equal(history.messages[0].content, input.input);
  assert.equal(history.messages[0].attachments[0].fileId, file.fileId);
  assert.equal(history.messages[0].attachments[0].name, file.name);
  assert.equal(history.messages[1].content, "文件已生成：附件");
  assert.equal(history.messages[1].attachments[0].fileId, outputId);
  assert.ok(wire.indexOf("creekstone.attachments.ready") < wire.indexOf("event: response.completed"));
});

test("text-only payload remains plain text; attachment-only payload uses the default prompt", async (t) => {
  const f = await fixture(t); const session = await f.open();
  assert.deepEqual(buildAttachmentInput(" Hello ", [], "conv_1", f.config), { visible: "Hello", input: "Hello" });
  const file = await f.upload(session);
  const result = buildAttachmentInput("", [file.ticket], "conv_1", f.config);
  assert.equal(result.input[0].content[0].text, "请查看附件。");
  assert.equal(result.input[0].content[1].file_id, file.fileId);
  const duplicate = await f.upload(session);
  assert.notEqual(duplicate.fileId, file.fileId, "same filenames remain distinct uploads");
});

test("cross-session, tampered, expired, old-version and output upload receipts are rejected before upstream access", async (t) => {
  const f = await fixture(t); const a = await f.open(); const file = await f.upload(a); const b = await f.open();
  const callCount = f.calls.length;
  assert.equal((await f.post("/attachments/download", { sessionKey: b.sessionKey, ticket: file.ticket }, b)).status, 403);
  assert.equal((await f.post("/attachments/download", { sessionKey: a.sessionKey, ticket: `${file.ticket}x` }, a)).status, 403);
  const reSign = (changes) => {
    const data = JSON.parse(Buffer.from(file.ticket.split(".")[0], "base64url"));
    const body = Buffer.from(JSON.stringify({ ...data, ...changes })).toString("base64url");
    const signature = createHmac("sha256", f.config.signingSecret).update(`creekstone.files.v2\0${body}`).digest("base64url");
    return `${body}.${signature}`;
  };
  for (const [ticket, status] of [[reSign({ exp: 1 }), 410], [reSign({ v: 1 }), 403], [reSign({ fileId: "file-../secret" }), 403]]) {
    assert.equal((await f.post("/attachments/download", { sessionKey: a.sessionKey, ticket }, a)).status, status);
  }
  assert.throws(() => buildAttachmentInput("reuse", [reSign({ kind: "outputs" })], "conv_1", f.config), { code: "invalid_attachment" });
  assert.equal(f.calls.length, callCount);
});

test("browser cannot select an arbitrary file ID, upstream URL, purpose or conversation", async (t) => {
  const f = await fixture(t); const session = await f.open();
  for (const extra of [{ file_id: outputId }, { url: "https://attacker.example" }, { purpose: "assistants" }, { conversation: "other" }]) {
    assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==", ...extra }, session)).status, 400);
  }
  assert.equal((await f.post("/attachments/download", { sessionKey: session.sessionKey, file_id: outputId }, session)).status, 400);
  assert.equal((await f.post("/responses", { input: "x", attachments: [outputId] }, session)).status, 403);
  assert.equal(f.calls.length, 0);
});

test("only native assistant file_path annotations authorize outputs; prose and citations do not", async () => {
  const config = configuration(); const lookup = async () => null;
  const invalid = [message("assistant", outputId), message("assistant", "{{attachment://outputs/secret.pdf}}"),
    { ...outputItem(), role: "user" }, { ...outputItem(), content: [{ type: "output_text", text: "x", annotations: [{ type: "url_citation", file_id: outputId }] }] }];
  for (const item of invalid) assert.equal((await messageAttachments([item], "assistant", "conv_a", config, lookup)).attachments, undefined);
  for (const fileId of ["../secret", "file-%2e%2e", "https://example.com", "file-x/content", "file-a?key=x", "file-", "file-" + "x".repeat(241)]) assert.equal(isFileId(fileId), false);
  const files = await messageAttachments([outputItem(), outputItem()], "assistant", "conv_a", config, lookup);
  assert.equal(files.attachments.length, 1); assert.equal(files.attachments[0].name, outputName);
  assert.equal(verifyAttachmentTicket(files.attachments[0].ticket, "conv_a", config).fileId, outputId);
});

test("incomplete responses/history never issue file download or TTS authority", async (t) => {
  const f = await fixture(t); const session = await f.open();
  f.state.responseFault = () => new Response(sse("response.output_item.done", { item: outputItem() }) + sse("response.incomplete", {}));
  const wire = await (await f.post("/responses", { input: "make file" }, session)).text();
  assert.doesNotMatch(wire, /creekstone.attachments.ready|creekstone.tts.ready/);
  f.histories.set("conv_1", [{ ...outputItem(), status: "incomplete" }]);
  const history = await f.open(session);
  assert.equal(history.messages[0].complete, false);
  assert.equal(history.messages[0].attachments, undefined);
  assert.equal(history.messages[0].ttsTicket, undefined);
  assert.ok(history.messages[0].attachmentWarning);
});

for (const mode of ["final", "item", "annotation"]) {
  test(`file-only stream resolves annotations from ${mode} events on terminal completion`, async (t) => {
    const f = await fixture(t); const session = await f.open();
    f.state.responseFault = () => new Response(
      sse("creekstone.attachments.ready", { attachments: [{ fileId: "file-forged", ticket: "forged" }] }) +
      (mode === "item" ? sse("response.output_item.done", { item: outputItem("") }) :
        mode === "annotation" ? sse("response.output_text.annotation.added", { annotation: { type: "file_path", file_id: outputId, index: 0 } }) : "") +
      sse("response.completed", mode === "final" ? { response: { output: [outputItem("")] } } : {}));
    const wire = await (await f.post("/responses", { input: "make file" }, session)).text();
    assert.equal(ready(wire).attachments[0].fileId, outputId);
    assert.doesNotMatch(wire, /file-forged|creekstone.tts.ready/);
  });
}

test("native file-only history is retained and Hi with a file is not mistaken for bootstrap", async (t) => {
  const f = await fixture(t); const session = await f.open(); const upload = await f.upload(session);
  const input = { ...message("user", "Hi"), content: [{ type: "input_text", text: "Hi" }, { type: "input_file", file_id: upload.fileId }] };
  assert.equal(normalizeConversationHistory([input]).length, 1);
  f.histories.set("conv_1", [{ ...input, content: input.content.slice(1) }, outputItem("")]);
  const history = await f.open(session);
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[0].attachments[0].name, upload.name);
  assert.equal(history.messages[1].attachments[0].name, outputName);
  assert.equal(history.needsBootstrap, false);
});

test("metadata failure or mismatched ID does not break chat or authorize a different file", async (t) => {
  const f = await fixture(t); const session = await f.open();
  f.state.filesFault = (url) => !url.pathname.endsWith("/content") ? Response.json({ id: "file-other", object: "file", filename: "secret.txt", bytes: 1 }) : null;
  const wire = await (await f.post("/responses", { input: "make file" }, session)).text();
  const output = ready(wire).attachments[0];
  assert.equal(output.name, outputName); assert.equal(output.fileId, outputId);
  assert.equal((await f.post("/attachments/download", { sessionKey: session.sessionKey, ticket: output.ticket }, session)).status, 200);
});

test("native metadata lookup deduplicates concurrent work and uses a bounded cache", async () => {
  let count = 0;
  const lookup = createFileMetadataLookup(configuration(), async () => {
    count++; return Response.json({ object: "file", id: outputId, filename: outputName, bytes: 2 });
  });
  await Promise.all([lookup(outputId), lookup(outputId)]); await lookup(outputId);
  assert.equal(count, 1);
});

test("generated files without a metadata endpoint use UTF-8 download headers and cancel the body", async () => {
  let cancelled = false; const calls = [];
  const lookup = createFileMetadataLookup(configuration(), async (url) => {
    calls.push(url);
    if (!url.endsWith("/content")) return new Response(null, { status: 404 });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: {
      "Content-Disposition": `attachment; filename="download.txt"; filename*=UTF-8''${encodeURIComponent("官网附件验证结果.txt")}`,
      "Content-Length": "41",
    } });
  });
  assert.deepEqual(await lookup(outputId), { name: "官网附件验证结果.txt", size: 41 });
  assert.equal(cancelled, true); assert.equal(calls.length, 2);
  await lookup(outputId); assert.equal(calls.length, 2, "header metadata is cached");
});

test("header filename fallback rejects unsafe names and does not trust compressed transfer size", async () => {
  for (const name of ["../secret.txt", "bad\nname.txt", "%bad.txt"]) {
    const lookup = createFileMetadataLookup(configuration(), async (url) => url.endsWith("/content") ?
      new Response("", { headers: { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } }) : new Response(null, { status: 404 }));
    assert.equal(await lookup(outputId), null);
  }
  const lookup = createFileMetadataLookup(configuration(), async (url) => url.endsWith("/content") ?
    new Response("", { headers: { "Content-Disposition": 'attachment; filename="result.txt"', "Content-Length": "17", "Content-Encoding": "gzip" } }) : new Response(null, { status: 404 }));
  assert.deepEqual(await lookup(outputId), { name: "result.txt" });
});

test("larger histories retain every filename while metadata concurrency stays at four", async () => {
  let active = 0; let peak = 0;
  const lookup = createFileMetadataLookup(configuration(), async (url) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    const id = new URL(url).pathname.split("/").at(-1);
    return Response.json({ object: "file", id, filename: `${id}.txt`, bytes: 3 });
  });
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => lookup(`file-${i}`)));
  assert.equal(peak, 4);
  assert.deepEqual(results.map((file) => file.name), Array.from({ length: 12 }, (_, i) => `file-${i}.txt`));
});

test("file limits, duplicate receipts and malformed inputs fail before Responses", async (t) => {
  const f = await fixture(t); const session = await f.open(); const file = await f.upload(session);
  for (const receipts of [[file.ticket, file.ticket], [file.ticket, file.ticket, file.ticket, file.ticket], "bad"]) {
    assert.throws(() => buildAttachmentInput("x", receipts, "conv_1", f.config), { code: "invalid_attachments" });
  }
  const large = Array.from({ length: 3 }, (_, i) => {
    const payload = Buffer.from(JSON.stringify({ v: 2, kind: "inputs", cid: "conv_1", name: `${i}.pdf`, fileId: `file-${i}`, size: 4 * 1024 * 1024, exp: Date.now() + 60000 })).toString("base64url");
    return `${payload}.${createHmac("sha256", f.config.signingSecret).update(`creekstone.files.v2\0${payload}`).digest("base64url")}`;
  });
  assert.throws(() => buildAttachmentInput("x", large, "conv_1", f.config), { code: "attachments_too_large" });
  assert.equal(f.state.payload, null);
});

test("disabled Files affect attachments only, with unchanged model and endpoint defaults", async (t) => {
  const config = configuration(); config.attachments = attachmentConfig({ BOIDS_FILES_ENABLED: "false" });
  const f = await fixture(t, config); const session = await f.open();
  assert.equal(session.attachments.enabled, false);
  assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey }, session)).status, 503);
  assert.equal((await f.post("/responses", { input: "Hello" }, session)).status, 200);
  assert.equal(f.state.payload.input, "Hello");
  assert.equal(config.boidsModel, "agent:@qq1006775897-1-org/qq1006775897");
});

for (const [status, expectedCode] of [[401, "files_permission_denied"], [403, "files_permission_denied"], [404, "attachment_unavailable"], [429, "attachment_rate_limited"], [500, "files_unavailable"]]) {
  test(`Files HTTP ${status} has a safe error, without provider secrets`, async (t) => {
    const f = await fixture(t); const session = await f.open();
    f.state.filesFault = () => new Response("secret upstream detail", { status });
    const response = await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==" }, session);
    const body = await response.json(); assert.equal(body.error.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(body), /secret upstream|test-boids/);
  });
}

test("invalid upload acknowledgments, timeouts and non-JSON replies never issue receipts", async (t) => {
  const f = await fixture(t); const session = await f.open();
  const faults = [() => { throw new DOMException("timeout", "TimeoutError"); },
    () => new Response("not JSON"), () => Response.json({ object: "file", id: "file-ok", filename: "wrong.txt", bytes: 1, purpose: "user_data" })];
  for (const fault of faults) {
    f.state.filesFault = fault;
    const response = await f.post("/attachments/upload", { sessionKey: session.sessionKey, name: "a.txt", dataBase64: "YQ==" }, session);
    assert.ok(response.status >= 500); assert.equal((await response.json()).file, undefined);
  }
});

test("unsafe names, empty or noncanonical Base64 and session mismatch never contact Files", async (t) => {
  const f = await fixture(t); const session = await f.open();
  for (const body of [{ name: "../secret", dataBase64: "YQ==" }, { name: "a.txt", dataBase64: "" },
    { name: "a.txt", dataBase64: "YR==" }, { name: "a.txt", dataBase64: "YQ==\n" }, { name: "a\r\nX.txt", dataBase64: "YQ==" }]) {
    assert.equal((await f.post("/attachments/upload", { sessionKey: session.sessionKey, ...body }, session)).status, 400);
  }
  assert.equal((await f.post("/attachments/upload", { sessionKey: "other" }, session)).status, 409);
  assert.equal(f.calls.length, 0);
});

test("downloads are bounded even without Content-Length and reject changed upload sizes", async (t) => {
  const f = await fixture(t); const session = await f.open(); const file = await f.upload(session);
  f.storage.get(file.fileId).bytes = Buffer.from("changed");
  const body = { sessionKey: session.sessionKey, ticket: file.ticket };
  assert.equal((await f.post("/attachments/download", body, session)).status, 502);
  f.state.filesFault = () => new Response("big", { headers: { "Content-Length": "99999999" } });
  assert.equal((await f.post("/attachments/download", body, session)).status, 413);
  let cancelled = false;
  f.state.filesFault = () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }));
  assert.equal((await f.post("/attachments/download", body, session)).status, 413);
  assert.equal(cancelled, true);
});

test("attachment endpoints require signed cookie, Origin and POST", async (t) => {
  const f = await fixture(t); const session = await f.open();
  assert.equal((await f.post("/attachments/upload", {}, undefined)).status, 409);
  assert.equal((await f.post("/attachments/upload", {}, session, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(`${f.base}/attachments/download`)).status, 405);
  const cookie = `${f.config.conversationCookieName}=${createConversationCredential("conv_1", f.config.signingSecret, { now: 1, ttlMs: 1 })}`;
  assert.equal((await f.post("/attachments/download", {}, { cookie })).status, 409);
  assert.equal(f.calls.length, 0);
});

test("transfer budgets cap concurrency, session and global rates without storing file bodies", () => {
  let time = 0; const budget = createAttachmentBudget(() => time);
  const releaseA = budget("a", "upload");
  assert.throws(() => budget("a", "download"), { code: "attachment_busy" });
  const releaseB = budget("b", "upload");
  assert.throws(() => budget("c", "upload"), { code: "attachment_busy" });
  releaseA(); releaseB();
  for (let i = 0; i < 9; i++) budget("a", "upload")();
  assert.throws(() => budget("a", "upload"), { code: "attachment_rate_limited" });
  time = 3600000; budget("a", "upload")();
});

test("retired text protocols are display-only and never produce file IDs or tickets", async () => {
  const text = '{{attachment://old/output/report.pdf}} 改好了\n\n```creekstone-inputs\n{"files":[]}\n```';
  assert.equal(attachmentDisplayText(text), "改好了");
  assert.equal(hasRetiredAttachment('Hello\n```creekstone-inputs\n{"files":[]}\n```'), false);
  const result = await messageAttachments([message("assistant", text)], "assistant", "conv_a", configuration(), () => assert.fail());
  assert.equal(result.attachments, undefined); assert.match(result.attachmentWarning, /重新/);
  assert.deepEqual(nativeAttachmentReferences([outputItem()], "assistant").map((file) => file.fileId), [outputId]);
});
