'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseStructureJson,
  assembleStructuredPrompt,
  heuristicStructureFromText,
  buildStructureMessages,
} = require('../lib/structure-prompt');

test('parseStructureJson accepts fenced JSON and assembles compact English', () => {
  const fields = parseStructureJson('```json\n{"subject":"fictional adult woman","appearance":"black hair","clothing":"red dress","pose":"standing","scene":"rainy street","camera":"50mm","lighting":"neon","style":"photoreal","extras":"18+"}\n```');
  assert.equal(fields.subject, 'fictional adult woman');
  const prompt = assembleStructuredPrompt(fields);
  assert.match(prompt, /fictional adult woman/);
  assert.match(prompt, /red dress/);
  assert.doesNotMatch(prompt, /```/);
});

test('heuristicStructureFromText prefers photoreal unless anime is requested', () => {
  const real = heuristicStructureFromText('一位虚构的成年女性站在雨夜街头');
  assert.match(real.promptEn, /photorealistic RAW photo/i);
  const anime = heuristicStructureFromText('二次元少女在霓虹巷', { anime: true });
  assert.match(anime.promptEn, /anime illustration/i);
});

test('buildStructureMessages keeps core as source of truth', () => {
  const msgs = buildStructureMessages('核心：红发剑士', { anime: false });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[1].content, /红发剑士/);
});

test('workshop client structures before gen and shows wake copy', () => {
  const gen = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
  assert.match(gen, /async function structurePromptForGen/);
  assert.match(gen, /\/api\/workshop\/structure-prompt/);
  assert.match(gen, /正在唤醒服务/);
  assert.match(gen, /makeThumbnailDataUrl/);
  assert.match(gen, /reportImageFailure/);
  assert.match(html, /历史只持久化缩略图|只缓存缩略图/);
  assert.match(html, /__sushiHistFull/);
  assert.match(html, /workshop-generation\.js\?v=1\.1\.54/);
  // 核心描述 must remain source of truth in structure step comments/code
  assert.match(gen, /Never overwrite 角色描述|never overwrite 角色描述|Keep visible/);
});
