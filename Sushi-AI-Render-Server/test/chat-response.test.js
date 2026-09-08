'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contentText, normalizeChatPayload } = require('../lib/chat-response');

test('normalizes JSON and plain-text chat responses', () => {
  assert.equal(contentText([{ type: 'text', text: '好的' }]), '好的');
  assert.equal(normalizeChatPayload('直接回复', 'openai').choices[0].message.content, '直接回复');
  assert.equal(
    normalizeChatPayload(JSON.stringify({ choices: [{ message: { content: '好的' } }] }), 'deepseek')
      .choices[0].message.content,
    '好的'
  );
});

test('accepts provider output_text and rejects empty responses', () => {
  assert.equal(normalizeChatPayload(JSON.stringify({ output_text: '收到' }), 'openai').choices[0].message.content, '收到');
  assert.throws(() => normalizeChatPayload(JSON.stringify({ choices: [{ message: { content: '' } }] }), 'openai'), /空回复/);
});
