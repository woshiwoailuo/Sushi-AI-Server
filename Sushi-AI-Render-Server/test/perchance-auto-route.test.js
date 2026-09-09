import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/workshop-generation.js'),
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
