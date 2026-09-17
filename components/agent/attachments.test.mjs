import assert from "node:assert/strict";
import test from "node:test";
import { streamReply, uploadAttachment, downloadAttachment, readAttachmentFiles, openConversation, attachmentError } from "./agent-client.ts";
import { OUTPUT_FENCE, parseAttachmentReply, formatAttachmentReference, formatFileSize } from "../../lib/agent-attachments.mjs";

const file = { name: "计划 书.pdf", path: "root/inputs/session/id/计划 书.pdf", size: 6, ticket: "signed-upload-receipt" };
const output = { name: "结果 报告.html", path: "root/outputs/session/结果 报告.html", ticket: "signed-download" };
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
  const answer = `完成\n\n${OUTPUT_FENCE}\n${JSON.stringify({ version: 1, files: [{ name: output.name, path: output.path }] })}\n\`\`\``;
  let wire = event("response.output_text.delta", { delta: answer }) + event("creekstone.attachments.ready", { attachments: [output] });
  t.mock.method(globalThis, "fetch", async () => new Response(wire));
  await assert.rejects(streamReply("read", handlers), (error) => error.code === "stream_interrupted");
  assert.equal(parseAttachmentReply(answer, false).files.length, 0);
  wire += event("response.completed", {});
  const result = await streamReply("read", handlers);
  assert.deepEqual(result.attachments, [output]);
  assert.equal(parseAttachmentReply(result.text, true).text, "完成");
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

test("inline paths never appear in rendered text during streaming, completion or history restore", async (t) => {
  const answer = `${formatAttachmentReference(output.path)} 改完了，请查收。`;
  const chunks = Array.from(answer);
  let text = "";
  t.mock.method(globalThis, "fetch", async () => new Response(chunks.map((delta) =>
    event("response.output_text.delta", { delta })).join("") +
    event("creekstone.attachments.ready", { attachments: [output] }) + event("response.completed", {})));
  const result = await streamReply("修改一下", { ...handlers, onOutputDelta(delta) {
    text += delta;
    const displayed = parseAttachmentReply(text, false);
    assert.doesNotMatch(displayed.text, /attachment:|root\/outputs/);
    assert.equal(displayed.files.length, 0);
  } });
  assert.deepEqual(result.attachments, [output]);
  assert.equal(parseAttachmentReply(result.text, true).text, "改完了，请查收。");
  t.mock.method(globalThis, "fetch", async () => Response.json({ sessionKey: "s", messages: [
    { role: "assistant", content: answer, complete: true, attachments: [output] },
  ] }));
  const restored = await openConversation();
  assert.equal(parseAttachmentReply(restored.messages[0].content, restored.messages[0].complete).text, "改完了，请查收。");
  assert.deepEqual(restored.messages[0].attachments, [output]);
});

test("downloads are same-origin authenticated POSTs, not exposed Workspace URLs", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/agent/attachments/download"); assert.equal(options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(options.body), { sessionKey: "s", ticket: output.ticket });
    return new Response("download bytes", { headers: { "Content-Type": "application/octet-stream" } });
  });
  assert.equal(await (await downloadAttachment(output, "s")).text(), "download bytes");
});

test("permission failures have actionable UI copy and malformed metadata is ignored", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "workspace_permission_denied" } }, { status: 503 }));
  await assert.rejects(downloadAttachment(output, "s"), (error) => /权限不足/.test(attachmentError(error)));
  assert.deepEqual(readAttachmentFiles([{ ...file, path: "../another-session" }]), []);
  assert.deepEqual(readAttachmentFiles([{ ...file, ticket: undefined }]), []);
  assert.equal(formatFileSize(1024), "1.0 KB"); assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
});
