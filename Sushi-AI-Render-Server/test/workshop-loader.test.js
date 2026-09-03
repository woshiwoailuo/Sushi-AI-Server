'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const render = require('../lib/workshop-loader');

test('native key-only unlock uses the embedded IV and establishes a cookie session before rendering', async t => {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const content = '<!doctype html><p>Test workshop</p>';
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
  const html = render({ id: 'ticket', iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  const dom = new JSDOM(html, { url: 'https://app.example/workshop?k=ticket', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, events = [];
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
  w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  w.fetch = async (url, options) => {
    if (url.endsWith('/unlock')) return { ok: false, json: async () => ({ error: '未登录' }) };
    assert.equal(url, '/api/workshop/session');
    assert.equal(JSON.parse(options.body).key, key.toString('hex'));
    assert.equal(options.credentials, 'same-origin');
    events.push('session');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  w.document.open = () => {};
  w.document.write = text => { assert.equal(text, content); events.push('render'); };
  w.document.close = () => {};
  w.eval(w.document.querySelector('script').textContent);
  const result = await Promise.all([w.__sushiUnlock(key.toString('hex')), w.__sushiUnlock(key.toString('hex'))]);
  assert.deepEqual(result, [true, true]);
  assert.deepEqual(events, ['session', 'render']);
});

test('a fresh URL key takes precedence over stale session storage', async t => {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update('<p>Fresh</p>'), cipher.final()]);
  const dom = new JSDOM(render({ id: 'new-ticket', iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }), {
    url: 'https://app.example/workshop?k=new-ticket#' + key.toString('hex') + '.' + iv.toString('hex'), runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
  w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  w.sessionStorage.setItem('sushi_wrap_key', '0'.repeat(64));
  w.sessionStorage.setItem('sushi_wrap_ticket', 'old-ticket');
  let resolve;
  const rendered = new Promise(r => { resolve = r; });
  const calls = [];
  w.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ ok: true }) }; };
  w.document.open = () => {};
  w.document.write = html => { assert.equal(html, '<p>Fresh</p>'); resolve(); };
  w.document.close = () => {};
  w.eval(w.document.querySelector('script').textContent);
  await rendered;
  assert.deepEqual(calls, ['/api/workshop/session']);
  assert.equal(w.location.hash, '');
  assert.equal(w.sessionStorage.getItem('sushi_wrap_key'), null);
});
