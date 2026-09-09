'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

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

test('homepage chat channel picker honors explicit selection and auto race', () => {
  assert.match(home, /id="chatChannel"/);
  assert.match(home, /function selectedChatChannel/);
  assert.match(home, /function raceChat\(question, channel\)/);
  assert.match(home, /if \(channel && channel !== 'auto'\) return askOneChat\(question, channel\);/);
  assert.match(home, /localStorage\.setItem\(chatChannelKey\(\), v\)/);
  assert.match(workshop, /id="AI通道"/);
  assert.match(workshop, /问免费模型\(文本, 本轮通道\)/);
  assert.match(workshop, /if \(指定 === "deepseek"\) return 问花粉/);
});

test('homepage can generate images directly from chat intent', () => {
  assert.match(home, /function wantsImageGen/);
  assert.match(home, /function generateHomeImage/);
  assert.match(home, /model=flux-realism/);
  assert.match(home, /item\.image \? '<img class="chat-img"/);
  assert.match(home, /photorealistic RAW photo/);
  assert.match(home, /not anime, not manga, not cartoon/);
});
