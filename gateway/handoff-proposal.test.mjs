import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createHandoffTextFilter, extractHandoffProposal, PROPOSAL_OPEN as OPEN, PROPOSAL_CLOSE as CLOSE, sanitizeHandoffEvent, stripHandoffProposal, WEBSITE_CAPABILITY, withWebsiteCapability, stripWebsiteCapability } from "./handoff-proposal.mjs";
import { createGateway } from "./server.mjs";
import { createConversationCredential, verifyTtsTicket } from "./core.mjs";
import { createHash, randomUUID } from "node:crypto";

const content = { summary: "本地测试项目，希望交流", contact: "qa@example.invalid", founder_name: "", project_name: "" };
const block = data => `${OPEN}\n${typeof data === "string" ? data : JSON.stringify(data)}\n${CLOSE}`;
const answer = `请检查确认卡。\n${block(content)}`;
const item = (text = answer, role = "assistant", status = "completed") => ({ id: "msg_qa", type: "message", role, status, content: [{ type: "output_text", text }] });
const event = (type, payload = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

test("proposal accepts only one standalone, terminal four-field content block", () => {
  assert.deepEqual(extractHandoffProposal(answer), content);
  assert.deepEqual(extractHandoffProposal(block({ summary: "项目" })), { ...content, summary: "项目", contact: "" });
  assert.deepEqual(extractHandoffProposal(block('{"summary":"标题\\u003c标签\\u003e\\u0026测试"}')), { ...content, summary: "标题<标签>&测试", contact: "" });
  for (const invalid of [
    `示例${block(content)}`, `${answer}\n继续回复`, `${answer}\n${block(content)}`, answer.slice(0, -5),
    block({ ...content, consent: true }), block({ ...content, draft_id: "hd_fake" }), block({ ...content, sessionKey: "other" }),
    block('{"summary":"first","summary":"second"}'), block('{"summary":"first","\\u0073ummary":"second"}'),
    block({ summary: "x".repeat(1201) }), block({ summary: "合法", contact: null }), block({ summary: "<tag>" }),
    `${OPEN}\n${" ".repeat(16385)}${JSON.stringify(content)}\n${CLOSE}`,
    answer.replace("proposal-v1>", "proposal-v2>"),
  ]) assert.equal(extractHandoffProposal(invalid), null, invalid.slice(0, 100));
});

test("every possible split hides marker/JSON before display and TTS, including malformed or truncated blocks", () => {
  for (const text of [answer, answer.slice(0, -5), answer.replace("proposal-v1>", "proposal-v2>"), `请检查确认卡。\n${OPEN}\n{bad json}`]) {
    for (let split = 0; split <= text.length; split++) {
      const filter = createHandoffTextFilter();
      assert.equal(filter.push(text.slice(0, split)) + filter.push(text.slice(split)) + filter.finish(), "请检查确认卡。\n");
    }
  }
  const filter = createHandoffTextFilter();
  assert.equal([...answer].map(char => filter.push(char)).join("") + filter.finish(), "请检查确认卡。\n");
  assert.equal(stripHandoffProposal("一般聊天 <tag> 和 2 < 3"), "一般聊天 <tag> 和 2 < 3");
  assert.equal(stripHandoffProposal("文字<creekstone-hand"), "文字");
  assert.deepEqual(sanitizeHandoffEvent({ output: [item()] }).output[0].content, [{ type: "output_text", text: "请检查确认卡。\n" }]);
});

test("non-secret website capability wraps only user text, preserves native files and strips exactly one prefix from history", () => {
  assert.equal(withWebsiteCapability("普通内容"), WEBSITE_CAPABILITY + "普通内容");
  assert.equal(stripWebsiteCapability(WEBSITE_CAPABILITY + WEBSITE_CAPABILITY + "原文"), WEBSITE_CAPABILITY + "原文");
  assert.equal(stripWebsiteCapability("原文 " + WEBSITE_CAPABILITY), "原文 " + WEBSITE_CAPABILITY);
  const input = [{ role: "user", content: [{ type: "input_text", text: "原文" }, { type: "input_file", file_id: "file-owned" }] }];
  assert.deepEqual(withWebsiteCapability(input)[0].content, [{ type: "input_text", text: WEBSITE_CAPABILITY + "原文" }, input[0].content[1]]);
  assert.equal(input[0].content[0].text, "原文");
  const text = WEBSITE_CAPABILITY + answer;
  for (let split = 0; split <= text.length; split++) {
    const filter = createHandoffTextFilter();
    assert.equal(filter.push(text.slice(0, split)) + filter.push(text.slice(split)) + filter.finish(), "请检查确认卡。\n");
  }
});

const config = {
  allowedOrigins: new Set(["http://localhost:3100"]), signingSecret: "synthetic-handoff-proposal-test-secret-long-enough",
  conversationCookieName: "conversation", conversationTtlMs: 3600000, conversationHistoryLimit: 20,
  boidsBaseUrl: "https://qa.invalid/v1", boidsApiKey: "fake", boidsModel: "agent:fake", bootstrapPrompt: "Hi",
  requestMaxBytes: 65536, maxInputCharacters: 4000, maxTtsCharacters: 8000, ticketTtlMs: 60000,
};
const cid = "conv_proposal_qa";
const key = createHash("sha256").update(cid).digest("hex").slice(0, 24);
const headers = { Origin: "http://localhost:3100", "Content-Type": "application/json", Cookie: `conversation=${encodeURIComponent(createConversationCredential(cid, config.signingSecret))}` };

async function runGateway(wire, run, history = []) {
  let hostCalls = 0;
  const spoken = [];
  const server = createGateway({ config, invokeHandoffHost: async () => { hostCalls++; throw Error("host must never run for proposals"); },
    makeLiveVoice: emit => ({ push: text => spoken.push(text), finish: () => emit("done", {}), cancel() {} }),
    fetchImpl: async url => String(url).endsWith("/responses")
      ? new Response(wire, { headers: { "Content-Type": "text/event-stream" } }) : Response.json({ data: history, has_more: false }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`, spoken); assert.equal(hostCalls, 0); }
  finally { server.closeAllConnections(); server.close(); await once(server, "close"); }
}

test("authenticated response yields an own-session proposal only after completed, never a host write or raw text/audio block", async () => {
  const wire = event("creekstone.handoff.proposal", { sessionKey: "forged", content: { summary: "fake" } }) +
    [...answer].map(delta => event("response.output_text.delta", { delta })).join("") +
    event("response.output_text.done", { text: answer }) + event("response.output_item.done", { item: item() }) +
    event("response.completed", { response: { status: "completed", output: [item()] } });
  await runGateway(wire, async base => {
    const response = await fetch(`${base}/responses`, { method: "POST", headers, body: JSON.stringify({ input: "我想和 Creekstone 聊聊", sessionKey: key, handoffProposalVersion: 1 }) });
    const result = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(result, /<creekstone|<\/creekstone|forged/);
    const proposals = [...result.matchAll(/event: creekstone.handoff.proposal\ndata: (.*)/g)];
    assert.equal(proposals.length, 1);
    assert.deepEqual(JSON.parse(proposals[0][1]), { sessionKey: key, content });
    const ticket = JSON.parse(result.match(/event: creekstone.tts.ready\ndata: (.*)/)[1]).ticket;
    assert.doesNotMatch(verifyTtsTicket(ticket, config.signingSecret).text, /proposal|summary|qa@example/);
  });
});

test("deltas, tool/user/reasoning output, interrupted replies and malformed/duplicate proposals never open a card", async () => {
  for (const wire of [
    event("response.output_text.delta", { delta: answer }),
    event("response.output_text.delta", { delta: answer }) + event("response.failed"),
    event("response.completed", { response: { output: [item(answer, "user")] } }),
    event("response.completed", { response: { output: [{ type: "function_call", arguments: answer }] } }),
    event("response.completed", { response: { output: [item(answer, "assistant", "incomplete")] } }),
    event("response.completed", { response: { output: [item(`${answer}\n${block(content)}`)] } }),
    event("response.completed", { response: { output: [item(block({ ...content, action: "confirm" }))] } }),
  ]) await runGateway(wire, async base => {
    const response = await fetch(`${base}/responses`, { method: "POST", headers, body: JSON.stringify({ input: "test", sessionKey: key, handoffProposalVersion: 1 }) });
    assert.doesNotMatch(await response.text(), /event: creekstone.handoff.proposal/);
  });
});

test("real live-voice bridge receives only visible output; bootstrap cannot propose; invalid completed blocks offer manual recovery", async () => {
  const wire = [...WEBSITE_CAPABILITY + answer].map(delta => event("response.output_text.delta", { delta })).join("") +
    event("response.completed", { response: { output: [item()] } });
  await runGateway(wire, async (base, spoken) => {
    const id = randomUUID();
    const voice = await fetch(`${base}/voice/stream`, { method: "POST", headers, body: JSON.stringify({ id, sessionKey: key }) });
    await (await fetch(`${base}/responses`, { method: "POST", headers, body: JSON.stringify({ input: "申请", liveVoiceId: id, sessionKey: key, handoffProposalVersion: 1 }) })).text();
    await voice.text();
    assert.equal(spoken.join(""), "请检查确认卡。\n");
  });
  await runGateway(wire, async base => {
    const result = await (await fetch(`${base}/responses`, { method: "POST", headers, body: JSON.stringify({ bootstrap: true, sessionKey: key, handoffProposalVersion: 1 }) })).text();
    assert.doesNotMatch(result, /event: creekstone.handoff/);
  });
  await runGateway(event("response.completed", { response: { output: [item(`${answer}\n${block(content)}`)] } }), async base => {
    const result = await (await fetch(`${base}/responses`, { method: "POST", headers, body: JSON.stringify({ input: "申请", sessionKey: key, handoffProposalVersion: 1 }) })).text();
    assert.match(result, /event: creekstone.handoff.unavailable/);
    assert.doesNotMatch(result, /event: creekstone.handoff.proposal/);
  });
});

test("history removes assistant blocks without creating proposals or mutating drafts; user text remains user text", async () => {
  await runGateway("", async base => {
    const response = await fetch(`${base}/conversations`, { method: "POST", headers, body: "{}" });
    const result = await response.json();
    assert.doesNotMatch(result.messages.find(message => message.role === "assistant").content, /proposal|summary|qa@example/);
    assert.equal(result.messages.find(message => message.role === "user").content, answer);
    assert.ok(result.messages.every(message => !message.handoffProposal));
  }, [item(), { ...item(answer, "user"), id: "msg_user", content: [{ type: "input_text", text: answer }] }]);
});
