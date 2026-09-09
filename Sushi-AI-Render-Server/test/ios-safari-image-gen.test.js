'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

const root = path.join(__dirname, '..');
const home = fs.readFileSync(path.join(root, 'public/app/index.html'), 'utf8');
const workshop = fs.readFileSync(path.join(root, 'public/workshop.html'), 'utf8');
const gen = fs.readFileSync(path.join(root, 'public/assets/workshop-generation.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('iOS Safari: workshop viewport meta is in <head>', () => {
  const head = workshop.slice(0, workshop.indexOf('</head>'));
  assert.match(head, /<meta name="viewport"/);
  assert.doesNotMatch(workshop.slice(workshop.indexOf('<body>'), workshop.indexOf('<body>') + 200), /name="viewport"/);
});

test('iOS Safari: workshop image fetches send Bearer from localStorage JWT', () => {
  assert.match(gen, /function authHeaders/);
  assert.match(gen, /localStorage\.getItem\('sushi_jwt'\)/);
  assert.match(gen, /headers\.Authorization = 'Bearer '/);
  assert.match(gen, /credentials: 'include'/);
  assert.match(gen, /sushi_auth/);
  assert.match(home, /type: 'sushi_auth'/);
});

test('iOS web: random/direct gen buttons stay ~44px with smaller type', () => {
  assert.match(workshop, /\.核心操作 \.直接生成按钮/);
  assert.match(workshop, /min-height: 44px/);
  assert.match(workshop, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(workshop, /\.手机底栏 \.智能按钮/);
  assert.match(workshop, /font-size: 12px/);
});

test('auth cookie sets Secure on Vercel and generation button disable is honored', () => {
  assert.match(server, /SameSite=Lax' \+ secure/);
  assert.match(workshop, /var off = !!禁用;/);
  assert.match(workshop, /按钮\.disabled = off;/);
});

test('Grok unconfigured UX points to Vercel XAI_API_KEY and keeps Horde', () => {
  assert.match(home, /id="grokSetupHint"/);
  assert.match(home, /XAI_API_KEY/);
  assert.match(home, /value="horde"/);
  assert.match(home, /改用 Horde/);
  assert.match(server, /XAI_API_KEY \|\| process\.env\.GROK_API_KEY/);
});
