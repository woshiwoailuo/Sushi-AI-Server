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

test('manual image providers are available without selector locks', () => {
  for (const id of ['出图引擎','图生图平台']) {
    const picker = workshopHtml.slice(workshopHtml.indexOf('id="' + id + '"'), workshopHtml.indexOf('</select>', workshopHtml.indexOf('id="' + id + '"')));
    assert.doesNotMatch(picker, /disabled/);
    for (const provider of ['perchance','horde-real','horde-anime','sana']) assert.ok(picker.includes('value="' + provider + '"'));
  }
});

test('generation retains cancellation, gallery reset, and no cooldown', () => {
  assert.match(source, /gallery\.replaceChildren\(\)/);
  assert.match(source, /ENGINE_COOLDOWN_MS = 0/);
  assert.match(source, /function isEngineCool\(\) \{\s*return false;/);
  assert.match(source, /active\.controller\.abort\(\)/);
  assert.match(source, /hideStatusPanel\(\);/);
});

test('GLM remains chat-only and management UI stays hidden', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /function glmGenerateImage/);
  assert.doesNotMatch(source, /function generateGlm/);
  assert.match(workshopHtml, /#平台管理区, #管理面板/);
  assert.doesNotMatch(workshopHtml, /#平台管理区, #管理面板, #工具区/);
});
