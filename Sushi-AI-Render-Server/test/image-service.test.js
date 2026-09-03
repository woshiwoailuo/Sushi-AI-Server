'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createImageService, imageSource, generationPayload } = require('../lib/image-service');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6JkAAAAASUVORK5CYII=';
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(handler, extra = {}) {
  const calls = [], reserved = [], refunded = [], committed = [];
  let time = 1_000;
  const service = createImageService({
    now: () => time,
    fetchImpl: async (url, options) => { calls.push({ url, ...options }); return handler(url, options, calls); },
    reserve: uid => { reserved.push(uid); return reserved.length; },
    refund: (id, uid) => refunded.push([id, uid]),
    commit: (id, uid) => committed.push([id, uid]),
    ...extra
  });
  return { service, calls, reserved, refunded, committed, advance: ms => { time += ms; } };
}

test('validates input, preserves the prompt and sends reference images and guidance', () => {
  const payload = generationPayload({ prompt: 'A cat by a window', negativePrompt: 'blurry', width: 512, height: 768, cfgScale: 9, seed: '0', sourceImage: 'data:image/png;base64,' + PNG, strength: 0.3 });
  assert.equal(payload.prompt, 'A cat by a window ### blurry');
  assert.equal(payload.params.cfg_scale, 9);
  assert.equal(payload.params.seed, '0');
  assert.equal(payload.source_image, PNG);
  assert.equal(payload.params.denoising_strength, 0.3);
  assert.equal(payload.source_processing, 'img2img');
  assert.equal(payload.r2, true);
  for (const input of [null, [], {}, { prompt: 'x', width: 513 }, { prompt: 'x', width: 0 }, { prompt: 'x', cfgScale: 40 }, { prompt: 'x', seed: '-1' }, { prompt: 'x', sourceImage: 'https://example.com/photo.jpg' }]) {
    assert.throws(() => generationPayload(input), e => e.status === 400);
  }
});

test('accepts HTTPS, data URLs and raw base64; rejects HTML and unsafe URL schemes', () => {
  assert.equal(imageSource(PNG), 'data:image/png;base64,' + PNG);
  assert.equal(imageSource('data:image/png;base64,' + PNG), 'data:image/png;base64,' + PNG);
  assert.equal(imageSource('https://images.example/p.png'), 'https://images.example/p.png');
  for (const value of ['<html>error</html>', 'javascript:alert(1)', 'http://images.example/p.png', 'https://user:password@images.example/x', 'aGVsbG8=']) assert.throws(() => imageSource(value));
});

test('polls check first, fetches the image only on done, and commits quota once', async () => {
  let polls = 0;
  const f = fixture((url) => {
    if (url.endsWith('/async')) return response({ id: 'remote-1' }, 202);
    if (url.includes('/check/')) return response(++polls === 1 ? { done: false, processing: 0, queue_position: 21, wait_time: 120, is_possible: true } : { done: true, processing: 0, is_possible: false });
    return response({ generations: [{ img: PNG, seed: '123', model: 'test-worker' }] });
  });
  const job = await f.service.create(7, { prompt: 'A cat' });
  assert.equal((await f.service.get(7, job.id)).queuePosition, 21);
  assert.equal(f.calls.length, 2);
  f.advance(2000);
  const done = await f.service.get(7, job.id);
  assert.equal(done.state, 'done');
  assert.equal(done.image.url, 'data:image/png;base64,' + PNG);
  await f.service.get(7, job.id);
  await f.service.cancel(7, job.id);
  assert.deepEqual(f.committed, [[1, 7]]);
  assert.deepEqual(f.refunded, []);
  assert.equal(f.service.current(7), null);
  assert.deepEqual(f.calls.map(c => new URL(c.url).pathname), ['/api/v2/generate/async', '/api/v2/generate/check/remote-1', '/api/v2/generate/check/remote-1', '/api/v2/generate/status/remote-1']);
});

test('prevents duplicate submissions and hides jobs from other users', async () => {
  const f = fixture(() => response({ id: 'remote' }, 202));
  const job = await f.service.create(1, { prompt: 'A cat' });
  await assert.rejects(f.service.create(1, { prompt: 'A dog' }), e => e.status === 409);
  await assert.rejects(f.service.get(2, job.id), e => e.status === 404);
  await assert.rejects(f.service.cancel(2, job.id), e => e.status === 404);
  assert.equal(f.calls.length, 1);
  await f.service.cancel(1, job.id);
  await f.service.cancel(1, job.id);
  assert.deepEqual(f.refunded, [[1, 1]]);
});

test('cancellation during submission deletes a late upstream task and refunds once', async () => {
  const pending = deferred();
  const f = fixture((url, options) => options.method === 'POST' ? pending.promise : response({}));
  const submitting = f.service.create(1, { prompt: 'A cat' });
  const job = f.service.current(1);
  await f.service.cancel(1, job.id);
  pending.resolve(response({ id: 'late-remote' }, 202));
  assert.equal((await submitting).state, 'cancelled');
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.deepEqual(f.refunded, [[1, 1]]);
  assert.deepEqual(f.committed, []);
});

test('concurrent polls share one request and cancellation ignores late results', async () => {
  const pending = deferred();
  const f = fixture((url, options) => url.endsWith('/async') ? response({ id: 'remote' }, 202) : options.method === 'DELETE' ? response({}) : pending.promise);
  const job = await f.service.create(1, { prompt: 'A cat' });
  const first = f.service.get(1, job.id), second = f.service.get(1, job.id);
  assert.equal(f.calls.filter(c => c.url.includes('/check/')).length, 1);
  await f.service.cancel(1, job.id);
  pending.resolve(response({ done: true }));
  assert.equal((await first).state, 'cancelled');
  assert.equal((await second).state, 'cancelled');
  assert.deepEqual(f.committed, []);
});

test('failed submissions, faulted tasks, censored/missing images and expiry refund quota', async () => {
  for (const mode of ['unreachable', 'faulted', 'empty', 'censored', 'expired']) {
    const f = fixture((url) => {
      if (mode === 'unreachable') throw new Error('network offline');
      if (url.endsWith('/async')) return response({ id: 'remote' }, 202);
      if (url.includes('/check/')) return response({ done: mode !== 'faulted', faulted: mode === 'faulted' });
      return response({ generations: mode === 'censored' ? [{ img: PNG, censored: true }] : [] });
    });
    if (mode === 'unreachable') await assert.rejects(f.service.create(1, { prompt: 'A cat' }), e => e.code === 'UPSTREAM_UNREACHABLE');
    else {
      const job = await f.service.create(1, { prompt: 'A cat' });
      if (mode === 'expired') f.advance(600001);
      assert.equal((await f.service.get(1, job.id)).state, 'failed');
      await f.service.get(1, job.id);
    }
    assert.equal(f.refunded.length, 1, mode);
    assert.equal(f.service.current(1), null, mode);
  }
});

test('transient poll errors can be retried without resubmission or an early refund', async () => {
  let checks = 0;
  const f = fixture(url => url.endsWith('/async') ? response({ id: 'remote' }, 202) : ++checks === 1 ? response({}, 429) : response({ done: false, is_possible: true }));
  const job = await f.service.create(1, { prompt: 'A cat' });
  await assert.rejects(f.service.get(1, job.id), e => e.status === 429);
  assert.equal((await f.service.get(1, job.id)).state, 'queued');
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.deepEqual(f.refunded, []);
  await f.service.cancel(1, job.id);
});
