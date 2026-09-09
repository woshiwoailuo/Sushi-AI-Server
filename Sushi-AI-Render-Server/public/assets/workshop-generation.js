(function () {
  'use strict';

  var active = null;
  var lastEdited = '角色描述';
  var randomPair = null;
  var lockedImageProvider = '';
  window.__sushiImageProviderLock = '';
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

  function lockImageProvider(name) {
    // Remember last successful engine for tips only — never lock/disable the picker.
    name = String(name || '').trim();
    if (!name || name === 'auto') return;
    window.__sushiLastEngine = name;
    var box = $('出图引擎');
    if (box) {
      box.disabled = false;
      box.removeAttribute('disabled');
      box.title = '可随时切换生图平台；上次成功：' + name;
    }
  }

  async function api(path, options) {
    options = options || {};
    var method = options.method || 'GET';
    var controller = new AbortController();
    var abort = function () { controller.abort(); };
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

  // Explicit art-style keywords: honor anime/manga/cartoon/二次元/插画 instead of forcing photoreal.
  var ART_STYLE_RE = /anime|manga|cartoon|chibi|二次元|动漫|卡通|漫画|插画|illustration|cel[\s-]?shad|pixar|disney|comic(?:\s|-)?style|手绘|赛璐璐|2d\s*art|视觉小说/i;
  function hasExplicitArtStyle(text) {
    return ART_STYLE_RE.test(String(text || ''));
  }

  function photorealPrompt(prompt) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      text = 'photorealistic RAW photo of a fictional adult, natural light, DSLR';
    }
    // Keep the user's core intent. If they named an art style, do not strip or override it.
    if (hasExplicitArtStyle(text)) {
      if (!/fictional adult|18\+|no minors|虚构成年/i.test(text)) {
        text += ', fictional adult 18+ only, no minors';
      }
      return text.replace(/\s{2,}/g, ' ').trim();
    }
    // Default: lead with strong photoreal rhetoric so anime-biased engines (e.g. Perchance) honor photo style.
    // Enrichment is for the generator prompt only — never write this back into visible core/display fields.
    var lead = 'photorealistic RAW photo, shot on DSLR, 85mm, natural skin pores, realistic fabric texture';
    if (!/photoreal|RAW photo|DSLR|cinematic still|real human|写实摄影|写实照片/i.test(text)) {
      text = lead + ', ' + text;
    } else if (!/^\s*photoreal/i.test(text)) {
      text = 'photorealistic photograph of ' + text;
    }
    if (!/natural light|cinematic|rim light|soft light|golden hour|studio light|volumetric|shallow depth/i.test(text)) {
      text += ', natural light, cinematic still, shallow depth of field';
    }
    if (!/skin pores|subsurface|imperfection|fabric texture|material detail|sharp focus/i.test(text)) {
      text += ', natural skin texture, clear material detail, sharp focus, real human';
    }
    if (!/not anime|no anime|非卡通|非动漫|NOT anime/i.test(text)) {
      text += ', not anime, not manga, not cartoon, not illustration, not 2d art, not cel shading';
    }
    if (!/fictional adult|18\+|no minors/i.test(text)) {
      text += ', fictional adult 18+ only, no minors';
    }
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  function hideStatusPanel() {
    var box = $('状态提示');
    if (!box) return;
    box.style.display = 'none';
    box.setAttribute('aria-busy', 'false');
    box.replaceChildren();
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

  function addImage(run, result, engine) {
    return new Promise(function (resolve, reject) {
      var card = document.createElement('figure');
      card.className = '生图卡片';
      var img = document.createElement('img');
      img.alt = run.description || '生成的图片';
      img.referrerPolicy = 'no-referrer';
      img.setAttribute('data-engine', engine || 'horde');
      var timer = setTimeout(failed, 45000);
      var settled = false;
      function cleanup() { clearTimeout(timer); img.onload = null; img.onerror = null; run.controller.signal.removeEventListener('abort', cancelled); }
      function cancelled() {
        if (settled) return;
        settled = true; cleanup(); reject(new Error('已取消生成'));
      }
      function loaded() {
        if (settled || !img.naturalWidth) return;
        settled = true; cleanup();
        lockImageProvider(engine || 'horde');
        resolve();
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

  function workshopTicket() {
    try { return new URLSearchParams(location.search).get('k') || ''; } catch (e) { return ''; }
  }

  function pollinationsProxyUrl(model, prompt, width, height, seed) {
    return '/api/workshop/image'
      + '?k=' + encodeURIComponent(workshopTicket())
      + '&model=' + encodeURIComponent(model || 'turbo')
      + '&prompt=' + encodeURIComponent(String(prompt || 'photo').slice(0, 1400))
      + '&width=' + (width || 512)
      + '&height=' + (height || 512)
      + '&seed=' + seed;
  }

  function turboUrl(prompt, width, height, seed) {
    return pollinationsProxyUrl('turbo', prompt, width, height, seed);
  }

  function loadImageUrl(run, url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Turbo 出图超时'));
      }, timeoutMs || 45000);
      function cleanup() {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        run.controller.signal.removeEventListener('abort', onAbort);
      }
      function onAbort() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('已取消生成'));
      }
      img.referrerPolicy = 'no-referrer';
      img.onload = function () {
        if (settled || !img.naturalWidth) return;
        settled = true;
        cleanup();
        resolve(url);
      };
      img.onerror = function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Turbo 出图失败'));
      };
      run.controller.signal.addEventListener('abort', onAbort, { once: true });
      img.src = url;
    });
  }

  async function generatePollinations(run, prompt, index, model) {
    model = normalizeEngineName(model || 'turbo');
    if (isEngineCool(model)) {
      var coolErr = new Error(coolHint(model) + '（限流跳过）');
      coolErr.status = 429;
      coolErr.code = 'ENGINE_COOLDOWN';
      throw coolErr;
    }
    var seedBase = run.payload.seed !== '' && run.payload.seed != null
      ? Number(run.payload.seed)
      : Math.floor(Math.random() * 2147483646);
    if (!Number.isFinite(seedBase)) seedBase = Math.floor(Math.random() * 2147483646);
    var seed = seedBase + (index || 0) * 97;
    var label = engineLabel(model);
    status('正在用 ' + label + ' 生成 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', '同源代理出图；遇限流会立刻换引擎，不空等。', true);
    var lastError = null;
    for (var attempt = 0; attempt < 3; attempt += 1) {
      ensureActive(run);
      var url = pollinationsProxyUrl(model, prompt, run.payload.width, run.payload.height, seed + attempt * 131);
      try {
        var response = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: run.controller.signal });
        if (!response.ok) {
          var httpErr = new Error(label + (response.status === 429 ? ' 限流(429)' : (' HTTP ' + response.status)));
          httpErr.status = response.status;
          if (response.status === 429 || response.status >= 500) {
            markEngineCool(model, response.status);
            throw httpErr; // fail fast — skip this engine for the rest of the round
          }
          throw httpErr;
        }
        var blob = await response.blob();
        if (!blob || !blob.size || blob.size < 2500) throw new Error(label + ' 图片无效');
        if (blob.type && blob.type.indexOf('image/') !== 0 && blob.type.indexOf('application/octet-stream') !== 0) {
          throw new Error(label + ' 未返回图片');
        }
        var dataUrl = await new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(new Error(label + ' 读图失败')); };
          reader.readAsDataURL(blob);
        });
        return { url: dataUrl, engine: model };
      } catch (error) {
        if (run.cancelled || (error && error.name === 'AbortError')) throw new Error('已取消生成');
        lastError = error;
        if (error && (error.status === 429 || error.status >= 500 || error.code === 'ENGINE_COOLDOWN')) throw error;
        await pause(run, 400 + attempt * 350);
      }
    }
    throw lastError || new Error(label + ' 出图失败');
  }

  async function generateTurbo(run, prompt, index) {
    return generatePollinations(run, prompt, index, 'turbo');
  }

  async function generateHorde(run, prompt, index) {
    var payload = Object.assign({}, run.payload, { prompt: prompt });
    if (payload.seed !== '' && payload.seed != null) payload.seed = String(Number(payload.seed) + (index || 0));
    status('正在提交 Horde · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', '服务器如刚启动可能稍慢；重复点击不会创建新任务。', true);
    run.job = await api('', { method: 'POST', body: payload, timeoutMs: 90000, signal: run.controller.signal });
    ensureActive(run);
    var done = await poll(run, run.job);
    return { url: done.image.url, engine: 'horde', job: done };
  }

  // Short cool-down after 429/5xx so race skips that engine for the rest of this round.
  var ENGINE_COOLDOWN_MS = 25000;
  var engineCooldownUntil = Object.create(null);
  var lastRateLimited = false;

  function markEngineCool(eng, statusCode) {
    eng = normalizeEngineName(eng);
    if (!eng || eng === 'auto') return;
    engineCooldownUntil[eng] = Date.now() + ENGINE_COOLDOWN_MS;
    if (statusCode === 429) lastRateLimited = true;
  }

  function isEngineCool(eng) {
    eng = normalizeEngineName(eng);
    var until = engineCooldownUntil[eng];
    return !!(until && Date.now() < until);
  }

  function coolHint(eng) {
    var until = engineCooldownUntil[normalizeEngineName(eng)];
    if (!until) return '';
    var sec = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return engineLabel(eng) + ' 冷却中约 ' + sec + ' 秒';
  }

  // Short cooldown after *real* Perchance failure/timeout so auto race prefers Turbo/Horde first.
  // Do NOT mark cool-down when we merely lost an auto-race (another engine already won).
  var perchanceCooldownUntil = 0;
  var PERCHANCE_COOLDOWN_MS = 15000;

  function markPerchanceFailure(reason) {
    perchanceCooldownUntil = Date.now() + PERCHANCE_COOLDOWN_MS;
    try { window.__sushiPerchanceCoolReason = String(reason || 'failure'); } catch (e) {}
  }

  function isPerchanceCooling() {
    return Date.now() < perchanceCooldownUntil;
  }

  function perchanceCoolHint() {
    var sec = Math.max(1, Math.ceil((perchanceCooldownUntil - Date.now()) / 1000));
    return 'Perchance 短暂冷却中约 ' + sec + ' 秒（上次出图失败/超时后的短暂停用，避免空等）。可改选「自动抢出」或「Flux写实」，或稍后再试。';
  }

  function raceFailMessage(errors) {
    var msgs = (errors || []).map(function (e) { return e && e.message; }).filter(Boolean);
    var rate = lastRateLimited || msgs.some(function (m) { return /429|限流|繁忙|冷却/.test(String(m)); });
    if (rate) {
      return '出图通道限流：已跳过繁忙引擎（短冷却）。请稍后重试或手动换通道；不是全部永久失败。';
    }
    return msgs.length ? msgs.join('；') : '自动抢出失败：各平台均未成功';
  }

  var FREE_RACE_ENGINES = ['flux-realism', 'turbo', 'flux', 'sana', 'horde', 'perchance'];

  function normalizeEngineName(raw) {
    var name = String(raw || '').trim().toLowerCase();
    if (name === '官方' || name === 'perch') return 'perchance';
    if (name === 'flux-real' || name === 'flux_realism') return 'flux-realism';
    if (name === 'zimage' || name === 'sdxl' || name === 'krea2' || name === 'liblib') return 'flux';
    if (name === 'anishort') return 'sana';
    return name || 'auto';
  }

  function engineLabel(name) {
    var map = {
      auto: '自动抢出', turbo: 'Turbo', horde: 'Horde', flux: 'Flux',
      'flux-realism': 'Flux写实', sana: 'Sana', perchance: 'Perch / Perchance'
    };
    return map[name] || name;
  }

  function nodeImageUrl(node) {
    if (!node) return '';
    if (node.tagName === 'IMG' && node.src) return node.src;
    if (node.tagName === 'CANVAS' && typeof node.toDataURL === 'function') {
      try { return node.toDataURL('image/png'); } catch (e) { return ''; }
    }
    if (node.tagName === 'IFRAME') {
      try {
        var doc = node.contentDocument || (node.contentWindow && node.contentWindow.document);
        if (!doc) return '';
        var img = doc.querySelector('img');
        return img && img.src ? img.src : '';
      } catch (e) { return ''; }
    }
    return '';
  }

  async function generatePerchance(run, prompt, index) {
    // Keep Perchance primary, but do not wait again after a recent real failure.
    if (isPerchanceCooling()) throw new Error(perchanceCoolHint());
    // In-app Perchance/Perch only — never open perchance.org.
    // Enriched photoreal prompt goes ONLY into hidden 安全英文 — never decorate visible 英文描述/角色描述.
    var safeBox = $('安全英文');
    var prevSafe = safeBox ? safeBox.value : '';
    var styleBox = $('艺术风格');
    var prevStyle = styleBox ? styleBox.value : '';
    try {
      if (typeof window.update !== 'function') throw new Error('Perchance 组件未加载');
      var gallery = $('官方画廊');
      var trigger = $('执行生成');
      if (!gallery || !trigger) throw new Error('Perchance 界面未就绪');
      if (safeBox) safeBox.value = prompt;
      // Also reinforce photoreal style token the plugin may read.
      if (styleBox && !hasExplicitArtStyle(prompt)) {
        styleBox.value = '写实摄影，电影剧照，自然皮肤质感，非卡通，非动漫，非插画，真实照片';
      }
      gallery.hidden = false;
      var before = gallery.querySelectorAll('iframe, img, canvas').length;
      trigger.value = String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000)) + '-p' + String(index || 0);
      try {
        trigger.dispatchEvent(new Event('input', { bubbles: true }));
        trigger.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}
      try { window.update(gallery); } catch (error) { throw new Error('Perchance 未能启动'); }
      var deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        ensureActive(run);
        // Another free-race engine already won — exit quietly, do NOT enter cool-down.
        if (run && run._raceSettled) throw new Error('lost-race');
        var nodes = gallery.querySelectorAll('iframe, img, canvas');
        if (nodes.length > before) {
          var i = nodes.length - 1;
          for (; i >= before; i -= 1) {
            var url = nodeImageUrl(nodes[i]);
            if (url && String(url).length > 32) {
              perchanceCooldownUntil = 0;
              return { url: url, engine: 'perchance' };
            }
          }
        }
        await pause(run, 600);
      }
      throw new Error('Perchance 出图超时');
    } catch (error) {
      var msg = String(error && error.message || error || '');
      // Skip cool-down for cancel, already-cooling tip, or losing an auto-race (false positive).
      if (!error || /已取消生成|短暂冷却中|lost-race/.test(msg)) throw error;
      markPerchanceFailure(msg);
      throw error;
    } finally {
      if (safeBox) safeBox.value = prevSafe;
      if (styleBox) styleBox.value = prevStyle;
    }
  }

  async function generateOne(run, prompt, index) {
    var engine = resolveEngine();
    lastRateLimited = false;
    prompt = photorealPrompt(prompt);
    // Honor explicit platform selection: only race when engine === 'auto'.
    if (engine === 'horde') {
      if (isEngineCool('horde')) throw Object.assign(new Error(coolHint('horde') + '。限流冷却中，请稍后或换自动抢出。'), { status: 429, code: 'ENGINE_COOLDOWN' });
      try {
        return await generateHorde(run, prompt, index);
      } catch (error) {
        if (error && (error.status === 429 || error.status >= 500)) markEngineCool('horde', error.status);
        throw error;
      }
    }
    if (engine === 'perchance') {
      // Explicit Perch/Perchance only — in-app plugin, never open perchance.org, never free-race fallback.
      // If cooling after a recent failure, fail fast with tip (do not fall into FREE_RACE).
      return await generatePerchance(run, prompt, index);
    }
    if (engine !== 'auto') return generatePollinations(run, prompt, index, engine);

    // auto only: race free platforms; skip engines still in short cool-down after 429/5xx.
    // Perchance stays in the race unless recently failed; generation never window.open's perchance.org.
    var activeEngines = FREE_RACE_ENGINES.filter(function (eng) {
      if (eng === 'perchance' && isPerchanceCooling()) return false;
      return !isEngineCool(eng);
    });
    var cooled = FREE_RACE_ENGINES.filter(function (eng) {
      if (eng === 'perchance' && isPerchanceCooling()) return true;
      return isEngineCool(eng);
    });
    if (!activeEngines.length) {
      throw Object.assign(new Error('出图通道限流：本轮引擎都在短冷却中，请稍后再试（不是全部永久失败）。'), { status: 429, code: 'ALL_COOLDOWN' });
    }
    status(
      '自动抢出 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张',
      (cooled.length
        ? ('已跳过冷却中：' + cooled.map(engineLabel).join('、') + '。')
        : '') + activeEngines.map(engineLabel).join(' / ') + ' 同时开跑，先到先得。',
      true
    );
    var winner = null;
    var hordeJobId = null;

    function claim(result) {
      if (winner) throw new Error('lost-race');
      winner = result;
      return result;
    }

    var tasks = activeEngines.map(function (eng) {
      if (eng === 'horde') {
        return (async function () {
          var payload = Object.assign({}, run.payload, { prompt: prompt });
          if (payload.seed !== '' && payload.seed != null) payload.seed = String(Number(payload.seed) + (index || 0));
          try {
            var job = await api('', { method: 'POST', body: payload, timeoutMs: 90000, signal: run.controller.signal });
          } catch (error) {
            if (error && (error.status === 429 || error.status >= 500)) markEngineCool('horde', error.status);
            throw error;
          }
          hordeJobId = job.id;
          run.job = job;
          if (winner) {
            try { await api('/' + encodeURIComponent(job.id), { method: 'DELETE', timeoutMs: 15000 }); } catch (e) {}
            throw new Error('lost-race');
          }
          var done = await poll(run, job);
          if (winner) throw new Error('lost-race');
          return claim({ url: done.image.url, engine: 'horde', job: done });
        })();
      }
      if (eng === 'perchance') {
        return generatePerchance(run, prompt, index).then(claim);
      }
      return generatePollinations(run, prompt, index, eng).then(claim);
    });

    try {
      return await Promise.any(tasks);
    } catch (error) {
      throw new Error(raceFailMessage(error && error.errors));
    } finally {
      // Signal losers (esp. Perchance poll loop) to stop without marking cool-down.
      run._raceSettled = true;
      if (run.wake) try { run.wake(); } catch (e) {}
      if (winner && winner.engine !== 'horde' && hordeJobId) {
        try { await api('/' + encodeURIComponent(hordeJobId), { method: 'DELETE', timeoutMs: 15000 }); } catch (e) {}
        run.job = null;
      }
    }
  }

  function resolveEngine() {
    var raw = normalizeEngineName(value('出图引擎') || window.__sushiPreferredProvider || 'perchance');
    if (raw === 'turbo' || raw === 'horde' || raw === 'flux' || raw === 'flux-realism' || raw === 'sana') return raw;
    // perchance: keep as selectable in-app path (free race under the hood; never open perchance.org)
    if (raw === 'perchance') return 'perchance';
    // auto / unknown → full free race
    return 'auto';
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
      // Managed display under the image stays simple — never overwrite with generator-enriched prompt.
      if (typeof window.刷新画面说明 === 'function') {
        window.刷新画面说明();
      } else {
        if ($('说明标题')) {
          $('说明标题').textContent = (randomPair && randomPair.displayChinese) || value('中文译文') || '当前画面';
        }
        if ($('说明英文')) {
          $('说明英文').textContent = (randomPair && randomPair.displayEnglish) || value('英文描述') || '';
        }
      }
      while (run.completed < run.total) {
        ensureActive(run);
        if (restored) {
          var done = await poll(run, run.job);
          status('图片已生成，正在加载', '', true);
          await addImage(run, done.image, (done.provider || 'horde'));
        } else {
          var result = await generateOne(run, run.payload.prompt, run.completed);
          ensureActive(run);
          status('图片已生成，正在加载', '', true);
          await addImage(run, result, result.engine);
        }
        ensureActive(run);
        run.completed += 1;
        restored = false;
      }
      // Hide the bulky status card so images sit directly under 「角色画廊」.
      hideStatusPanel();
    } catch (error) {
      if (active !== run) return;
      var cleanupError = '';
      try { await stopJob(run); } catch (e) { cleanupError = ' 未收到取消确认，任务最迟在 10 分钟上限后结束。'; }
      var title = run.cancelled ? '已停止本轮生成' : (run.completed ? '已生成 ' + run.completed + ' 张，后续未完成' : '本次未完成');
      var detail = run.cancelled ? '已保留已完成的图片。' : String(error && error.message || error || '');
      if (!run.cancelled && (error && (error.status === 429 || error.code === 'ENGINE_COOLDOWN' || error.code === 'ALL_COOLDOWN' || /限流|冷却|429/.test(detail)))) {
        title = run.completed ? title : '出图通道限流';
        if (!/限流|冷却/.test(detail)) detail = '免费通道繁忙（限流），已跳过该引擎短冷却；请稍后重试或换通道。';
      } else if (!run.cancelled && /各平台均未成功|自动抢出失败/.test(detail)) {
        title = run.completed ? title : '各通道均未成功';
      }
      status(title, detail + cleanupError, false);
      if (!run.cancelled && window.记录失败原因) window.记录失败原因(error.message);
    } finally {
      if (active === run) { active = null; controls(false); }
    }
  }

  function newRun(description, total) {
    return { description: description, total: total, completed: 0, payload: {}, job: null, cancelled: false, controller: new AbortController() };
  }

  window.开始生成 = function () {
    if (active || $('生成按钮').disabled) return Promise.resolve();
    // Never open Perchance official site — keep selection, generate in-app.
    var providerBox = $('出图引擎');
    if (providerBox) { providerBox.disabled = false; providerBox.removeAttribute('disabled'); }

    var description = lastEdited === '英文描述' ? value('英文描述') : value('角色描述');
    if (!description) description = value('角色描述') || value('英文描述');
    if (!description) { status('请先填写画面描述', '也可以点击“随机生成图片”。', false); $('角色描述').focus(); return Promise.resolve(); }
    var run = newRun(description, [1, 3, 5, 7].includes(Number(value('生成数量'))) ? Number(value('生成数量')) : 1);
    run.backgroundOnly = !!($('只换背景') && $('只换背景').checked);
    if ($('纯背景出图') && $('纯背景出图').checked) {
      run.backgroundOnly = false;
      if (!/no people|no characters|empty scenic/i.test(description)) {
        description = 'empty scenic environment background only, no people, no characters, no humans, no faces, cinematic atmosphere, ' + description;
        run.description = description;
      }
    }
    var dimensions = value('图像比例').split('x');
    var negative = value('负面提示');
    var styleAware = hasExplicitArtStyle(description + ' ' + (value('英文描述') || '') + ' ' + (value('角色描述') || ''));
    if (!negative) {
      negative = styleAware
        ? 'lowres, blurry, bad anatomy, extra limbs, child, minor, watermark, text'
        : 'anime, manga, cartoon, illustration, cel shading, lowres, blurry, bad anatomy, extra limbs, child, minor, watermark, text';
    } else if (styleAware) {
      // User asked for anime/illustration — strip style bans from the default negative box.
      negative = negative
        .replace(/\b(anime|manga|cartoon|illustration|cel\s*shading|chibi)\b/gi, ' ')
        .replace(/卡通|动漫|插画|二次元|漫画|数字绘画|赛璐璐|手绘/g, ' ')
        .replace(/[，,]\s*[，,]/g, ',')
        .replace(/^[，,\s]+|[，,\s]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    } else if (!/anime|manga|cartoon|动漫|卡通/i.test(negative)) {
      negative += ', anime, manga, cartoon, illustration';
    }
    run.payload = {
      prompt: description, width: Number(dimensions[0]) || 512, height: Number(dimensions[1]) || 512,
      negativePrompt: negative, seed: value('随机种子'), cfgScale: Number(value('引导强度')) || 7,
      sourceImage: value('参考图地址'), strength: Number(value('图生图强度')) || 0.45
    };
    active = run; controls(true);
    $('图像输出').replaceChildren(); $('官方画廊').replaceChildren(); $('官方画廊').hidden = true;
    window.设平台提示(resolveEngine());
    run.promise = execute(run, false);
    return run.promise;
  };

  window.开始随机生成 = function () {
    if (active || $('随机按钮').disabled) return Promise.resolve();
    var providerBox = $('出图引擎');
    if (providerBox) { providerBox.disabled = false; providerBox.removeAttribute('disabled'); }
    var item = typeof window.本地随机一项 === 'function' ? window.本地随机一项() : null;
    if (!item && typeof window.本地随机一对 === 'function') {
      var pair = window.本地随机一对();
      item = {
        中文: pair[0],
        英文: pair[1],
        核心: pair.核心 || pair[0],
        详英: pair.详英 || pair[1]
      };
    }
    if (!item) return Promise.resolve();
    var simpleZh = item.中文 || '';
    var simpleEn = item.英文 || '';
    var core = item.核心 || simpleZh;
    var richEn = item.详英 || simpleEn;
    randomPair = {
      chinese: core,
      english: richEn,
      displayChinese: simpleZh,
      displayEnglish: simpleEn
    };
    $('角色描述').value = core;
    $('中文译文').value = simpleZh;
    $('英文描述').value = simpleEn;
    lastEdited = '角色描述';
    if (typeof window.刷新画面说明 === 'function') window.刷新画面说明();
    if ($('安全英文')) $('安全英文').value = richEn;
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

  window.当前引擎 = function () { return resolveEngine(); };
  window.photorealPrompt = photorealPrompt;
  window.hasExplicitArtStyle = hasExplicitArtStyle;
  window.设平台提示 = function (engine) {
    var tip = $('平台提示');
    if (!tip) return;
    engine = normalizeEngineName(engine);
    if (engine === 'turbo') tip.textContent = 'Turbo · Pollinations 极速免费通道';
    else if (engine === 'horde') tip.textContent = 'AI Horde · 免费共享算力，繁忙时需要排队';
    else if (engine === 'flux') tip.textContent = 'Flux · 通用高质量免费通道';
    else if (engine === 'flux-realism') tip.textContent = 'Flux写实 · 人像优先免费通道';
    else if (engine === 'sana') tip.textContent = 'Sana · 中文友好免费通道';
    else if (engine === 'perchance') tip.textContent = 'Perch / Perchance · 应用内生成（不跳转官网）';
    else tip.textContent = '自动抢出 · Turbo / Flux / Flux写实 / Sana / Horde / Perchance 全平台同时开跑，先到先得';
  };

  async function init() {
    ['角色描述', '英文描述', '中文译文'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        lastEdited = id;
        if (id === '中文译文') $('角色描述').value = value(id);
        randomPair = null;
      });
    });
    var engineSelect = $('出图引擎');
    if (engineSelect) {
      if (!engineSelect.querySelector('option[value="auto"]')) {
        var autoOpt = document.createElement('option');
        autoOpt.value = 'auto'; autoOpt.textContent = '自动抢出 · 全平台';
        engineSelect.insertBefore(autoOpt, engineSelect.firstChild);
      }
      ['turbo','horde','flux','flux-realism','sana','perchance'].forEach(function (id) {
        if (engineSelect.querySelector('option[value="' + id + '"]')) return;
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id === 'perchance' ? 'Perch / Perchance · 应用内生成' : engineLabel(id);
        engineSelect.appendChild(opt);
      });
      // Normalize flux-real alias option if patch injected it.
      var fluxReal = engineSelect.querySelector('option[value="flux-real"]');
      if (fluxReal) fluxReal.value = 'flux-realism';
      engineSelect.disabled = false;
      engineSelect.removeAttribute('disabled');
      if (!engineSelect.value) engineSelect.value = 'perchance';
      engineSelect.addEventListener('change', function () {
        if (engineSelect.value === 'flux-real') engineSelect.value = 'flux-realism';
        // Keep explicit perchance selection; generation stays in-app and never opens perchance.org.
        window.__sushiPreferredProvider = engineSelect.value;
        try { localStorage.setItem('角色生成器_默认平台', engineSelect.value); } catch (e) {}
        window.设平台提示(window.当前引擎());
      });
    }
    window.设平台提示(window.当前引擎());
    window.__sushiReady = true; window.__sushiLoadError = '';
    controls(true); $('取消生成按钮').hidden = true;
    status('正在连接生图服务', '如果服务器刚休眠，首次连接会自动等待并重试。', true);
    try {
      var results = await Promise.all([safeGet('/config', 2), safeGet('/current', 2)]);
      if (results[1].job) {
        var run = newRun('', 1);
        run.job = results[1].job;
        active = run; controls(true);
        run.promise = execute(run, true);
        return;
      }
      status('生图服务已就绪', '可以开始生成图片（自动抢出：全平台）。', false);
    } catch (error) {
      status('暂时无法准备生图', error.message + ' 可稍后直接再次点击生成。', false);
    }
    controls(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
