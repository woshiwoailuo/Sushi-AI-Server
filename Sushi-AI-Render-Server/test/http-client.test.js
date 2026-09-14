'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestQueue } = require('../lib/http-client');

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
