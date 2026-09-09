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
  assert.match(home, /model: 'flux-realism'/);
  assert.match(home, /item\.image \? '<img class="chat-img"/);
  assert.match(home, /photorealistic RAW photo/);
  assert.match(home, /not anime, not manga, not cartoon/);
});


test('homepage image path uses auth API and never opens workshop loader', () => {
  assert.match(home, /function homeImageError/);
  assert.match(home, /\/api\/chat\/image/);
  assert.match(home, /api\('\/api\/images'/);
  // Must not mint workshop HTML tickets or navigate for homepage image intent.
  const genFn = home.slice(home.indexOf('async function generateHomeImage'), home.indexOf('async function askOneChat'));
  assert.ok(genFn.length > 200);
  assert.doesNotMatch(genFn, /\/api\/workshop\/ticket/);
  assert.doesNotMatch(genFn, /\/workshop\?/);
  assert.doesNotMatch(genFn, /enterGen|openWorkshop|data-tab="gen"/);
  assert.doesNotMatch(genFn, /工坊未能打开|打开工坊超时/);
  assert.match(home, /填入对话后发送，首页直出图/);
  assert.match(home, /input\.value = '画一张：' \+ item\[1\]/);
  assert.doesNotMatch(home, /文生图快捷模板（会跳转工坊）/);
  assert.match(server, /app\.post\('\/api\/chat\/image'/);
  assert.match(server, /Homepage chat image: auth cookie\/JWT only/);
});


test('homepage photoreal enrichment honors style-keyword bypass', () => {
  assert.match(home, /function hasExplicitArtStyle/);
  assert.match(home, /function photorealHomePrompt/);
  assert.match(home, /二次元\|动漫\|卡通\|漫画\|插画/);
  assert.match(home, /photorealistic RAW photo/);
  assert.match(home, /not anime, not manga, not cartoon/);
  const fn = home.slice(home.indexOf('function photorealHomePrompt'), home.indexOf('function homeImageError'));
  assert.match(fn, /hasExplicitArtStyle\(t\)/);
  assert.doesNotMatch(fn, /t\.replace\(\/\\b\(anime\|manga\|cartoon\|chibi\)\\b\/gi/);
  const gen = home.slice(home.indexOf('async function generateHomeImage'), home.indexOf('async function askOneChat'));
  assert.match(gen, /styleAware/);
  assert.match(gen, /negativePrompt: negative/);
});


test('homepage enterGen waits long enough for cold-start ticket mint', () => {
  const enter = home.slice(home.indexOf('async function enterGen'), home.indexOf('setTimeout(async () => {'));
  assert.ok(enter.length > 200);
  assert.match(enter, /正在打开工坊/);
  assert.match(enter, /\/api\/workshop\/ticket/);
  assert.match(enter, /60000/);
  assert.doesNotMatch(enter, /,\s*8000\)/);
  assert.match(enter, /打开工坊超时|冷启动/);
  assert.match(server, /function readWorkshopPlaintext/);
  assert.match(server, /workshopPlainCache/);
  assert.match(server, /encryptWorkshopHtml/);
});
