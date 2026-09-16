'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  categorizeImageFailure,
  recordImageFailure,
  snapshotImageFailures,
  resetImageFailuresForTests,
} = require('../lib/image-failure-stats');

test('categorizes connection/timeout/censor/empty failures', () => {
  assert.equal(categorizeImageFailure({ message: 'Failed to fetch' }, 0), '连接失败');
  assert.equal(categorizeImageFailure({ name: 'AbortError', message: 'aborted' }, 504), '超时');
  assert.equal(categorizeImageFailure({ message: '成人内容被生图节点审查' }, 502), '审核拒绝');
  assert.equal(categorizeImageFailure({ message: '上游未返回图片' }, 502), '返回空图');
  assert.equal(categorizeImageFailure({ message: 'busy' }, 429), '限流');
});

test('records platform/duration/status/type and snapshots counts', () => {
  resetImageFailuresForTests();
  recordImageFailure({ platform: 'horde-real', durationMs: 1200, statusCode: 504, message: 'timeout' });
  recordImageFailure({ platform: 'perchance', durationMs: 300, statusCode: 502, message: '上游未返回图片' });
  const snap = snapshotImageFailures();
  assert.equal(snap.counts['超时'], 1);
  assert.equal(snap.counts['返回空图'], 1);
  assert.equal(snap.recent[0].platform, 'perchance');
  assert.ok(snap.recent[0].durationMs >= 0);
  assert.ok(snap.categories.includes('连接失败'));
});
