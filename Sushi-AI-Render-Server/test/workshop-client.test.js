'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
require('../lib/runtime-patch');
require('../lib/image-lock-patch');
require('../lib/feature-patch');
const html = fs.readFileSync(path.join(__dirname, '../public/workshop.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6JkAAAAASUVORK5CYII=';
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const job = (state = 'queued') => ({ id: 'test-job', state, expiresAt: Date.now() + 600000, queuePosition: 5, waitTimeSeconds: 60, image: state === 'done' ? { url: PNG } : null });
function isImageSubmit(c) {
  return c.method === 'POST' && /aihorde\.net\/api\/v2\/generate\/async|\/api\/images\/?$/.test(String(c.url));
}
function isImageDelete(c) {
  return c.method === 'DELETE' && /aihorde\.net\/api\/v2\/generate\/status|\/api\/images\//.test(String(c.url));
}
function imagePayload(calls) {
  const c = calls.find(isImageSubmit);
  assert.ok(c, 'expected a platform image submit');
  return JSON.parse(c.body);
}
function isRealHorde(body) {
  if (body && (body.style === 'real' || body.style === 'photoreal' || body.style === 'perchance')) return true;
  return Array.isArray(body && body.models) && body.models.includes('AbsoluteReality');
}

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
    const href = String(url);
    if (href.includes('/api/images/config')) return response({ perchanceUrl: 'https://perchance.org/ai-text-to-image-generator' });
    if (href.includes('/api/images/current')) return response({ job: null });
    if (href.includes('aihorde.net')) {
      const method = options.method || 'GET';
      const mapped = method === 'POST' ? '/api/images' : '/api/images/test-job';
      const result = await handler(mapped, options, calls);
      const status = result.status;
      let data = {};
      try { data = await result.json(); } catch (e) { data = {}; }
      if (!result.ok) return { ok: false, status, json: async () => data };
      if (method === 'POST') return response({ id: data.id || 'test-job' }, 202);
      if (method === 'DELETE') return response({ done: true, generations: [] });
      if (data.state === 'done' && data.image && data.image.url) {
        return response({ done: true, faulted: false, is_possible: true, processing: 0, generations: [{ img: data.image.url, censored: false }] });
      }
      if (data.state === 'queued' || data.state === 'processing' || data.state === 'submitting') {
        return response({ done: false, faulted: false, is_possible: true, processing: data.state === 'processing' ? 1 : 0, queue_position: data.queuePosition || 1, wait_time: data.waitTimeSeconds || 5 });
      }
      if (data.state === 'failed') return response({ done: true, faulted: true, generations: [] });
      if (data.state === 'cancelled') return response({ done: true, faulted: false, generations: [] });
      return { ok: result.ok, status, json: async () => data };
    }
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
  // Select Horde explicitly for API-backed generation tests.
  var engine = w.document.getElementById('出图引擎');
  if (engine) {
    engine.value = 'horde-real';
  }
  return { w, calls, errors, text: () => w.document.getElementById('状态提示').textContent };
}

test('the actual workshop initializes without Perchance runtime and generates only once on double click', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.ok(f.w.document.querySelector('#出图引擎 option[value="perchance"]'), 'perchance remains the only image channel');
  assert.equal(f.w.document.getElementById('出图引擎').disabled, false);
  const first = f.w.开始生成();
  await f.w.开始生成();
  await first;
  assert.equal(f.calls.filter(isImageSubmit).length, 1);
  // Success hides the bulky 「已生成图片」 status card so the gallery sits under 「角色画廊」.
  assert.equal(f.w.document.getElementById('状态提示').style.display, 'none');
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
  assert.equal(f.calls.filter(isImageSubmit).length, 1);
  assert.equal(f.calls.filter(isImageDelete).length, 1);
  assert.match(f.text(), /network offline/);
  assert.equal(f.w.document.querySelector('#状态提示 .加载动画'), null);
});

test('the current Chinese prompt is translated before submission, never replaced by stale English', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.document.getElementById('英文描述').value = 'A stale unrelated scene';
  f.w.调用开源翻译 = async source => { assert.equal(source, '窗边的小猫'); return 'A small cat by the window'; };
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /A small cat by the window/);
  // Visible core is source of truth — no silent photoreal rewrite on generate.
  assert.match(payload.prompt, /photorealistic/i);
  assert.doesNotMatch(payload.prompt, /A stale unrelated scene/);
});

test('failed translation preserves core; Perch stays selected and generates in-app', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.调用开源翻译 = async () => { throw new Error('translation offline'); };
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /窗边的小猫/);
  const posts = f.calls.filter(isImageSubmit).length;
  const box = f.w.document.getElementById('出图引擎');
  box.value = 'perchance';
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(box.value, 'perchance');
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.ok(f.calls.filter(isImageSubmit).length > posts);
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'perchance');
});

test('Horde selection remains unchanged after a successful generation', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  await f.w.开始生成();
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'horde-real');
  assert.equal(f.w.document.getElementById('出图引擎').value, 'horde-real');
  assert.equal(f.w.document.getElementById('出图引擎').disabled, false);
});

test('manual Sana selection uses only Sana', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  box.value = 'sana';
  box.disabled = false;
  const realFetch = f.w.fetch;
  const hits = [];
  const imagePosts = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image')) {
      hits.push(href);
      const bytes = Buffer.alloc(3200, 9);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    if (options.method === 'POST' && (href.includes('/api/images') || href.includes('aihorde.net'))) imagePosts.push(href);
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.equal(hits.length, 1, 'Sana must receive the generation request');
  assert.equal(imagePosts.length, 0, 'must not call Horde');
  assert.equal(box.value, 'sana');
  assert.equal(box.disabled, false);
});

test('generate displays the image immediately and click enlarges', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  await f.w.开始生成();
  const img = f.w.document.querySelector('#图像输出 img');
  assert.ok(img);
  assert.ok(img.getAttribute('src') || img.src);
  assert.ok(img.getAttribute('data-full-url'));
  assert.equal(f.w.读取生成历史().length, 1);
  assert.equal(f.w.document.getElementById('状态提示').style.display, 'none');
  assert.equal(f.w.document.getElementById('生成按钮').disabled, false);
  f.w.document.querySelector('.生图卡片').click();
  await until(() => f.w.document.querySelector('#图片预览层') && !f.w.document.querySelector('#图片预览层').hasAttribute('hidden'), 'preview overlay');
});

test('failed image downloads show a reload action and do not silently create another paid/quota task', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')), true);
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('生成按钮').disabled, false);
  assert.equal(f.w.document.querySelectorAll('#图像输出 img').length, 1);
  assert.doesNotMatch(f.text() || '', /未能加载/);
  await until(() => {
    const btn = f.w.document.querySelector('#图像输出 button');
    return !!(btn && btn.textContent === '重新加载图片');
  }, 'reload action after display error');
  assert.equal(f.w.document.querySelector('#图像输出 button').textContent, '重新加载图片');
  assert.equal(f.calls.filter(isImageSubmit).length, 1);
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

test('random generate fills rich core while managed display stays simple two-line style', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.本地随机一项, 'function');
  const item = f.w.本地随机一项();
  assert.match(item.中文, /成年/);
  assert.match(item.英文, /fictional adult/i);
  assert.ok(item.核心.length > item.中文.length, 'core should be richer than managed Chinese');
  assert.ok(item.详英.length > item.英文.length, 'generation English should be richer than managed English');
  assert.match(item.核心, /光|构图|景深|材质|发型|五官/);
  assert.match(item.详英, /light|depth of field|composition|texture|fictional/i);
  assert.doesNotMatch(item.核心 + item.详英 + item.中文 + item.英文, /\bchild\b|\bteen\b|儿童|少年|未成年(?!人)/i);
  assert.match(item.核心 + item.详英, /no minors|无未成年人|18\+/i);

  // Deterministic pair for UI fill assertions
  f.w.本地随机一项 = () => ({
    中文: '两名成年人在暖光室内对视',
    英文: 'photoreal photo of two fictional adults facing each other in warm indoor light',
    核心: '两名虚构成年人在暖光室内近距离对视，肩线相对；双人半身构图，浅景深；钨丝暖黄主光；无未成年人。',
    详英: 'photoreal photo of two fictional adults facing each other in warm indoor light, intimate half-body two-shot, tungsten key, shallow depth of field, fictional adults 18+ only, no minors'
  });
  await f.w.开始随机生成();
  assert.equal(f.w.document.getElementById('角色描述').value, f.w.本地随机一项().核心);
  assert.equal(f.w.document.getElementById('中文译文').value, '两名成年人在暖光室内对视');
  assert.equal(f.w.document.getElementById('英文描述').value, 'photoreal photo of two fictional adults facing each other in warm indoor light');
  assert.equal(f.w.document.getElementById('说明标题').textContent, '两名成年人在暖光室内对视');
  assert.equal(f.w.document.getElementById('说明英文').textContent, 'photoreal photo of two fictional adults facing each other in warm indoor light');
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /shallow depth of field|tungsten key|intimate half-body/i);
  assert.doesNotMatch(payload.prompt, /^photoreal photo of two fictional adults facing each other in warm indoor light$/);
  assert.match(payload.prompt, /photoreal|shallow depth of field/i);
});

test('Perchance uses its official component when available without Horde calls', async t => {
  const f = await setup(t, () => { throw new Error('unexpected upstream'); });
  const box = f.w.document.getElementById('出图引擎'); box.value = 'perchance';
  let invoked = 0;
  f.w.update = gallery => { invoked++; const img = f.w.document.createElement('img'); img.src = PNG; gallery.appendChild(img); };
  await f.w.开始生成();
  assert.equal(invoked, 1);
  assert.ok(f.w.document.querySelector('#图像输出 img'));
  assert.equal(box.value, 'perchance');
  assert.equal(f.calls.filter(isImageSubmit).length, 0);
});

test('Perch without official plugin uses Horde photoreal in-app', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎'); box.value = 'perchance';
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.equal(typeof f.w.update, 'undefined');
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1, 'in-app Perch uses Horde photoreal');
  const payload = JSON.parse(posts[0].body);
  assert.ok(isRealHorde(payload));
  assert.match(payload.prompt, /photorealistic RAW photo/i);
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'perchance');
});


test('failed manual Horde request does not call Sana or Perchance', async t => {
  const f = await setup(t, () => response({error:'upstream unavailable'}, 502));
  f.w.update = () => { throw new Error('unexpected Perchance fallback'); };
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('出图引擎').value, 'horde-real');
  assert.equal(f.calls.filter(c => String(c.url).includes('/api/workshop/image')).length, 0);
  assert.equal(f.w.document.querySelector('#图像输出 img'), null);
  assert.match(f.text(), /upstream unavailable/);
});


test('workshop offers Perchance as initial choice without locking selection', () => {
  const dom = new JSDOM(html);
  const box = dom.window.document.getElementById('出图引擎');
  assert.equal(box.value, 'perchance'); assert.equal(box.disabled, false);
  dom.window.close();
});

test('server keeps leftover Pollinations aliases on sana; Perchance no longer routes through it', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /IMAGE_MODELS = new Set\(\[[^\]]*['"]perchance['"]/);
  assert.match(server, /if \(model === 'perch' \|\| model === '官方'\) return 'perchance'/);
  assert.match(server, /function pollinationsModelFor/);
  assert.match(server, /return 'sana'/);
  assert.match(server, /Perchance no longer uses this proxy/);
  assert.doesNotMatch(server, /if \(model === 'perchance'\) return 'flux-realism'/);
});


test('failed Perchance official plugin falls back to Horde photoreal', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎'); box.value = 'perchance';
  let plugin = 0;
  f.w.update = () => { plugin++; throw new Error('official offline'); };
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(plugin, 1);
  assert.equal(box.value, 'perchance');
  assert.equal(opened.length, 0, 'must never open perchance.org');
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1, 'falls back to Horde photoreal');
  const payload = JSON.parse(posts[0].body);
  assert.ok(isRealHorde(payload));
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'perchance');
});

test('photorealPrompt enriches by default but style-keyword bypass keeps anime/二次元/插画', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.photorealPrompt, 'function');
  assert.equal(typeof f.w.hasExplicitArtStyle, 'function');

  const plain = f.w.photorealPrompt('a fictional adult standing by a rainy window');
  assert.match(plain, /a fictional adult standing by a rainy window/i);
  assert.match(plain, /^photorealistic RAW photo/i);
  assert.match(plain, /photoreal|cinematic|natural light|texture|DSLR|85mm/i);
  assert.match(plain, /not anime|not manga|not cartoon/i);
  assert.ok(plain.length > 'a fictional adult standing by a rainy window'.length);
  assert.ok(plain.toLowerCase().indexOf('photorealistic raw photo') < plain.toLowerCase().indexOf('fictional adult standing'));

  const anime = f.w.photorealPrompt('anime style girl with red hair under cherry blossoms');
  assert.match(anime, /anime style girl with red hair under cherry blossoms/i);
  assert.doesNotMatch(anime, /not anime|not manga|not cartoon|photorealistic RAW photo/i);
  assert.equal(f.w.hasExplicitArtStyle('二次元插画 夜市少女'), true);
  assert.equal(f.w.hasExplicitArtStyle('窗边的小猫'), false);
  const cn = f.w.photorealPrompt('二次元插画，夜市里的成年少女吃章鱼烧');
  assert.match(cn, /二次元插画/);
  assert.doesNotMatch(cn, /not anime|photorealistic RAW photo/i);
});

test('写实 channel strips anime keywords and always sends photoreal negatives', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.document.getElementById('角色描述').value = 'anime style fictional adult in neon alley';
  f.w.document.getElementById('中文译文').value = '霓虹巷弄里的动漫成年角色';
  f.w.document.getElementById('英文描述').value = 'anime style fictional adult in neon alley';
  if (typeof f.w.刷新画面说明 === 'function') f.w.刷新画面说明();
  const beforeZh = f.w.document.getElementById('中文译文').value;
  const beforeEn = f.w.document.getElementById('英文描述').value;
  const beforeTitle = f.w.document.getElementById('说明标题').textContent;
  const beforeCap = f.w.document.getElementById('说明英文').textContent;
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /photorealistic RAW photo/i);
  assert.match(payload.prompt, /not anime|not manga/i);
  assert.match(payload.prompt, /###/);
  assert.match(payload.prompt, /anime|manga|cartoon|illustration/i);
  assert.ok(isRealHorde(payload));
  assert.equal(f.w.document.getElementById('中文译文').value, beforeZh);
  assert.equal(f.w.document.getElementById('英文描述').value, beforeEn);
  assert.equal(f.w.document.getElementById('说明标题').textContent, beforeTitle);
  assert.equal(f.w.document.getElementById('说明英文').textContent, beforeCap);
});

test('default generation keeps visible core unchanged while enriching the private prompt', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = 'A fictional adult reading by a library window';
  f.w.document.getElementById('中文译文').value = '图书馆窗边的成年人';
  f.w.document.getElementById('英文描述').value = 'A fictional adult reading by a library window';
  if (typeof f.w.刷新画面说明 === 'function') f.w.刷新画面说明();
  const beforeCore = f.w.document.getElementById('角色描述').value;
  const beforeZh = f.w.document.getElementById('中文译文').value;
  const beforeEn = f.w.document.getElementById('英文描述').value;
  const beforeCap = f.w.document.getElementById('说明英文').textContent;
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /A fictional adult reading by a library window/i);
  assert.match(payload.prompt, /^photorealistic RAW photo/i);
  assert.match(payload.prompt, /not anime, not manga, not cartoon/i);
  assert.equal(f.w.document.getElementById('角色描述').value, beforeCore, '核心描述 must stay user text');
  assert.equal(f.w.document.getElementById('中文译文').value, beforeZh);
  assert.equal(f.w.document.getElementById('英文描述').value, beforeEn);
  assert.equal(f.w.document.getElementById('说明英文').textContent, beforeCap);
  assert.doesNotMatch(f.w.document.getElementById('角色描述').value, /photorealistic RAW photo|not anime, not manga/i);
});

test('清空描述 clears core and linked prompt fields but not gallery', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.ok(f.w.document.getElementById('清空描述按钮'), '清空描述 button present');
  assert.equal(typeof f.w.清空描述, 'function');
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.document.getElementById('中文译文').value = '窗边的小猫';
  f.w.document.getElementById('英文描述').value = 'a cat by the window';
  f.w.document.getElementById('安全英文').value = 'a cat by the window, photorealistic RAW photo';
  f.w.document.getElementById('图像输出').innerHTML = '<img src="' + PNG + '" alt="keep">';
  f.w.清空描述();
  assert.equal(f.w.document.getElementById('角色描述').value, '');
  assert.equal(f.w.document.getElementById('中文译文').value, '');
  assert.equal(f.w.document.getElementById('英文描述').value, '');
  assert.equal(f.w.document.getElementById('安全英文').value, '');
  assert.equal(f.w.document.querySelectorAll('#图像输出 img').length, 1, 'gallery untouched');
});

test('generatePerchance source does not assign enriched prompt into 英文描述', async t => {
  const src = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /var prevSafe = safeBox/);
  assert.doesNotMatch(src, /engBox\.value\s*=\s*prompt/);
  assert.match(src, /safeBox\.value\s*=\s*prompt/);
});


test('auto-race loss must not hang Perchance and cool-down remains cancelled', async t => {
  const src = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /if \(run && run\._raceSettled\) throw new Error\('lost-race'\)/);
  assert.match(src, /lost-race/);
  assert.match(src, /PERCHANCE_COOLDOWN_MS = 0/);
  assert.match(src, /perchanceCoolHint/);
  assert.doesNotMatch(src, /PERCHANCE_COOLDOWN_MS = 15000/);
  assert.doesNotMatch(src, /PERCHANCE_COOLDOWN_MS = 30000/);
});

test('智能修饰 writes visible core modifiers and generation uses that text', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.ok(f.w.document.getElementById('智能修饰按钮'), '智能修饰 button present');
  assert.equal(typeof f.w.智能修饰, 'function');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.document.getElementById('角色描述').value = '窗边看书的成年人';
  f.w.document.getElementById('中文译文').value = '窗边看书的成年人';
  f.w.document.getElementById('英文描述').value = 'an adult reading by the window';
  f.w.智能修饰();
  const afterFirst = f.w.document.getElementById('角色描述').value;
  assert.match(afterFirst, /^窗边看书的成年人/);
  assert.match(afterFirst, /写实摄影|单反|皮肤|非动漫/);
  assert.ok(afterFirst.length > '窗边看书的成年人'.length);
  f.w.智能修饰();
  const afterSecond = f.w.document.getElementById('角色描述').value;
  assert.match(afterSecond, /^窗边看书的成年人/);
  assert.notEqual(afterSecond, afterFirst);
  assert.ok(afterSecond.indexOf(afterFirst) === -1, 'must not stack previous full enriched text');
  f.w.document.getElementById('角色描述').value = '动漫风格的窗边成年人';
  f.w.智能修饰();
  const animeCore = f.w.document.getElementById('角色描述').value;
  assert.match(animeCore, /二次元|动漫|插画|赛璐璐|线稿/);
  assert.doesNotMatch(animeCore, /写实摄影|非动漫非卡通/);
  f.w.document.getElementById('角色描述').value = afterFirst;
  f.w.document.getElementById('角色描述').dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.equal(f.w.document.getElementById('角色描述').value, afterFirst);
  assert.ok(payload.prompt && payload.prompt.length > 8);
  assert.match(payload.prompt, /photorealistic/i);
});

test('photorealPrompt helper still available for style-aware enrich logic', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const plain = f.w.photorealPrompt('a fictional adult standing by a rainy window');
  assert.match(plain, /^photorealistic RAW photo/i);
  assert.match(plain, /not anime|not manga|not cartoon/i);
  const anime = f.w.animePrompt('a fictional adult standing by a rainy window');
  assert.match(anime, /anime illustration/i);
  assert.doesNotMatch(anime, /not anime|photorealistic RAW photo/i);
  assert.equal(f.w.engineFamily('horde-anime'), 'anime');
  assert.equal(f.w.engineFamily('perchance'), 'perchance');
  assert.equal(f.w.engineFamily('turbo'), 'real');
  assert.equal(typeof f.w.forcePhotorealPrompt, 'function');
  const forced = f.w.forcePhotorealPrompt('anime style girl with red hair');
  assert.match(forced, /photorealistic RAW photo/i);
  assert.match(forced, /not anime/i);
  assert.doesNotMatch(forced, /\banime style\b/i);
});

test('manual Horde anime choice reaches its requested style', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'horde-anime';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.ok(Array.isArray(payload.models) && payload.models.includes('WAI-NSFW-illustrious-SDXL'));
  assert.doesNotMatch(String(payload.prompt).split('###')[1] || '', /anime|manga|cartoon/i);
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'horde-anime');
});

test('img2img honors its own provider selection and never calls Sana', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-anime';
  f.w.用户选定图生图平台 = 'horde-anime';
  f.w.document.getElementById('出图引擎').value = 'auto-real';
  const realFetch = f.w.fetch;
  const pollinationHits = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image') || href.includes('image.pollinations.ai')) {
      pollinationHits.push(href);
      return { ok: false, status: 429, blob: async () => new f.w.Blob([]) };
    }
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.equal(pollinationHits.length, 0);
  const payload = imagePayload(f.calls);
  assert.ok(Array.isArray(payload.models) && payload.models.includes('WAI-NSFW-illustrious-SDXL'));
  assert.ok(payload.source_image);
  const engine = f.w.document.querySelector('#图像输出 img').getAttribute('data-engine');
  assert.equal(engine, 'horde-anime');
});

test('picker no longer lists dead turbo/flux/flux-realism platforms', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  assert.equal(box.querySelector('option[value="turbo"]'), null);
  assert.equal(box.querySelector('option[value="flux"]'), null);
  assert.equal(box.querySelector('option[value="flux-realism"]'), null);
  assert.equal(box.querySelector('option[value="auto-real"]'), null);
  assert.equal(box.querySelector('option[value="auto-anime"]'), null);
  assert.ok(box.querySelector('option[value="horde-real"]'));
  assert.ok(box.querySelector('option[value="horde-anime"]'));
  assert.equal(box.querySelector('optgroup[label="写实"]'), null);
  assert.equal(box.querySelector('optgroup[label="动漫"]'), null);
  assert.ok(box.querySelector('option[value="perchance"]'));
  assert.equal(box.disabled, false);
  assert.equal(box.querySelector('option[value="glm"]'), null);
  const img2img = f.w.document.getElementById('图生图平台');
  assert.ok(img2img.querySelector('option[value="perchance"]'));
  assert.ok(img2img.querySelector('option[value="horde-real"]'));
  assert.ok(img2img.querySelector('option[value="horde-anime"]'));
  assert.equal(img2img.querySelector('option[value="auto"]'), null);
  assert.equal(img2img.disabled, false);
});


test('production feature injection preserves manual choice through two generations and image load', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  box.value = 'horde-real';
  // outside-only executes scripts explicitly; bind the actual HTML event handler too.
  box.onchange = f.w.Function(box.getAttribute('onchange'));
  box.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  for (let i = 0; i < 2; i++) {
    await f.w.开始生成();
    const image = f.w.document.querySelector('#图像输出 img');
    assert.ok(image);
    image.dispatchEvent(new f.w.Event('load'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(box.value, 'horde-real');
    assert.equal(box.disabled, false);
    assert.equal(f.w.localStorage.getItem('角色生成器_默认平台'), 'horde-real');
    assert.doesNotMatch(f.w.document.getElementById('平台提示').textContent, /已锁定|Perch/);
  }
  assert.equal(f.calls.filter(isImageSubmit).length, 2);
});

test('shows danger/adult warning overlay then enables adult mode on confirm', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const layer = f.w.document.getElementById('成人确认层');
  const tick = f.w.document.getElementById('成人模式对勾');
  assert.ok(layer, 'official-style warning overlay required');
  assert.match(layer.textContent, /危险内容与成人提示/);
  assert.match(layer.textContent, /我已年满 18 岁/);
  assert.equal(layer.hidden, false);
  assert.equal(f.w.document.getElementById('成人图标按钮'), null);
  assert.doesNotMatch(f.w.document.querySelector('.顶栏右侧').textContent, /成人模式/);
  const sw = f.w.document.getElementById('成人开关按钮');
  assert.ok(sw);
  assert.equal(sw.textContent.trim(), '✓');
  assert.equal(sw.getAttribute('aria-pressed'), 'true');
  assert.ok(tick);
  assert.equal(tick.checked, true);
  assert.equal(f.w.成人主题已开启, true);
  assert.equal(f.w.document.getElementById('确认开启按钮'), null);
  f.w.document.getElementById('成人统一确认').checked = true;
  f.w.检查成人确认按钮();
  assert.equal(layer.hidden, true);
  assert.equal(f.w.成人主题已开启, true);
  assert.equal(tick.checked, true);
  assert.equal(f.w.localStorage.getItem('角色生成器_成人确认'), '1');
  assert.match(f.w.document.getElementById('成人功能状态').value, /NSFW allowed/);
  assert.equal(sw.textContent.trim(), '✓');
  f.w.藏编辑钮();
  assert.equal(layer.hidden, true);
  assert.ok(layer.getAttribute('style') === null || !/display:\s*none/i.test(layer.getAttribute('style') || ''));
  tick.checked = false;
  f.w.切换成人对勾(false);
  assert.equal(f.w.成人主题已开启, false);
  assert.equal(tick.checked, false);
  assert.equal(sw.textContent.trim(), '');
  tick.checked = true;
  f.w.切换成人对勾(true);
  assert.equal(layer.hidden, true);
  assert.equal(f.w.成人主题已开启, true);
  assert.equal(tick.checked, true);
  assert.equal(sw.textContent.trim(), '✓');
});
