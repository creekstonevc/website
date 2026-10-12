import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createPublicTextFilter, publicAssistantText } from "./public-output.mjs";
import { createGateway } from "./server.mjs";
import { createConversationCredential, createTtsTicket, verifyTtsTicket } from "./core.mjs";
import { messageAttachments } from "./attachments.mjs";
import { PROPOSAL_OPEN, PROPOSAL_CLOSE } from "./handoff-proposal.mjs";

const internalPath = "/workspace/agent/skills/yihao-founder-handoff/SKILL.md";
const xml = `<attachments>\n<file path="${internalPath}" />\n</attachments>`;
const businessXml = '<attachments><file path="/workspace/session/业务分析.pdf" /></attachments>';
const secret = "PRIVATE_SENTINEL";

test("reserved output protocols and paths remain hidden at every possible split, not only at completion", () => {
  for (const hidden of [xml, businessXml, `<file path="${internalPath}" />`, `<file path="${internalPath}">${secret}</file>`, xml.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    `<think>${secret}</think>`, `<thinking x="yes">${secret}</thinking>`, `<reasoning>${secret}</reasoning>`,
    `<analysis><think>${secret}</think></analysis>`, `<ATTACHMENTS>${secret}</ATTACHMENTS>`, internalPath]) {
    const text = `前文 ${hidden} 后文`;
    for (let split = 0; split <= text.length; split++) {
      const filter = createPublicTextFilter();
      const first = filter.push(text.slice(0, split));
      assert.doesNotMatch(first, /PRIVATE|workspace|SKILL|attachments|file path/i);
      assert.equal(first + filter.push(text.slice(split)) + filter.finish(), "前文  后文", `${hidden} at ${split}`);
    }
    const filter = createPublicTextFilter();
    const pieces = [...text].map(char => filter.push(char));
    assert.equal(pieces.join("") + filter.finish(), "前文  后文");
  }
});

test("truncated, nested, or oversized reserved output fails closed without changing normal prose", () => {
  for (const tail of ["<atta", "<attachments>", `<attachments>${secret}`, `<attachments><file path="${internalPath}`, `<think>${secret}`,
    "<attachments " + "x".repeat(9000), "<think>".repeat(33) + secret, "/workspace/agent/private.txt", "sandbox:/workspace/agent/private.txt"]) {
    assert.equal(publicAssistantText("正文 " + tail).trim(), "正文");
  }
  for (const text of ["Here is the answer.", "一般聊天 <tag> 和 2 < 3，A&B", "合同、投资分析.md、training skills都可以讨论。"])
    assert.equal(publicAssistantText(text), text);
  assert.equal(publicAssistantText("文件：`/workspace/session/report.pdf`"), "文件：附件");
});

const config = {
  allowedOrigins: new Set(["http://localhost:3100"]), signingSecret: "synthetic-public-output-secret-at-least-32-characters",
  conversationCookieName: "conversation", conversationTtlMs: 3600000, conversationHistoryLimit: 20,
  boidsBaseUrl: "https://qa.invalid/v1", boidsApiKey: "fake", boidsModel: "agent:fake", bootstrapPrompt: "Hi",
  bytePlusUrl: "https://voice.invalid/tts", bytePlusApiKey: "fake", bytePlusSpeakerId: "fake", bytePlusResourceId: "fake",
  requestMaxBytes: 65536, maxInputCharacters: 4000, maxTtsCharacters: 8000, ticketTtlMs: 60000,
};
const cid = "conv_public_qa";
const key = createHash("sha256").update(cid).digest("hex").slice(0, 24);
const headers = { Origin: "http://localhost:3100", "Content-Type": "application/json", Cookie: `conversation=${encodeURIComponent(createConversationCredential(cid, config.signingSecret))}` };
const item = (text, extra = {}) => ({ id: "msg_qa", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }], ...extra });
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
const forbidden = /PRIVATE_SENTINEL|workspace|SKILL|<attachments|file path|reasoning|thinking|重新生成/;

async function fixture(t, wire = "", history = []) {
  let hostCalls = 0;
  const spoken = [], rendered = [];
  const server = createGateway({ config, invokeHandoffHost: async () => { hostCalls++; throw Error("no writes allowed"); },
    makeLiveVoice: emit => ({ push: text => spoken.push(text), finish: () => emit("done", {}), cancel() {} }),
    fetchImpl: async (rawUrl, options = {}) => {
      const url = String(rawUrl);
      if (url.endsWith("/responses")) return new Response(wire);
      if (url.includes("/items")) return Response.json({ data: history, has_more: false });
      if (url.endsWith("/files/file-internal")) return Response.json({ object: "file", id: "file-internal", filename: "SKILL.md", bytes: 12 });
      if (url.endsWith("/files/file-business")) return Response.json({ object: "file", id: "file-business", filename: "业务分析.pdf", bytes: 12 });
      if (url === config.bytePlusUrl) {
        rendered.push(JSON.parse(options.body).req_params.text);
        return new Response(JSON.stringify({ data: Buffer.from("synthetic audio").toString("base64") }) + "\n");
      }
      throw Error(`Unexpected mock URL: ${url}`);
    } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); server.close(); await once(server, "close"); assert.equal(hostCalls, 0); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { spoken, rendered, post: (path, body = {}) => fetch(base + path, { method: "POST", headers, body: JSON.stringify({ sessionKey: key, ...body }) }) };
}

test("HTTP SSE projects public output only: traces, tools, repeated payloads, inline protocols and their TTS never leak", async t => {
  const raw = `<think>${secret}</think>最终答复 ${xml} 继续沟通。`;
  const privateItem = item(secret, { id: "msg_private", channel: "analysis" });
  const wire = event("response.created", { response: { metadata: secret } }) +
    event("response.reasoning_summary_text.delta", { delta: secret }) +
    event("response.thinking.delta", { delta: secret }) +
    event("response.output_item.added", { output_index: 0, item: privateItem }) +
    event("response.output_text.delta", { item_id: "msg_private", output_index: 0, delta: secret }) +
    event("response.output_item.done", { item: privateItem }) +
    event("response.content_part.added", { item_id: "private_part", content_index: 0, part: { type: "output_text", phase: "analysis" } }) +
    event("response.output_text.delta", { item_id: "private_part", content_index: 0, delta: secret }) +
    event("response.function_call_arguments.done", { arguments: secret }) +
    [...raw].map(delta => event("response.output_text.delta", { output_index: 1, delta, metadata: secret })).join("") +
    event("response.content_part.done", { part: { type: "output_text", text: raw }, private: secret }) +
    event("response.output_item.done", { item: item(raw) }) +
    event("response.completed", { response: { output: [privateItem, { type: "reasoning", summary: secret }, item(raw)], metadata: secret } });
  const f = await fixture(t, wire);
  const id = randomUUID();
  const voice = await f.post("/voice/stream", { id });
  const response = await f.post("/responses", { input: "test", liveVoiceId: id });
  const result = await response.text(); await voice.text();
  assert.equal(response.status, 200); assert.doesNotMatch(result, forbidden);
  assert.equal(f.spoken.join(""), "最终答复  继续沟通。");
  const ticket = JSON.parse(result.match(/event: creekstone.tts.ready\ndata: (.*)/)[1]).ticket;
  assert.equal(verifyTtsTicket(ticket, config.signingSecret).text, "最终答复 继续沟通。");
  assert.match(result, /response.completed/);
});

test("internal exports disappear silently in final and history, mixed business files and review cards survive", async t => {
  const card = { summary: "测试项目", contact: "qa@example.invalid", project_name: "", founder_name: "" };
  const raw = `已生成未保存的确认卡。\n${xml}\n${businessXml}\n${PROPOSAL_OPEN}\n${JSON.stringify(card)}\n${PROPOSAL_CLOSE}`;
  const output = item(raw, { content: [{ type: "output_text", text: raw, annotations: [
    { type: "file_path", file_id: "file-internal" }, { type: "file_path", file_id: "file-business" },
  ] }] });
  const user = item("user supplied " + xml, { id: "msg_user", role: "user", content: [{ type: "input_text", text: "user supplied " + xml }] });
  const f = await fixture(t, event("response.completed", { response: { output: [output] } }), [output, item(secret, { phase: "commentary" }), user]);
  const result = await (await f.post("/responses", { input: "申请", handoffProposalVersion: 1 })).text();
  assert.doesNotMatch(result, forbidden);
  assert.deepEqual(JSON.parse(result.match(/event: creekstone.handoff.proposal\ndata: (.*)/)[1]).content, card);
  const files = JSON.parse(result.match(/event: creekstone.attachments.ready\ndata: (.*)/)[1]);
  assert.equal(files.attachmentWarning, undefined);
  assert.deepEqual(files.attachments.map(file => file.fileId), ["file-business"]);
  const history = await (await f.post("/conversations")).json();
  assert.equal(history.messages[0].content, "user supplied " + xml);
  const reply = history.messages.find(message => message.role === "assistant");
  assert.doesNotMatch(JSON.stringify(reply), forbidden);
  assert.deepEqual(reply.attachments.map(file => file.fileId), ["file-business"]);
  assert.doesNotMatch(verifyTtsTicket(reply.ttsTicket, config.signingSecret).text, forbidden);
  assert.ok(history.messages.every(message => !message.handoffProposal));
});

test("historical signed tickets are sanitized again for both MP3 and live voice replay", async t => {
  const f = await fixture(t);
  const ticket = createTtsTicket(`<think>${secret}</think>安全正文。\n${xml}`, config.signingSecret);
  const response = await f.post("/tts", { ticket });
  assert.equal(response.status, 200); await response.arrayBuffer();
  assert.equal(f.rendered.length, 1); assert.doesNotMatch(f.rendered[0], forbidden); assert.match(f.rendered[0], /安全正文/);
  await (await f.post("/voice/stream", { id: randomUUID(), ticket })).text();
  assert.doesNotMatch(f.spoken.join(""), forbidden); assert.match(f.spoken.join(""), /安全正文/);
});

test("internal-only history has no warning, playable ticket or empty phantom message", async t => {
  const f = await fixture(t, "", [item(xml, { content: [{ type: "output_text", text: xml, annotations: [{ type: "file_path", file_id: "file-internal" }] }] })]);
  const history = await (await f.post("/conversations")).json();
  assert.deepEqual(history.messages, []); assert.equal(history.needsBootstrap, false);
});

test("known private references stay silent even if service disabled or generation incomplete; real business errors remain actionable", async () => {
  const known = item(xml, { content: [{ type: "output_text", text: xml, annotations: [{ type: "file_path", file_id: "file-internal" }] }] });
  const business = item("业务分析", { content: [{ type: "output_text", text: "业务分析", annotations: [{ type: "file_path", file_id: "file-business" }] }] });
  const cfg = { ...config, attachments: { enabled: false } };
  const noLookup = () => assert.fail("known internal files never need metadata");
  assert.equal((await messageAttachments([known], "assistant", cid, cfg, noLookup)).attachmentWarning, undefined);
  assert.equal((await messageAttachments([known], "assistant", cid, cfg, noLookup, false)).attachmentWarning, undefined);
  assert.match((await messageAttachments([business], "assistant", cid, cfg, noLookup)).attachmentWarning, /停用/);
  assert.match((await messageAttachments([business], "assistant", cid, cfg, noLookup, false)).attachmentWarning, /尚未/);
  cfg.attachments.enabled = true;
  assert.match((await messageAttachments([business], "assistant", cid, cfg, async () => null)).attachmentWarning, /同步历史/);
});

test("provider failure still surfaces a safe actionable error, never private detail or successful voice ticket", async t => {
  const f = await fixture(t, event("response.failed", { error: { message: secret } }) +
    event("response.completed", { response: { output: [item("must not become successful after failure")] } }));
  const result = await (await f.post("/responses", { input: "test" })).text();
  assert.match(result, /response.failed/); assert.match(result, /sync history/);
  assert.doesNotMatch(result, forbidden); assert.doesNotMatch(result, /tts.ready|response.completed/);
});
