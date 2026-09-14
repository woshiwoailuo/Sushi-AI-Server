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
  isLocalEditCore,
  applyLocalEditOutbound,
  preferLocalEditStrength,
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
  assert.match(html, /workshop-generation\.js\?v=1\.1\.63/);
  // 核心描述 must remain source of truth in structure step comments/code
  assert.match(gen, /Never overwrite 角色描述|never overwrite 角色描述|Keep visible/);
});

test('heuristic preserves East Asian and 全身 framing', () => {
  const east = heuristicStructureFromText('一位东亚中国女性全身站立在雨夜街头');
  assert.match(east.fields.appearance, /East Asian/i);
  assert.match(east.fields.pose, /full body|feet in frame/i);
  assert.match(east.fields.camera, /28mm/i);
  assert.match(east.fields.pose, /head and feet both visible|uncropped/i);
  assert.match(east.promptEn, /East Asian/i);
  const msgs = buildStructureMessages('韩国女性全身', { anime: false });
  assert.match(msgs[0].content, /PRESERVE ethnicity|East Asian|NEVER invent blonde/i);
});

test('img2img local-edit detection and keep-rest outbound', () => {
  assert.equal(isLocalEditCore('图中人物抬起左手'), true);
  assert.equal(isLocalEditCore('抬起左手'), true);
  assert.equal(isLocalEditCore('转头微笑'), true);
  assert.equal(isLocalEditCore('change hair color slightly'), true);
  assert.equal(isLocalEditCore('raise left hand'), true);
  assert.equal(isLocalEditCore('turn head'), true);
  assert.equal(isLocalEditCore('一位东亚中国女性全身站立在雨夜街头'), false);
  assert.equal(isLocalEditCore('背景换成宁静雪山与晨雾，人物保持原样'), false);
  assert.equal(isLocalEditCore('左手拿着杯子站在窗边的东亚女性全身'), false);

  const none = applyLocalEditOutbound('raise left hand', '图中人物抬起左手', {});
  assert.equal(none, 'raise left hand');

  const out = applyLocalEditOutbound('raise the left hand', '图中人物抬起左手', { img2img: true });
  assert.match(out, /keep the EXACT same person identity/i);
  assert.match(out, /apply ONLY the stated local change/i);
  assert.match(out, /do NOT redraw, recompose/i);
  assert.match(out, /same clothing|same background|composition/i);
  const again = applyLocalEditOutbound(out, '图中人物抬起左手', { img2img: true });
  assert.equal(again, out);

  const h = heuristicStructureFromText('图中人物抬起左手', { img2img: true });
  assert.match(h.promptEn, /keep the same person identity|same clothing as the reference|ONLY the stated local change/i);
  assert.match(h.fields.pose, /抬起左手|图中人物/);
  const eastFull = heuristicStructureFromText('一位东亚中国女性全身站立在雨夜街头');
  assert.match(eastFull.fields.appearance, /East Asian/i);
  assert.match(eastFull.fields.pose, /full body|feet in frame/i);

  const msgs = buildStructureMessages('图中人物抬起左手', { img2img: true });
  assert.match(msgs[0].content, /LOCAL EDIT|keep identity|same as reference/i);
  assert.match(msgs[1].content, /图中人物抬起左手/);

  assert.equal(preferLocalEditStrength(0.52, '图中人物抬起左手'), 0.22);
  assert.equal(preferLocalEditStrength(0.68, '图中人物抬起左手'), 0.22);
  assert.equal(preferLocalEditStrength(0.52, '图中人物保持身份与构图，只把外套颜色稍微改成深红，并调整站姿让右手自然垂下，其余全部不变不要重画场景'), 0.26);
  assert.equal(preferLocalEditStrength(0.18, '抬手'), 0.18);
});

test('force local-edit outbound even when core is not heuristic local-edit', () => {
  const prompt = applyLocalEditOutbound('a woman in a red dress on a rainy street', '一位穿红裙的女性站在雨夜街头', { img2img: true, force: true });
  assert.match(prompt, /Keep the (?:EXACT )?same person identity/i);
  assert.match(prompt, /red dress|rainy street/i);
  const skipped = applyLocalEditOutbound('a woman in a red dress', '一位穿红裙的女性', { img2img: true });
  assert.doesNotMatch(skipped, /Keep the (?:EXACT )?same person identity/i);
  assert.equal(preferLocalEditStrength(0.45, '一位穿红裙的女性站在雨夜街头，保持参考图人物身份与构图，只微调表情与手势，不要整张重绘场景或换背景'), 0.26);
  assert.equal(preferLocalEditStrength(0.45, '微笑'), 0.22);
});
