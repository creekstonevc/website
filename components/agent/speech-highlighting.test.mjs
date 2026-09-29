import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightedLiveVoice } from "../../gateway/live-voice.mjs";
import { prepareSpeechText } from "../../gateway/core.mjs";
import { splitSpeechGroups, normalizeSpeechText, speechHighlightPlugin, alignSpeechGroups, speechGroupAt, alignSpeechSegments, speechSegmentAt } from "./speech-highlighting.ts";

test("short Chinese sentences accumulate to 24 characters; final tail and streamed groups stay stable", () => {
  const text = "你好。很高兴认识你！我们先一起聊一聊你现在最关心的创业问题。然后再继续。";
  const groups = splitSpeechGroups(text);
  assert.equal(groups.length, 2);
  assert.equal(text.slice(groups[0].start, groups[0].end), "你好。很高兴认识你！我们先一起聊一聊你现在最关心的创业问题。");
  assert.ok(normalizeSpeechText(text.slice(0, groups[0].end)).length >= 24);
  assert.deepEqual(splitSpeechGroups(text + "还有下一个问题值得我们一起探讨。\n")[0], groups[0]);
  assert.deepEqual(splitSpeechGroups(""), []);
});

test("English spaces are not counted and decimal points are not sentence boundaries", () => {
  const text = "Short. OK! The measured value is 12.5 units. And a final tail.";
  const groups = splitSpeechGroups(text);
  assert.equal(text.slice(0, groups[0].end), "Short. OK! The measured value is 12.5 units.");
  assert.equal(normalizeSpeechText("Ｆｏｕｎｄｅｒ，ＡＩ 123！"), "founderai123");
});

test("highlight wrappers preserve Markdown/GFM and exclude code, links and their labels", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [speechHighlightPlugin] },
    "## 标题\n\n一段**强调文字**，继续讲清楚我们现在需要共同解决的问题。\n\n- 第一个问题。\n- 第二个问题。\n\n[链接](https://example.com) `code()`\n\n```js\nprivate()\n```"));
  assert.match(html, /<strong><span data-speech-group=/);
  assert.match(html, /<li><span data-speech-group=/);
  assert.match(html, /<a href="https:\/\/example.com">链接<\/a>/);
  assert.match(html, /<code>code\(\)<\/code>/);
  assert.match(html, /<pre><code class="language-js">private\(\)/);
  assert.doesNotMatch(html, /<code[^>]*><span/);
});

test("actual timestamps map repeated sentences forward; pauses hold, late cues are never replayed", () => {
  const groups = [{ id: 0, text: "你好。" }, { id: 1, text: "你好。" }, { id: 2, text: "继续吧。" }];
  const cues = alignSpeechGroups(groups, [
    { text: "你好。", startSample: 100, endSample: 1000 },
    { text: "你好。", startSample: 2000, endSample: 3000 },
    { text: "继续吧。", startSample: 5000, endSample: 6000 },
  ]);
  assert.deepEqual(cues.map(cue => cue.group), [0, 1, 2]);
  assert.equal(speechGroupAt(cues, 0), null);
  assert.equal(speechGroupAt(cues, 1500), 0);
  assert.equal(speechGroupAt(cues, 2000), 1);
  assert.equal(speechGroupAt(cues, 5500), 2);
  assert.equal(speechGroupAt(cues, 20000), null);
  assert.deepEqual(alignSpeechGroups(groups, [{ text: "unmatched", startSample: 0, endSample: 10 }]), []);
});

test("known audio batches highlight from their first sample even with no/late subtitles", () => {
  const groups = [{ id: 0, text: '第一组，我们先把问题讲清楚。' }, { id: 1, text: '第二组，再一起讨论问题。' }, { id: 2, text: '最后一句。' }];
  const segments = [
    { text: groups[0].text, startSample: 0, endSample: 120000 },
    { text: groups[1].text, startSample: 120000, endSample: null },
  ];
  const cues = alignSpeechSegments(groups, segments);
  assert.deepEqual(speechSegmentAt(cues, 0), [0]);
  assert.deepEqual(speechSegmentAt(cues, 119999), [0]);
  assert.deepEqual(speechSegmentAt(cues, 120000), [1]);
  assert.deepEqual(speechSegmentAt(cues, 180000), [1]);
  segments[1].endSample = 200000;
  assert.deepEqual(speechSegmentAt(alignSpeechSegments(groups, segments), 200000), []);
  // A mismatched phrase containing words from the final sentence cannot pull
  // the cursor forward to that sentence, as greedy single-word matching did.
  assert.deepEqual(alignSpeechSegments(groups, [{ text: '无法匹配的最后一个问题', startSample: 0, endSample: 100 }]), []);
});

test("batch alignment preserves repeated phrases, Markdown-spanning groups and streamed text arrival", () => {
  const groups = [{ id: 0, text: '你好。' }, { id: 1, text: '你好。' }, { id: 2, text: '继续讨论。' }];
  const segments = [
    { text: '你好。你好。', startSample: 0, endSample: 100 },
    { text: '继续讨论。', startSample: 100, endSample: 200 },
  ];
  assert.deepEqual(speechSegmentAt(alignSpeechSegments(groups, segments), 0), [0, 1]);
  assert.deepEqual(speechSegmentAt(alignSpeechSegments(groups.slice(0, 2), segments), 150), []);
  assert.deepEqual(speechSegmentAt(alignSpeechSegments(groups, segments), 150), [2]);
});

function renderedGroups(text) {
  let tree;
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm],
    rehypePlugins: [speechHighlightPlugin, () => root => { tree = root; }] }, text));
  const byGroup = new Map();
  const walk = node => {
    const id = node.properties?.['data-speech-group'];
    if (id !== undefined) byGroup.set(id, (byGroup.get(id) ?? '') + node.children.map(child => child.value ?? '').join(''));
    else node.children?.forEach(walk);
  };
  walk(tree);
  return { html, groups: Array.from(byGroup, ([id, text]) => ({ id, text })) };
}

async function spokenSegments(text, width) {
  const segments = [];
  await new Promise((resolve, reject) => {
    const voice = new HighlightedLiveVoice({}, (event, data) => {
      if (event === 'segment' && data.endSample !== null) segments.push(data);
      if (event === 'done') resolve();
      if (event === 'error') reject(new Error(data.code));
    }, { makeVoice: send => ({ push() {}, finish() { send('audio', { data: 'AAA=' }); send('done', {}); }, cancel() {} }) });
    for (let offset = 0; offset < text.length; offset += width) voice.push(text.slice(offset, offset + width));
    voice.finish();
  });
  return segments;
}

test("screenshot regression: replay batch crosses a paragraph and an unspoken bold heading number", async () => {
  const text = '**2. 主动式 AI / Intent Layer** — 产品不是等用户发命令，而是在正确时机识别意图、提出建议或发起可控行动。触发规则得可解释，权限得可撤回，错误成本得可控。\n\n**3. AI-Native 生产力和开发工具** — 能把模型能力转成可委托的完整交付，在真实生产流程里承担验证与协作。最关键的检验是：如果用户能无成本切换到平台原生功能，你的价值还在不在。';
  const { html, groups } = renderedGroups(text);
  const segments = await spokenSegments(prepareSpeechText(text), 17);
  const crossParagraph = segments.find(segment => segment.text.startsWith('触发规则'));
  assert.ok(crossParagraph.text.includes('AI-Native'));
  assert.ok(!crossParagraph.text.includes('3.'));
  const cues = alignSpeechSegments(groups, segments);
  assert.equal(cues.length, segments.length);
  const active = speechSegmentAt(cues, crossParagraph.startSample);
  assert.ok(active.length);
  const group = groups.find(group => group.id === active[0]);
  assert.match(group.text, /触发规则.*\n3\. AI-Native/s);
  // Its wrappers exist in both paragraphs; the correction must not flatten
  // the Markdown, drop the visual number, or move the group to another line.
  assert.match(html, new RegExp(`<strong><span data-speech-group="${group.id}">3\\. AI-Native`));
});

test("soft/hard line breaks, paragraphs and real lists retain every live/replay speech batch", async () => {
  const cases = [
    '先把这个问题讲清楚。\n**3. 新的方向** — 我们继续一起认真讨论下一步如何进行验证。',
    '先把这个问题讲清楚。  \n**3. 新的方向** — 我们继续一起认真讨论下一步如何进行验证。',
    '先把这个问题讲清楚。\n\n**3. 新的方向** — 我们继续一起认真讨论下一步如何进行验证。',
    '1. 先把这个问题讲清楚。\n2. 我们继续一起认真讨论下一步如何进行验证。',
    '先把**这个问题**讲清楚。\n\n我们继续一起认真讨论下一步如何进行验证。',
  ];
  for (const text of cases) {
    const { groups } = renderedGroups(text);
    for (const input of [text, prepareSpeechText(text)]) {
      for (const width of [1, 19, input.length]) {
        const segments = await spokenSegments(input, width);
        assert.equal(alignSpeechSegments(groups, segments).length, segments.length, `${text} (chunks ${width})`);
      }
    }
  }
});

test("optional enumeration keeps an original-coordinate cursor and cannot skip to a later repeated phrase", () => {
  const groups = [{ id: 0, text: '上一段内容。\n3. 后一段内容。' }, { id: 1, text: '上一段内容。后一段内容。' }];
  const cue = { text: '上一段内容。后一段内容。', startSample: 0, endSample: 10 };
  const cues = alignSpeechSegments(groups, [cue, { ...cue, startSample: 10, endSample: 20 }]);
  assert.deepEqual(cues.map(cue => cue.groups), [[0], [1]]);
  assert.deepEqual(alignSpeechSegments(groups, [{ ...cue, text: groups[0].text }])[0].groups, [0]);
});

test("only line-start enumeration is optional: quantities, years and decimals stay significant", () => {
  const groups = [{ id: 0, text: '我们预计2026年增长了3.5倍。预算是24万元。' }];
  const segment = { startSample: 0, endSample: 100 };
  assert.equal(alignSpeechSegments(groups, [{ ...segment, text: groups[0].text }]).length, 1);
  for (const text of ['我们预计年增长了3.5倍。预算是24万元。', '我们预计2026年增长了5倍。预算是24万元。', '我们预计2026年增长了3.5倍。预算是万元。']) {
    assert.deepEqual(alignSpeechSegments(groups, [{ ...segment, text }]), []);
  }
});
