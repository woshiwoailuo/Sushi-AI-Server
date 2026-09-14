'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequestQueue, fetchLimitedRetry, fetchReuse } = require('../lib/http-client');

test('http-client source does not require undici (Vercel boot-safe)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/http-client.js'), 'utf8');
  assert.equal(/require\(['"]undici['"]\)/.test(src), false);
  assert.equal(/from ['"]undici['"]/.test(src), false);
});

test('request queue limits concurrency', async () => {
  const enqueue = createRequestQueue(2);
  let active = 0;
  let maxActive = 0;
  const jobs = [];
  for (let i = 0; i < 5; i += 1) {
    jobs.push(enqueue(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return i;
    }));
  }
  const got = await Promise.all(jobs);
  assert.deepEqual(got, [0, 1, 2, 3, 4]);
  assert.ok(maxActive <= 2);
});

test('fetchLimitedRetry returns first ok response', async () => {
  let calls = 0;
  const res = await fetchLimitedRetry('https://example.test', {}, {
    retries: 2,
    fetchImpl: async () => {
      calls += 1;
      return { status: 200, ok: true };
    },
  });
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
});

test('fetchLimitedRetry retries 503 then succeeds', async () => {
  let calls = 0;
  const res = await fetchLimitedRetry('https://example.test', {}, {
    retries: 2,
    baseDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 2) return { status: 503, ok: false };
      return { status: 200, ok: true };
    },
  });
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('fetchReuse is a function (global fetch)', () => {
  assert.equal(typeof fetchReuse, 'function');
  assert.equal(typeof fetch, 'function');
});
