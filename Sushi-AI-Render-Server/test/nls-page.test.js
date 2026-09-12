'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const pagePath = path.join(__dirname, '..', 'public', 'app', 'nls', 'index.html');

test('brain-ten page inline JavaScript parses and escapes rendered text', () => {
  const html = fs.readFileSync(pagePath, 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]))
    .map((match) => match[2]);

  assert.ok(scripts.length > 0, 'expected an inline application script');
  for (const source of scripts) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: pagePath }));
  }
  assert.match(html, /"&": "&amp;"/);
  assert.match(html, /"<": "&lt;"/);
  assert.match(html, /'"': "&quot;"/);
});
