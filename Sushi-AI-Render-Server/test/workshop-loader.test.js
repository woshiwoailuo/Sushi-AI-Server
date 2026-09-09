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


test('cookie unlock auth failures surface instead of waiting silently until total timeout', async t => {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update('<p>Gate</p>'), cipher.final()]);
  const html = render({ id: 'ticket-auth', iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  assert.match(html, /未能取得解锁密钥|未登录|凭证|恢复登录超时|工坊解锁失败/);
  assert.match(html, /\/api\/workshop\/unlock/);
  const dom = new JSDOM(html, { url: 'https://app.example/workshop?k=ticket-auth', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
  w.TextDecoder = TextDecoder;
  w.AbortController = AbortController;
  // Speed up soft-failure timer in boot catch
  const realTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => realTimeout(fn, Math.min(ms, 20), ...args);
  w.fetch = async (url) => {
    if (String(url).includes('/unlock')) {
      return { ok: false, json: async () => ({ error: '未登录，请先登录后再进入工坊' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  w.document.open = () => {};
  w.document.write = () => { throw new Error('must not decrypt without key'); };
  w.document.close = () => {};
  w.eval(w.document.querySelector('script').textContent);
  const deadline = Date.now() + 2000;
  while (!w.__sushiLoadError && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.match(String(w.__sushiLoadError || ''), /未登录/);
  assert.equal(w.document.getElementById('loaderTitle').textContent, '工坊未能打开');
  assert.equal(w.document.getElementById('loaderBack').hidden, false);
});


test('parent postMessage sushi_wrap_unlock decrypts without unlock API', async t => {
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const content = '<!doctype html><p>From parent</p>';
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
  const html = render({
    id: 'ticket-pm',
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  });
  assert.match(html, /sushi_wrap_unlock/);
  const dom = new JSDOM(html, { url: 'https://app.example/workshop?k=ticket-pm', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: crypto.webcrypto });
  w.TextDecoder = TextDecoder;
  w.AbortController = AbortController;
  const calls = [];
  w.fetch = async (url) => {
    calls.push(url);
    if (String(url).includes('/unlock')) {
      return { ok: false, json: async () => ({ error: 'should not unlock via API' }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  let resolve;
  const rendered = new Promise((r) => { resolve = r; });
  w.document.open = () => {};
  w.document.write = (htmlText) => { assert.equal(htmlText, content); resolve(); };
  w.document.close = () => {};
  w.eval(w.document.querySelector('script').textContent);
  w.dispatchEvent(new w.MessageEvent('message', {
    data: {
      type: 'sushi_wrap_unlock',
      key: key.toString('hex'),
      iv: iv.toString('hex'),
      ticket: 'ticket-pm',
    },
  }));
  await rendered;
  assert.deepEqual(calls, ['/api/workshop/session']);
});
