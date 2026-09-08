'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const chatLib = fs.readFileSync(path.join(__dirname, '../lib/chat-response.js'), 'utf8');

test('desktop gallery enlarges on wide screens without mobile rewrite', () => {
  assert.match(workshop, /@media \(min-width: 901px\)/);
  assert.match(workshop, /minmax\(380px, 1fr\)/);
  assert.match(workshop, /min-height: 52vh/);
  assert.match(workshop, /@media \(max-width: 800px\)/);
  assert.match(home, /@media \(min-width: 901px\)/);
  assert.match(home, /gen-wrap iframe/);
});

test('client and server expose reply dedupe helpers', () => {
  assert.match(chatLib, /function collapseRepeatedText/);
  assert.match(home, /function collapseRepeatedText/);
  assert.match(workshop, /function 折叠重复回复/);
  assert.match(workshop, /return 折叠重复回复\(文\)/);
  assert.match(home, /collapseRepeatedText\(content\)/);
});
