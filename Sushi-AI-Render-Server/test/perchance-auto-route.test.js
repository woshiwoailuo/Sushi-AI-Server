'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'assets', 'workshop-generation.js'),
  'utf8'
);
const workshopHtml = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'workshop.html'),
  'utf8'
);

test('image generation is locked to Perch and never opens the official site', () => {
  assert.match(source, /generatePerchance\(run, prompt, index, signal\)/);
  assert.match(source, /官网无法内嵌|应用内出图/i);
  assert.match(source, /function resolveEngine\(\) \{\s*return 'perchance';/);
  assert.match(source, /function resolveImg2imgEngine\(selected\) \{\s*void selected;\s*return 'perchance';/);
  assert.doesNotMatch(
    source,
    /eng === ['"]perchance['"]\s*&&\s*typeof window\.update !== ['"]function['"]/
  );
});

test('Perch is the only remaining image race engine', () => {
  const real = source.match(/var REAL_RACE_ENGINES\s*=\s*\[([\s\S]*?)\];/);
  const anime = source.match(/var ANIME_RACE_ENGINES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(real, 'REAL_RACE_ENGINES must be declared');
  assert.ok(anime, 'ANIME_RACE_ENGINES must be declared');
  assert.match(real[1], /['"]perchance['"]/);
  assert.doesNotMatch(real[1], /['"]horde-real['"]/);
  assert.doesNotMatch(real[1], /['"]sana['"]/);
  assert.doesNotMatch(real[1], /['"]flux-realism['"]/);
  assert.doesNotMatch(real[1], /['"]turbo['"]/);
  assert.doesNotMatch(anime[1], /['"]sana['"]/);
  assert.doesNotMatch(anime[1], /['"]horde-anime['"]/);
  assert.doesNotMatch(anime[1], /['"]perchance['"]/);
});

test('workshop image providers have no application-side cool-down', () => {
  assert.match(source, /ENGINE_COOLDOWN_MS = 0/);
  assert.match(source, /function isEngineCool\(\) \{\s*return false;/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ ENGINE_COOLDOWN_MS/);
  assert.match(source, /可立即重试|未设置冷却/);
});

test('repeated Perch attempts reset the prior gallery and provider failure state', () => {
  assert.match(source, /gallery\.replaceChildren\(\)/);
  assert.match(source, /function resetDisabledEnginesForNewRun/);
  assert.match(source, /resetDisabledEnginesForNewRun\(\);/);
  assert.doesNotMatch(source, /option\.remove\(\)/);
});

test('generation prompt favors realistic output without rewriting the visible core description', () => {
  assert.match(source, /forcePhotorealPrompt\(prompt\)/);
  assert.match(source, /visible 核心描述 remains the source of truth/);
  assert.match(source, /改用写实后端/);
});

test('Perch timeout uses Horde photoreal and never Sana', () => {
  assert.match(source, /runWithProviderBudget\(run, 'perchance'[\s\S]*?\}, HORDE_BUDGET_MS\)/);
  assert.doesNotMatch(source, /runWithProviderBudget\(run, 'sana'/);
  assert.match(source, /generatePerchancePlugin\(run, prompt, index, 5000\)/);
  assert.match(source, /Negative phrases.*must not be mistaken/);
  assert.match(source, /generateHorde\(run, prompt, index, providerSignal, 'perchance'\)/);
});

test('chat channel selection is locked to GLM', () => {
  assert.match(workshopHtml, /value="glm"[^>]*>GLM · 已锁定/);
  const chatPicker = workshopHtml.slice(workshopHtml.indexOf('id="AI通道"'), workshopHtml.indexOf('</select>', workshopHtml.indexOf('id="AI通道"')) + 9);
  assert.match(chatPicker, /value="glm"/);
  assert.doesNotMatch(chatPicker, /<option value="auto"/);
  assert.doesNotMatch(workshopHtml, /<option value="openai"/);
  assert.match(workshopHtml, /问花粉\(问句, "glm"\)/);
  assert.match(workshopHtml, /function 规范化对话通道[\s\S]*return "glm"/);
});

test('workshop locks chat selector and hides configuration UI', () => {
  assert.match(workshopHtml, /AI通道/);
  assert.match(workshopHtml, /GLM 已锁定|对话已锁定 GLM/);
  assert.match(workshopHtml, /框\.disabled = true/);
  assert.match(workshopHtml, /#平台管理区, #管理面板/);
  assert.doesNotMatch(workshopHtml, /#平台管理区, #管理面板, #工具区/);
});

test('Perch requests are fast-cancelled and upstream work stops on disconnect', () => {
  assert.match(source, /runWithProviderBudget\(run, 'perchance'[\s\S]*?\}, HORDE_BUDGET_MS\)/);
  assert.doesNotMatch(source, /runWithProviderBudget\(run, 'sana'[\s\S]*?\}, 12000\)/);
});

test('workshop picker keeps only the locked Perch channel', () => {
  assert.doesNotMatch(workshopHtml, /<optgroup label="写实">/);
  assert.doesNotMatch(workshopHtml, /<optgroup label="动漫">/);
  assert.match(workshopHtml, /value="perchance" selected>Perch · 已锁定/);
  assert.doesNotMatch(workshopHtml, /value="auto-real"/);
  assert.doesNotMatch(workshopHtml, /value="horde-real"/);
  assert.doesNotMatch(workshopHtml, /value="glm">智谱 GLM · 写实/);
  assert.doesNotMatch(workshopHtml, /value="horde-anime"/);
  assert.doesNotMatch(workshopHtml, /value="auto">跟随生图平台/);
  assert.doesNotMatch(workshopHtml, /<option value="turbo"/);
  assert.doesNotMatch(workshopHtml, /<option value="flux"/);
  assert.doesNotMatch(workshopHtml, /<option value="flux-realism"/);
  assert.doesNotMatch(workshopHtml, /value="aihorde"/);
  assert.match(workshopHtml, /id="图生图平台"[\s\S]*value="perchance" selected>Perch · 已锁定/);
});

test('img2img endpoint pins Horde models; GLM is chat-only; config advertises Perch only', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/workshop\/img2img'/);
  assert.match(server, /payload = generationPayload/);
  assert.match(server, /style: isAnime \? 'anime' : 'real'/);
  assert.doesNotMatch(server, /style === 'glm'/);
  assert.doesNotMatch(server, /function glmGenerateImage/);
  assert.match(server, /realRace: \['perchance'\]/);
  assert.match(server, /race: \['perchance'\]/);
  assert.doesNotMatch(source, /function generateGlm/);
  assert.match(source, /function resolveImg2imgEngine/);
  assert.doesNotMatch(source, /glmImageReady/);
});
