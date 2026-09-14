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
function isPerchOfficial(c) {
  return /image-generation\.perchance\.org\/api\/generate/.test(String(c.url));
}
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
    if (href.includes('image-generation.perchance.org')) {
      if (href.includes('verifyUser')) {
        const data = { userKey: 'test-key', status: 'ok' };
        return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
      }
      if (href.includes('/generate')) {
        const data = { status: 'success', imageId: 'pc-img' };
        return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
      }
      if (href.includes('downloadTemporaryImage')) {
        const raw = Buffer.from(PNG.split(',')[1], 'base64');
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
          blob: async () => new w.Blob([raw], { type: 'image/png' })
        };
      }
    }
    if (href.includes('/api/workshop/structure-prompt')) {
      const result = await handler(url, options, calls);
      let data = {};
      try { data = await result.json(); } catch (e) { data = {}; }
      if (data && data.promptEn) return response(data, result.status || 200);
      if (result.status === 503 || (data && data.error && !data.id)) return result;
      return response({ error: 'structure unavailable in unit test' }, 503);
    }
    if (href.includes('/api/image-failure-stats')) return response({ ok: true, counts: {} });
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

test('structure-prompt success feeds compact English without overwriting 核心描述', async t => {
  const f = await setup(t, (url, options) => {
    const href = String(url);
    if (href.includes('/api/workshop/structure-prompt')) {
      return response({
        ok: true,
        source: 'chat',
        promptEn: 'fictional adult woman, black hair, red dress, rainy street, 50mm, neon light, photoreal',
        fields: { subject: 'fictional adult woman', clothing: 'red dress' }
      });
    }
    return response(options.method === 'POST' ? job() : job('done'));
  });
  const coreBefore = '一位虚构成年女性穿红裙站在雨夜街头';
  f.w.document.getElementById('角色描述').value = coreBefore;
  // 结构化扩写仅在智能修饰开启后走；未修饰时只译核心
  await f.w.智能修饰();
  assert.equal(f.w.hasSmartModifier(), true);
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('角色描述').value, coreBefore, '核心描述 stays source of truth');
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /red dress|rainy street|photoreal/i);
  assert.doesNotMatch(payload.prompt, /一位虚构/);
});

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
  const f = await setup(t, (url, options) => {
    const href = String(url);
    if (/structure-prompt|image-failure-stats/.test(href)) return response({ error: 'skip' }, 503);
    return options.method === 'POST' ? pending : response(job('cancelled'));
  });
  const running = f.w.开始生成();
  await until(() => f.calls.some(isImageSubmit), 'image submission');
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
  // 未智能修饰：只译核心，不堆写实修饰词库
  assert.doesNotMatch(payload.prompt.split(' ### ')[0], /photorealistic RAW photo/i);
  assert.match(payload.prompt, /no text in image|no pinyin/i);
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
  assert.equal(f.calls.filter(isImageSubmit).length, posts, 'Perch must not relay Horde');
  assert.ok(f.calls.some(isPerchOfficial), 'Perch uses official generate');
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

test('Perch without official plugin uses official generate in-app', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎'); box.value = 'perchance';
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.equal(typeof f.w.update, 'undefined');
  assert.equal(f.calls.filter(isImageSubmit).length, 0, 'must not relay Horde');
  assert.ok(f.calls.some(isPerchOfficial), 'in-app Perch uses official generate');
  const gen = f.calls.find(isPerchOfficial);
  const perchPrompt = decodeURIComponent(String(gen.url).replace(/\+/g, '%20'));
  assert.match(perchPrompt, /small cat|sunny window/i);
  assert.doesNotMatch(perchPrompt, /photorealistic RAW photo/i);
  assert.match(perchPrompt, /no text in image|no pinyin|no watermark/i);
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


test('failed Perchance page plugin uses official generate without Horde', async t => {
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
  assert.equal(f.calls.filter(isImageSubmit).length, 0, 'must not relay Horde');
  assert.ok(f.calls.some(isPerchOfficial), 'falls back to official generate');
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'perchance');
});

test('Perch official Load failed uses in-app photoreal', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('出图引擎'); box.value = 'perchance';
  const inner = f.w.fetch;
  f.w.fetch = (url, options) => {
    if (/image-generation\.perchance\.org/.test(String(url))) {
      return Promise.reject(Object.assign(new TypeError('Load failed'), { name: 'TypeError' }));
    }
    return inner(url, options);
  };
  const opened = [];
  f.w.open = (url) => { opened.push(String(url)); return null; };
  await f.w.开始生成();
  assert.equal(opened.length, 0, 'must never open perchance.org');
  assert.ok(f.calls.filter(isImageSubmit).length >= 1, 'blocked official uses in-app photoreal');
  assert.equal(f.w.document.querySelector('#图像输出 img').getAttribute('data-engine'), 'perchance');
  assert.doesNotMatch(f.text(), /Load failed/);
});

test('photorealPrompt enriches by default but style-keyword bypass keeps anime/二次元/插画', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.photorealPrompt, 'function');
  assert.equal(typeof f.w.hasExplicitArtStyle, 'function');

  const plain = f.w.photorealPrompt('a fictional adult standing by a rainy window');
  assert.match(plain, /a fictional adult standing by a rainy window/i);
  assert.match(plain, /photorealistic photograph|natural light/i);
  assert.ok(/clothing matching the core|Faithful to core description|photorealistic photograph/i.test(plain));
  assert.match(plain, /photoreal|natural light/i);
  assert.match(plain, /not anime|not cartoon|not 2d/i);
  assert.ok(plain.length > 'a fictional adult standing by a rainy window'.length);
  assert.ok(plain.toLowerCase().indexOf('photorealistic') < plain.toLowerCase().indexOf('fictional adult standing'));

  const anime = f.w.photorealPrompt('anime style girl with red hair under cherry blossoms');
  assert.match(anime, /anime style girl with red hair under cherry blossoms/i);
  assert.doesNotMatch(anime, /not anime|not manga|not cartoon|photorealistic photograph|photorealistic RAW photo/i);
  assert.equal(f.w.hasExplicitArtStyle('二次元插画 夜市少女'), true);
  assert.equal(f.w.hasExplicitArtStyle('窗边的小猫'), false);
  const cn = f.w.photorealPrompt('二次元插画，夜市里的成年少女吃章鱼烧');
  assert.match(cn, /二次元插画/);
  assert.doesNotMatch(cn, /not anime|photorealistic photograph|photorealistic RAW photo/i);
});

test('写实 channel without smart-mod stays translate-only but still bans text/pinyin in negatives', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.document.getElementById('角色描述').value = 'fictional adult in neon alley';
  f.w.document.getElementById('中文译文').value = '霓虹巷弄里的成年角色';
  f.w.document.getElementById('英文描述').value = 'fictional adult in neon alley';
  if (typeof f.w.刷新画面说明 === 'function') f.w.刷新画面说明();
  const beforeZh = f.w.document.getElementById('中文译文').value;
  const beforeEn = f.w.document.getElementById('英文描述').value;
  const beforeTitle = f.w.document.getElementById('说明标题').textContent;
  const beforeCap = f.w.document.getElementById('说明英文').textContent;
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /fictional adult in neon alley/i);
  assert.doesNotMatch(payload.prompt, /photorealistic RAW photo/i);
  assert.match(payload.prompt, /###/);
  assert.match(payload.prompt, /pinyin|romanization|watermark|text/i);
  assert.ok(isRealHorde(payload));
  assert.equal(f.w.document.getElementById('中文译文').value, beforeZh);
  assert.equal(f.w.document.getElementById('英文描述').value, beforeEn);
  assert.equal(f.w.document.getElementById('说明标题').textContent, beforeTitle);
  assert.equal(f.w.document.getElementById('说明英文').textContent, beforeCap);
});

test('default generation keeps visible core unchanged; no smart-mod means translate-only outbound', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = 'A fictional adult reading by a library window';
  f.w.document.getElementById('中文译文').value = '图书馆窗边的成年人';
  f.w.document.getElementById('英文描述').value = 'A fictional adult reading by a library window';
  if (typeof f.w.刷新画面说明 === 'function') f.w.刷新画面说明();
  const beforeCore = f.w.document.getElementById('角色描述').value;
  const beforeZh = f.w.document.getElementById('中文译文').value;
  const beforeEn = f.w.document.getElementById('英文描述').value;
  const beforeCap = f.w.document.getElementById('说明英文').textContent;
  assert.equal(f.w.hasSmartModifier(), false);
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /A fictional adult reading by a library window/i);
  assert.doesNotMatch(payload.prompt, /photorealistic RAW photo|natural skin pores|cinematic still/i);
  assert.match(payload.prompt, /adult mode enabled/i);
  assert.match(payload.prompt, /no text in image|no pinyin|no watermark/i);
  assert.equal(f.w.document.getElementById('角色描述').value, beforeCore, '核心描述 must stay user text');
  assert.equal(f.w.document.getElementById('中文译文').value, beforeZh);
  assert.equal(f.w.document.getElementById('英文描述').value, beforeEn);
  assert.equal(f.w.document.getElementById('说明英文').textContent, beforeCap);
  assert.doesNotMatch(f.w.document.getElementById('角色描述').value, /photorealistic RAW photo|not anime, not manga/i);
});

test('outbound stays faithful to core: fidelity lead, key facts, no core mutation', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.applyCoreFidelityLead, 'function');
  assert.match(f.w.CORE_FIDELITY_LEAD, /Faithful to core description|do not invent clothing/i);
  assert.match(f.w.CORE_FIDELITY_LEAD, /include every explicitly described element|omit none/i);
  const core = 'a fictional adult East Asian woman in a red knit sweater, side view, standing in a quiet library';
  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('英文描述').value = core;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  assert.equal(f.w.hasSmartModifier(), false);
  const minimal = f.w.minimalOutboundPrompt(core, { core: core });
  assert.match(minimal, /Faithful to core description/i);
  assert.match(minimal, /red knit sweater/i);
  assert.match(minimal, /side view|library|East Asian/i);
  assert.doesNotMatch(minimal, /photorealistic RAW photo|cinematic still|shallow depth of field/i);
  assert.doesNotMatch(minimal, /\bnude\b|\bnaked\b|unclothed|bikini|beach party/i);
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  assert.match(pos, /Faithful to core description|follow the core description/i);
  assert.match(pos, /red knit sweater/i);
  assert.match(pos, /side view|library/i);
  assert.doesNotMatch(pos, /\bnude\b|\bnaked\b|do not add clothes|keep requested nudity/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心描述 must not mutate');
  // Smart-mod must not force front-view when core asks side view
  f.w.document.getElementById('角色描述').value = core;
  f.w.智能修饰();
  assert.equal(f.w.document.getElementById('角色描述').value, core);
  const mod = f.w.读取智能修饰后缀();
  const gated = f.w.sanitizeModifierAgainstCore(mod, core);
  assert.doesNotMatch(gated, /front view facing camera|full-body front view eye-level facing camera/i);
  assert.match(gated, /photoreal|DSLR|not anime|photography/i);
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

test('智能修饰 does not rewrite core; outbound uses English modifiers', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.ok(f.w.document.getElementById('智能修饰按钮'), '智能修饰 button present');
  assert.equal(typeof f.w.智能修饰, 'function');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  const core = '窗边看书的成年人';
  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('中文译文').value = core;
  f.w.document.getElementById('英文描述').value = 'an adult reading by the window';
  f.w.智能修饰();
  assert.equal(f.w.document.getElementById('角色描述').value, core, '核心描述 must stay untouched');
  const mod1 = f.w.读取智能修饰后缀();
  assert.match(mod1, /photorealistic|DSLR|full-body|not anime/i);
  assert.doesNotMatch(mod1, /[一-鿿]/);
  f.w.智能修饰();
  assert.equal(f.w.document.getElementById('角色描述').value, core);
  const mod2 = f.w.读取智能修饰后缀();
  assert.notEqual(mod2, mod1);
  assert.match(mod2, /photoreal|portrait|photography|not anime/i);
  f.w.document.getElementById('角色描述').value = '动漫风格的窗边成年人';
  f.w.智能修饰();
  assert.equal(f.w.document.getElementById('角色描述').value, '动漫风格的窗边成年人');
  const animeMod = f.w.读取智能修饰后缀();
  assert.match(animeMod, /anime|illustration|lineart|cel/i);
  assert.doesNotMatch(animeMod, /photorealistic photography style|not anime, not manga/i);
  f.w.document.getElementById('角色描述').value = core;
  f.w.智能修饰(); // reset cycle on new base → first photoreal mod
  assert.equal(f.w.document.getElementById('角色描述').value, core);
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.equal(f.w.document.getElementById('角色描述').value, core, 'generate must not rewrite core');
  assert.ok(payload.prompt && payload.prompt.length > 8);
  assert.match(payload.prompt, /photorealistic/i);
  assert.doesNotMatch(payload.prompt, /勿覆盖|用简体中文回复|请只输出/);
});

test('智能修饰 cycles prepared pool then asks AI without stacking or rewriting core', async t => {
  let chatBodies = [];
  const f = await setup(t, (url, options) => {
    const href = String(url || '');
    const method = (options && options.method) || 'GET';
    if (method === 'POST' && /\/api\/workshop\/chat/.test(href)) {
      chatBodies.push(JSON.parse(options.body || '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: ', AI official photoreal modifier, full-body front, natural light, not anime, fictional adult 18+' } }] }),
        text: async () => JSON.stringify({ choices: [{ message: { content: ', AI official photoreal modifier, full-body front, natural light, not anime, fictional adult 18+' } }] })
      };
    }
    return response(method === 'POST' ? job() : job('done'));
  });
  const box = f.w.document.getElementById('角色描述');
  const core = '窗边看书的成年人';
  box.value = core;
  const seen = [];
  await f.w.智能修饰();
  assert.equal(box.value, core);
  seen.push(f.w.读取智能修饰后缀());
  assert.match(seen[0], /photorealistic|full-body|not anime/i);
  for (let i = 0; i < 12; i++) {
    await f.w.智能修饰();
    assert.equal(box.value, core, 'core must never change while cycling modifiers');
    const cur = f.w.读取智能修饰后缀();
    assert.ok(seen.every(prev => prev !== cur), 'must replace previous suffix, not stack');
    seen.push(cur);
    if (chatBodies.length) break;
  }
  assert.ok(chatBodies.length >= 1, 'after pool exhausted should call workshop chat AI');
  assert.equal(box.value, core);
  assert.match(f.w.读取智能修饰后缀(), /AI official photoreal modifier|photorealistic|full-body/i);
});

test('platform picker shows full names without Perch abbreviation', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const optText = (id) => Array.from(f.w.document.getElementById(id).options).map(o => o.textContent).join('|');
  assert.match(optText('出图引擎'), /Perchance/);
  assert.doesNotMatch(optText('出图引擎'), /(^|\|)Perch(\||$)/);
  assert.match(optText('出图引擎'), /AI Horde · 写实/);
  assert.match(optText('出图引擎'), /AI Horde · 动漫/);
  assert.match(optText('图生图平台'), /Perchance/);
  assert.match(optText('管理默认平台'), /Perchance/);
  assert.match(optText('AI通道'), /AI Horde/);
  f.w.设平台提示('perchance');
  assert.match(f.w.document.getElementById('平台提示').textContent, /Perchance/);
  assert.doesNotMatch(f.w.document.getElementById('平台提示').textContent, /官网|perchance\.org/i);
  f.w.设平台提示('horde-real');
  assert.match(f.w.document.getElementById('平台提示').textContent, /AI Horde/);
});

test('photorealPrompt helper still available for style-aware enrich logic', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const plain = f.w.photorealPrompt('a fictional adult standing by a rainy window');
  assert.match(plain, /photorealistic photograph/i);
  assert.ok(/clothing matching the core|Faithful to core description|photorealistic photograph/i.test(plain));
  assert.ok(plain.toLowerCase().indexOf('photorealistic') >= 0);
  assert.match(plain, /not anime|not cartoon|not 2d/i);
  const anime = f.w.animePrompt('a fictional adult standing by a rainy window');
  assert.match(anime, /anime illustration/i);
  assert.doesNotMatch(anime, /not anime|photorealistic photograph/i);
  assert.equal(f.w.engineFamily('horde-anime'), 'anime');
  assert.equal(f.w.engineFamily('perchance'), 'perchance');
  assert.equal(f.w.engineFamily('turbo'), 'real');
  assert.equal(typeof f.w.forcePhotorealPrompt, 'function');
  const forced = f.w.forcePhotorealPrompt('anime style girl with red hair');
  assert.match(forced, /photorealistic photograph/i);
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

test('adult mode defaults on with no top-bar toggle and no replica confirmation UI', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(f.w.document.getElementById('成人确认层'), null);
  assert.equal(f.w.document.getElementById('官方警告确认'), null);
  assert.equal(f.w.document.getElementById('成人统一确认'), null);
  assert.equal(f.w.document.querySelector('.确认遮罩'), null);
  assert.equal(typeof f.w.打开成人确认, 'undefined');
  assert.equal(typeof f.w.关闭成人确认, 'undefined');
  assert.equal(typeof f.w.检查成人确认按钮, 'undefined');
  assert.equal(typeof f.w.确认开启成人主题, 'undefined');
  const tick = f.w.document.getElementById('成人模式对勾');
  assert.equal(f.w.document.getElementById('成人图标按钮'), null);
  assert.equal(f.w.document.getElementById('成人开关按钮'), null);
  assert.doesNotMatch(f.w.document.querySelector('.顶栏右侧').textContent, /成人模式|✓/);
  assert.ok(f.w.document.querySelector('#只换背景') && f.w.document.querySelector('#只换背景').nextElementSibling.classList.contains('对勾盒'));
  assert.ok(tick);
  assert.equal(tick.checked, true);
  assert.equal(f.w.成人主题已开启, true);
  assert.match(f.w.document.getElementById('成人功能状态').value, /NSFW allowed/);
  assert.doesNotMatch(f.w.document.getElementById('成人功能状态').value, /preferred when described|do not add clothes/i);
  const official = f.w.document.createElement('div');
  official.setAttribute('role', 'dialog');
  official.id = 'fakeOfficialWarn';
  official.textContent = 'Okay to show NSFW warning content warning';
  f.w.document.body.appendChild(official);
  f.w.藏编辑钮();
  assert.ok(f.w.document.getElementById('fakeOfficialWarn'));
  assert.ok(f.w.document.getElementById('记忆开关'));
  tick.checked = false;
  f.w.切换成人对勾(false);
  assert.equal(f.w.成人主题已开启, false);
  assert.equal(tick.checked, false);
  assert.equal(f.w.document.getElementById('成人确认层'), null);
  tick.checked = true;
  f.w.切换成人对勾(true);
  assert.equal(f.w.成人主题已开启, true);
  assert.equal(tick.checked, true);
  assert.equal(f.w.localStorage.getItem('角色生成器_成人主题'), 'enabled');
});

test('memory mode checkmark defaults on; rewritten core description overrides old memory on generate', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const mem = f.w.document.getElementById('记忆开关');
  assert.ok(mem);
  assert.equal(mem.checked, true);
  assert.equal(f.w.记忆已开(), true);
  const row = f.w.document.getElementById('记忆模式对勾行');
  assert.ok(row);
  assert.match(row.textContent, /记忆模式/);
  const chat = f.w.document.getElementById('问答区');
  assert.ok(chat);
  assert.equal(chat.open, false);
  // 记忆对勾必须在折叠的 AI 对话外，否则用户「打不开/勾不上」
  assert.equal(chat.contains(row), false);
  assert.equal(chat.contains(mem), false);
  // 关→开 可再次启用
  mem.checked = false;
  f.w.切换记忆(false);
  assert.equal(f.w.记忆已开(), false);
  assert.equal(mem.checked, false);
  assert.equal(f.w.document.getElementById('记忆模式').value, 'off');
  mem.checked = true;
  f.w.切换记忆(true);
  assert.equal(f.w.记忆已开(), true);
  assert.equal(mem.checked, true);
  assert.notEqual(f.w.document.getElementById('记忆模式').value, 'off');
  assert.equal(f.w.document.getElementById('工具区'), null);
  assert.equal(typeof f.w.生成随机种子, 'undefined');
  assert.equal(typeof f.w.复制当前提示, 'undefined');
  assert.equal(typeof f.w.清理当前提示, 'undefined');
  assert.equal(typeof f.w.重置生成参数, 'undefined');
  f.w.document.getElementById('角色描述').value = '旧角色：红发剑士在雨夜';
  f.w.写记忆摘要('用户：旧角色红发剑士\n助手：他在雨夜拔剑');
  f.w.标记核心已用于生成();
  f.w.document.getElementById('角色描述').value = '新角色：银发法师在雪原施法';
  f.w.document.getElementById('英文描述').value = 'stale english about red-haired swordsman';
  f.w.document.getElementById('英文描述').dataset.staleFromCore = '1';
  const sys = f.w.组装记忆与核心系统提示();
  assert.match(sys, /银发法师在雪原施法/);
  assert.match(sys, /以此为准/);
  assert.match(sys, /历史记忆/);
  assert.match(sys, /红发剑士/);
  const msgs = f.w.组装花粉消息('继续写下一幕');
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /银发法师/);
  assert.doesNotMatch(msgs[0].content, /^用简体中文回复。延续以下角色记忆/);
  // 默认无参考图 → 重新生成：记忆摘要可作为出图补充，但不含对话系统元指令
  assert.equal(f.w.读取生图方式(), '重新生成');
  const blended = f.w.组装出图描述含记忆();
  assert.match(blended, /银发法师在雪原施法/);
  assert.match(blended, /红发剑士|雨夜拔剑/);
  assert.doesNotMatch(blended, /^stale english/);
  assert.doesNotMatch(blended, /用简体中文回复|请只输出|以此为准/);
  f.w.切换生图方式('改动');
  const editBlend = f.w.组装出图描述含记忆();
  assert.match(editBlend, /银发法师在雪原施法/);
  assert.doesNotMatch(editBlend, /红发剑士|雨夜拔剑/);
  f.w.切换生图方式('重新生成');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('英文描述').value, '');
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1, 'expected image submit, calls=' + f.calls.map(c => c.method + ' ' + c.url).join(' | '));
  const body = JSON.parse(posts[0].body);
  const prompt = String(body.prompt || '');
  assert.match(prompt, /银发法师/);
  assert.doesNotMatch(prompt, /stale english about red-haired/);
});


test('adult on: outbound prompts keep NSFW tokens and attach 成人功能状态 with photoreal enrich', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(f.w.成人主题已开启, true);
  assert.equal(typeof f.w.withAdultDirective, 'function');
  const adultField = f.w.document.getElementById('成人功能状态').value;
  assert.match(adultField, /NSFW allowed/i);
  assert.doesNotMatch(adultField, /do not add clothes|preferred when described/i);
  const nude = 'nude fictional adult woman standing by a rainy window, explicit adult scene';
  const enriched = f.w.forcePhotorealPrompt(nude);
  assert.match(enriched, /nude fictional adult woman/i);
  assert.doesNotMatch(enriched, /realistic fabric texture/i);
  const outbound = f.w.withAdultDirective(enriched, { core: nude });
  assert.match(outbound, /nude fictional adult woman/i);
  assert.match(outbound, /adult mode enabled/i);
  assert.match(outbound, /do not add clothes/i);
  assert.match(outbound, /NSFW allowed/i);
  f.w.切换成人对勾(false);
  assert.equal(f.w.withAdultDirective(enriched, { core: nude }), enriched);
  f.w.切换成人对勾(true);
  f.w.document.getElementById('角色描述').value = nude;
  f.w.document.getElementById('英文描述').value = nude;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1, 'expected image submit');
  const prompt = String(JSON.parse(posts[0].body).prompt || '');
  assert.match(prompt, /nude fictional adult woman/i);
  assert.match(prompt, /adult mode enabled/i);
  assert.match(prompt, /NSFW allowed/i);
  assert.match(prompt, /do not add clothes/i);
  assert.doesNotMatch(prompt.split(' ### ')[0], /realistic fabric texture/i);
});

test('balanced gen: no woman/nude tokens when core lacks them; coverage instructions present', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasFemaleIntent, 'function');
  assert.equal(typeof f.w.stripInjectedFemaleDefaults, 'function');
  assert.match(f.w.CORE_FIDELITY_LEAD, /include every explicitly described element|omit none/i);
  assert.match(f.w.CORE_FIDELITY_LEAD, /gender-neutral|gender/i);
  assert.match(f.w.ADULT_DIR_BASE, /omit none of the core facts|every described clothing/i);
  assert.equal(f.w.hasFemaleIntent('一位虚构成年人穿红毛衣站在雨夜街头'), false);
  assert.equal(f.w.hasFemaleIntent('一位虚构成年女人穿红毛衣'), true);
  assert.equal(f.w.hasFemaleIntent('a fictional adult woman in a park'), true);
  assert.equal(f.w.hasNudeIntent('一位虚构成年人穿红毛衣'), false);

  const coreZh = '一位虚构成年人穿红毛衣站在雨夜街头，手里拿着一把黑伞';
  const core = 'a fictional adult in a red knit sweater standing on a rainy night street holding a black umbrella';
  const injected = 'a fictional adult woman in a red knit sweater standing on a rainy night street holding a black umbrella';
  const stripped = f.w.stripInjectedFemaleDefaults(injected, coreZh);
  assert.doesNotMatch(stripped, /\bwoman\b|\bfemale\b|\bgirl\b|beautiful woman/i);
  assert.match(stripped, /red knit sweater|black umbrella|rainy/i);
  assert.equal(f.w.hasFemaleIntent(coreZh), false);

  const minimal = f.w.minimalOutboundPrompt(injected, { core: coreZh });
  assert.match(minimal, /Faithful to core description|include every explicitly described element|omit none/i);
  const sceneMin = minimal.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '');
  assert.doesNotMatch(sceneMin, /\bwoman\b|\bfemale\b|\bgirl\b|beautiful woman/i);
  assert.doesNotMatch(minimal, /\bnude\b|\bnaked\b|unclothed/i);
  assert.match(minimal, /red knit sweater|black umbrella|rainy/i);

  const kept = f.w.minimalOutboundPrompt(
    'a fictional adult woman in a blue coat',
    { core: '一位虚构成年女人穿蓝大衣' }
  );
  assert.match(kept, /\bwoman\b/i);

  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('英文描述').value = injected;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  assert.match(pos, /Faithful to core description|include every explicitly described|omit none|follow the core description/i);
  assert.doesNotMatch(pos, /\bwoman\b|\bfemale\b|beautiful woman/i);
  assert.doesNotMatch(pos, /\bnude\b|\bnaked\b|do not add clothes|keep requested nudity/i);
  assert.match(pos, /red knit sweater|black umbrella|rainy/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心描述 must not mutate');
});

test('male core: outbound has male locks and no woman tokens; female core kept; neutral stays neutral', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasMaleIntent, 'function');
  assert.equal(typeof f.w.applyMaleGenderLocks, 'function');
  assert.equal(typeof f.w.isMaleOnlyCore, 'function');

  assert.equal(f.w.hasMaleIntent('一位虚构成年男人穿风衣站在雨夜街头'), true);
  assert.equal(f.w.hasMaleIntent('a handsome adult man in a coat'), true);
  assert.equal(f.w.hasMaleIntent('帅哥大叔站在街头'), true);
  assert.equal(f.w.hasMaleIntent('一位虚构成年人穿红毛衣'), false);
  assert.equal(f.w.isMaleOnlyCore('一位虚构成年男人穿风衣'), true);
  assert.equal(f.w.isMaleOnlyCore('一对男女在雨夜街头'), false);

  const maleCoreZh = '一位虚构成年男人穿风衣站在雨夜街头，手里拿着黑伞';
  const drifted = 'a fictional adult woman in a trench coat standing on a rainy night street holding a black umbrella, feminine face, cleavage';
  const locked = f.w.applyMaleGenderLocks(drifted, maleCoreZh);
  assert.match(locked, /adult man/i);
  assert.doesNotMatch(locked, /adult man,\s*male,\s*masculine/i);
  assert.doesNotMatch(locked, /\bwoman\b|\bfemale\b|\bgirl\b|feminine face|cleavage/i);
  assert.match(locked, /trench coat|black umbrella|rainy/i);

  const minimalMale = f.w.minimalOutboundPrompt(drifted, { core: maleCoreZh });
  assert.match(minimalMale, /adult man/i);
  assert.doesNotMatch(minimalMale, /adult man,\s*male,\s*masculine/i);
  const sceneMaleMin = minimalMale.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '').replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(sceneMaleMin, /\bwoman\b|\bfemale\b|\bgirl\b|beautiful woman|feminine face/i);
  assert.match(minimalMale, /trench coat|black umbrella|rainy/i);

  const femaleKept = f.w.minimalOutboundPrompt(
    'a fictional adult woman in a blue coat',
    { core: '一位虚构成年女人穿蓝大衣' }
  );
  assert.match(femaleKept, /\bwoman\b/i);
  assert.doesNotMatch(femaleKept, /adult man,\s*male,\s*masculine/i);

  const neutral = f.w.minimalOutboundPrompt(
    'a fictional adult in a red knit sweater',
    { core: '一位虚构成年人穿红毛衣' }
  );
  const sceneNeu = neutral.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '');
  assert.doesNotMatch(sceneNeu, /\bwoman\b|\bfemale\b|beautiful woman/i);
  assert.doesNotMatch(neutral, /adult man,\s*male,\s*masculine/i);

  const mod = f.w.sanitizeModifierAgainstCore(
    ', beautiful woman, feminine face, cleavage, photoreal photography',
    maleCoreZh
  );
  assert.doesNotMatch(mod, /\bwoman\b|feminine face|cleavage/i);

  f.w.document.getElementById('角色描述').value = maleCoreZh;
  f.w.document.getElementById('英文描述').value = drifted;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || String(payload.negativePrompt || '');
  assert.match(pos, /adult man/i);
  assert.match(pos, /^\s*adult man\b/i, 'gender lead must lead outbound prompt');
  assert.doesNotMatch(pos, /adult man,\s*male,\s*masculine/i);
  assert.doesNotMatch(pos, /\bwoman\b|\bfemale\b|beautiful woman|feminine face|\bbreasts?\b|hourglass/i);
  assert.doesNotMatch(pos.split(/adult mode enabled/i)[0] || pos, /\blingerie\b|\bcleavage\b|\bseductive\b|\bsexy\b|skimpy/i);
  assert.match(neg, /\bwoman\b|\bfemale\b|feminine face|female body|\bbreasts?\b/i);
  assert.equal(f.w.document.getElementById('角色描述').value, maleCoreZh, '可见核心描述 must not mutate');
});


test('adult on: clothed core does not force nude tokens in outbound prompt', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(f.w.成人主题已开启, true);
  const clothed = 'a fictional adult woman in a red knit sweater standing by a rainy window';
  const outbound = f.w.withAdultDirective(f.w.forcePhotorealPrompt(clothed), { core: clothed });
  assert.match(outbound, /adult mode enabled/i);
  assert.match(outbound, /clothing as written|follow the core description/i);
  assert.doesNotMatch(outbound, /do not add clothes|preferred when described|keep requested nudity/i);
  assert.doesNotMatch(outbound, /\bnude\b|\bnaked\b|全裸|裸体|unclothed/i);
  assert.equal(f.w.hasNudeIntent(clothed), false);
  assert.equal(f.w.hasNudeIntent('全身裸体的虚构成年女人'), true);
  f.w.document.getElementById('角色描述').value = clothed;
  f.w.document.getElementById('英文描述').value = clothed;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1);
  const prompt = String(JSON.parse(posts[0].body).prompt || '').split(' ### ')[0];
  assert.match(prompt, /red knit sweater|fictional adult woman/i);
  assert.doesNotMatch(prompt, /do not add clothes|preferred when described|keep requested nudity/i);
  assert.doesNotMatch(prompt, /\bnude\b|\bnaked\b|全裸|裸体|unclothed/i);
  assert.equal(f.w.document.getElementById('角色描述').value, clothed);
});

test('adult on: censored Horde generations retry then succeed with NSFW-preferred models', async t => {
  let hordeSubmits = 0;
  const f = await setup(t, (url, options) => {
    const method = (options && options.method) || 'GET';
    const href = String(url || '');
    if (method === 'POST') {
      // setup maps Horde async POST to /api/images; chat POSTs must not count.
      if (href.includes('/api/images')) {
        hordeSubmits += 1;
        return response(job());
      }
      return response({ choices: [{ message: { content: 'a cat' } }] });
    }
    if (hordeSubmits <= 2) {
      return response({
        done: true,
        faulted: false,
        is_possible: true,
        processing: 0,
        generations: [{ img: PNG, censored: true }]
      });
    }
    return response({
      done: true,
      faulted: false,
      is_possible: true,
      processing: 0,
      generations: [{ img: PNG, censored: false }]
    });
  });
  f.w.切换成人对勾(true);
  f.w.document.getElementById('出图引擎').value = 'horde-anime';
  const statuses = [];
  const realStatus = f.w.document.getElementById('状态提示');
  const obs = new f.w.MutationObserver(() => {
    const title = realStatus.querySelector('b');
    if (title && title.textContent) statuses.push(title.textContent);
  });
  obs.observe(realStatus, { childList: true, subtree: true });
  await f.w.开始生成();
  obs.disconnect();
  assert.ok(hordeSubmits >= 3, 'expected censored retries then success, got hordeSubmits=' + hordeSubmits);
  assert.ok(statuses.some((s) => /节点审查了成人内容，正在换节点重试/.test(s)), 'statuses=' + statuses.join(' | '));
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 3);
  const first = JSON.parse(posts[0].body);
  assert.equal(first.nsfw, true);
  assert.equal(first.censor_nsfw, false);
  assert.equal(first.models[0], 'WAI-NSFW-illustrious-SDXL');
  const retry = JSON.parse(posts[1].body);
  assert.equal(retry.models[0], 'WAI-NSFW-illustrious-SDXL');
  assert.ok(f.w.document.querySelector('#图像输出 img'));
});

test('adult on: still-censored after retries shows explicit node-censor error', async t => {
  const f = await setup(t, (url, options) => {
    const method = (options && options.method) || 'GET';
    if (method === 'POST') return response(job());
    return response({
      done: true,
      faulted: false,
      is_possible: true,
      processing: 0,
      generations: [{ img: PNG, censored: true }]
    });
  });
  f.w.切换成人对勾(true);
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const detail = f.w.document.getElementById('状态提示').textContent;
  assert.match(detail, /成人内容被生图节点审查，请换写实\/动漫通道或稍后再试/);
  assert.doesNotMatch(detail, /没有可显示的图片/);
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 4, 'initial + up to 3 censored retries, got ' + posts.length);
  const payload = JSON.parse(posts[0].body);
  assert.equal(payload.nsfw, true);
  assert.equal(payload.censor_nsfw, false);
  assert.equal(payload.models[0], 'Realistic Vision');
});

test('adult off keeps censor_nsfw true and does not use adult censor retry copy', async t => {
  const f = await setup(t, (url, options) => {
    const method = (options && options.method) || 'GET';
    if (method === 'POST') return response(job());
    return response({
      done: true,
      faulted: false,
      is_possible: true,
      processing: 0,
      generations: [{ img: PNG, censored: true }]
    });
  });
  f.w.切换成人对勾(false);
  f.w.document.getElementById('出图引擎').value = 'horde-anime';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.equal(payload.nsfw, false);
  assert.equal(payload.censor_nsfw, true);
  const detail = f.w.document.getElementById('状态提示').textContent;
  assert.match(detail, /没有可显示的图片|请修改描述后重试/);
  assert.doesNotMatch(detail, /换节点重试/);
});

test('photoreal soft: no always-on full-body; 全身 still covered; half/side respected', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const plain = f.w.forcePhotorealPrompt('fictional adult woman in a park');
  assert.match(plain, /photorealistic photograph|natural light/i);
  assert.doesNotMatch(plain, /full body head-to-toe visible|feet in frame|standing full figure|front view facing camera/i);
  assert.doesNotMatch(plain, /shot on DSLR,\s*35mm|cinematic still, shallow depth of field|natural skin texture, clear material detail/i);
  const withFull = f.w.forcePhotorealPrompt('fictional adult woman in a park', { core: '虚构成年女人全身站立在公园' });
  assert.match(withFull, /full body head-to-toe visible|feet in frame/i);
  const half = f.w.forcePhotorealPrompt('半身肖像 fictional adult woman close-up portrait');
  assert.doesNotMatch(half, /full body head-to-toe visible|feet in frame/i);
  const side = f.w.forcePhotorealPrompt('fictional adult man side view profile');
  assert.match(side, /side view|profile/i);
  assert.doesNotMatch(side, /front view facing camera/i);
});


test('migrate-on-load replaces cached Chinese negative with English default', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const box = f.w.document.getElementById('负面提示');
  const oldCn = '低清晰度，模糊，失焦，错误解剖，多头，身体融合，多余手臂，畸形手部，未成年人，水印, anime, manga';
  box.value = oldCn;
  assert.equal(f.w.migrateNegativePromptBox(), true);
  assert.equal(box.value, f.w.DEFAULT_EN_NEGATIVE);
  assert.match(box.value, /lowres|bad anatomy|malformed hands/i);
  assert.doesNotMatch(box.value, /[\u4e00-\u9fff]/);
  // English-only should not be overwritten
  box.value = 'lowres, blurry, custom token xyz';
  assert.equal(f.w.migrateNegativePromptBox(), false);
  assert.equal(box.value, 'lowres, blurry, custom token xyz');
});

test('generate converts CJK negative phrases; Horde ### has no CJK', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('负面提示').value = '低清晰度，错误解剖，畸形手部，extra limbs, watermark';
  f.w.document.getElementById('角色描述').value = 'a fictional adult woman in a park';
  f.w.document.getElementById('英文描述').value = 'a fictional adult woman in a park';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  const converted = f.w.englishizeNegativePrompt(f.w.document.getElementById('负面提示').value);
  assert.match(converted, /lowres|bad anatomy|malformed hands|extra limbs|watermark/i);
  assert.doesNotMatch(converted, /[\u4e00-\u9fff]/);
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1);
  const body = JSON.parse(posts[0].body);
  const prompt = String(body.prompt || '');
  assert.match(prompt, /###/);
  const negPart = prompt.split(' ### ')[1] || '';
  assert.doesNotMatch(negPart, /[\u4e00-\u9fff]/);
  assert.match(negPart, /lowres|bad anatomy|anime|extra limbs/i);
  // Textarea should be migrated to English after generate
  assert.doesNotMatch(f.w.document.getElementById('负面提示').value, /[\u4e00-\u9fff]/);
});

test('workshop negative default is English; adult directive follows clothing unless nude asked', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const neg = f.w.document.getElementById('负面提示').value;
  assert.match(neg, /lowres|bad anatomy|malformed hands/i);
  assert.doesNotMatch(neg, /低清晰度|错误解剖|畸形手部|未成年人/);
  const adult = f.w.document.getElementById('成人功能状态').value;
  assert.match(adult, /NSFW allowed/i);
  assert.match(adult, /clothing as written|do not invent undressing/i);
  assert.doesNotMatch(adult, /do not add clothes|preferred when described|keep requested nudity/i);
  assert.match(adult, /no minors/i);
  f.w.document.getElementById('负面提示').value = '';
  f.w.document.getElementById('角色描述').value = 'a fictional adult woman in a park';
  f.w.document.getElementById('英文描述').value = 'a fictional adult woman in a park';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1);
  const body = JSON.parse(posts[0].body);
  const prompt = String(body.prompt || '');
  assert.match(prompt, /###/);
  const negPart = prompt.split(' ### ')[1] || '';
  assert.match(negPart, /anime|manga|cartoon/i);
  assert.doesNotMatch(negPart, /[\u4e00-\u9fff]/);
  const pos = prompt.split(' ### ')[0];
  assert.match(pos, /adult mode enabled|NSFW allowed/i);
  assert.doesNotMatch(pos, /do not add clothes|preferred when described|keep requested nudity/i);
  assert.doesNotMatch(pos, /\bnude\b|\bnaked\b|全裸|裸体|unclothed/i);
});

test('memory tip copy and perch official-site tips are removed; platform tip stays selection-only', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(f.w.document.getElementById('记忆开关说明'), null);
  assert.equal(f.w.document.getElementById('记忆说明'), null);
  assert.equal(f.w.document.getElementById('生成记忆模式'), null);
  assert.ok(f.w.document.getElementById('记忆开关'));
  const tip = f.w.document.getElementById('平台提示').textContent;
  assert.doesNotMatch(tip, /官网|perchance\.org/i);
  f.w.设平台提示('horde-real');
  assert.match(f.w.document.getElementById('平台提示').textContent, /AI Horde|Horde|按所选通道/);
  assert.doesNotMatch(f.w.document.getElementById('平台提示').textContent, /官网|perchance\.org/i);
});

test('selected Horde stays exclusive when Perch official path would otherwise jump', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.保存默认平台('horde-real', true);
  await f.w.开始生成();
  const img = f.w.document.querySelector('#图像输出 img');
  assert.ok(img);
  assert.equal(img.getAttribute('data-engine'), 'horde-real');
  assert.equal(f.w.document.getElementById('出图引擎').value, 'horde-real');
  assert.doesNotMatch(f.w.document.getElementById('平台提示').textContent, /Perch|官网/);
});

test('East Asian cues get strong outbound ethnicity tokens; western beauty defaults stripped', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasEastAsianCue, 'function');
  assert.ok(f.w.hasEastAsianCue('一位东亚女性站在街上'));
  assert.ok(f.w.hasEastAsianCue('Korean woman in Seoul'));
  assert.ok(!f.w.hasEastAsianCue('fictional adult woman in a park'));
  const out = f.w.forcePhotorealPrompt('blonde caucasian blue eyes woman in a park', { core: '东亚女性，中国人' });
  assert.match(out, /East Asian/i);
  assert.match(out, /East Asian facial features/i);
  assert.doesNotMatch(out, /\bblonde\b|\bcaucasian\b|blue eyes/i);
  const en = f.w.forcePhotorealPrompt('East Asian woman standing outdoors');
  assert.match(en, /East Asian facial features/i);
  assert.doesNotMatch(en, /distinctly East Asian appearance/i);
});

test('全身 / full body wins over portrait modifier tokens and half-body defaults', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  // Bare "portrait photography" must not block full-body injection.
  assert.equal(f.w.hasExplicitCropFraming('documentary portrait photography, natural lighting'), false);
  assert.equal(f.w.hasExplicitCropFraming('半身肖像 close-up portrait'), true);
  const withPortraitMod = f.w.forcePhotorealPrompt(
    'fictional adult woman, documentary portrait photography, natural lighting',
    { core: '虚构成年女人全身站立' }
  );
  assert.match(withPortraitMod, /full body head-to-toe visible|feet in frame/i);
  assert.match(withPortraitMod, /feet in frame|head and feet both visible/i);
  // Soft: no keyword spam walls
  assert.doesNotMatch(withPortraitMod, /complete figure from crown to shoes|subject fills vertical frame from head to toe/i);
  const half = f.w.forcePhotorealPrompt('半身肖像 fictional adult woman close-up portrait');
  assert.doesNotMatch(half, /full body head-to-toe visible|feet in frame/i);
});

test('Horde outbound keeps East Asian from core and full-body when 全身 present', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '一位东亚中国女性全身站立在公园里';
  f.w.document.getElementById('英文描述').value = 'a woman standing in a park';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  assert.ok(posts.length >= 1);
  const body = JSON.parse(posts[0].body);
  const prompt = String(body.prompt || '');
  const pos = prompt.split(' ### ')[0];
  const neg = prompt.split(' ### ')[1] || '';
  assert.match(pos, /East Asian/i);
  assert.match(pos, /full body|feet in frame/i);
  assert.match(neg, /caucasian|blonde|european/i);
});

test('全身 square aspect nudges outbound to portrait 2:3', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.preferPortraitAspectForFullBody, 'function');
  const square = f.w.preferPortraitAspectForFullBody(512, 512, '虚构成年女人全身站立');
  assert.equal(square.width, 512);
  assert.equal(square.height, 768);
  assert.equal(square.nudged, true);
  const landscape = f.w.preferPortraitAspectForFullBody(768, 512, '虚构成年女人全身站立');
  assert.equal(landscape.nudged, false);
  assert.equal(landscape.width, 768);
  assert.equal(landscape.height, 512);
  const noFull = f.w.preferPortraitAspectForFullBody(512, 512, '虚构成年女人半身肖像');
  assert.equal(noFull.nudged, false);
  f.w.document.getElementById('角色描述').value = '一位东亚中国女性全身站立在公园里';
  f.w.document.getElementById('英文描述').value = 'a woman standing in a park';
  f.w.document.getElementById('图像比例').value = '512x512';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const body = JSON.parse(f.calls.filter(isImageSubmit)[0].body);
  const w = (body.params && body.params.width) || body.width;
  const h = (body.params && body.params.height) || body.height;
  assert.equal(w, 512);
  assert.equal(h, 768);
  const prompt = String(body.prompt || '');
  const neg = prompt.includes(' ### ') ? prompt.split(' ### ')[1] : String(body.negativePrompt || '');
  assert.match(neg, /cropped at waist|cut off feet|half-body shot/i);
});

test('lightbox shows top-right close and click-to-zoom further', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  await f.w.开始生成();
  f.w.document.querySelector('.生图卡片').click();
  await until(() => f.w.document.querySelector('#图片预览层') && !f.w.document.querySelector('#图片预览层').hasAttribute('hidden'), 'preview overlay');
  const layer = f.w.document.querySelector('#图片预览层');
  const closeBtn = layer.querySelector('.图片预览关闭');
  assert.ok(closeBtn, 'close button present');
  assert.match(closeBtn.getAttribute('aria-label') || '', /关闭/);
  const img = layer.querySelector('img');
  assert.ok(img);
  // Simulate loaded preview then second click zooms
  img.hidden = false;
  img.dispatchEvent(new f.w.Event('click', { bubbles: true }));
  assert.ok(layer.classList.contains('放大'), 'second click toggles zoom class');
  img.dispatchEvent(new f.w.Event('click', { bubbles: true }));
  assert.equal(layer.classList.contains('放大'), false);
  closeBtn.click();
  assert.ok(layer.hasAttribute('hidden'));
});

test('img2img local-edit helpers and outbound keep-rest; 核心描述 unchanged', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.isLocalEditCore, 'function');
  assert.equal(f.w.isLocalEditCore('图中人物抬起左手'), true);
  assert.equal(f.w.isLocalEditCore('转头微笑'), true);
  assert.equal(f.w.isLocalEditCore('change hair color slightly'), true);
  assert.equal(f.w.isLocalEditCore('raise left hand'), true);
  assert.equal(f.w.isLocalEditCore('一位东亚中国女性全身站立在雨夜街头'), false);
  assert.equal(f.w.isLocalEditCore('背景换成宁静雪山与晨雾，人物保持原样'), false);
  assert.ok(f.w.isPoseGestureEdit('图中人物抬起左手'));
  const poseBand = f.w.preferLocalEditStrength(0.52, '图中人物抬起左手');
  assert.ok(poseBand >= 0.55 && poseBand <= 0.65, 'pose strength gesture band, got ' + poseBand);

  const core = '图中人物抬起左手';
  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.document.getElementById('只换背景').checked = true;
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('角色描述').value, core, '核心描述 stays source of truth');
  const payload = imagePayload(f.calls);
  const prompt = String(payload.prompt || '');
  const pos = prompt.split(' ### ')[0];
  const neg = prompt.includes(' ### ') ? prompt.split(' ### ')[1] : String(payload.negativePrompt || '');
  assert.match(pos, /(?:CRITICAL EDIT \(must be clearly visible\)|Visible edit:).*left hand raised|raised left hand clearly visible/i);
  assert.match(pos, /keep the (?:EXACT )?same person identity|allow pose\/gesture\/limbs to change/i);
  assert.match(pos, /do NOT invent a new person|invent a new background|allow pose\/gesture\/limbs/i);
  assert.doesNotMatch(pos, /camera angle, crop, and framing/i);
  assert.doesNotMatch(pos, /change only the background/i);
  assert.ok(payload.source_image);
  const strength = (payload.params && payload.params.denoising_strength);
  assert.ok(Number(strength) >= 0.55 && Number(strength) <= 0.65, 'pose local edit gesture strength, got ' + strength);
  assert.match(neg, /different person|identity change|full scene redraw/i);
});

test('img2img local smile/hair still keep rest; t2i 全身+东亚 unchanged', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '图中人物微笑';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const smile = String(imagePayload(f.calls).prompt || '').split(' ### ')[0];
  assert.match(smile, /CRITICAL EDIT|Visible edit:|keep the same person identity|stated local change must stay clearly visible|do NOT invent a new person/i);
  assert.equal(f.w.document.getElementById('角色描述').value, '图中人物微笑');

  f.w.document.getElementById('参考图地址').value = '';
  f.w.document.getElementById('角色描述').value = '一位东亚中国女性全身站立在公园里';
  f.w.document.getElementById('英文描述').value = 'a woman standing in a park';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const posts = f.calls.filter(isImageSubmit);
  const body = JSON.parse(posts[posts.length - 1].body);
  const pos = String(body.prompt || '').split(' ### ')[0];
  assert.match(pos, /East Asian/i);
  assert.match(pos, /full body|feet in frame/i);
  assert.doesNotMatch(pos, /CRITICAL EDIT \(must be clearly visible\)|apply ONLY the stated local change/i);
});

test('memory route line and clear-memory-path button; 改动 checkbox vs full regen', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const line = f.w.document.getElementById('记忆生成线路');
  const clearBtn = f.w.document.getElementById('清除记忆线路按钮');
  const edit = f.w.document.getElementById('生图方式改动');
  assert.ok(line);
  assert.ok(clearBtn);
  assert.ok(edit);
  assert.equal(edit.type, 'checkbox');
  assert.equal(f.w.document.getElementById('生图方式重新生成'), null);
  assert.ok(f.w.document.getElementById('生图方式改动行')?.querySelector('.对勾盒'));
  assert.match(clearBtn.textContent, /清除(?:全部)?记忆线路/);
  const row = f.w.document.getElementById('记忆模式对勾行');
  const zone = f.w.document.getElementById('记忆线路区');
  assert.ok(zone);
  assert.equal(f.w.document.getElementById('问答区').contains(zone), false);
  assert.equal(f.w.document.getElementById('问答区').contains(row), false);
  f.w.同步生图方式默认(true);
  assert.equal(f.w.读取生图方式(), '重新生成');
  assert.equal(edit.checked, false);
  assert.match(line.textContent, /记忆续生/);
  assert.match(line.textContent, /无参考图/);
  assert.match(line.textContent, /重新生成/);
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.同步生图方式默认(true);
  assert.equal(f.w.读取生图方式(), '改动');
  assert.equal(edit.checked, true);
  assert.equal(f.w.本轮使用参考图(), true);
  assert.equal(f.w.应用局部改图(), true);
  assert.match(line.textContent, /带参考图/);
  assert.match(line.textContent, /改动/);
  f.w.切换生图方式('重新生成');
  assert.equal(edit.checked, false);
  assert.equal(f.w.本轮使用参考图(), false);
  assert.equal(f.w.应用局部改图(), false);
  assert.match(f.w.document.getElementById('记忆生成线路').textContent, /有参考图·本轮忽略|重新生成/);
  // 生完图后仍可开记忆模式
  f.w.切换记忆(false);
  f.w.切换记忆(true);
  assert.equal(f.w.记忆已开(), true);
  f.w.document.getElementById('角色描述').value = '核心保持原样';
  f.w.写记忆摘要('用户：旧设定甲。助手：旧回复乙。');
  f.w.对话历史 = [{ role: 'user', text: '你好' }, { role: 'assistant', text: '在的' }];
  f.w.保存对话历史();
  assert.match(f.w.组装记忆与核心系统提示(), /旧设定甲|历史记忆/);
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图地址').dataset.softAdopted = '1';
  f.w.document.getElementById('参考图种子').value = '999';
  f.w.localStorage.setItem('sushi_pending_prompt', 'stale-pending');
  const histBefore = f.w.读取生成历史();
  const origConfirm = f.w.confirm;
  let confirms = 0;
  f.w.confirm = () => { confirms += 1; return true; };
  f.w.清除记忆线路();
  assert.equal(confirms, 1);
  assert.equal(String(f.w.记忆摘要 || ''), '');
  assert.equal((f.w.对话历史 || []).length, 0);
  assert.doesNotMatch(f.w.组装记忆与核心系统提示(), /旧设定甲|旧回复乙/);
  assert.equal(f.w.记忆已开(), true);
  assert.equal(f.w.document.getElementById('记忆开关').checked, true);
  assert.equal(f.w.document.getElementById('角色描述').value, '核心保持原样');
  assert.equal(f.w.document.getElementById('参考图地址').value, '', '清记忆线路应清生图工作缓存参考图');
  assert.equal(f.w.document.getElementById('参考图种子').value, '');
  assert.equal(f.w.localStorage.getItem('sushi_pending_prompt'), null);
  assert.deepEqual(f.w.读取生成历史(), histBefore, '六张生成历史不变');
  f.w.confirm = origConfirm;
});

test('记忆与改动用对勾；清除记忆线路为按钮；不勾改动=全文生图', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const memRow = f.w.document.getElementById('记忆模式对勾行');
  const editRow = f.w.document.getElementById('生图方式改动行');
  const clearBtn = f.w.document.getElementById('清除记忆线路按钮');
  const mem = f.w.document.getElementById('记忆开关');
  const edit = f.w.document.getElementById('生图方式改动');
  assert.ok(memRow && editRow && clearBtn);
  assert.ok(memRow.classList.contains('对勾行'));
  assert.ok(editRow.classList.contains('对勾行'));
  assert.ok(memRow.querySelector('.对勾盒 .对勾符'));
  assert.ok(editRow.querySelector('.对勾盒 .对勾符'));
  assert.match(editRow.textContent, /改动/);
  assert.match(editRow.textContent, /局部改|全文生图/);
  assert.match(clearBtn.textContent, /清除(?:全部)?记忆线路/);
  assert.equal(f.w.document.getElementById('生图方式重新生成行'), null);
  // 记忆独立开关（生完图后也可开）
  assert.equal(mem.checked, true);
  f.w.切换记忆(false);
  assert.equal(mem.checked, false);
  f.w.切换记忆(true);
  assert.equal(mem.checked, true);
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.同步生图方式默认(true);
  assert.equal(edit.checked, true);
  assert.equal(f.w.读取生图方式(), '改动');
  f.w.切换生图方式('重新生成');
  assert.equal(edit.checked, false);
  assert.equal(f.w.读取生图方式(), '重新生成');
  f.w.切换生图方式('改动');
  assert.equal(edit.checked, true);
  assert.equal(f.w.读取生图方式(), '改动');
  assert.equal(mem.checked, true);
  assert.equal(f.w.记忆已开(), true);
});

test('重新生成 ignores reference image on generate; 改动 keeps local-edit path', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.同步生图方式默认(true);
  assert.equal(f.w.读取生图方式(), '改动');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  let body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动应带 source_image');
  f.calls.length = 0;
  f.w.切换生图方式('重新生成');
  await f.w.开始生成();
  body = imagePayload(f.calls);
  assert.equal(!!body.source_image, false, '重新生成不应带参考图作底');
});

test('smart-mod enables photoreal enrich on outbound; core unchanged', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = 'A fictional adult reading by a library window';
  f.w.document.getElementById('英文描述').value = 'A fictional adult reading by a library window';
  await f.w.智能修饰();
  assert.equal(f.w.hasSmartModifier(), true);
  assert.match(f.w.读取智能修饰后缀(), /photoreal|DSLR|full-body|not anime/i);
  const beforeCore = f.w.document.getElementById('角色描述').value;
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  assert.match(payload.prompt, /photorealistic RAW photo|photorealistic photography/i);
  assert.match(payload.prompt, /no text in image|no pinyin/i);
  assert.equal(f.w.document.getElementById('角色描述').value, beforeCore);
});

test('gallery caption hides pinyin when Chinese core exists', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '一位东亚女性站在雨夜街头';
  f.w.document.getElementById('中文译文').value = '一位东亚女性站在雨夜街头';
  f.w.document.getElementById('英文描述').value = 'yi wei dong ya nv xing zhan zai yu ye jie tou';
  f.w.刷新画面说明();
  assert.match(f.w.document.getElementById('说明标题').textContent, /东亚女性/);
  assert.equal(f.w.document.getElementById('说明英文').textContent.trim(), '');
});

test('full regen when 改动 unchecked ignores reference image', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.同步生图方式默认(true);
  assert.equal(f.w.读取生图方式(), '改动');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  let body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动应带 source_image');
  f.calls.length = 0;
  f.w.切换生图方式('重新生成');
  await f.w.开始生成();
  body = imagePayload(f.calls);
  assert.equal(!!body.source_image, false, '不勾改动=全文生图，不应带参考图作底');
});


test('改动 UI only when memory ON; memory off forces full regen', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const editRow = f.w.document.getElementById('生图方式改动行');
  const editBlock = f.w.document.getElementById('生图方式行');
  const routeZone = f.w.document.getElementById('记忆线路区');
  const edit = f.w.document.getElementById('生图方式改动');
  f.w.切换记忆(true);
  f.w.同步改动可见性();
  assert.equal(editRow.hidden, false);
  assert.equal(editBlock.hidden, false);
  assert.equal(routeZone.hidden, false, '记忆开应显示记忆线路区');
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.同步生图方式默认(true);
  assert.equal(f.w.读取生图方式(), '改动');
  assert.equal(f.w.应用局部改图(), true);
  f.w.切换记忆(false);
  assert.equal(editRow.hidden, true);
  assert.equal(editBlock.hidden, true, '记忆关应整块隐藏改动板块');
  assert.equal(routeZone.hidden, true, '记忆关应隐藏记忆线路区');
  const pathLine = f.w.document.getElementById('记忆生成线路');
  const clearBtn = f.w.document.getElementById('清除记忆线路按钮');
  const routeList = f.w.document.getElementById('记忆路线列表');
  assert.equal(pathLine.hidden, true, '记忆关应隐藏记忆路径摘要');
  assert.equal(String(pathLine.textContent || '').trim(), '', '记忆关路径摘要应清空');
  assert.equal(clearBtn.hidden, true, '记忆关应隐藏清除按钮');
  assert.equal(!!clearBtn.disabled, true, '记忆关应禁用清除按钮');
  assert.equal(routeList.hidden, true, '记忆关应隐藏路线列表');
  assert.equal(f.w.读取生图方式(), '重新生成');
  assert.equal(f.w.应用局部改图(), false);
  assert.equal(f.w.本轮使用参考图(), false);
  assert.equal(edit.checked, false);
  f.w.写记忆摘要('用户：旧记忆甲。助手：旧回复乙。');
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  const blendedOff = f.w.组装出图描述含记忆();
  assert.equal(blendedOff, '图中人物抬起左手');
  assert.doesNotMatch(blendedOff, /旧记忆甲|旧回复乙/);
  const sysOff = f.w.组装记忆与核心系统提示();
  assert.doesNotMatch(sysOff, /旧记忆甲|历史记忆|旧回复乙/);
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.equal(!!body.source_image, false, '记忆关时即使有参考图也走全文生图');
  const promptOff = String(body.prompt || '');
  assert.doesNotMatch(promptOff, /旧记忆甲|旧回复乙|历史记忆/);
});

test('记忆关隐藏记忆线路区 CSS [hidden] override', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/workshop.html'), 'utf8');
  assert.match(html, /\.记忆线路区\[hidden\]/);
  assert.match(html, /#记忆生成线路\[hidden\]/);
  assert.match(html, /#清除记忆线路按钮\[hidden\]/);
  assert.match(html, /function 同步改动可见性\(\)[\s\S]*?记忆线路区[\s\S]*?hidden = !开/);
  assert.match(html, /function 同步改动可见性\(\)[\s\S]*?清除记忆线路按钮[\s\S]*?hidden = !开/);
});

test('memory route list shows each generation description; per-step clear', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const list = f.w.document.getElementById('记忆路线列表');
  assert.ok(list);
  f.w.切换记忆(true);
  f.w.载入记忆路线();
  f.w.刷新记忆路线列表();
  assert.equal(typeof f.w.追加记忆路线, 'function');
  f.w.追加记忆路线('第一步：东亚女性站立');
  f.w.追加记忆路线('第二步：图中人物抬起左手');
  assert.equal((f.w.记忆路线 || []).length, 2);
  assert.match(list.textContent, /第一步：东亚女性站立/);
  assert.match(list.textContent, /第二步：图中人物抬起左手/);
  const clearBtns = list.querySelectorAll('.清除单条记忆钮');
  assert.equal(clearBtns.length, 2);
  const firstId = f.w.记忆路线[0].id;
  f.w.清除一条记忆路线(firstId);
  assert.equal(f.w.记忆路线.length, 1);
  assert.doesNotMatch(list.textContent, /第一步：东亚女性站立/);
  assert.match(list.textContent, /第二步：图中人物抬起左手/);
  f.w.document.getElementById('角色描述').value = '第三步：微笑';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  assert.ok(f.w.记忆路线.some(item => /第三步：微笑/.test(item.text)));
  assert.match(f.w.document.getElementById('记忆生成线路').textContent, /\d+ 步/);
});

test('pose local-edit harder strength; mild color lower; pose omits seed lock; raised-hand prompt', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const pose = f.w.preferLocalEditStrength(0.52, '抬起左手');
  assert.ok(pose >= 0.55 && pose <= 0.65, 'pose gesture band, got ' + pose);
  assert.match(f.w.localEditChangeDirective('抬起左手'), /left hand raised high|raised left hand clearly visible/i);
  const mild = f.w.preferLocalEditStrength(0.52, 'change hair color slightly');
  assert.ok(mild >= 0.2 && mild <= 0.28, 'mild color low band, got ' + mild);
  const longPose = f.w.preferLocalEditStrength(0.52, '图中人物保持身份与构图，只把外套颜色稍微改成深红，并调整站姿让右手自然垂下，其余全部不变不要重画场景');
  assert.ok(longPose >= 0.55 && longPose <= 0.65, 'long text with 站姿 uses pose band, got ' + longPose);
  assert.equal(f.w.resolveLocalEditSeed('424242', '抬起左手'), '', 'pose omits identical seed lock');
  f.w.切换记忆(true);
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图种子').value = '424242';
  f.w.document.getElementById('随机种子').value = '111';
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.同步生图方式默认(true);
  f.w.切换生图方式('改动');
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  const strength = body.params && body.params.denoising_strength;
  assert.ok(Number(strength) >= 0.55 && Number(strength) <= 0.65, 'pose local edit strength, got ' + strength);
  assert.ok(body.source_image, '改动必须带 source_image');
  assert.equal(body.source_processing, 'img2img');
  assert.ok(body.params.seed === undefined || body.params.seed === '' || body.params.seed == null, 'pose should omit seed lock, got ' + body.params.seed);
  assert.match(String(body.prompt || ''), /(?:CRITICAL EDIT|Visible edit:).*left hand raised|raised left hand clearly visible/i);
  assert.match(String(body.prompt || ''), /same person identity|allow pose\/gesture\/limbs to change/i);
  assert.doesNotMatch(String(body.prompt || ''), /camera angle, crop, and framing/i);
  assert.doesNotMatch(String(body.prompt || '') + ' ### ' + String(body.params && ''), /camera move, new composition/);
  assert.equal(f.w.document.getElementById('角色描述').value, '图中人物抬起左手');
});

test('memory steps persist images; delete-3 shows-2 as reference', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FAP5EBfTZO8fNAAAAAElFTkSuQmCC';
  const PNG3 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAGUlEQVR42mNkYGD4z8DAwMgABXAGNgGwSgwAW0wD/QAAAABJRU5ErkJggg==';
  f.w.切换记忆(true);
  f.w.追加记忆路线('第一步站立', { image: PNG, seed: '11' });
  f.w.追加记忆路线('第二步抬手', { image: PNG2, seed: '22' });
  f.w.追加记忆路线('第三步微笑', { image: PNG3, seed: '33' });
  assert.equal(f.w.记忆路线.length, 3);
  assert.ok(f.w.记忆路线.every(item => !!item.image), '每步应保存图片');
  assert.match(f.w.document.getElementById('记忆路线列表').innerHTML, /记忆路线缩略|img/);
  const id3 = f.w.记忆路线[2].id;
  f.w.清除一条记忆路线(id3);
  assert.equal(f.w.记忆路线.length, 2);
  assert.equal(f.w.当前记忆路线().text, '第二步抬手');
  assert.equal(f.w.当前记忆路线图(), PNG2);
  assert.equal(f.w.document.getElementById('参考图地址').value, PNG2);
  assert.equal(f.w.document.getElementById('参考图种子').value, '22');
  const focus = f.w.document.querySelector('#图像输出 img');
  assert.ok(focus, '删除第3步后应立刻显示第2步图');
  assert.equal(focus.getAttribute('data-full-url') || focus.src, PNG2);
});

test('改动 payload includes source_image from memory step image', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.追加记忆路线('基底全身站立', { image: PNG, seed: '99' });
  f.w.document.getElementById('参考图地址').value = '';
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('出图引擎').value = 'perchance';
  f.w.document.getElementById('图生图平台').value = 'perchance';
  f.w.用户选定图生图平台 = 'perchance';
  f.w.同步生图方式默认(true);
  f.w.切换生图方式('改动');
  assert.equal(f.w.读取生图方式(), '改动');
  assert.equal(f.w.resolveImg2imgEngine('perchance'), 'horde-real');
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动必须带 source_image');
  assert.equal(body.source_processing, 'img2img');
  assert.ok(Number(body.params.denoising_strength) >= 0.55 && Number(body.params.denoising_strength) <= 0.65, 'pose band, got ' + body.params.denoising_strength);
  assert.match(String(body.prompt || ''), /left hand raised|raised left hand clearly visible/i);
  assert.ok(body.params.seed === undefined || body.params.seed === '' || body.params.seed == null, 'pose omits seed');
  assert.equal(f.w.document.getElementById('角色描述').value, '图中人物抬起左手');
});

test('generation success stores image on memory route step', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.记忆路线 = [];
  f.w.document.getElementById('角色描述').value = '东亚女性站立全身';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('重新生成');
  await f.w.开始生成();
  assert.equal(f.w.记忆路线.length, 1);
  assert.ok(f.w.记忆路线[0].image, '出图成功应把图片写入记忆路线');
  assert.equal(f.w.document.getElementById('参考图地址').value, f.w.记忆路线[0].image);
});


test('改动 ON ⇒ payload has source_image + denoising in pose band; 核心描述 unchanged', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const core = '抬起左手';
  f.w.切换记忆(true);
  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('图生图强度').value = '0.52';
  f.w.document.getElementById('图生图平台').value = 'perchance';
  f.w.用户选定图生图平台 = 'perchance';
  f.w.document.getElementById('出图引擎').value = 'perchance';
  f.w.同步生图方式默认(true);
  f.w.切换生图方式('改动');
  assert.equal(f.w.读取生图方式(), '改动');
  assert.equal(f.w.resolveImg2imgEngine('perchance'), 'horde-real');
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动必须带 source_image');
  assert.equal(body.source_processing, 'img2img');
  const ds = Number(body.params && body.params.denoising_strength);
  assert.ok(ds >= 0.55 && ds <= 0.65, 'pose band denoising, got ' + ds);
  assert.match(String(body.prompt || ''), /(?:CRITICAL EDIT|Visible edit:).*left hand raised|raised left hand clearly visible/i);
  assert.match(String(body.prompt || ''), /allow pose\/gesture\/limbs to change/i);
  assert.doesNotMatch(String(body.prompt || ''), /camera angle and crop as the reference/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '核心描述不变');
});

test('no exposure tokens without core; realism default lock; smart-mod off skips modifier pack', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasExposureIntent, 'function');
  assert.equal(typeof f.w.stripExposureBiasDefaults, 'function');
  assert.equal(f.w.hasExposureIntent('一位虚构成年人穿红毛衣站在雨夜街头'), false);
  assert.equal(f.w.hasExposureIntent('性感暴露的虚构成年女人'), true);
  assert.equal(f.w.hasNudeIntent('一位虚构成年人穿红毛衣'), false);

  const core = 'a fictional adult in a red knit sweater standing on a rainy night street holding a black umbrella';
  const injected = 'a fictional adult, sexy revealing lingerie, cleavage, seductive pose, nude, ' + core;
  const stripped = f.w.stripExposureBiasDefaults(injected, core);
  assert.doesNotMatch(stripped, /\bnude\b|\blingerie\b|\bcleavage\b|\bseductive\b|\brevealing\b|\bsexy\b/i);
  assert.match(stripped, /red knit sweater|black umbrella|rainy/i);

  assert.equal(f.w.hasSmartModifier(), false);
  const minimal = f.w.minimalOutboundPrompt(core, { core });
  assert.match(minimal, /photorealistic photograph|natural light/i);
  assert.match(minimal, /not anime|not cartoon|not 2d/i);
  assert.doesNotMatch(minimal, /photorealistic RAW photo|natural skin pores|cinematic still/i);
  assert.doesNotMatch(minimal, /\bnude\b|\bnaked\b|\blingerie\b|\bcleavage\b|\bseductive\b|skimpy/i);
  assert.doesNotMatch(minimal, /photorealistic photography style, shot on DSLR, 35mm lens, natural skin texture and fabric detail/i);

  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('英文描述').value = core;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || '';
  assert.match(pos, /photorealistic photograph|natural light/i);
  assert.match(pos, /do not invent undressing|revealing outfits/i);
  assert.match(pos, /clothing matching the core/i);
  assert.doesNotMatch(pos, /\bkeep requested nudity\b|\bNSFW fully allowed\b|\bpreferred when described\b/i);
  const sceneOnly = pos.replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(sceneOnly, /\bnude\b|\bnaked\b|\blingerie\b|\bcleavage\b|\bseductive\b|\bsexy\b|skimpy/i);
  assert.doesNotMatch(pos, /photorealistic photography style, shot on DSLR, 35mm lens, natural skin texture and fabric detail/i);
  assert.match(neg, /lingerie|cleavage|skimpy|nude|naked|revealing (?:clothes|outfit)|bikini|sheer|bra visible|panties/i);
  assert.doesNotMatch(neg, /bare midriff|crop top|exposed navel|exposed stomach/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core);
});

test('智能修饰 on derives modifiers from core clothing/setting; no random exposure pack', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const core = '雨夜街头穿红毛衣撑黑伞的虚构成年人';
  f.w.document.getElementById('角色描述').value = core;
  f.w.智能修饰();
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心不改写');
  assert.equal(f.w.hasSmartModifier(), true);
  const mod = f.w.读取智能修饰后缀();
  assert.match(mod, /knit sweater|umbrella|rainy|street|photoreal|photography|not anime/i);
  assert.doesNotMatch(mod, /\bnude\b|\blingerie\b|\bcleavage\b|\bseductive\b|\bsexy\b|skimpy|revealing/i);
  const gated = f.w.sanitizeModifierAgainstCore(', sexy lingerie, cleavage, seductive pose, photoreal', core);
  assert.doesNotMatch(gated, /\bsexy\b|\blingerie\b|\bcleavage\b|\bseductive\b/i);
});

test('harder gender+clothing locks: male core leads; clothed core gets exposure negatives', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.finalizeOutboundCoreLocks, 'function');
  assert.equal(typeof f.w.applyClothingFidelityLocks, 'function');
  assert.match(f.w.CLOTHING_FIDELITY_LEAD, /clothing matching the core/i);
  assert.match(f.w.CLOTHING_EVERYDAY_LEAD, /ordinary everyday clothing/i);
  assert.equal(f.w.hasClothingCue('穿红毛衣的女人'), true);
  assert.equal(f.w.hasClothingCue('女人站在窗边'), false);
  assert.match(f.w.clothingLeadForCore('女人站在窗边'), /ordinary everyday clothing/i);
  assert.match(f.w.clothingLeadForCore('穿红毛衣的女人'), /clothing matching the core/i);

  const maleCore = '一位虚构成年男人穿风衣站在雨夜街头';
  const drifted = 'beautiful woman, feminine face, breasts, cleavage, lingerie, seductive pose, a person in a trench coat';
  const finalized = f.w.finalizeOutboundCoreLocks(drifted, maleCore);
  assert.match(finalized, /^\s*adult man\b/i);
  assert.match(finalized, /clothing matching the core/i);
  assert.doesNotMatch(finalized, /\bwoman\b|\bfemale\b|\bgirl\b|beautiful woman|feminine face|\bbreasts?\b|\blingerie\b|\bcleavage\b|\bseductive\b/i);
  assert.match(finalized, /trench coat/i);

  const clothedCore = '一位虚构成年人穿红毛衣站在窗边';
  const clothedOut = f.w.minimalOutboundPrompt(
    'a fictional adult in a red knit sweater, sexy revealing lingerie, cleavage',
    { core: clothedCore }
  );
  assert.match(clothedOut, /clothing matching the core/i);
  const sceneCloth = clothedOut.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '').replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(sceneCloth, /\blingerie\b|\bcleavage\b|\bsexy\b|\brevealing\b/i);
  assert.doesNotMatch(sceneCloth, /\bwoman\b|\bfemale\b|beautiful woman/i);

  f.w.document.getElementById('角色描述').value = maleCore;
  f.w.document.getElementById('英文描述').value = drifted;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || '';
  assert.match(pos, /^\s*adult man\b/i);
  const sceneMale = pos.replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(sceneMale, /\bwoman\b|\bfemale\b|beautiful woman|\bbreasts?\b|\blingerie\b/i);
  assert.match(neg, /woman|female|lingerie|cleavage|nude|revealing (?:clothes|outfit)|bra visible|panties/i);
  assert.equal(f.w.document.getElementById('角色描述').value, maleCore);
});

test('memory off: hide all memory UI and omit memory from gen payload', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.写记忆摘要('用户：雨夜剑士旧记忆。助手：拔剑续写。');
  f.w.追加记忆路线('旧路线一步', { image: PNG, seed: '11' });
  f.w.document.getElementById('角色描述').value = '穿蓝大衣的虚构成年人站在公园';
  f.w.刷新记忆生成线路();
  assert.equal(f.w.document.getElementById('记忆线路区').hidden, false);
  assert.match(f.w.组装记忆与核心系统提示(), /雨夜剑士旧记忆|历史记忆/);
  assert.match(f.w.组装出图描述含记忆(), /雨夜剑士旧记忆|穿蓝大衣/);

  f.w.切换记忆(false);
  f.w.同步改动可见性();
  f.w.刷新记忆生成线路();
  assert.equal(f.w.记忆已开(), false);
  assert.equal(f.w.document.getElementById('记忆线路区').hidden, true);
  assert.equal(f.w.document.getElementById('记忆生成线路').hidden, true);
  assert.equal(f.w.document.getElementById('记忆路线列表').hidden, true);
  assert.equal(f.w.document.getElementById('清除记忆线路按钮').hidden, true);
  assert.equal(f.w.document.getElementById('生图方式改动行').hidden, true);
  const core = '穿蓝大衣的虚构成年人站在公园';
  f.w.document.getElementById('角色描述').value = core;
  assert.equal(f.w.组装出图描述含记忆(), core);
  assert.doesNotMatch(f.w.组装出图描述含记忆(), /雨夜剑士|拔剑续写|旧路线/);
  assert.doesNotMatch(f.w.组装记忆与核心系统提示(), /雨夜剑士|历史记忆|拔剑续写/);
  assert.equal(f.w.追加记忆路线('不应写入', { image: PNG }), null);
  assert.equal(f.w.更新记忆路线图片('x', { image: PNG }), null);
  assert.equal(f.w.激活记忆路线项('x'), null);

  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.doesNotMatch(String(body.prompt || ''), /雨夜剑士|拔剑续写|旧路线|历史记忆/);
  assert.equal(f.w.document.getElementById('角色描述').value, core);
});

test('contact email is 163 not qq', () => {
  assert.match(html, /sjdwukai2@163\.com/);
  assert.doesNotMatch(html, /sjdwukai2@qq\.com/);
  assert.match(html, /mailto:sjdwukai2@163\.com/);
});

test('gallery CSS stacks full images without fixed-height crop', () => {
  assert.match(html, /\.画廊\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(html, /\.画廊 img[\s\S]*?max-height:\s*none/);
  assert.match(html, /Desktop\/web: gallery stacks downward/);
  assert.doesNotMatch(html, /grid-template-columns:\s*repeat\(auto-fit, minmax\(260px/);
});

test('core action coverage: 翻炒+蒸汽 front-loaded even when smart-mod off', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.applyCoreActionCoverage, 'function');
  assert.equal(typeof f.w.hasDynamicCookingAction, 'function');

  const core =
    '厨房里忙碌的虚构成年女人正在翻炒，蒸汽升腾；纪实抓拍全身正面面向镜头，略带运动感；顶灯与窗光混合，不锈钢锅具有高光；围裙与食材细节清楚，表情专注；无未成年人。';
  assert.equal(f.w.hasDynamicCookingAction(core), true);

  // Weak English that dropped stir-fry / steam (common translate miss)
  const weakEn = 'a fictional adult woman cooking in a kitchen, full-body front view facing camera';
  const covered = f.w.applyCoreActionCoverage(weakEn, core);
  assert.match(covered, /stir[\s-]?fry|tossing food in wok|mid-motion/i);
  assert.match(covered, /steam|vapor|vapour/i);
  assert.match(covered, /wok|stainless/i);
  assert.match(covered, /apron/i);
  assert.match(covered, /ingredient|food detail/i);
  assert.match(covered, /documentary|candid|photojournal/i);
  // Action phrases should lead before the weak cooking filler
  const stirIdx = covered.search(/stir[\s-]?fry|tossing food in wok/i);
  const cookIdx = covered.search(/cooking in a kitchen/i);
  assert.ok(stirIdx >= 0 && (cookIdx < 0 || stirIdx < cookIdx), 'action should front-load before generic cooking');

  // Smart-mod OFF path must still inject coverage
  const minimal = f.w.minimalOutboundPrompt(weakEn, { core: core });
  assert.match(minimal, /stir[\s-]?fry|tossing food in wok|mid-motion/i);
  assert.match(minimal, /steam|vapor|vapour/i);
  assert.match(minimal, /apron|wok|stainless/i);
  assert.match(minimal, /photoreal|documentary|candid/i);
  f.w.document.getElementById('角色描述').value = core;
  assert.equal(f.w.document.getElementById('角色描述').value, core);

  // Gen path: outbound + negatives kill static/no-steam
  f.w.document.getElementById('英文描述').value = weakEn;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  // Ensure smart-mod off
  try { if (typeof f.w.清除智能修饰 === 'function') f.w.清除智能修饰(); } catch (e) {}
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || String(payload.negativePrompt || '');
  assert.match(pos, /stir[\s-]?fry|tossing food in wok|mid-motion/i);
  assert.match(pos, /steam|vapor|vapour/i);
  assert.match(pos, /apron|wok|stainless/i);
  assert.match(neg, /static pose|standing idle|no steam/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心不改写');
  // Woman+apron OK because core states 女人+围裙; no invented nude
  assert.match(pos, /woman|female|apron/i);
  const sceneCook = pos.replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(sceneCook, /\bnude\b|\blingerie\b|\bcleavage\b/i);
});

test('two-person 对视 core: count+eye-contact+warm light covered; solo negatives; no invented crop-top', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.corePersonCount, 'function');
  const core = '两名成年人在暖光室内对视';
  assert.equal(f.w.corePersonCount(core), 2);
  const weakEn = 'a fictional adult standing indoors';
  const covered = f.w.applyCoreActionCoverage(weakEn, core);
  assert.match(covered, /\btwo\b|\bboth\b/i);
  assert.match(covered, /looking at each other|eye\s*contact/i);
  assert.match(covered, /warm\s+(?:light|lighting|glow|interior)|warm interior/i);
  assert.match(covered, /indoor|interior/i);
  // Count/action should lead
  const twoIdx = covered.search(/\btwo\b/i);
  const standIdx = covered.search(/standing indoors/i);
  assert.ok(twoIdx >= 0 && (standIdx < 0 || twoIdx < standIdx), 'count should front-load: ' + covered.slice(0, 200));

  const minimal = f.w.minimalOutboundPrompt(weakEn, { core });
  assert.match(minimal, /\btwo\b|\bboth\b/i);
  assert.match(minimal, /looking at each other|eye\s*contact/i);
  assert.match(minimal, /warm/i);
  assert.doesNotMatch(minimal, /crop top|bare midriff|lingerie|cleavage/i);
  // Neutral gender — core says 成年人, not woman
  const sceneTwo = minimal.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '');
  assert.doesNotMatch(sceneTwo, /\bwoman\b|beautiful woman|\bfemale\b/i);
  // No always-on full-body facing-camera wall
  assert.doesNotMatch(minimal, /front view facing camera, eye-level, looking at camera/i);

  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('英文描述').value = weakEn;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  try { if (typeof f.w.清除智能修饰 === 'function') f.w.清除智能修饰(); } catch (e) {}
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || String(payload.negativePrompt || '');
  assert.match(pos, /\btwo\b|\bboth\b/i);
  assert.match(pos, /looking at each other|eye\s*contact/i);
  assert.match(pos, /warm/i);
  assert.match(neg, /single person|solo portrait|alone|one woman only|only one person/i);
  assert.match(neg, /revealing outfit|lingerie|skimpy|bra visible|panties/i);
  assert.doesNotMatch(neg, /bare midriff|crop top|exposed navel|exposed stomach/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心不改写');
});

test('female core without lingerie: strip underwear positives, everyday/clothed lead, anti-lingerie negatives; explicit lingerie still allowed', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasExposureIntent, 'function');
  assert.equal(f.w.hasExposureIntent('穿红毛衣的虚构成年女人站在窗边'), false);
  assert.equal(f.w.hasExposureIntent('穿内衣的虚构成年女人'), true);
  assert.equal(f.w.hasExposureIntent('a woman in lingerie'), true);
  assert.equal(f.w.hasExposureIntent('woman wearing bra and panties'), true);

  const womanNoOutfit = '一位虚构成年女人站在窗边';
  const drifted = 'beautiful woman, lingerie, underwear, bra visible, panties, cleavage, crop top, bare midriff, sheer blouse, seductive pose, standing by a window';
  const stripped = f.w.stripExposureBiasDefaults(drifted, womanNoOutfit);
  assert.doesNotMatch(stripped, /\blingerie\b|\bunderwear\b|\bbra\b|\bpanties\b|\bcleavage\b|\bcrop top\b|\bbare midriff\b|\bsheer blouse\b|\bseductive\b/i);
  assert.match(stripped, /window/i);

  const locked = f.w.finalizeOutboundCoreLocks(drifted, womanNoOutfit);
  assert.match(locked, /ordinary everyday clothing|fully clothed/i);
  assert.doesNotMatch(locked, /\blingerie\b|\bunderwear\b|\bbra\b|\bpanties\b|\bcleavage\b|\bcrop top\b|\bseductive\b/i);

  const womanClothed = '一位虚构成年女人穿蓝连衣裙站在公园';
  const clothedLocked = f.w.finalizeOutboundCoreLocks(
    'a woman in a blue dress, sexy lingerie, cleavage, panties',
    womanClothed
  );
  assert.match(clothedLocked, /clothing matching the core|fully clothed as described/i);
  assert.doesNotMatch(clothedLocked, /\blingerie\b|\bcleavage\b|\bpanties\b|\bsexy\b/i);

  const lingerieCore = '一位穿黑色内衣的虚构成年女人躺在床上';
  assert.equal(f.w.hasExposureIntent(lingerieCore), true);
  const allowed = f.w.stripExposureBiasDefaults('woman in black lingerie, cleavage', lingerieCore);
  assert.match(allowed, /lingerie/i);
  const allowLock = f.w.applyClothingFidelityLocks('woman in black lingerie', lingerieCore);
  assert.doesNotMatch(allowLock, /ordinary everyday clothing|clothing matching the core/i);
  assert.match(allowLock, /lingerie/i);

  const gated = f.w.sanitizeModifierAgainstCore(', lingerie, bra, panties, crop top, seductive pose, photoreal', womanNoOutfit);
  assert.doesNotMatch(gated, /\blingerie\b|\bbra\b|\bpanties\b|\bcrop top\b|\bseductive\b/i);

  f.w.document.getElementById('角色描述').value = womanNoOutfit;
  f.w.document.getElementById('英文描述').value = drifted;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  try { if (typeof f.w.清除智能修饰 === 'function') f.w.清除智能修饰(); } catch (e) {}
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || String(payload.negativePrompt || '');
  const scene = pos.replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '').replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '');
  assert.doesNotMatch(scene, /\blingerie\b|\bunderwear\b|\bbra\b|\bpanties\b|\bcleavage\b|\bcrop top\b|\bbare midriff\b|\bsheer blouse\b|\bseductive\b/i);
  assert.match(pos, /ordinary everyday clothing|fully clothed/i);
  assert.match(neg, /lingerie/);
  assert.match(neg, /underwear as outerwear|bra visible|panties/);
  assert.match(neg, /cleavage focus|sheer blouse|seductive pose|revealing outfit/);
  assert.doesNotMatch(neg, /bare midriff|crop top|exposed navel|exposed stomach/);
  assert.equal(f.w.document.getElementById('角色描述').value, womanNoOutfit, '可见核心不改写');

  const neutral = '一位虚构成年人站在雨夜街头';
  const neutOut = f.w.minimalOutboundPrompt('a fictional adult standing on a rainy night street, lingerie, cleavage', { core: neutral });
  assert.match(neutOut, /ordinary everyday clothing|fully clothed/i);
  const neutScene = neutOut.replace(/Faithful to core description:[\s\S]*?lead with core facts,?\s*/i, '').replace(/adult mode enabled[\s\S]*?no minors,?\s*/i, '');
  assert.doesNotMatch(neutScene, /\blingerie\b|\bcleavage\b/i);
});

test('midriff/露脐: no hard negatives; allow when core asks; strip when hallucinated; lingerie still anti', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasMidriffIntent, 'function');
  assert.equal(f.w.hasMidriffIntent('一位露脐的虚构成年女人站在窗边'), true);
  assert.equal(f.w.hasMidriffIntent('woman in crop top, bare midriff'), true);
  assert.equal(f.w.hasMidriffIntent('一位虚构成年女人站在窗边'), false);
  assert.equal(f.w.hasExposureIntent('一位露脐的虚构成年女人站在窗边'), false, '露脐 alone is not lingerie exposure');

  const noMidriffCore = '一位虚构成年女人站在窗边';
  const drifted = 'beautiful woman, crop top, bare midriff, exposed navel, lingerie, bra visible, standing by a window';
  const stripped = f.w.stripExposureBiasDefaults(drifted, noMidriffCore);
  assert.doesNotMatch(stripped, /\bcrop top\b|\bbare midriff\b|\bexposed navel\b|\blingerie\b|\bbra\b/i);
  assert.match(f.w.ANTI_LINGERIE_NEG, /lingerie|bra visible|panties/);
  assert.doesNotMatch(f.w.ANTI_LINGERIE_NEG, /bare midriff|crop top|exposed navel/i);

  const midriffCore = '一位穿露脐短上衣的虚构成年女人站在窗边';
  assert.equal(f.w.hasMidriffIntent(midriffCore), true);
  const kept = f.w.stripExposureBiasDefaults('woman in crop top, bare midriff, lingerie, bra visible, by a window', midriffCore);
  assert.match(kept, /crop top|bare midriff/i);
  assert.doesNotMatch(kept, /\blingerie\b|\bbra\b/i);
  const midLock = f.w.applyClothingFidelityLocks('woman in crop top, bare midriff, lingerie', midriffCore);
  assert.match(midLock, /crop top|bare midriff/i);
  assert.doesNotMatch(midLock, /ordinary everyday clothing|fully clothed as described/i);
  assert.doesNotMatch(midLock, /\blingerie\b/i);

  f.w.document.getElementById('角色描述').value = midriffCore;
  f.w.document.getElementById('英文描述').value = 'a fictional adult woman in a crop top with bare midriff standing by a window';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  try { if (typeof f.w.清除智能修饰 === 'function') f.w.清除智能修饰(); } catch (e) {}
  await f.w.开始生成();
  const payload = imagePayload(f.calls);
  const pos = String(payload.prompt || '').split(' ### ')[0];
  const neg = String(payload.prompt || '').split(' ### ')[1] || String(payload.negativePrompt || '');
  assert.match(pos, /crop top|bare midriff|midriff|露脐/i);
  assert.match(neg, /lingerie|bra visible|panties|underwear as outerwear/i);
  assert.doesNotMatch(neg, /bare midriff|crop top|exposed navel|exposed stomach/i);
  assert.equal(f.w.document.getElementById('角色描述').value, midriffCore, '可见核心不改写');
});

test('soft-adopted ref cleared on next full gen; history max 6 untouched; memory can save', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.清除生图工作缓存, 'function');
  assert.equal(typeof f.w.生图方式已自选, 'function');
  f.w.切换记忆(true);
  for (let i = 0; i < 6; i++) f.w.收入历史('https://example.com/h' + i + '.jpg', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
  assert.equal(f.w.读取生成历史().length, 6);
  f.w.document.getElementById('角色描述').value = '一位东亚女性站在雨夜街头';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图地址').dataset.softAdopted = '1';
  f.w.document.getElementById('参考图种子').value = '4242';
  f.w.localStorage.setItem('sushi_pending_prompt', 'old-run');
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  assert.equal(f.w.document.getElementById('参考图地址').dataset.softAdopted, '1', '记忆开成功后可软采用供下次改动');
  assert.ok(f.w.记忆路线.length >= 1, '记忆模式仍保存路线');
  assert.ok(f.w.记忆路线[0].image, '记忆路线保存图片');
  assert.equal(f.w.读取生成历史().length, 6, '历史容量仍为六张');
  f.calls.length = 0;
  f.w.切换生图方式('重新生成');
  f.w.document.getElementById('角色描述').value = '一位东亚女性站在雨夜街头，换一件红大衣';
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.equal(!!body.source_image, false, '未显式改动时不应沿用上一次软采用 source_image');
  assert.equal(f.w.读取生成历史().length, 6);
});

test('explicit 改动 keeps soft-adopted ref; clear last memory step clears gen cache', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图地址').dataset.softAdopted = '1';
  f.w.document.getElementById('参考图种子').value = '77';
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('改动');
  assert.equal(f.w.生图方式已自选(), true);
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, '显式改动应保留软采用参考图');
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图种子').value = '11';
  const ids = f.w.记忆路线.map(item => item.id);
  ids.forEach(id => f.w.清除一条记忆路线(id));
  assert.equal(f.w.记忆路线.length, 0);
  assert.equal(f.w.document.getElementById('参考图地址').value, '', '清尽记忆步后应清参考图缓存');
  assert.equal(f.w.document.getElementById('参考图种子').value, '');
});

test('改动 uses max-numbered memory step (1…N) as source; softThumb base64 materialize', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.改动参照源图, 'function');
  assert.equal(typeof f.w.最大编号记忆路线项, 'function');
  assert.equal(typeof f.w.ensureEditSourceBase64, 'function');
  f.w.切换记忆(true);
  const step1 = f.w.追加记忆路线('第一步描述', { image: 'https://example.com/step1.jpg', thumb: PNG + '1'.slice(0, 0) || PNG, seed: '1' });
  // distinct thumbs: reuse PNG for both (materialize already data)
  const thumb2 = PNG;
  const step2 = f.w.追加记忆路线('第二步描述', { image: 'https://example.com/step2.jpg', thumb: thumb2, seed: '2' });
  const step3 = f.w.追加记忆路线('第三步描述', { image: 'https://example.com/step3.jpg', thumb: PNG, seed: '3' });
  assert.equal(f.w.记忆路线.length, 3);
  // Activate older step 1 — 改动仍应取最大编号 3
  f.w.激活记忆路线项(step1.id, { 展示: false });
  const max = f.w.最大编号记忆路线项();
  assert.equal(max.步, 3);
  assert.match(String(max.image || ''), /step3/);
  const ref = f.w.改动参照源图();
  assert.equal(ref.step, 3);
  assert.match(String(ref.url || ''), /step3/);
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  f.w.document.getElementById('参考图地址').value = '';
  f.w.document.getElementById('参考图地址').dataset.softAdopted = '1';
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('改动');
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动应从最大编号步 materialize 出 base64');
  assert.equal(f.w.document.getElementById('角色描述').value, '图中人物抬起左手', '可见核心不改写');
});

test('改动 falls back to softThumb base64 when http source cannot materialize', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.document.getElementById('角色描述').value = '图中人物微笑';
  const addr = f.w.document.getElementById('参考图地址');
  addr.value = 'https://blocked.example/no-cors.jpg';
  addr.dataset.softAdopted = '1';
  addr.dataset.softThumb = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('改动');
  // stub materialize to fail on http, succeed path via softThumb
  const orig = f.w.materializeSourceImage;
  f.w.materializeSourceImage = async (src) => {
    if (String(src || '').indexOf('data:image') === 0) return src;
    return '';
  };
  const got = await f.w.ensureEditSourceBase64(addr.value);
  assert.equal(got, PNG);
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, 'softThumb 应作为改动 base64');
  f.w.materializeSourceImage = orig;
});

test('random invented core forces ordinary clothing; no lingerie/nude defaults', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.扩写随机核心, 'function');
  const bare = f.w.扩写随机核心('窗边的虚构成年女人', 'fictional adult woman by a window');
  assert.match(bare.核心, /普通日常服装|衣着整齐/);
  assert.match(bare.核心, /非内衣非暴露|非内衣/);
  assert.doesNotMatch(bare.核心, /(?<!非)(内衣|裸体|全裸|暴露|性感)/);
  assert.match(bare.详英, /ordinary everyday clothing|fully clothed/i);
  assert.match(bare.详英, /not lingerie|not nude/i);
  assert.doesNotMatch(bare.详英.replace(/not (?:lingerie|nude|revealing)/gi, ''), /\bnude\b|\blingerie\b|\bnaked\b/i);
  const clothed = f.w.扩写随机核心('穿红毛衣的虚构成年男人', 'fictional adult man in a red sweater');
  assert.match(clothed.核心, /非内衣|非裸体|衣着整齐/);
  assert.doesNotMatch(clothed.详英.replace(/not (?:lingerie|nude)/gi, ''), /\bnude\b|\blingerie\b/i);
  const item = f.w.本地随机一项();
  assert.ok(item && item.核心);
  assert.doesNotMatch(item.详英 || '', /\bnude\b|\bnaked\b|\blingerie\b/i);
  assert.doesNotMatch(item.核心, /(?<!非)(全裸|裸体)/);
  // 随机详英出站加日常着装；可见核心保持本地项原文
  f.w.本地随机一项 = () => ({
    中文: '公园里的虚构成年人',
    英文: 'fictional adult in a park',
    核心: '公园里的虚构成年人，全身正面',
    详英: 'fictional adult in a park, full-body front view'
  });
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始随机生成();
  assert.equal(f.w.document.getElementById('角色描述').value, '公园里的虚构成年人，全身正面', '可见核心不被随机着装回写改写');
  const body = imagePayload(f.calls);
  const prompt = String(body.prompt || '');
  assert.match(prompt, /ordinary everyday clothing|fully clothed|clothing matching the core/i);
  assert.doesNotMatch(prompt.split(/adult mode enabled/i)[0] || prompt, /\blingerie\b|\bnude\b|\bnaked\b|skimpy|cleavage/i);
});

test('#99 non-改动 still clears soft-adopted; 改动 rehydrates max step', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  f.w.追加记忆路线('甲', { image: 'https://example.com/a.jpg', thumb: PNG, seed: '10' });
  f.w.追加记忆路线('乙', { image: 'https://example.com/b.jpg', thumb: PNG, seed: '20' });
  f.w.document.getElementById('角色描述').value = '一位东亚女性站在雨夜街头';
  f.w.document.getElementById('参考图地址').value = PNG;
  f.w.document.getElementById('参考图地址').dataset.softAdopted = '1';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('重新生成');
  await f.w.开始生成();
  const body1 = imagePayload(f.calls);
  assert.equal(!!body1.source_image, false, '全文生图不应带软采用 source');
  f.calls.length = 0;
  f.w.document.getElementById('参考图地址').value = '';
  f.w.切换生图方式('改动');
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  await f.w.开始生成();
  const body2 = imagePayload(f.calls);
  assert.ok(body2.source_image, '改动应回填最大编号记忆步为 base64');
  const ref = f.w.改动参照源图();
  assert.equal(ref.step, f.w.记忆路线.length, '改动参照应为当前最大编号步');
  assert.ok(ref.step >= 2);
});

test('no chest exposure unless core asks: soft cover + negatives; explicit 露胸 allowed', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.hasChestExposureIntent, 'function');
  assert.equal(typeof f.w.applyChestCoverageLocks, 'function');
  assert.equal(f.w.hasChestExposureIntent('穿红毛衣的虚构成年女人站在窗边'), false);
  assert.equal(f.w.hasChestExposureIntent('一位露胸的虚构成年女人'), true);
  assert.equal(f.w.hasChestExposureIntent('a woman with cleavage and bare breasts'), true);
  assert.equal(f.w.hasChestExposureIntent('topless fictional adult'), true);
  assert.equal(f.w.hasChestExposureIntent('一位露脐的虚构成年女人'), false, '露脐 alone is not chest exposure');

  const core = '穿蓝连衣裙的虚构成年女人站在窗边';
  const locked = f.w.applyChestCoverageLocks('a woman in a blue dress by a window', core);
  assert.match(locked, /chest covered by clothing|modest neckline/i);
  assert.doesNotMatch(locked, /\bno cleavage\b/i);

  const allowed = f.w.applyChestCoverageLocks('woman with cleavage, bare breasts', '一位露胸的虚构成年女人');
  assert.match(allowed, /cleavage|bare breasts/i);
  assert.doesNotMatch(allowed, /chest covered by clothing/i);

  const out = f.w.finalizeOutboundCoreLocks('a woman in a blue dress by a window, photoreal', core);
  assert.match(out, /chest covered by clothing|modest neckline/i);

  f.w.document.getElementById('角色描述').value = core;
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  const prompt = String(body.prompt || '');
  const neg = String(body.prompt || '').split(' ### ')[1] || String(body.negativePrompt || '');
  assert.match(prompt, /chest covered by clothing|modest neckline/i);
  assert.match(neg, /cleavage|bare breasts|topless|deep neckline focus/i);
  assert.doesNotMatch(neg, /bare midriff|crop top|exposed navel|exposed stomach/i);
  assert.equal(f.w.document.getElementById('角色描述').value, core, '可见核心不改写');

  // explicit chest intent: no soft cover forced
  f.calls.length = 0;
  const chestCore = '一位露胸的虚构成年女人站在窗边';
  f.w.document.getElementById('角色描述').value = chestCore;
  await f.w.开始生成();
  const body2 = imagePayload(f.calls);
  const prompt2 = String(body2.prompt || '');
  assert.doesNotMatch(prompt2.split(/adult mode enabled/i)[0] || prompt2, /chest covered by clothing/i);
});

test('改动 auto-picks history max when memory empty; survives clear-cache race', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  f.w.切换记忆(true);
  // memory empty — history has numbered gens
  assert.equal(f.w.记忆路线.length, 0);
  f.w.收入历史('https://example.com/h0.jpg', PNG);
  f.w.收入历史('https://example.com/h1.jpg', PNG);
  assert.equal(f.w.读取生成历史().length, 2);
  const histRef = f.w.改动参照源图();
  assert.ok(histRef, '记忆空时应落到历史');
  assert.match(String(histRef.source || ''), /history/);
  assert.ok(histRef.thumb === PNG || String(histRef.url || '').indexOf('data:image') === 0 || /h[01]\.jpg/.test(String(histRef.url || '')));

  f.w.document.getElementById('角色描述').value = '图中人物抬起左手';
  const addr = f.w.document.getElementById('参考图地址');
  addr.value = 'https://blocked.example/gone.jpg';
  addr.dataset.softAdopted = '1';
  addr.dataset.softThumb = PNG;
  f.w.document.getElementById('图生图平台').value = 'horde-real';
  f.w.用户选定图生图平台 = 'horde-real';
  f.w.document.getElementById('出图引擎').value = 'horde-real';
  f.w.切换生图方式('改动');
  // stub http materialize fail — must succeed via softThumb or history thumb
  const orig = f.w.materializeSourceImage;
  f.w.materializeSourceImage = async (src) => {
    if (String(src || '').indexOf('data:image') === 0) return src;
    return '';
  };
  await f.w.开始生成();
  const body = imagePayload(f.calls);
  assert.ok(body.source_image, '改动应在 clear-cache 后仍拿到 base64（softThumb/历史）');
  // Horde payload may strip data:image prefix and send raw base64
  assert.match(String(body.source_image), /^(?:data:image\/|iVBOR|[A-Za-z0-9+/=]{32,})/);
  f.w.materializeSourceImage = orig;
});

test('改动 collect candidates prefer data URLs from history over http', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  assert.equal(typeof f.w.collectEditSourceCandidates, 'function');
  f.w.切换记忆(true);
  f.w.收入历史('https://example.com/old.jpg', PNG);
  const cands = f.w.collectEditSourceCandidates('https://example.com/preferred.jpg');
  assert.ok(cands.length >= 2);
  const firstData = cands.find(u => String(u).indexOf('data:image') === 0);
  assert.ok(firstData, '应收集到历史 data thumb');
  const dataIdx = cands.indexOf(firstData);
  const httpIdx = cands.findIndex(u => String(u).indexOf('http') === 0);
  if (httpIdx >= 0) assert.ok(dataIdx < httpIdx, 'data: 候选应排在 http 之前');
});
