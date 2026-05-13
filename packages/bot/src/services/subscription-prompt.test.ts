import { strict as assert } from 'node:assert';
import { renderPromptText, buildPromptKeyboard } from './subscription-prompt';

const missing = [
  { username: 'a', title: 'Channel A', inviteUrl: 'https://t.me/a' },
  { username: 'b', title: 'Channel B', inviteUrl: 'https://t.me/b' },
];

// 默认模板
const def = renderPromptText(null, missing);
assert.match(def, /请先订阅以下频道/);
assert.match(def, /Channel A/);
assert.match(def, /@a/);
assert.match(def, /Channel B/);

// 自定义模板带占位
const custom = renderPromptText('Hi! Please join:\n{channels}\nThanks', missing);
assert.match(custom, /^Hi! Please join:/);
assert.match(custom, /Channel A/);
assert.match(custom, /Thanks$/);

// 自定义模板无占位 — 渲染原文(频道仅出现在 keyboard 里)
const noPlaceholder = renderPromptText('Subscribe first.', missing);
assert.equal(noPlaceholder, 'Subscribe first.');

// keyboard 包含频道按钮 + 我已完成按钮
const kb = buildPromptKeyboard(missing, 99, 5);
const rows = (kb as any).inline_keyboard as any[][];
assert.equal(rows.length, 3);  // 2 channels + 1 done
assert.equal(rows[0][0].text, '📢 Channel A');
assert.equal(rows[0][0].url, 'https://t.me/a');
assert.equal(rows[2][0].text, '✅ 我已完成');
assert.equal(rows[2][0].callback_data, 'check_sub:99:5');

console.log('✓ subscription-prompt tests passed');
