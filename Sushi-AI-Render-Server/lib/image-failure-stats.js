'use strict';

const CATEGORIES = ['连接失败', '超时', '审核拒绝', '返回空图', '限流', '其他'];
const MAX_RECENT = 40;

const counts = Object.create(null);
for (const key of CATEGORIES) counts[key] = 0;

const recent = [];

function categorizeImageFailure(error, statusCode) {
  const status = Number(statusCode) || Number(error && error.status) || 0;
  const name = String((error && error.name) || '');
  const code = String((error && error.code) || '');
  const msg = String((error && error.message) || error || '');
  if (name === 'AbortError' || status === 504 || /timeout|超时|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg + ' ' + code)) {
    return '超时';
  }
  if (status === 429 || /限流|冷却|rate.?limit|cooldown/i.test(msg)) {
    return '限流';
  }
  if (/censored|审核|审查|nsfw.*(block|reject)|content.?policy|safety/i.test(msg)) {
    return '审核拒绝';
  }
  if (/空图|未返回图片|图片无效|图片过小|no image|empty image|upstream未返回/i.test(msg) || status === 204) {
    return '返回空图';
  }
  if (
    status === 0
    || status === 502
    || status === 503
    || /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|NetworkError|连接失败|不可用/i.test(msg + ' ' + code)
  ) {
    return '连接失败';
  }
  return '其他';
}

function recordImageFailure(entry = {}) {
  const errorType = CATEGORIES.includes(entry.errorType)
    ? entry.errorType
    : categorizeImageFailure({ message: entry.message, status: entry.statusCode, code: entry.code, name: entry.name }, entry.statusCode);
  counts[errorType] = (counts[errorType] || 0) + 1;
  const row = {
    at: new Date().toISOString(),
    platform: String(entry.platform || 'unknown').slice(0, 64),
    durationMs: Math.max(0, Number(entry.durationMs) || 0),
    statusCode: Number(entry.statusCode) || 0,
    errorType,
    message: String(entry.message || '').slice(0, 240),
  };
  recent.unshift(row);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    console.error('[image-fail]', JSON.stringify(row));
  } catch (_) { /* ignore */ }
  return row;
}

function snapshotImageFailures() {
  return {
    counts: Object.assign({}, counts),
    recent: recent.slice(),
    categories: CATEGORIES.slice(),
  };
}

function resetImageFailuresForTests() {
  for (const key of CATEGORIES) counts[key] = 0;
  recent.length = 0;
}

module.exports = {
  CATEGORIES,
  categorizeImageFailure,
  recordImageFailure,
  snapshotImageFailures,
  resetImageFailuresForTests,
};
