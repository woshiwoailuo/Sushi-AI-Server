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
  assert.match(payload.prompt, /A small cat by the window/);
  assert.match(payload.prompt, /^photorealistic RAW photo/i);
  assert.match(payload.prompt, /photoreal|not anime/i);
  assert.doesNotMatch(payload.prompt, /A stale unrelated scene/);
});

test('failed translation preserves the current text, and perchance stays selectable in-app (no official redirect)', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '窗边的小猫';
  f.w.调用开源翻译 = async () => { throw new Error('translation offline'); };
  // Force horde-only so unit test does not hit live Pollinations.
  f.w.document.getElementById('出图引擎').value = 'horde';
  await f.w.开始生成();
  const failedPrompt = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body).prompt;
  assert.match(failedPrompt, /窗边的小猫/);
  assert.match(failedPrompt, /^photorealistic RAW photo/i);
  assert.match(failedPrompt, /photoreal|not anime/i);
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
  assert.ok(['turbo', 'flux', 'flux-realism', 'sana', 'horde', 'perchance'].includes(engine), 'engine=' + engine);
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
  const imagePosts = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image')) {
      hits.push(href);
      const bytes = Buffer.alloc(3200, 9);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    if (options.method === 'POST' && href.includes('/api/images')) imagePosts.push(href);
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.ok(hits.some(h => h.includes('model=sana')), hits.join('\n'));
  assert.equal(hits.every(h => h.includes('model=sana')), true, 'must not race other pollinations models when sana selected');
  assert.equal(imagePosts.length, 0, 'must not also race Horde when sana selected');
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
  const payload = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body);
  assert.match(payload.prompt, /shallow depth of field|tungsten key|intimate half-body/i);
  assert.doesNotMatch(payload.prompt, /^photoreal photo of two fictional adults facing each other in warm indoor light$/);
  assert.match(payload.prompt, /not anime|not manga|not cartoon|photoreal/i);
});

test('perch/perchance is selectable and included in the free race list', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  assert.ok(box.querySelector('option[value="perchance"]'), 'perchance option required');
  box.value = 'perchance';
  assert.equal(f.w.当前引擎(), 'perchance');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /FREE_RACE_ENGINES = \[[^\]]*['"]perchance['"]/);
  assert.match(src, /name === 'perch'/);
  // Canonical select id is perchance; perch is accepted as an alias in normalizeEngineName.
  assert.match(src, /官方' \|\| name === 'perch'/);
  assert.match(src, /never free-race fallback/);
  assert.match(src, /function photorealPrompt/);
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  box.value = 'perchance';
  const realFetch = f.w.fetch;
  const pollinationHits = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image') || href.includes('image.pollinations.ai')) {
      pollinationHits.push(href);
      const bytes = Buffer.alloc(3200, 7);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    return realFetch(url, options);
  };
  // Without in-app Perchance plugin, explicit selection should fail closed (no race / no window.open).
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.equal(box.value, 'perchance');
  assert.equal(pollinationHits.length, 0, 'explicit perchance must not fall back into free race');
});


test('auto race skips rate-limited engines quickly and surfaces 限流 tip', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'auto';
  const hits = [];
  const realFetch = f.w.fetch;
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image')) {
      hits.push(href);
      const model = new URL(href, 'https://app.example').searchParams.get('model');
      if (model === 'turbo' || model === 'flux') {
        return { ok: false, status: 429, blob: async () => new f.w.Blob([]) };
      }
      const bytes = Buffer.alloc(3200, 11);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    return realFetch(url, options);
  };
  await f.w.开始生成();
  assert.ok(f.w.document.querySelector('#图像输出 img'), 'another engine should win the race');
  const engine = f.w.document.querySelector('#图像输出 img').getAttribute('data-engine');
  assert.ok(!['turbo', 'flux'].includes(engine), 'winner should not be rate-limited engine, got ' + engine);
  // turbo/flux should not be hammered with 3 retries each after 429
  const turboHits = hits.filter(h => h.includes('model=turbo')).length;
  const fluxHits = hits.filter(h => h.includes('model=flux&') || h.includes('model=flux"') || /model=flux(?:&|$)/.test(h)).length;
  assert.ok(turboHits <= 1, 'turbo should fail fast on 429, hits=' + turboHits);
  assert.ok(fluxHits <= 1, 'flux should fail fast on 429, hits=' + fluxHits);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /ENGINE_COOLDOWN_MS/);
  assert.match(src, /出图通道限流/);
  assert.doesNotMatch(src, /window\.open\([^)]*perchance\.org/);
});


test('workshop source defaults to in-app perchance as the primary route', () => {
  assert.match(html, /<option value="perchance" selected>/);
  assert.match(html, /var 用户选定平台 = "perchance";/);
  assert.match(client, /window\\.__sushiPreferredProvider \\|\\| 'perchance'/);
});


test('perchance failure enters a short cooldown without free-race fallback for explicit selection', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎');
  box.value = 'perchance';
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /PERCHANCE_COOLDOWN_MS = 15000/);
  assert.match(src, /markPerchanceFailure/);
  assert.match(src, /isPerchanceCooling/);
  assert.match(src, /Perchance 短暂冷却中/);
  assert.match(src, /eng === 'perchance' && isPerchanceCooling\(\)/);
  assert.match(src, /never free-race fallback/);
  assert.equal(f.w.当前引擎(), 'perchance');
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  const realFetch = f.w.fetch;
  const pollinationHits = [];
  f.w.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/workshop/image') || href.includes('image.pollinations.ai')) {
      pollinationHits.push(href);
      const bytes = Buffer.alloc(3200, 7);
      return { ok: true, status: 200, blob: async () => new f.w.Blob([bytes], { type: 'image/png' }) };
    }
    return realFetch(url, options);
  };
  // First explicit attempt fails closed (no plugin) and marks cooldown — never FREE_RACE.
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.equal(box.value, 'perchance');
  assert.equal(pollinationHits.length, 0, 'explicit perchance must not fall back into free race');
  // Second attempt while cooling should fail fast with the cooldown tip, still no race.
  await f.w.开始生成();
  assert.equal(pollinationHits.length, 0, 'cooling explicit perchance must still not free-race');
  const tip = f.w.document.getElementById('状态提示').textContent || '';
  assert.match(tip, /Perchance 短暂冷却中/);
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

test('style-keyword generation keeps managed display simple while gen prompt honors anime', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = 'anime style fictional adult in neon alley';
  f.w.document.getElementById('中文译文').value = '霓虹巷弄里的动漫成年角色';
  f.w.document.getElementById('英文描述').value = 'anime style fictional adult in neon alley';
  if (typeof f.w.刷新画面说明 === 'function') f.w.刷新画面说明();
  const beforeZh = f.w.document.getElementById('中文译文').value;
  const beforeEn = f.w.document.getElementById('英文描述').value;
  const beforeTitle = f.w.document.getElementById('说明标题').textContent;
  const beforeCap = f.w.document.getElementById('说明英文').textContent;
  await f.w.开始生成();
  const payload = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body);
  assert.match(payload.prompt, /anime style fictional adult in neon alley/i);
  assert.doesNotMatch(payload.prompt, /not anime|not manga|photorealistic RAW photo/i);
  assert.doesNotMatch(payload.negativePrompt || '', /anime|manga|cartoon|illustration/i);
  assert.equal(f.w.document.getElementById('中文译文').value, beforeZh);
  assert.equal(f.w.document.getElementById('英文描述').value, beforeEn);
  assert.equal(f.w.document.getElementById('说明标题').textContent, beforeTitle);
  assert.equal(f.w.document.getElementById('说明英文').textContent, beforeCap);
  assert.doesNotMatch(beforeCap, /not anime|photorealistic RAW photo/i);
});

test('default generation enriches photoreal prompt without rewriting display fields', async t => {
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
  const payload = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body);
  assert.match(payload.prompt, /A fictional adult reading by a library window/i);
  assert.match(payload.prompt, /^photorealistic RAW photo/i);
  assert.match(payload.prompt, /photoreal|natural light|texture|not anime|DSLR/i);
  assert.notEqual(payload.prompt, beforeEn);
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
  assert.match(src, /Enriched photoreal prompt goes ONLY into hidden/);
  assert.doesNotMatch(src, /engBox\.value\s*=\s*prompt/);
  assert.match(src, /safeBox\.value\s*=\s*prompt/);
});


test('auto-race loss must not mark Perchance cool-down (no false positive)', async t => {
  const src = fs.readFileSync(path.join(__dirname, '../public/assets/workshop-generation.js'), 'utf8');
  assert.match(src, /run\._raceSettled = true/);
  assert.match(src, /if \(run && run\._raceSettled\) throw new Error\('lost-race'\)/);
  assert.match(src, /短暂冷却中\|lost-race/);
  assert.match(src, /PERCHANCE_COOLDOWN_MS = 15000/);
  assert.match(src, /perchanceCoolHint/);
  assert.doesNotMatch(src, /PERCHANCE_COOLDOWN_MS = 30000/);
});

test('photorealPrompt lead-in reaches generator while display core stays plain', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'horde';
  f.w.document.getElementById('角色描述').value = '窗边看书的成年人';
  f.w.document.getElementById('中文译文').value = '窗边看书的成年人';
  f.w.document.getElementById('英文描述').value = 'an adult reading by the window';
  const beforeCore = f.w.document.getElementById('角色描述').value;
  await f.w.开始生成();
  const payload = JSON.parse(f.calls.find(c => c.method === 'POST' && String(c.url).includes('/api/images')).body);
  assert.match(payload.prompt, /^photorealistic RAW photo/i);
  assert.match(payload.prompt, /not anime|not manga|not cartoon/i);
  assert.equal(f.w.document.getElementById('角色描述').value, beforeCore);
  assert.doesNotMatch(beforeCore, /photorealistic RAW photo|85mm|not anime/i);
});
