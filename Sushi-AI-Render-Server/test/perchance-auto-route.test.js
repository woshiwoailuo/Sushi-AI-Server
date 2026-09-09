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
