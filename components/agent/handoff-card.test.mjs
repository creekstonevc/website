import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as contract from "../../lib/handoff.mjs";
import * as client from "./handoff-client.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./HandoffCard.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const content = { summary: "合成测试：希望交流产品验证方向。", contact: "founder@example.invalid", founder_name: "测试创始人", project_name: "QA 项目" };
const draft = { draft_id: `hd_${"a".repeat(32)}`, revision: 2, state: "awaiting_confirmation", purpose: contract.HANDOFF_PURPOSE,
  expires_at_ms: 2000000000000, confirmation_nonce: "n".repeat(43), content };
const snapshot = { available: true, canSubmit: true, draft };
const submitted = { ...snapshot, draft: { ...draft, state: "submitted", result: { status: "submitted", reference_id: `ext_${"a".repeat(64)}`, notified: false } } };

// Exercise the actual component's DOM and callbacks at deterministic hook states.
// Full edit/save/confirm and reload interactions are also checked in the local browser fixture.
function render(options = {}) {
  const state = [true, 0, snapshot, content, "", "", "", false, false];
  for (const [index, value] of Object.entries(options.state || {})) state[Number(index)] = value;
  let hook = 0;
  const effects = [], changes = [], requests = [];
  const exports = {};
  runInNewContext(compiled, { exports, window: { confirm: () => true }, require: name => {
    if (name === "react") return { ...React,
      useState: () => { const index = hook++; return [state[index], value => changes.push({ index, value })]; },
      useRef: current => ({ current }), useCallback: callback => callback,
      useEffect: effect => effects.push(effect), useLayoutEffect: () => {},
    };
    if (name.endsWith("handoff.mjs")) return contract;
    if (name === "./handoff-client") return { ...client, requestHandoff: async (...args) => { requests.push(args); return options.response || submitted; } };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_, key) => key }) };
    return require(name);
  } });
  const tree = exports.HandoffCard({ sessionKey: "synthetic-session", openRequest: null, chatBusy: false, onOpen() {} });
  const elements = [];
  const walk = element => {
    if (Array.isArray(element)) { element.forEach(walk); return; }
    if (!React.isValidElement(element)) return;
    elements.push(element); walk(element.props.children);
  };
  walk(tree);
  return { html: renderToStaticMarkup(tree), elements, effects, changes, requests };
}
const visibleText = node => Array.isArray(node) ? node.map(visibleText).join("") : React.isValidElement(node)
  ? node.props["aria-hidden"] ? "" : visibleText(node.props.children) : typeof node === "string" ? node : "";
const byText = (view, text) => view.elements.find(element => element.type === "button" && visibleText(element.props.children) === text);

test("unsaved and saved cards preserve the separate save and explicit confirm actions", () => {
  const unsaved = render({ state: { 2: { ...snapshot, draft: null } } });
  assert.match(unsaved.html, /尚未保存/);
  assert.ok(byText(unsaved, "保存草稿，继续确认"));
  assert.equal(byText(unsaved, "确认转交"), undefined);
  const saved = render();
  assert.match(saved.html, /草稿已保存，请核对后确认/);
  assert.equal(byText(saved, "确认转交").props.disabled, false);
  assert.equal(byText(saved, "重新查询"), undefined);
  assert.match(saved.html, /确认后，将以上内容交给 Creekstone 团队审阅/);
  assert.match(saved.html, /<summary><span>数据使用说明<\/span>/);
  assert.doesNotMatch(saved.html, /第 2 版|ext_|尚未发送通知|已同步服务端/);
});

test("dirty edits require another save; pending confirmation cannot be repeated", () => {
  const dirty = render({ state: { 3: { ...content, summary: "修改后的合成摘要" } } });
  assert.match(dirty.html, /修改尚未保存/);
  assert.ok(byText(dirty, "保存草稿，继续确认"));
  assert.equal(byText(dirty, "确认转交"), undefined);
  const pending = render({ state: { 4: "confirm" } });
  assert.match(pending.html, /正在提交申请/);
  assert.ok(byText(pending, "正在转交…").props.disabled);
  assert.equal(byText(pending, "重新查询"), undefined);
});

test("success appears once with optional content review, no receipt or permanent query", () => {
  const success = render({ state: { 2: submitted } });
  assert.equal(success.html.split("申请已提交，等待团队审阅。").length - 1, 1);
  assert.match(success.html, /<details[^>]*><summary><span>查看已提交内容<\/span>/);
  assert.match(success.html, /founder@example.invalid/);
  assert.match(success.html, /aria-label="收起确认卡"/);
  assert.doesNotMatch(success.html, /ext_|第 2 版|尚未发送通知|提交标识|会话编号|同步|重新查询|数据使用说明/);
  assert.equal(byText(success, "确认转交"), undefined);
});

test("decorative marks preserve control labels and only verified submission gets completion styling", () => {
  for (const view of [render(), render({ state: { 2: submitted } })]) {
    assert.ok(view.elements.filter(element => element.type === "svg").every(element => element.props["aria-hidden"] === "true"));
    assert.equal(view.elements.filter(element => element.props.role === "status").length, 1);
  }
  assert.doesNotMatch(render().html, /data-complete/);
  assert.match(render({ state: { 2: submitted } }).html, /data-complete="true"/);
  assert.doesNotMatch(render({ state: { 2: submitted, 7: true } }).html, /data-complete/);
});

test("unknown result keeps actionable error; re-query calls only status, never decision", async () => {
  const unknown = render({ state: { 7: true, 5: client.handoffErrorText(new Error()) } });
  assert.match(unknown.html, /结果暂时无法确认/);
  assert.ok(byText(unknown, "确认转交").props.disabled);
  byText(unknown, "重新查询").props.onClick();
  await setImmediate();
  assert.deepEqual(unknown.requests.map(args => args[0]), ["status"]);
  assert.ok(unknown.changes.some(change => change.index === 2 && change.value === submitted));
  assert.ok(unknown.changes.some(change => change.index === 7 && change.value === false));
});

test("reload restores submitted content with one read-only status request", async () => {
  const reload = render({ state: { 2: null, 3: { ...contract.EMPTY_HANDOFF } } });
  reload.effects[2](); // automatic restoration when chat is not busy
  await setImmediate();
  assert.deepEqual(reload.requests.map(args => args[0]), ["status"]);
  assert.ok(reload.changes.some(change => change.index === 2 && change.value === submitted));
  assert.ok(reload.changes.some(change => change.index === 3 && change.value === submitted.draft.content));
});

test("recovery controls remain for interrupted processing, but not normal saved/deferred/success states", () => {
  for (const state of ["confirmed", "submitting", "failed", "reconcile_required"]) {
    const view = render({ state: { 2: { ...snapshot, draft: { ...draft, state } } } });
    assert.ok(byText(view, "重新查询"), state);
  }
  for (const state of ["awaiting_confirmation", "declined", "expired"]) {
    assert.equal(client.handoffPresentation({ ...snapshot, draft: { ...draft, state } }, false, false, "", false).showQuery, false);
  }
  const unavailable = render({ state: { 2: { ...snapshot, available: false, canSubmit: false, draft: null } } });
  assert.match(unavailable.html, /内容无法保存或提交/);
  assert.ok(byText(unavailable, "保存草稿，继续确认").props.disabled);
  const lostRead = render({ state: { 2: submitted, 7: true, 5: "申请记录暂时无法读取。" } });
  assert.match(lostRead.html, /申请记录暂时无法读取/);
  assert.ok(byText(lostRead, "重新查询"));
});
