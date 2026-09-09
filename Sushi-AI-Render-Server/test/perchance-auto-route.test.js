'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'assets', 'workshop-generation.js'),
  'utf8'
);

test('auto mode keeps Perchance eligible when the official plugin is unavailable', () => {
  assert.match(source, /var activeEngines = FREE_RACE_ENGINES\.filter/);
  assert.doesNotMatch(
    source,
    /eng === ['"]perchance['"]\s*&&\s*typeof window\.update !== ['"]function['"]/
  );
  assert.match(source, /generatePerchance\(run, prompt, index, signal\)/);
  assert.match(source, /same-origin proxy|应用内出图/i);
});

test('auto mode does not race Perchance against its Flux写实 proxy twice', () => {
  const race = source.match(/var FREE_RACE_ENGINES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(race, 'FREE_RACE_ENGINES must be declared');
  assert.match(race[1], /['"]perchance['"]/);
  assert.doesNotMatch(race[1], /['"]flux-realism['"]/);
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
  assert.match(source, /prompt = photorealPrompt\(prompt\);/);
  assert.match(source, /visible 核心描述 remains the source of truth/);
  assert.match(source, /同源写实备用模型重试/);
});


test('Perch timeout uses a fresh fallback and repeated attempts keep realistic routing', () => {
  assert.match(source, /runWithProviderBudget\(run, engine, function \(signal\) \{[\s\S]*?\}, 15000\)/);
  assert.match(source, /runWithProviderBudget\(run, 'turbo'/);
  assert.match(source, /generatePerchancePlugin\(run, prompt, index, 5000\)/);
  assert.match(source, /Negative phrases.*must not be mistaken/);
});

test('chat channel selection keeps the explicit free OpenAI route', () => {
  assert.match(source, /value="openai">快速对话/);
  assert.match(source, /值 === "openai-fast".*return "openai"/);
  assert.match(source, /指定 === "openai"\) return 问花粉/);
});
