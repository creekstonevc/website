import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const sheet = postcss.parse(readFileSync(new URL('./AgentChat.module.css', import.meta.url), 'utf8'));
const declarations = selector => {
  const values = new Map();
  sheet.walkRules(selector, rule => {
    if (rule.parent.type !== 'root') return;
    rule.walkDecls(declaration => values.set(declaration.prop, declaration.value));
  });
  return values;
};

// Structural guard, not a substitute for WebKit rendering: reproduce in Safari
// with a long *unselected* saved-conversation option and a narrow video/voice
// sidebar. Header, transcript and composer must fit the sidebar's clientWidth.
test('chat grid does not derive its minimum column width from native select options', () => {
  assert.equal(declarations('.console').get('grid-template-columns'), 'minmax(0, 1fr)');
});

test('all content-bearing chat rows can shrink below their intrinsic content width', () => {
  for (const selector of ['.consoleHeader', '.transcriptPane', '.composer']) {
    assert.equal(declarations(selector).get('min-width'), '0', selector);
  }
});
