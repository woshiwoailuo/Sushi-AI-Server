'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

test('HTTP login, native ticket bridge, image jobs and SQLite quota accounting', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sushi-integration-'));
  const password = crypto.randomBytes(24).toString('hex');
  Object.assign(process.env, {
    PORT: '0', HOST: '127.0.0.1', DATA_DIR: directory,
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_EMAIL: 'test-admin@example.invalid', ADMIN_PASSWORD: password,
    SMTP_USER: '', SMTP_HOST: '', SMTP_PASS: '', SMTP_PASS_FILE: ''
  });
  const realFetch = global.fetch;
  let upstreamMode = 'done', upstreamCalls = 0;
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://aihorde.net/api/v2/'), 'only the provider adapter is mocked');
    upstreamCalls++;
    if (upstreamMode === 'offline') throw new Error('offline');
    let data = {};
    if (url.endsWith('/async')) data = { id: 'mock-upstream-' + upstreamCalls };
    else if (url.includes('/check/')) data = { done: upstreamMode === 'done', is_possible: true, queue_position: 9, wait_time: 90 };
    else if (options.method === 'GET') data = { generations: [{ img: 'https://images.example/result.png', seed: '1', model: 'test-worker' }] };
    return new Response(JSON.stringify(data), { status: url.endsWith('/async') ? 202 : 200 });
  };
  const { main } = require('../server');
  const server = await main();
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    global.fetch = realFetch;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (url, method = 'GET', body, headers = {}) => realFetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  assert.equal((await request('/api/images', 'POST', { prompt: 'A cat' })).status, 401);
  const login = await request('/api/auth/login', 'POST', { email: process.env.ADMIN_EMAIL, password });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const auth = { Authorization: 'Bearer ' + token };
  const ticket = await (await request('/api/workshop/ticket', 'POST', {}, auth)).json();
  assert.ok(ticket.key && ticket.iv);
  const loader = await request('/workshop?k=' + ticket.ticket);
  assert.equal(loader.status, 200);
  assert.match(await loader.text(), /api\/workshop\/session/);
  assert.equal((await request('/api/workshop/session', 'POST', { ticket: ticket.ticket, key: '0'.repeat(64) })).status, 401);
  const bridge = await request('/api/workshop/session', 'POST', { ticket: ticket.ticket, key: ticket.key });
  assert.equal(bridge.status, 200);
  assert.match(bridge.headers.get('set-cookie'), /HttpOnly/);
  const cookie = { Cookie: bridge.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/api/images/config', 'GET', undefined, cookie)).status, 200);
  const quota = async () => (await (await request('/api/me/quota', 'GET', undefined, cookie)).json()).used;
  assert.equal(await quota(), 0);
  const created = await request('/api/images', 'POST', { prompt: 'A cat by a window' }, cookie);
  assert.equal(created.status, 202);
  const job = await created.json();
  assert.equal(await quota(), 1);
  assert.equal((await request('/api/images', 'POST', { prompt: 'A dog' }, cookie)).status, 409);
  const done = await (await request('/api/images/' + job.id, 'GET', undefined, cookie)).json();
  assert.equal(done.state, 'done');
  assert.equal(await quota(), 1);
  await request('/api/images/' + job.id, 'DELETE', undefined, cookie);
  assert.equal(await quota(), 1, 'a completed image is counted once');
  upstreamMode = 'queued';
  const queued = await (await request('/api/images', 'POST', { prompt: 'A dog' }, cookie)).json();
  assert.equal(await quota(), 2);
  assert.equal((await (await request('/api/images/current', 'GET', undefined, cookie)).json()).job.id, queued.id);
  const cancelled = await (await request('/api/images/' + queued.id, 'DELETE', undefined, cookie)).json();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await quota(), 1, 'cancellation refunds the pending reservation');
  upstreamMode = 'offline';
  assert.equal((await request('/api/images', 'POST', { prompt: 'A bird' }, cookie)).status, 503);
  assert.equal(await quota(), 1, 'failed submission does not consume quota');
  assert.equal((await request('/assets/workshop-generation.js')).status, 200);
});
