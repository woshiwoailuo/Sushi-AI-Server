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
  STRUCTURE_SYSTEM,
  CORE_FIDELITY_LEAD,
  applyCoreFidelityLead,
  isLocalEditCore,
  applyLocalEditOutbound,
  preferLocalEditStrength,
  isPoseGestureEdit,
  localEditChangeDirective,
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
  assert.match(html, /workshop-generation\.js\?v=1\.1\.71/);
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
  assert.match(STRUCTURE_SYSTEM, /do NOT invent nudity|unless the core explicitly describes/i);
  assert.match(STRUCTURE_SYSTEM, /FAITHFUL TO CORE|do NOT invent clothing, props/i);
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
  assert.match(out, /CRITICAL EDIT \(must be clearly visible\).*left hand raised/i);
  assert.match(out, /keep the same person identity|same clothing|background/i);
  assert.match(out, /allow pose\/gesture\/limbs to change|stated local change must stay clearly visible|do NOT invent a new person/i);
  assert.match(out, /raise the left hand/i);
  assert.doesNotMatch(out, /camera angle, crop, and framing/i);
  const again = applyLocalEditOutbound(out, '图中人物抬起左手', { img2img: true });
  assert.equal(again, out);

  const h = heuristicStructureFromText('图中人物抬起左手', { img2img: true });
  assert.match(h.promptEn, /left hand raised|CRITICAL EDIT|same clothing as the reference|allow pose\/gesture\/limbs|stated local change must stay clearly visible/i);
  assert.match(h.fields.pose, /left hand raised|抬起左手|CRITICAL EDIT/i);
  const eastFull = heuristicStructureFromText('一位东亚中国女性全身站立在雨夜街头');
  assert.match(eastFull.fields.appearance, /East Asian/i);
  assert.match(eastFull.fields.pose, /full body|feet in frame/i);

  const msgs = buildStructureMessages('图中人物抬起左手', { img2img: true });
  assert.match(msgs[0].content, /LOCAL EDIT|keep identity|same as reference/i);
  assert.match(msgs[1].content, /图中人物抬起左手/);

  assert.equal(isPoseGestureEdit('图中人物抬起左手'), true);
  assert.equal(isPoseGestureEdit('微笑'), false);
  assert.match(localEditChangeDirective('抬起左手'), /left hand raised high|raised left hand clearly visible/i);
  const poseStr = preferLocalEditStrength(0.52, '图中人物抬起左手');
  assert.ok(poseStr >= 0.55 && poseStr <= 0.65, 'pose strength gesture band, got ' + poseStr);
  assert.equal(preferLocalEditStrength(0.68, '图中人物抬起左手'), 0.65);
  assert.equal(preferLocalEditStrength(0.2, '抬起左手'), 0.55);
  const longPose = preferLocalEditStrength(0.52, '图中人物保持身份与构图，只把外套颜色稍微改成深红，并调整站姿让右手自然垂下，其余全部不变不要重画场景');
  assert.ok(longPose >= 0.55 && longPose <= 0.65, 'pose cue in long edit uses gesture band, got ' + longPose);
  assert.equal(preferLocalEditStrength(0.18, '抬手'), 0.55);
  const mild = preferLocalEditStrength(0.52, '微笑');
  assert.ok(mild >= 0.2 && mild <= 0.28, 'mild expression stays low, got ' + mild);
  const hair = preferLocalEditStrength(0.52, 'change hair color slightly');
  assert.ok(hair >= 0.2 && hair <= 0.28, 'hair color stays low, got ' + hair);
});

test('force local-edit outbound even when core is not heuristic local-edit', () => {
  const prompt = applyLocalEditOutbound('a woman in a red dress on a rainy street', '一位穿红裙的女性站在雨夜街头', { img2img: true, force: true });
  assert.match(prompt, /Keep the (?:EXACT )?same person identity/i);
  assert.match(prompt, /red dress|rainy street/i);
  const skipped = applyLocalEditOutbound('a woman in a red dress', '一位穿红裙的女性', { img2img: true });
  assert.doesNotMatch(skipped, /Keep the (?:EXACT )?same person identity/i);
  const mildLong = preferLocalEditStrength(0.45, '一位穿红裙的女性站在雨夜街头，保持参考图人物身份与构图，只微调表情，不要整张重绘场景或换背景');
  assert.ok(mildLong >= 0.2 && mildLong <= 0.28, 'mild long local-edit strength, got ' + mildLong);
  const smile = preferLocalEditStrength(0.45, '微笑');
  assert.ok(smile >= 0.2 && smile <= 0.28, 'smile strength, got ' + smile);
});


test('core fidelity lead and heuristic do not invent clothing', () => {
  assert.match(CORE_FIDELITY_LEAD, /Faithful to core description|do not invent clothing/i);
  assert.match(CORE_FIDELITY_LEAD, /include every explicitly described element|omit none/i);
  assert.match(CORE_FIDELITY_LEAD, /gender-neutral|gender/i);
  const led = applyCoreFidelityLead('a woman in a red dress on a rainy street');
  assert.match(led, /Faithful to core description/i);
  assert.match(led, /red dress|rainy street/i);
  assert.equal(applyCoreFidelityLead(led), led);
  const msgs = buildStructureMessages('穿红毛衣的东亚女性侧身站在图书馆窗边', { anime: false });
  assert.match(msgs[0].content, /FAITHFUL TO CORE|do NOT invent clothing, props/i);
  assert.match(msgs[0].content, /do NOT invent woman|gender-neutral|omit none/i);
  assert.match(msgs[0].content, /adult man|male \/ masculine|男人|男性/i);
  assert.match(msgs[1].content, /translate faithfully|include ALL explicitly described|do not invent gender/i);
  assert.match(msgs[1].content, /adult man|male\/masculine|never woman/i);
  assert.match(msgs[1].content, /红毛衣|图书馆/);
  const h = heuristicStructureFromText('穿红毛衣的东亚女性侧身站在图书馆窗边');
  assert.match(h.promptEn, /Faithful to core description/i);
  assert.match(h.promptEn, /红毛衣|图书馆|East Asian/i);
  assert.equal(h.fields.clothing, '');
  assert.doesNotMatch(h.fields.clothing + h.fields.scene, /bikini|beach|nude/i);
});

test('heuristic covers 翻炒+蒸汽 action-first from kitchen core', () => {
  const core =
    '厨房里忙碌的虚构成年女人正在翻炒，蒸汽升腾；纪实抓拍全身正面面向镜头，略带运动感；顶灯与窗光混合，不锈钢锅具有高光；围裙与食材细节清楚，表情专注；无未成年人。';
  const h = heuristicStructureFromText(core);
  assert.match(h.fields.pose, /stir[\s-]?fry|tossing food in wok|mid-motion/i);
  assert.match(h.fields.pose, /steam|vapor/i);
  assert.match(h.fields.clothing, /apron|wok|stainless|ingredient/i);
  assert.match(h.fields.scene, /kitchen/i);
  assert.match(h.fields.style, /documentary|candid|photojournal|photoreal/i);
  assert.match(h.fields.lighting, /overhead|window light/i);
  // Action (pose) appears before appearance filler in assembled prompt order
  const poseIdx = h.promptEn.search(/stir[\s-]?fry|tossing/i);
  const styleIdx = h.promptEn.search(/photorealistic RAW|DSLR/i);
  assert.ok(poseIdx >= 0);
  assert.ok(styleIdx < 0 || poseIdx < styleIdx, 'action should appear before style filler');
  assert.match(CORE_FIDELITY_LEAD, /lead with described actions|actions then subject props/i);
  assert.match(STRUCTURE_SYSTEM, /ACTION-FIRST|翻炒|steam/i);
});
