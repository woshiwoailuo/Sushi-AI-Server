'use strict';

const { Agent, fetch: undiciFetch } = require('undici');
const agent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
  pipelining: 1,
});

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Connection-reusing fetch for outbound image/chat upstreams. */
function fetchReuse(url, options = {}) {
  return undiciFetch(url, Object.assign({}, options, { dispatcher: agent }));
}

function isRetryableFetchError(error, status) {
  if (error && error.name === 'AbortError') return false;
  if (status === 502 || status === 503 || status === 504) return true;
  const code = String((error && error.code) || '');
  const msg = String((error && error.message) || '');
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|socket/i.test(code + ' ' + msg);
}

/**
 * Limited retries for transient upstream failures. Does not retry 4xx (except 429).
 */
async function fetchLimitedRetry(url, options = {}, retryOptions = {}) {
  const retries = Math.max(0, Number(retryOptions.retries != null ? retryOptions.retries : 2));
  const baseDelay = Number(retryOptions.baseDelayMs != null ? retryOptions.baseDelayMs : 400);
  const doFetch = typeof retryOptions.fetchImpl === 'function' ? retryOptions.fetchImpl : fetchReuse;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await doFetch(url, options);
      if (!isRetryableFetchError(null, response.status) || attempt >= retries) return response;
      lastError = Object.assign(new Error('HTTP ' + response.status), { status: response.status });
      await sleep(baseDelay + attempt * 350, options.signal);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error, error && error.status) || attempt >= retries) throw error;
      await sleep(baseDelay + attempt * 350, options && options.signal);
    }
  }
  throw lastError || new Error('upstream fetch failed');
}

/** Tiny concurrency queue for bursty upstream submits. */
function createRequestQueue(concurrency) {
  const limit = Math.max(1, Number(concurrency) || 2);
  let active = 0;
  const waiters = [];
  const pump = () => {
    while (active < limit && waiters.length) {
      const next = waiters.shift();
      active += 1;
      Promise.resolve()
        .then(next.fn)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      waiters.push({ fn, resolve, reject });
      pump();
    });
  };
}

const imageUpstreamQueue = createRequestQueue(Number(process.env.SUSHI_IMAGE_QUEUE || 2));

module.exports = {
  agent,
  fetchReuse,
  fetchLimitedRetry,
  createRequestQueue,
  imageUpstreamQueue,
};
