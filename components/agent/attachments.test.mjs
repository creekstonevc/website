import assert from "node:assert/strict";
import test from "node:test";
import { streamReply, uploadAttachment, downloadAttachment, readAttachmentFiles, openConversation, attachmentError } from "./agent-client.ts";
import { attachmentDisplayText, formatFileSize } from "../../lib/agent-attachments.mjs";

const file = { name: "计划 书.pdf", fileId: "file-upload-123", size: 6, ticket: "signed-upload-receipt" };
const output = { name: "结果 报告.html", fileId: "file-out-123", ticket: "signed-download" };
const event = (type, payload) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
const handlers = { onOutputDelta() {}, onThinkingDelta() {} };

test("uploads UTF-8 and space filenames with binary Base64 and only the session selector", async (t) => {
  const bytes = Uint8Array.of(0, 255, 128, 42, 13, 10);
  let body;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/agent/attachments/upload"); assert.equal(options.credentials, "same-origin");
    body = JSON.parse(options.body); return Response.json({ file });
  });
  const result = await uploadAttachment(new File([bytes], file.name), "session");
  assert.deepEqual(body, { name: file.name, sessionKey: "session", dataBase64: Buffer.from(bytes).toString("base64") });
  assert.deepEqual(result.file, file);
});

test("oversized, empty and unsafe filenames are rejected before network transfer", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", () => assert.fail("must not upload"));
  for (const bad of [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"), new File([], "empty.pdf"), new File(["a"], "../file.pdf")]) {
    await assert.rejects(uploadAttachment(bad, "session"));
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("a cancelled file selection cannot upload to a newly selected conversation", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", () => assert.fail("must not upload"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(uploadAttachment(new File(["a"], "file.txt"), "old-session", controller.signal), { name: "AbortError" });
  assert.equal(mock.mock.callCount(), 0);
});

test("Responses only submits signed receipts, never client paths or filenames as authority", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    body = JSON.parse(options.body);
    return new Response(event("response.output_text.delta", { delta: "Ready" }) + event("response.completed", {}));
  });
  await streamReply("read", handlers, { sessionKey: "s", attachments: [file] });
  assert.deepEqual(body, { input: "read", sessionKey: "s", attachments: [file.ticket] });
});

test("output attachments appear only on terminal success, never from partial SSE", async (t) => {
  const answer = "完成";
  let wire = event("response.output_text.delta", { delta: answer }) + event("creekstone.attachments.ready", { attachments: [output] });
  t.mock.method(globalThis, "fetch", async () => new Response(wire));
  await assert.rejects(streamReply("read", handlers), (error) => error.code === "stream_interrupted");
  wire += event("response.completed", {});
  const result = await streamReply("read", handlers);
  assert.deepEqual(result.attachments, [output]);
  assert.equal(result.text, "完成");
});

test("history uses the same attachment representation and preserves incompletion and warnings", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ sessionKey: "s", sessions: [], attachments: { enabled: true }, messages: [
    { role: "user", content: "请查看附件。", attachments: [file] },
    { role: "assistant", content: "incomplete", complete: false, attachmentWarning: "not ready" },
    { role: "assistant", content: "done", complete: true, attachments: [output] },
  ] }));
  const result = await openConversation();
  assert.deepEqual(result.messages[0].attachments, [file]);
  assert.equal(result.messages[1].complete, false);
  assert.equal(result.messages[1].attachmentWarning, "not ready");
  assert.deepEqual(result.messages[2].attachments, [output]);
  assert.equal(result.attachments.enabled, true);
});

test("native sandbox filenames are presented as attachments, not raw download paths", async (t) => {
  const answer = "文件已生成：`/workspace/session/结果 报告.html`";
  const chunks = Array.from(answer);
  let text = "";
  t.mock.method(globalThis, "fetch", async () => new Response(chunks.map((delta) =>
    event("response.output_text.delta", { delta })).join("") +
    event("creekstone.attachments.ready", { attachments: [output] }) + event("response.completed", {})));
  const result = await streamReply("修改一下", { ...handlers, onOutputDelta(delta) {
    text += delta;
    if (text.includes("/workspace/session/")) assert.doesNotMatch(attachmentDisplayText(text, true), /\/workspace\/session\//);
  } });
  assert.deepEqual(result.attachments, [output]);
  assert.equal(attachmentDisplayText(result.text, true), "文件已生成：附件");
  t.mock.method(globalThis, "fetch", async () => Response.json({ sessionKey: "s", messages: [
    { role: "assistant", content: answer, complete: true, attachments: [output] },
  ] }));
  const restored = await openConversation();
  assert.equal(attachmentDisplayText(restored.messages[0].content, true), "文件已生成：附件");
  assert.deepEqual(restored.messages[0].attachments, [output]);
});

test("downloads are same-origin authenticated POSTs, never exposed provider URLs", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/agent/attachments/download"); assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body), { sessionKey: "s", ticket: output.ticket });
    return new Response("download bytes", { headers: { "Content-Type": "application/octet-stream" } });
  });
  assert.equal(await (await downloadAttachment(output, "s")).text(), "download bytes");
});

test("permission failures have actionable UI copy and malformed metadata is ignored", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "files_permission_denied" } }, { status: 503 }));
  await assert.rejects(downloadAttachment(output, "s"), (error) => /权限不足/.test(attachmentError(error)));
  assert.deepEqual(readAttachmentFiles([{ ...file, fileId: "file-../another-session" }]), []);
  assert.deepEqual(readAttachmentFiles([{ name: "old.pdf", path: "old/inputs/old.pdf", ticket: "retired" }]), []);
  assert.deepEqual(readAttachmentFiles([{ ...file, ticket: undefined }]), []);
  assert.equal(formatFileSize(1024), "1.0 KB"); assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
});

test("file-only Responses and file-only history remain visible without text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(event("creekstone.attachments.ready", { attachments: [output] }) +
    event("response.completed", { response: { output: [] } })));
  const result = await streamReply("give me a file", handlers);
  assert.equal(result.text, ""); assert.deepEqual(result.attachments, [output]);
  t.mock.method(globalThis, "fetch", async () => Response.json({ sessionKey: "s", messages: [
    { role: "user", content: "", attachments: [file] }, { role: "assistant", content: "", attachments: [output] },
    { role: "assistant", content: "", attachmentWarning: "File unavailable" },
  ] }));
  assert.equal((await openConversation()).messages.length, 3);
});

test("an annotation without a gateway-issued ticket cannot create a clickable file", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(event("response.completed", { response: { output: [{
    type: "message", role: "assistant", content: [{ type: "output_text", text: "done", annotations: [{ type: "file_path", file_id: output.fileId }] }],
  }] } })));
  assert.equal((await streamReply("give me a file", handlers)).attachments, undefined);
});
