(function () {
  'use strict';

  var active = null;
  var lastEdited = '角色描述';
  var randomPair = null;
  var officialUrl = 'https://perchance.org/ai-text-to-image-generator';
  var $ = function (id) { return document.getElementById(id); };
  var value = function (id) { return ($(id) && $(id).value || '').trim(); };

  function status(title, detail, busy) {
    var box = $('状态提示');
    box.replaceChildren();
    box.style.display = 'flex';
    box.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) {
      var spinner = document.createElement('div');
      spinner.className = '加载动画';
      box.appendChild(spinner);
    }
    var heading = document.createElement('b');
    heading.textContent = title;
    var description = document.createElement('p');
    description.textContent = detail || '';
    box.append(heading, description);
  }

  function controls(busy) {
    window.正在生成图片 = busy;
    window.设置生成按钮状态(busy, busy ? '生成中…' : '生成角色图片');
    $('取消生成按钮').hidden = !busy;
    $('取消生成按钮').disabled = false;
  }

  async function api(path, options) {
    options = options || {};
    var method = options.method || 'GET';
    var controller = new AbortController();
    var abort = function () { controller.abort(); };
    // Render 免费实例冷启动可能超过 30 秒。读取请求允许更长时间，提交任务绝不自动重试，避免重复生成。
    var timeoutMs = options.timeoutMs || (method === 'POST' ? 90000 : 55000);
    var timer = setTimeout(abort, timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    try {
      var response = await fetch('/api/images' + path, {
        method: method, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      var data;
      try { data = await response.json(); } catch (e) { throw new Error('服务器返回异常，请稍后重试'); }
      if (!response.ok) {
        var error = new Error(data.error || (response.status === 401 ? '登录已过期，请返回首页重新登录' : '请求失败，请稍后重试'));
        error.status = response.status;
        error.code = data.code;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        var timeoutError = new Error('服务器启动或连接耗时较长，请稍后重试');
        timeoutError.code = 'CLIENT_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', abort);
    }
  }

  async function safeGet(path, attempts) {
    var lastError;
    attempts = attempts || 2;
    for (var i = 0; i < attempts; i += 1) {
      try {
        return await api(path, { method: 'GET', timeoutMs: i === 0 ? 55000 : 70000 });
      } catch (error) {
        lastError = error;
        if (error.status && error.status < 500 && error.status !== 429) throw error;
        if (i + 1 < attempts) {
          status('服务器正在启动', '首次连接较慢，正在自动重试，不会重复提交生图任务。', true);
          await new Promise(function (resolve) { setTimeout(resolve, 2500); });
        }
      }
    }
    throw lastError;
  }

  function ensureActive(run) {
    if (active !== run || run.cancelled) throw new Error('已取消生成');
  }

  function pause(run, ms) {
    return new Promise(function (resolve) {
      var timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); run.wake = null; resolve(); }
      run.wake = done;
    });
  }

  function within(promise, ms) {
    var timer;
    return Promise.race([promise, new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error('翻译超时')); }, ms);
    })]).finally(function () { clearTimeout(timer); });
  }

  async function promptFor(run) {
    var source = run.description;
    if (randomPair && randomPair.chinese === source) return randomPair.english;
    if (!/[\u4e00-\u9fff]/.test(source)) return source;
    if (source.length <= 400 && typeof window.调用开源翻译 === 'function') {
      status('正在翻译画面描述', '翻译完成后提交；连接失败时使用本次原文。', true);
      try {
        var translated = await within(window.调用开源翻译(source, 'en'), 8000);
        ensureActive(run);
        if (translated && !/[\u4e00-\u9fff]/.test(translated)) return translated;
      } catch (e) { ensureActive(run); }
    }
    run.translationNote = '翻译未完成，已使用本次原文；英文描述通常更稳定。';
    return source;
  }

  function progress(run, job) {
    var detail = '免费共享算力的等待时间会变化，最多等待 10 分钟。';
    if (job.queuePosition !== null && job.queuePosition !== undefined) detail = '当前排队位置：' + job.queuePosition + '。' + detail;
    if (job.waitTimeSeconds > 0) detail += ' 服务估计还需约 ' + Math.ceil(job.waitTimeSeconds) + ' 秒。';
    if (run.translationNote) detail += ' ' + run.translationNote;
    status((job.state === 'processing' ? '正在生成' : '正在排队') + ' · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', detail, true);
  }

  async function poll(run, job) {
    var errors = 0;
    while (!['done', 'failed', 'cancelled'].includes(job.state)) {
      ensureActive(run);
      if (Date.now() > job.expiresAt + 35000) throw new Error('任务等待超时，请稍后重试');
      progress(run, job);
      await pause(run, 2500);
      ensureActive(run);
      try {
        job = await api('/' + encodeURIComponent(job.id), { signal: run.controller.signal });
        run.job = job;
        errors = 0;
      } catch (error) {
        ensureActive(run);
        if (error.status && error.status < 500 && error.status !== 429) throw error;
        errors += 1;
        if (errors >= 4) throw error;
        status('连接暂时中断，正在重新查询', '不会重复提交生图任务。', true);
        await pause(run, Math.min(3000 + errors * 1500, 7000));
      }
    }
    ensureActive(run);
    if (job.state !== 'done') throw new Error(job.error || '任务未完成，请重试');
    return job;
  }

  function addImage(run, result) {
    return new Promise(function (resolve, reject) {
      var card = document.createElement('figure');
      card.className = '生图卡片';
      var img = document.createElement('img');
      img.alt = run.description || '生成的图片';
      img.referrerPolicy = 'no-referrer';
      img.setAttribute('data-engine', 'horde');
      var timer = setTimeout(failed, 30000);
      var settled = false;
      function cleanup() { clearTimeout(timer); img.onload = null; img.onerror = null; run.controller.signal.removeEventListener('abort', cancelled); }
      function cancelled() {
        if (settled) return;
        settled = true; cleanup(); reject(new Error('已取消生成'));
      }
      function loaded() {
        if (settled || !img.naturalWidth) return;
        settled = true; cleanup(); resolve();
      }
      function failed() {
        if (settled) return;
        settled = true; cleanup();
        img.hidden = true;
        var note = document.createElement('figcaption');
        note.textContent = '图片已生成，但下载失败。';
        var retry = document.createElement('button');
        retry.type = 'button'; retry.className = '次按钮'; retry.textContent = '重新加载图片';
        retry.onclick = function () {
          retry.disabled = true; note.textContent = '正在重新加载…';
          var retryTimer = setTimeout(retryFailed, 30000);
          function retryFailed() {
            clearTimeout(retryTimer); img.onload = null; img.onerror = null;
            retry.disabled = false; note.textContent = '加载失败，请检查网络后重试。';
          }
          img.onload = function () {
            clearTimeout(retryTimer); img.onload = null; img.onerror = null;
            img.hidden = false; note.remove(); retry.remove();
          };
          img.onerror = retryFailed;
          img.removeAttribute('src'); img.src = result.url;
        };
        card.append(note, retry);
        var error = new Error('图片已生成，但未能加载。请点图片下方的“重新加载图片”，不会重复生成或扣除额度。');
        error.code = 'IMAGE_DOWNLOAD'; reject(error);
      }
      img.onload = loaded; img.onerror = failed;
      run.controller.signal.addEventListener('abort', cancelled, { once: true });
      card.appendChild(img); $('图像输出').appendChild(card);
      img.src = result.url;
      if (img.complete && img.naturalWidth) loaded();
    });
  }

  async function stopJob(run) {
    if (!run.job || ['done', 'failed', 'cancelled'].includes(run.job.state)) return;
    run.job = await api('/' + encodeURIComponent(run.job.id), { method: 'DELETE', timeoutMs: 30000 });
  }

  async function execute(run, restored) {
    try {
      if (!restored) {
        run.payload.prompt = await promptFor(run);
        if (run.backgroundOnly && run.payload.sourceImage) {
          run.payload.prompt = 'Keep the subject and composition of the reference photo, change only the background: ' + run.payload.prompt;
        }
      }
      ensureActive(run);
      if ($('说明标题')) $('说明标题').textContent = run.description || '恢复上次任务';
      if ($('说明英文')) $('说明英文').textContent = run.payload.prompt || '';
      while (run.completed < run.total) {
        ensureActive(run);
        if (!restored) {
          status('正在提交 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', '服务器如刚启动可能稍慢；重复点击不会创建新任务。', true);
          var payload = Object.assign({}, run.payload);
          if (payload.seed !== '') payload.seed = String(Number(payload.seed) + run.completed);
          // POST 不自动重试，防止网络抖动时重复创建任务或重复扣额度。
          run.job = await api('', { method: 'POST', body: payload, timeoutMs: 90000 });
        }
        ensureActive(run);
        var done = await poll(run, run.job);
        status('图片已生成，正在加载', '', true);
        await addImage(run, done.image);
        ensureActive(run);
        run.completed += 1;
        restored = false;
      }
      status('已生成 ' + run.completed + ' 张图片', '图片已显示在下方。', false);
    } catch (error) {
      if (active !== run) return;
      var cleanupError = '';
      try { await stopJob(run); } catch (e) { cleanupError = ' 未收到取消确认，任务最迟在 10 分钟上限后结束。'; }
      var title = run.cancelled ? '已停止本轮生成' : (run.completed ? '已生成 ' + run.completed + ' 张，后续未完成' : '本次未完成');
      status(title, (run.cancelled ? '已保留已完成的图片。' : error.message) + cleanupError, false);
      if (!run.cancelled && window.记录失败原因) window.记录失败原因(error.message);
    } finally {
      if (active === run) { active = null; controls(false); }
    }
  }

  function newRun(description, total) {
    return { description: description, total: total, completed: 0, payload: {}, job: null, cancelled: false, controller: new AbortController() };
  }

  function openOfficial() {
    status('在 Perchance 官网生成', 'Perchance 当前为官方网页通道；复制描述后打开官网生成。内置生成可选择其他平台。', false);
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = '次按钮'; copy.textContent = '复制画面描述';
    copy.onclick = async function () {
      try { await navigator.clipboard.writeText(value('角色描述')); copy.textContent = '已复制'; }
      catch (e) { copy.textContent = '请长按描述框手动复制'; $('角色描述').focus(); }
    };
    var link = document.createElement('a');
    link.href = officialUrl; link.target = '_top'; link.rel = 'noopener';
    link.className = '次按钮'; link.textContent = '打开 Perchance 官网';
    $('状态提示').append(copy, link);
  }

  window.开始生成 = function () {
    if (active || $('生成按钮').disabled) return Promise.resolve();
    if (window.当前引擎() === 'perchance') { openOfficial(); return Promise.resolve(); }
    var description = lastEdited === '英文描述' ? value('英文描述') : value('角色描述');
    if (!description) description = value('角色描述') || value('英文描述');
    if (!description) { status('请先填写画面描述', '也可以点击“随机生成图片”。', false); $('角色描述').focus(); return Promise.resolve(); }
    var run = newRun(description, [1, 3, 5, 7].includes(Number(value('生成数量'))) ? Number(value('生成数量')) : 1);
    run.backgroundOnly = !!($('只换背景') && $('只换背景').checked);
    var dimensions = value('图像比例').split('x');
    run.payload = {
      prompt: description, width: Number(dimensions[0]) || 512, height: Number(dimensions[1]) || 512,
      negativePrompt: value('负面提示'), seed: value('随机种子'), cfgScale: Number(value('引导强度')) || 7,
      sourceImage: value('参考图地址'), strength: Number(value('图生图强度')) || 0.45
    };
    active = run; controls(true);
    $('图像输出').replaceChildren(); $('官方画廊').replaceChildren(); $('官方画廊').hidden = true;
    window.设平台提示('horde');
    run.promise = execute(run, false);
    return run.promise;
  };

  window.开始随机生成 = function () {
    if (active || $('随机按钮').disabled) return Promise.resolve();
    var pair = window.本地随机一对();
    randomPair = { chinese: pair[0], english: pair[1] };
    $('角色描述').value = pair[0]; $('中文译文').value = pair[0]; $('英文描述').value = pair[1];
    lastEdited = '角色描述';
    window.刷新画面说明();
    return window.开始生成();
  };

  window.取消生成 = function () {
    if (!active || active.cancelled) return;
    active.cancelled = true;
    active.controller.abort();
    if (active.wake) active.wake();
    $('取消生成按钮').disabled = true;
    status('正在取消', '等待服务器确认后即可开始下一次。', false);
  };

  window.当前引擎 = function () { return value('出图引擎') === 'perchance' ? 'perchance' : 'horde'; };
  window.设平台提示 = function (engine) {
    $('平台提示').textContent = engine === 'perchance' ? 'Perchance · 官方网页通道' : 'AI Horde · 免费共享算力，繁忙时需要排队';
  };

  async function init() {
    ['角色描述', '英文描述', '中文译文'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        lastEdited = id;
        if (id === '中文译文') $('角色描述').value = value(id);
        randomPair = null;
      });
    });
    $('出图引擎').addEventListener('change', function () { window.设平台提示(window.当前引擎()); });
    window.设平台提示(window.当前引擎());
    window.__sushiReady = true; window.__sushiLoadError = '';
    controls(true); $('取消生成按钮').hidden = true;
    status('正在连接生图服务', '如果服务器刚休眠，首次连接会自动等待并重试。', true);
    try {
      var results = await Promise.all([safeGet('/config', 2), safeGet('/current', 2)]);
      officialUrl = results[0].perchanceUrl || officialUrl;
      if (results[1].job) {
        var run = newRun('', 1);
        run.job = results[1].job;
        active = run; controls(true);
        run.promise = execute(run, true);
        return;
      }
      status('生图服务已就绪', '可以开始生成图片。', false);
    } catch (error) {
      status('暂时无法准备生图', error.message + ' 可稍后直接再次点击生成。', false);
    }
    controls(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
