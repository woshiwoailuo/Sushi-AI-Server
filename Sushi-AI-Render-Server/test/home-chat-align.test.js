'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const chatLib = fs.readFileSync(path.join(__dirname, '../lib/chat-response.js'), 'utf8');

test('homepage no longer ships AI chat or 脑力十题 entry UI', () => {
  assert.doesNotMatch(home, /id="chatChannel"/);
  assert.doesNotMatch(home, /function generateHomeImage/);
  assert.doesNotMatch(home, /function sendChat/);
  assert.doesNotMatch(home, /data-tab="home"/);
  assert.doesNotMatch(home, /data-tab="nls"/);
  assert.doesNotMatch(home, /脑力/);
  assert.doesNotMatch(home, /enterNls/);
  assert.doesNotMatch(home, /\/nls\//);
  assert.match(home, /data-tab="gen"/);
  assert.match(home, /data-tab="me"/);
  assert.match(home, /async function enterGen/);
});

test('workshop chat timeouts and short-reply match server #14 values', () => {
  assert.match(workshop, /}, 20000\);/);
  assert.match(workshop, /}, 38000\);/);
  assert.match(workshop, /}, 30000\);/);
  assert.match(workshop, /文\.length < 1/);
  assert.match(server, /normalizeChatPayload/);
  assert.match(server, /cleaned\.length < 1/);
});

test('workshop offers manual chat channel selection', () => {
  const id = 'AI通道';
  const picker = workshop.slice(workshop.indexOf('id="' + id + '"'), workshop.indexOf('</select>', workshop.indexOf('id="' + id + '"')));
  assert.doesNotMatch(picker, /disabled/);
  for (const channel of ['glm','horde','openai','groq','grok','gemini','openrouter','deepseek']) {
    assert.ok(picker.includes('value="' + channel + '"'));
  }
});

test('server wires Groq + Grok OpenAI-compatible chat for workshop', () => {
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

test('homepage enterGen uses authenticated /workshop path (no AES unlock race)', () => {
  const enter = home.slice(home.indexOf('async function enterGen'), home.indexOf('async function bootSession'));
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

test('NLS routes and assets are removed from entry path', () => {
  assert.doesNotMatch(server, /registerNls/);
  assert.doesNotMatch(server, /migrateNls/);
  assert.doesNotMatch(server, /nls-schema/);
  assert.doesNotMatch(server, /nls-api/);
  assert.doesNotMatch(server, /app\.use\('\/nls'/);
  assert.equal(fs.existsSync(path.join(__dirname, '../public/app/nls/index.html')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../lib/nls-engine.js')), false);
});
