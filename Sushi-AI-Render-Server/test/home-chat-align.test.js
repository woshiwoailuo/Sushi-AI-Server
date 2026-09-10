'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const chatLib = fs.readFileSync(path.join(__dirname, '../lib/chat-response.js'), 'utf8');

test('homepage chat timeouts and short-reply match workshop #14 values', () => {
  assert.match(home, /model === 'horde' \? 38000 : 20000/);
  assert.match(home, /content\.length < 1/);
  assert.match(home, /}, 30000\);/);
  assert.match(workshop, /}, 20000\);/);
  assert.match(workshop, /}, 38000\);/);
  assert.match(workshop, /}, 30000\);/);
  assert.match(workshop, /文\.length < 1/);
  assert.match(server, /normalizeChatPayload/);
  assert.match(server, /cleaned\.length < 1/);
});

test('homepage and workshop lock chat channel switching to auto race', () => {
  assert.match(home, /id="chatChannel"/);
  assert.match(home, /function selectedChatChannel/);
  assert.match(home, /function raceChat\(question, channel\)/);
  assert.match(home, /if \(channel && channel !== 'auto'\) return askOneChat\(question, channel\);/);
  assert.match(home, /localStorage\.setItem\(chatChannelKey\(\), 'auto'\)/);
  assert.match(home, /function syncChatPicker/);
  assert.match(home, /var CHAT_PICKER/);
  assert.match(home, /id: 'groq'/);
  assert.match(home, /id: 'grok'/);
  assert.match(home, /var models = autoRaceList\(\)/);
  assert.match(home, /function autoRaceList/);
  assert.match(home, /function loadChatReady/);
  assert.match(home, /\/api\/health/);
  assert.match(home, /自动抢答已锁定/);
  assert.match(home, /不再更换通道/);
  const picker = home.slice(home.indexOf('id="chatChannel"'), home.indexOf('</select>', home.indexOf('id="chatChannel"')) + 9);
  assert.match(picker, /disabled/);
  assert.match(picker, /value="auto"/);
  assert.doesNotMatch(picker, /value="horde"/);
  assert.doesNotMatch(picker, /value="glm"/);
  assert.doesNotMatch(picker, /value="openai"/);
  assert.doesNotMatch(picker, /value="groq"/);
  assert.doesNotMatch(picker, /value="grok"/);
  assert.doesNotMatch(picker, /value="gemini"/);
  assert.doesNotMatch(picker, /value="openrouter"/);
  assert.doesNotMatch(picker, /value="deepseek"/);
  assert.match(workshop, /id="AI通道"/);
  assert.match(workshop, /问免费模型\(文本, 本轮通道\)/);
  assert.match(workshop, /if \(指定 === "deepseek"\) return 问花粉/);
  const wsPicker = workshop.slice(workshop.indexOf('id="AI通道"'), workshop.indexOf('</select>', workshop.indexOf('id="AI通道"')) + 9);
  assert.match(wsPicker, /disabled/);
  assert.match(wsPicker, /value="auto"/);
  assert.doesNotMatch(wsPicker, /value="glm"/);
  assert.doesNotMatch(wsPicker, /value="horde"/);
  assert.doesNotMatch(wsPicker, /value="openai"/);
  assert.doesNotMatch(wsPicker, /value="groq"/);
  assert.doesNotMatch(wsPicker, /value="deepseek"/);
  assert.match(workshop, /var 选择通道 = "auto"/);
  assert.match(workshop, /function 规范化对话通道[\s\S]*return "auto"/);
});

test('homepage and server wire Groq + Grok OpenAI-compatible chat', () => {
  assert.match(home, /CHAT_LABELS[\s\S]*groq:\s*'Groq'/);
  assert.match(home, /CHAT_LABELS[\s\S]*grok:\s*'Grok'/);
  assert.match(home, /Groq 未配置/);
  assert.match(home, /Grok 未配置/);
  assert.match(server, /GROQ_API_KEY/);
  assert.match(chatLib, /api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(server, /openai\/gpt-oss-20b/);
  assert.match(server, /model === 'groq'/);
  assert.match(server, /missingChatApiKeyMessage\('groq'\)/);
  assert.match(server, /XAI_API_KEY|GROK_API_KEY/);
  assert.match(chatLib, /api\.x\.ai\/v1\/chat\/completions/);
  assert.match(server, /model === 'grok'/);
  assert.match(server, /missingChatApiKeyMessage\('grok'\)/);
  assert.match(chatLib, /Groq 尚未配置/);
  assert.match(chatLib, /GROQ_API_KEY/);
  assert.match(chatLib, /Grok 尚未配置/);
  assert.match(chatLib, /return 'groq'/);
  assert.match(chatLib, /return 'grok'/);
});

test('free chat providers keep provider-specific errors and Gemini system instructions', () => {
  assert.match(server, /const requestedRaw = String/);
  assert.match(server, /const requested = requestedRaw\.toLowerCase\(\)/);
  assert.match(chatLib, /systemInstruction/);
  assert.match(chatLib, /thinkingConfig: \{ thinkingBudget: 0 \}/);
  assert.match(chatLib, /chatChannelLabel/);
  assert.match(chatLib, /x-goog-api-key/);
});

test('homepage can generate images directly from chat intent', () => {
  assert.match(home, /function wantsImageGen/);
  assert.match(home, /function generateHomeImage/);
  assert.match(home, /style: 'real'/);
  assert.match(home, /item\.image/);
  assert.match(home, /class="chat-img"/);
  assert.match(home, /data-full-url/);
  assert.match(home, /function conversationWantsImage/);
  assert.match(home, /function openHomePreview/);
  assert.match(home, /photorealistic RAW photo/);
  assert.match(home, /not anime, not manga, not cartoon/);
});


test('homepage image path uses workshop Horde API and never opens workshop loader', () => {
  assert.match(home, /function homeImageError/);
  assert.doesNotMatch(home.slice(home.indexOf('async function generateHomeImage'), home.indexOf('async function askOneChat')), /\/api\/chat\/image/);
  assert.match(home, /api\('\/api\/images'/);
  const genFn = home.slice(home.indexOf('async function generateHomeImage'), home.indexOf('async function askOneChat'));
  assert.ok(genFn.length > 200);
  assert.match(genFn, /style: 'real'/);
  assert.match(genFn, /style: 'glm'/);
  assert.match(genFn, /chatReady\.glm/);
  assert.doesNotMatch(genFn, /style: style/);
  assert.doesNotMatch(genFn, /style = 'anime'/);
  assert.doesNotMatch(genFn, /\/api\/workshop\/ticket/);
  assert.doesNotMatch(genFn, /\/workshop\?/);
  assert.doesNotMatch(genFn, /enterGen|openWorkshop|data-tab="gen"/);
  assert.doesNotMatch(genFn, /工坊未能打开|打开工坊超时/);
  assert.match(home, /点一下直接出图/);
  assert.match(home, /input\.value = '画一张：' \+ item\[1\]/);
  assert.match(home, /sendChat\(\)/);
  assert.doesNotMatch(home, /文生图快捷模板（会跳转工坊）/);
  assert.match(server, /app\.post\('\/api\/chat\/image'/);
  assert.match(server, /Homepage chat image: auth cookie\/JWT only/);
});


test('homepage photoreal enrichment strips anime keywords on the default 写实 path', () => {
  assert.match(home, /function hasExplicitArtStyle/);
  assert.match(home, /function photorealHomePrompt/);
  assert.match(home, /二次元\|动漫风格\|动漫\|卡通\|漫画\|插画/);
  assert.match(home, /photorealistic RAW photo/);
  assert.match(home, /not anime, not manga, not cartoon/);
  const fn = home.slice(home.indexOf('function photorealHomePrompt'), home.indexOf('function homeImageError'));
  assert.match(fn, /not anime, not manga, not cartoon/);
  assert.doesNotMatch(fn, /hasExplicitArtStyle\(t\)/);
  const gen = home.slice(home.indexOf('async function generateHomeImage'), home.indexOf('async function askOneChat'));
  assert.doesNotMatch(gen, /styleAware/);
  assert.match(gen, /negativePrompt: negative/);
  assert.match(gen, /style: 'real'/);
  assert.doesNotMatch(gen, /\/api\/chat\/image/);
  assert.doesNotMatch(gen, /style = 'anime'/);
});


test('homepage enterGen uses authenticated /workshop path (no AES unlock race)', () => {
  const enter = home.slice(home.indexOf('async function enterGen'), home.indexOf('setTimeout(async () => {'));
  assert.ok(enter.length > 200);
  assert.match(enter, /正在打开工坊/);
  assert.match(enter, /iframe\.src\s*=\s*['"]\/workshop['"]/);
  assert.match(server, /app\.get\('\/workshop\.html', sendWorkshopLoader\)/);
  assert.match(enter, /sushi_wrap_unlock/);
  assert.match(server, /function readWorkshopPlaintext/);
  assert.match(server, /workshopPlainCache/);
  assert.match(server, /encryptWorkshopHtml/);
  assert.match(server, /String\(ticket\.userId\) !== String\(req\.user\.id\)/);
  assert.match(server, /workshop_tickets/);
  assert.match(server, /readWorkshopPlaintext\(\)/);
});
