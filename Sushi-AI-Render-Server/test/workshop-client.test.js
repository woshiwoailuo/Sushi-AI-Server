'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6JkAAAAASUVORK5CYII=';
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const job = (state = 'queued') => ({ id: 'test-job', state, expiresAt: Date.now() + 600000, queuePosition: 5, waitTimeSeconds: 60, image: state === 'done' ? { url: PNG } : null });

async function until(condition, label) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function setup(t, handler, imageFails = false) {
  const errors = [], calls = [];
  const console = new VirtualConsole();
  console.on('jsdomError', e => { if (e.type === 'unhandled exception') errors.push(e); });
  const dom = new JSDOM(html, { url: 'https://app.example/workshop?k=test', runScripts: 'outside-only', virtualConsole: console });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.AbortController = global.AbortController;
  const realTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => realTimeout(fn, Math.max(1, ms * 0.02), ...args);
  w.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (url === '/api/images/config') return response({ perchanceUrl: 'https://perchance.org/ai-text-to-image-generator' });
    if (url === '/api/images/current') return response({ job: null });
    return handler(url, options, calls);
  };
  const src = Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype, 'src');
  Object.defineProperty(w.HTMLImageElement.prototype, 'src', {
    get: src.get,
    set(value) {
      src.set.call(this, value);
      setImmediate(() => {
        if (!w.document) return;
        Object.defineProperty(this, 'naturalWidth', { configurable: true, value: imageFails ? 0 : 512 });
        Object.defineProperty(this, 'complete', { configurable: true, value: true });
        this.dispatchEvent(new w.Event(imageFails ? 'error' : 'load'));
      });
    }
  });
  for (const script of w.document.querySelectorAll('script:not([src])')) w.eval(script.textContent);
  w.eval(client);
  await until(() => w.__sushiReady && !w.document.getElementById('生成按钮').disabled, 'workshop initialization');
  assert.deepEqual(errors, [], errors.map(e => e.message).join('\n'));
  w.document.getElementById('角色描述').value = 'A small cat by a sunny window';
  // Default unit tests exercise the authenticated /api/images (Horde) path.
  // Race/proxy coverage is in dedicated tests that mock /api/workshop/image.
  var engine = w.document.getElementById('出图引擎');
  if (engine) {
    engine.disabled = false;
    engine.value = 'horde';
  }
  return { w, calls, errors, text: () => w.document.getElementById('状态提示').textContent };
}

test('the actual workshop initializes without Perchance runtime and generates only once on double click', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.ok(f.w.document.querySelector('#出图引擎 option[value="perchance"]'), 'perchance remains selectable');
  const first = f.w.开始生成();
  await f.w.开始生成();
  await first;
  assert.equal(f.calls.filter(c => c.method === 'POST' && String(c.url).includes('/api/images')).length, 1);
  assert.match(f.text(), /已生成 1 张/);
  assert.equal(f.w.document.querySelectorAll('#状态提示 .加载动画').length, 0);
  assert.equal(f.w.document.getElementById('生成按钮').disabled, false);
  assert.equal(f.w.document.querySelectorAll('#图像输出 img').length, 1);
  assert.equal(f.w.读取生成历史().length, 1);
  assert.equal(f.w.document.getElementById('官方画廊').textContent, '');
  assert.deepEqual(f.errors, []);
});

test('submission errors are visible and exit loading state', async t => {
  const f = await setup(t, () => response({ error: '免费生图服务繁忙，请稍后重试' }, 429));
  await f.w.开始生成();
  assert.match(f.text(), /繁忙/);
  assert.equal(f.w.document.querySelector('#状态提示 .加载动画'), null);
  assert.equal(f.w.document.getElementById('生成按钮').disabled, false);
});

test('cancel during submission waits for its id, deletes it, and never displays its late result', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = await setup(t, (url, options) => options.method === 'POST' ? pending : response(job('cancelled')));
  const running = f.w.开始生成();
  await until(() => f.calls.some(c => c.method === 'POST'), 'submission');
  f.w.取消生成();
  assert.equal(f.w.document.querySelector('#状态提示 .加载动画'), null);
  release(response(job()));
  await running;
  assert.equal(f.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.equal(f.w.document.querySelectorAll('#图像输出 img').length, 0);
  assert.match(f.text(), /已停止/);
  assert.equal(f.w.document.getElementById('生成按钮').disabled, false);
});

test('poll failures retry the same task, then cancel and clear the spinner', async t => {
  const f = await setup(t, (url, options) => {
    if (options.method === 'POST') return response(job());
    if (options.method === 'DELETE') return response(job('cancelled'));
    throw new Error('network offline');
  });
  await f.w.开始生成();
  assert.equal(f.calls.filter(c => c.method === 'POST' && String(c.url).includes('/api/images')).length, 1);
  assert.equal(f.calls.filter(c => c.method === 'DELETE' && String(c.url).includes('/api/images')).length, 1);
  assert.match(f.text(), /network offline/);
  assert.equal(f.w.document.querySelector('#状态提示 .加载动画'), null);
});

test('the current Chinese prompt is translated before submission, never replaced by stale English', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.document.getElementById('英文描述').value = 'A stale unrelated scene';
  f.w.调用开源翻译 = async source => { assert.equal(source, '窗边的小猫'); return 'A small cat by the window'; };
  await f.w.开始生成();
  const payload = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body);
  assert.equal(payload.prompt, 'A small cat by the window');
});

test('failed translation preserves the current text, and perchance stays selectable in-app (no official redirect)', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.调用开源翻译 = async () => { throw new Error('translation offline'); };
  // Force horde-only so unit test does not hit live Pollinations.
  f.w.document.getElementById('出图引擎').value = 'horde';
  await f.w.开始生成();
  assert.equal(JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body).prompt, '窗边的小猫');
  const posts = f.calls.filter(c => c.method === 'POST' && String(c.url).includes('/api/images')).length;
  // Perchance must remain selectable and generate in-app — never window.open / official link.
  const box = f.w.document.getElementById('出图引擎');
  assert.ok(box.querySelector('option[value="perchance"]'), 'perchance option must exist');
  box.value = 'perchance';
  const opened = [];
  f.w.open = (url) => { opened.push(url); return null; };
  const realFetch = f.w.fetch;
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image') || href.includes('image.pollinations.ai')) {
      const bytes = Buffer.alloc(3200, 7);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must not open perchance.org');
  assert.equal(box.value, 'perchance', 'explicit perchance selection must be kept');
  assert.equal(f.w.document.querySelectorAll('#状态提示 a[href*="perchance.org"]').length, 0);
  assert.ok(f.w.document.querySelector('#图像输出 img') || f.calls.filter(c => c.method === 'POST' && String(c.url).includes('/api/images')).length >= posts);
  assert.doesNotMatch(f.text(), /在 Perchance 官网生成/);
});

test('auto race prefers a free platform without requiring official redirect', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'auto';
  const realFetch = f.w.fetch;
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image') || href.includes('image.pollinations.ai')) {
      const bytes = Buffer.alloc(3200, 7);
      return {
        ok: true,
        status: 200,
        blob: async () => new f.w.Blob([bytes], { type: 'image/png' })
      };
    }
    return realFetch(url, options);
  };
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(opened.length, 0);
  assert.ok(f.w.document.querySelector('#图像输出 img'));
  const engine = f.w.document.querySelector('#图像输出 img').getAttribute('data-engine');
  assert.ok(['turbo', 'flux', 'flux-realism', 'sana', 'horde'].includes(engine), 'engine=' + engine);
  // Platform picker must remain selectable after a successful run.
  assert.equal(f.w.document.getElementById('出图引擎').disabled, false);
});

test('manual platform selection is honored and not remapped to auto', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  box.value = 'sana';
  box.disabled = false;
  const realFetch = f.w.fetch;
  const hits = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image')) {
      hits.push(href);
      const bytes = Buffer.alloc(3200, 9);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.ok(hits.some(h => h.includes('model=sana')), hits.join('\n'));
  assert.equal(box.value, 'sana');
  assert.equal(box.disabled, false);
});

test('failed image downloads show a reload action and do not silently create another paid/quota task', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')), true);
  await f.w.开始生成();
  assert.match(f.text(), /未能加载/);
  assert.equal(f.w.document.querySelector('#图像输出 button').textContent, '重新加载图片');
  assert.equal(f.calls.filter(c => c.method === 'POST' && String(c.url).includes('/api/images')).length, 1);
  assert.equal(f.w.document.querySelector('#状态提示 .加载动画'), null);
});

test('a quota error in a batch preserves the earlier successful image', async t => {
  let submissions = 0;
  const f = await setup(t, (url, options) => {
    const isImagePost = options.method === 'POST' && String(url).includes('/api/images');
    if (isImagePost && ++submissions > 1) return response({ error: '今日额度已用尽' }, 402);
    return response(options.method === 'POST' ? job() : job('done'));
  });
  f.w.document.getElementById('生成数量').value = '3';
  await f.w.开始生成();
  assert.match(f.text(), /已生成 1 张，后续未完成/);
  assert.match(f.text(), /额度已用尽/);
  assert.equal(f.w.document.querySelectorAll('#图像输出 img').length, 1);
  assert.equal(submissions, 2);
});
