'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contentText, collapseRepeatedText, normalizeChatPayload } = require('../lib/chat-response');

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

test('collapseRepeatedText keeps short replies and collapses consecutive repeats', () => {
  assert.equal(collapseRepeatedText('好的'), '好的');
  assert.equal(collapseRepeatedText('嗯。'), '嗯。');
  assert.equal(collapseRepeatedText('你好。你好。你好。'), '你好。');
  assert.equal(
    collapseRepeatedText('今天天气不错。今天天气不错。适合出门走走。'),
    '今天天气不错。适合出门走走。'
  );
  assert.equal(
    collapseRepeatedText('第一段\n\n第一段\n\n第二段'),
    '第一段\n\n第二段'
  );
  assert.equal(
    collapseRepeatedText('Hello there. Hello there. Hello there.'),
    'Hello there.'
  );
  assert.equal(
    normalizeChatPayload(
      JSON.stringify({ choices: [{ message: { content: '收到收到收到。收到收到收到。收到收到收到。' } }] }),
      'openai'
    ).choices[0].message.content,
    '收到收到收到。'
  );
});
