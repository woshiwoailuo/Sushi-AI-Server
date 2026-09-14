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
  assert.match(decodeURIComponent(String(gen.url).replace(/\+/g, '%20')), /photorealistic RAW photo/i);
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
  assert.match(payload.prompt, /photorealistic RAW photo/i);
  assert.match(payload.prompt, /adult mode enabled/i);
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
  assert.match(f.w.document.getElementById('成人功能状态').value, /NSFW fully allowed|NSFW allowed/);
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
  const blended = f.w.组装出图描述含记忆();
  assert.match(blended, /银发法师在雪原施法/);
  assert.doesNotMatch(blended, /^stale english/);
  assert.doesNotMatch(blended, /勿覆盖|延续记忆补充|用简体中文回复|请只输出/);
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
  assert.match(adultField, /do not add clothes/i);
  assert.match(adultField, /NSFW fully allowed/i);
  const nude = 'nude fictional adult woman standing by a rainy window, explicit adult scene';
  const enriched = f.w.forcePhotorealPrompt(nude);
  assert.match(enriched, /nude fictional adult woman/i);
  assert.doesNotMatch(enriched, /realistic fabric texture/i);
  const outbound = f.w.withAdultDirective(enriched);
  assert.match(outbound, /nude fictional adult woman/i);
  assert.match(outbound, /adult mode enabled/i);
  assert.match(outbound, /do not add clothes/i);
  assert.match(outbound, /NSFW fully allowed/i);
  f.w.切换成人对勾(false);
  assert.equal(f.w.withAdultDirective(enriched), enriched);
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
  assert.match(prompt, /NSFW fully allowed|NSFW allowed/i);
  assert.doesNotMatch(prompt.split(' ### ')[0], /realistic fabric texture/i);
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

test('photoreal default prefers full-body front view unless user asks half-body', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const plain = f.w.forcePhotorealPrompt('fictional adult woman in a park');
  assert.match(plain, /full body head-to-toe visible|feet in frame|standing full figure/i);
  assert.match(plain, /not cropped at waist or chest/i);
  assert.match(plain, /front view|facing camera|eye-level/i);
  // Framing tokens should appear early (near photoreal lead), not only as a weak trailing tag.
  const leadIdx = plain.toLowerCase().indexOf('photorealistic');
  const feetIdx = plain.toLowerCase().indexOf('feet in frame');
  assert.ok(leadIdx >= 0 && feetIdx > leadIdx && feetIdx - leadIdx < 220, 'full-body tokens should be early: ' + plain.slice(0, 260));
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

test('workshop negative default is English; adult directive is stronger NSFW scale', async t => {
  const f = await setup(t, (url, options) => response(options.method === 'POST' ? job() : job('done')));
  const neg = f.w.document.getElementById('负面提示').value;
  assert.match(neg, /lowres|bad anatomy|malformed hands/i);
  assert.doesNotMatch(neg, /低清晰度|错误解剖|畸形手部|未成年人/);
  const adult = f.w.document.getElementById('成人功能状态').value;
  assert.match(adult, /NSFW fully allowed/i);
  assert.match(adult, /keep requested nudity and sexual details visible/i);
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
  assert.match(prompt.split(' ### ')[0], /adult mode enabled|NSFW fully allowed/i);
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
