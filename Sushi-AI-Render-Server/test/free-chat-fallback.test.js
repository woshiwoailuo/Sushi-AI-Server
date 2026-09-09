'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeChatPayload,
  normalizeChatModel,
  missingChatApiKeyMessage,
  configuredChatChannels,
  autoRaceModels,
  buildGeminiRequest,
  geminiTextFromPayload,
  buildKeyedChatRequest,
  chatChannelLabel,
} = require('../lib/chat-response');

const home = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('Gemini generateContent text skips thought parts and surfaces safety blocks', () => {
  const payload = {
    candidates: [{
      content: {
        parts: [
          { thought: true, text: 'hidden chain' },
          { text: '你好，我是 Gemini。' },
        ],
      },
      finishReason: 'STOP',
    }],
  };
  assert.equal(geminiTextFromPayload(payload), '你好，我是 Gemini。');
  assert.equal(
    normalizeChatPayload(JSON.stringify(payload), 'gemini').choices[0].message.content,
    '你好，我是 Gemini。'
  );
  assert.throws(
    () => geminiTextFromPayload({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
    /安全策略拦截/
  );
  assert.throws(
    () => geminiTextFromPayload({
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
    }),
    /SAFETY/
  );
});

test('buildGeminiRequest uses systemInstruction, merges roles, disables thinking', () => {
  const body = buildGeminiRequest([
    { role: 'system', content: '你是苏轼AI' },
    { role: 'user', content: '第一问' },
    { role: 'user', content: '补充' },
    { role: 'assistant', content: '先答' },
    { role: 'model', content: '再答' },
  ]);
  assert.equal(body.systemInstruction.parts[0].text, '你是苏轼AI');
  assert.equal(body.contents[0].role, 'user');
  assert.match(body.contents[0].parts[0].text, /第一问/);
  assert.match(body.contents[0].parts[0].text, /补充/);
  assert.equal(body.contents[1].role, 'model');
  assert.match(body.contents[1].parts[0].text, /先答/);
  assert.match(body.contents[1].parts[0].text, /再答/);
  assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(body.generationConfig.maxOutputTokens, 1024);
});

test('auto race skips unconfigured keys and never includes grok', () => {
  assert.deepEqual(
    autoRaceModels(configuredChatChannels({})),
    ['horde']
  );
  assert.deepEqual(
    autoRaceModels(configuredChatChannels({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' })),
    ['groq', 'gemini', 'horde']
  );
  assert.deepEqual(
    autoRaceModels(configuredChatChannels({
      GROQ_API_KEY: 'g',
      GEMINI_API_KEY: 'm',
      OPENROUTER_API_KEY: 'o',
      XAI_API_KEY: 'x',
    })),
    ['groq', 'gemini', 'openrouter', 'horde']
  );
  assert.deepEqual(
    autoRaceModels(configuredChatChannels({
      DEEPSEEK_API_KEY: 'd',
      GLM_API_KEY: 'z',
    })),
    ['glm', 'deepseek', 'horde']
  );
  assert.equal(configuredChatChannels({ ZHIPUAI_API_KEY: 'z' }).glm, true);
  assert.equal(configuredChatChannels({ ZAI_API_KEY: 'z' }).glm, true);
  assert.equal(configuredChatChannels({ GROK_API_KEY: 'x' }).grok, true);
  assert.ok(!autoRaceModels(configuredChatChannels({ XAI_API_KEY: 'x' })).includes('grok'));
});

test('buildKeyedChatRequest: Gemini header auth, OpenRouter free router', () => {
  const gemini = buildKeyedChatRequest('gemini', [{ role: 'user', content: 'hi' }], {
    geminiKey: 'secret-gemini',
    geminiModel: 'gemini-2.5-flash-lite',
  });
  assert.match(gemini.endpoint, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-lite:generateContent$/);
  assert.doesNotMatch(gemini.endpoint, /[?&]key=/);
  assert.equal(gemini.headers['x-goog-api-key'], 'secret-gemini');
  assert.equal(gemini.body.contents[0].role, 'user');
  assert.equal(gemini.body.generationConfig.thinkingConfig.thinkingBudget, 0);

  const or = buildKeyedChatRequest('openrouter', [{ role: 'user', content: 'hi' }], {
    openrouterKey: 'sk-or',
  });
  assert.equal(or.endpoint, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(or.body.model, 'openrouter/free');
  assert.equal(or.headers.Authorization, 'Bearer sk-or');

  const glm = buildKeyedChatRequest('glm', [{ role: 'user', content: 'hi' }], {
    glmKey: 'glm-key',
  });
  assert.equal(glm.endpoint, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(glm.body.model, 'glm-4.7-flash');
  assert.equal(glm.headers.Authorization, 'Bearer glm-key');

  const ds = buildKeyedChatRequest('deepseek', [{ role: 'user', content: 'hi' }], {
    deepseekKey: 'sk-ds',
  });
  assert.equal(ds.endpoint, 'https://api.deepseek.com/chat/completions');
  assert.equal(ds.body.model, 'deepseek-v4-flash');
  assert.equal(ds.body.thinking.type, 'disabled');
});

test('homepage and workshop skip unconfigured auto-race lanes', () => {
  assert.match(home, /function autoRaceList/);
  assert.match(home, /function loadChatReady/);
  assert.match(home, /chatReady\.groq/);
  assert.match(home, /var models = autoRaceList\(\)/);
  assert.match(home, /Gemini 未配置：请在 Vercel 环境变量填写 GEMINI_API_KEY/);
  assert.match(home, /OpenRouter 未配置：请在 Vercel 环境变量填写 OPENROUTER_API_KEY/);
  assert.match(home, /value="gemini"/);
  assert.match(home, /value="openrouter"/);
  assert.match(home, /value="deepseek"/);
  assert.match(home, /value="glm"/);
  assert.match(home, /DeepSeek 未配置：请在 Vercel 环境变量填写 DEEPSEEK_API_KEY/);
  assert.match(home, /GLM 未配置：请在 Vercel 环境变量填写 GLM_API_KEY/);
  assert.match(home, /\/api\/health/);
  assert.match(workshop, /var 已配置通道/);
  assert.match(workshop, /function 载入已配置通道/);
  assert.match(workshop, /if \(已配置通道\.groq\) 赛道模型\.push\("groq"\)/);
  assert.match(workshop, /if \(已配置通道\.gemini\) 赛道模型\.push\("gemini"\)/);
  assert.match(workshop, /if \(已配置通道\.openrouter\) 赛道模型\.push\("openrouter"\)/);
  assert.match(workshop, /if \(已配置通道\.glm\) 赛道模型\.push\("glm"\)/);
  assert.match(workshop, /if \(已配置通道\.deepseek\) 赛道模型\.push\("deepseek"\)/);
  assert.doesNotMatch(workshop.slice(workshop.indexOf('var 赛道模型'), workshop.indexOf('赛道.push(问群体模型')), /grok/);
  assert.match(server, /chat: configuredChatChannels\(process\.env\)/);
  assert.match(server, /buildKeyedChatRequest/);
  assert.match(fs.readFileSync(path.join(__dirname, '../lib/chat-response.js'), 'utf8'), /x-goog-api-key/);
  assert.doesNotMatch(server, /generateContent\?key=/);
  assert.equal(normalizeChatModel('google-gemini'), 'gemini');
  assert.equal(normalizeChatModel('open-router'), 'openrouter');
  assert.equal(normalizeChatModel('zhipuai'), 'glm');
  assert.equal(chatChannelLabel('gemini'), 'Gemini');
  assert.equal(chatChannelLabel('glm'), 'GLM');
  assert.match(missingChatApiKeyMessage('gemini'), /GEMINI_API_KEY/);
  assert.match(missingChatApiKeyMessage('glm'), /GLM_API_KEY/);
  assert.match(missingChatApiKeyMessage('deepseek'), /DEEPSEEK_API_KEY/);
});
