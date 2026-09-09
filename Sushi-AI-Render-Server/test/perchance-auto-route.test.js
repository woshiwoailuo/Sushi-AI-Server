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

test('auto mode keeps Perchance eligible when the official plugin is unavailable', () => {
  assert.match(source, /var activeEngines = raceList\.filter/);
  assert.doesNotMatch(
    source,
    /eng === ['"]perchance['"]\s*&&\s*typeof window\.update !== ['"]function['"]/
  );
  assert.match(source, /generatePerchance\(run, prompt, index, signal\)/);
  assert.match(source, /same-origin proxy|应用内出图/i);
});

test('auto-real races Perchance against Horde写实, not a duplicate Pollinations alias', () => {
  const real = source.match(/var REAL_RACE_ENGINES\s*=\s*\[([\s\S]*?)\];/);
  const anime = source.match(/var ANIME_RACE_ENGINES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(real, 'REAL_RACE_ENGINES must be declared');
  assert.ok(anime, 'ANIME_RACE_ENGINES must be declared');
  assert.match(real[1], /['"]perchance['"]/);
  assert.match(real[1], /['"]horde-real['"]/);
  assert.doesNotMatch(real[1], /['"]flux-realism['"]/);
  assert.doesNotMatch(real[1], /['"]turbo['"]/);
  assert.match(anime[1], /['"]sana['"]/);
  assert.match(anime[1], /['"]horde-anime['"]/);
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
  assert.match(source, /prompt = family === 'anime' \? animePrompt\(prompt\) : photorealPrompt\(prompt\);/);
  assert.match(source, /visible 核心描述 remains the source of truth/);
  assert.match(source, /同源写实备用模型重试/);
});


test('Perch timeout uses a fresh fallback and repeated attempts keep realistic routing', () => {
  assert.match(source, /runWithProviderBudget\(run, engine[\s\S]*?\}, 10000\)/);
  assert.match(source, /runWithProviderBudget\(run, 'sana'/);
  assert.match(source, /generatePerchancePlugin\(run, prompt, index, 5000\)/);
  assert.match(source, /Negative phrases.*must not be mistaken/);
});

test('chat channel selection keeps configured free routes and maps OpenAI aliases', () => {
  assert.match(workshopHtml, /value="glm">GLM/);
  assert.match(workshopHtml, /value="horde">Horde/);
  assert.doesNotMatch(workshopHtml, /<option value="openai"/);
  assert.match(workshopHtml, /值 === "openai-fast".*return "openai"/);
  assert.match(workshopHtml, /指定 === "openai"\) return 问花粉/);
});


test('workshop keeps chat selector active and hides configuration UI', () => {
  assert.match(workshopHtml, /AI通道/);
  assert.match(workshopHtml, /框\.disabled = false/);
  assert.match(workshopHtml, /#平台管理区, #管理面板/);
  assert.doesNotMatch(workshopHtml, /#平台管理区, #管理面板, #工具区/);
});

test('Perch requests are fast-cancelled and upstream work stops on disconnect', () => {
  assert.match(source, /runWithProviderBudget\(run, engine[\s\S]*?\}, 10000\)/);
  assert.match(source, /runWithProviderBudget\(run, 'sana'[\s\S]*?\}, 12000\)/);
});

test('workshop picker splits 写实 and 动漫 and hides dead Pollinations aliases', () => {
  assert.match(workshopHtml, /<optgroup label="写实">/);
  assert.match(workshopHtml, /<optgroup label="动漫">/);
  assert.match(workshopHtml, /value="auto-real" selected/);
  assert.match(workshopHtml, /value="horde-real"/);
  assert.match(workshopHtml, /value="horde-anime"/);
  assert.doesNotMatch(workshopHtml, /<option value="turbo"/);
  assert.doesNotMatch(workshopHtml, /<option value="flux"/);
  assert.doesNotMatch(workshopHtml, /<option value="flux-realism"/);
});
