(function () {
  'use strict';

  var active = null;
  var lastEdited = '角色描述';
  var randomPair = null;
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

  function enableProviderPickers() {
    window.__sushiImageProviderLock = '';
    ['出图引擎', '管理默认平台', '图生图平台'].forEach(function (id) {
      var box = $(id);
      if (box) { box.disabled = false; box.removeAttribute('disabled'); box.title = '按所选通道生成，不自动切换'; }
    });
  }

  function recordImageProvider(name) {
    window.__sushiLastEngine = name;
  }

  // iOS Safari iframe: cookie alone can miss; same-origin localStorage JWT is reliable.
  function readAuthToken() {
    try {
      if (window.__sushiJwt) return String(window.__sushiJwt);
      return localStorage.getItem('sushi_jwt') || '';
    } catch (e) { return window.__sushiJwt ? String(window.__sushiJwt) : ''; }
  }
  function authHeaders(extra) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var tok = readAuthToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return headers;
  }
  try {
    window.addEventListener('message', function (ev) {
      try {
        if (!ev || !ev.data || ev.data.type !== 'sushi_auth') return;
        if (ev.origin && ev.origin !== location.origin) return;
        var tok = String(ev.data.token || '');
        if (!tok) return;
        window.__sushiJwt = tok;
        try { localStorage.setItem('sushi_jwt', tok); } catch (e) {}
      } catch (e2) {}
    });
  } catch (e3) {}

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
        method: method, credentials: 'include', cache: 'no-store',
        headers: authHeaders(),
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
        var timeoutError = new Error('正在唤醒服务，连接耗时较长，请稍后重试');
        timeoutError.code = 'CLIENT_TIMEOUT';
        timeoutError.wake = true;
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
          status('正在唤醒服务', 'Render 冷启动时首次连接较慢，正在自动重试，不会重复提交生图任务。', true);
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

  
  function categorizeClientFailure(error, statusCode) {
    var status = Number(statusCode) || Number(error && error.status) || 0;
    var msg = String((error && error.message) || error || '');
    var code = String((error && error.code) || '');
    if ((error && error.name === 'AbortError') || status === 504 || /timeout|超时|CLIENT_TIMEOUT|唤醒/i.test(msg + ' ' + code)) return '超时';
    if (status === 429 || /限流|冷却|rate.?limit/i.test(msg)) return '限流';
    if (/censored|审核|审查/i.test(msg)) return '审核拒绝';
    if (/空图|未返回图片|图片无效|图片过小|no image/i.test(msg)) return '返回空图';
    if (status === 0 || status === 502 || status === 503 || /Failed to fetch|NetworkError|Load failed|连接失败/i.test(msg + ' ' + code)) return '连接失败';
    return '其他';
  }

  function reportImageFailure(platform, error, startedAt) {
    var statusCode = Number(error && error.status) || 0;
    var errorType = categorizeClientFailure(error, statusCode);
    var durationMs = Math.max(0, Date.now() - (startedAt || Date.now()));
    var message = String((error && error.message) || error || '').slice(0, 240);
    try {
      if (window.记录失败原因) {
        window.记录失败原因(errorType + ' · ' + (platform || 'unknown') + ' · ' + durationMs + 'ms · HTTP ' + statusCode + ' · ' + message);
      }
    } catch (e0) {}
    try {
      fetch('/api/image-failure-stats', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(),
        body: JSON.stringify({ platform: platform || 'unknown', durationMs: durationMs, statusCode: statusCode, errorType: errorType, message: message })
      }).catch(function () {});
    } catch (e1) {}
    return errorType;
  }

  function workshopTicketId() {
    try {
      var q = new URLSearchParams(location.search || '');
      return q.get('k') || '';
    } catch (e) { return ''; }
  }

  function assembleLocalStructuredPrompt(core) {
    var ids = ['角色姓名','身份职业','年龄阶段','性别气质','脸部特征','发型发色','体型特征','服装配饰','表情情绪','动作姿势','场景环境','构图景别','镜头视角','光线氛围','色彩方案','艺术风格','补充细节'];
    var parts = [];
    for (var i = 0; i < ids.length; i += 1) {
      var v = value(ids[i]);
      if (v) parts.push(v);
    }
    if (parts.length) return parts.join(', ');
    return '';
  }

  async function structurePromptForGen(run) {
    var core = String(run.description || '').trim();
    if (!core) return '';
    var anime = engineFamily(run.engine) === 'anime' || hasExplicitArtStyle(core);
    status('正在整理结构化提示词', '正在整理字段后交给生图平台。', true);
    var model = '';
    try { model = value('AI通道') || 'glm'; } catch (e0) { model = 'glm'; }
    try {
      var response = await fetch('/api/workshop/structure-prompt', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: authHeaders(),
        body: JSON.stringify({ core: core, anime: !!anime, model: model, k: workshopTicketId(), img2img: !!(run.payload && run.payload.sourceImage), localEdit: !!run.localEdit }),
        signal: run.controller.signal
      });
      var data = await response.json().catch(function () { return {}; });
      if (response.ok && data && data.promptEn) {
        run.structureSource = data.source || 'chat';
        run.structureFields = data.fields || null;
        if ($('英文描述') && data.promptEn) $('英文描述').value = data.promptEn;
        // Keep visible 核心描述 as source of truth — never overwrite 角色描述 here.
        return String(data.promptEn).trim();
      }
    } catch (error) {
      ensureActive(run);
      if (run.cancelled || (error && error.name === 'AbortError')) throw error;
    }
    var local = assembleLocalStructuredPrompt(core);
    if (local && !/[\u4e00-\u9fff]/.test(local)) {
      run.structureSource = 'fields';
      return local;
    }
    return '';
  }

  function makeThumbnailDataUrl(sourceUrl, maxEdge, quality) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = function () {
          try {
            var edge = Math.max(64, Number(maxEdge) || 240);
            var scale = Math.min(1, edge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
            var w = Math.max(1, Math.round((img.naturalWidth || edge) * scale));
            var h = Math.max(1, Math.round((img.naturalHeight || edge) * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality == null ? 0.72 : quality));
          } catch (e) { resolve(''); }
        };
        img.onerror = function () { resolve(''); };
        img.src = sourceUrl;
      } catch (e2) { resolve(''); }
    });
  }

  var promptCache = Object.create(null);
  async function promptFor(run) {
    var source = run.description;
    if (randomPair && randomPair.chinese === source) return randomPair.english;
    if (!/[\u4e00-\u9fff]/.test(source)) return source;
    if (promptCache[source]) return promptCache[source];
    status('正在翻译为英文', '正在译成英文再提交。', true);
    var tries = 0;
    for (; tries < 2; tries += 1) {
      if (typeof window.调用开源翻译 !== 'function') break;
      try {
        var translated = await within(window.调用开源翻译(source, 'en'), 8000);
        ensureActive(run);
        if (translated && !/[\u4e00-\u9fff]/.test(translated)) {
          promptCache[source] = translated;
          if ($('英文描述')) $('英文描述').value = translated;
          return translated;
        }
      } catch (e) { ensureActive(run); }
    }
    run.translationNote = '翻译未完成，已使用本次原文；英文描述通常更稳定。';
    return source;
  }

  // Explicit art-style keywords: honor anime/manga/cartoon/二次元/插画 instead of forcing photoreal.
  var ART_STYLE_RE = /anime|manga|cartoon|chibi|二次元|动漫|卡通|漫画|插画|illustration|cel[\s-]?shad|pixar|disney|comic(?:\s|-)?style|手绘|赛璐璐|2d\s*art|视觉小说/i;
  function hasExplicitArtStyle(text) {
    // Negative phrases such as “非动漫” must not be mistaken for a requested art style.
    var cleaned = String(text || '').replace(/(?:非|不要|不需要|no|not)\s*(?:anime|manga|cartoon|chibi|二次元|动漫|卡通|漫画|插画|illustration|cel[\s-]?shad|pixar|disney|comic(?:\s|-)?style|手绘|赛璐璐|2d\s*art|视觉小说)/gi, ' ');
    return ART_STYLE_RE.test(cleaned);
  }

  function photorealPrompt(prompt) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      text = 'photorealistic RAW photo of a fictional adult, natural light, DSLR';
    }
    // Helper keeps style-keyword bypass for callers that honor user-named 动漫.
    // 写实通道 uses forcePhotorealPrompt instead and never takes this branch.
    if (hasExplicitArtStyle(text)) {
      if (!/fictional adult|18\+|no minors|虚构成年/i.test(text)) {
        text += ', fictional adult 18+ only, no minors';
      }
      return text.replace(/\s{2,}/g, ' ').trim();
    }
    return forcePhotorealPrompt(text);
  }

  function stripArtStyleWords(text) {
    return String(text || '')
      .replace(/\b(anime|manga|cartoon|chibi|illustration|cel[\s-]?shading|pixar|disney|comic(?:\s|-)?style|2d\s*art|visual novel)\b/gi, ' ')
      .replace(/二次元|动漫风格|动漫|卡通|漫画|插画|手绘|赛璐璐|视觉小说/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[，,]{2,}/g, ',')
      .trim();
  }

  // Bare "portrait photography" must NOT count as half-body crop — only clear crop intent.
  // Explicit 全身 / full body always wins over model/default half-body bias.
  function wantsFullBodyFraming(text) {
    return /full[\s-]?body|full[\s-]?figure|全身|从头到脚|head[\s-]?to[\s-]?toe|feet in (?:the )?frame|entire body in frame|standing full figure/i.test(String(text || ''));
  }

  var LOCAL_EDIT_KEEP_REST =
    'IMG2IMG local edit of the REFERENCE IMAGE only: Keep the same person identity, face, hairstyle, body proportions, clothing, accessories, background, and lighting as the reference image; do NOT invent a new person or background; the stated local change must stay clearly visible while preserving likeness';

  var LOCAL_EDIT_KEEP_REST_POSE =
    'IMG2IMG local edit of the REFERENCE IMAGE only: Keep the same person identity, face, hairstyle, clothing, and background as the reference; allow pose/gesture/limbs to change as stated; do not invent a new person or background';

  var POSE_GESTURE_RE =
    /抬起|举起|放下|伸手|举手|挥手|叉腰|转头|回头|侧头|低头|抬头|扭头|侧过脸|抬手|站姿|raise(?:s|d|ing)?\s+(?:(?:the|her|his|their)\s+)?(?:left\s+|right\s+)?(?:hand|arm)|lower(?:s|ed|ing)?\s+(?:(?:the|her|his|their)\s+)?(?:left\s+|right\s+)?(?:hand|arm)|turn(?:s|ed|ing)?\s+(?:(?:the)\s+)?head|look(?:s|ing)?\s+(?:left|right|away)|wave(?:s|d|ing)?\b|hands?\s+on\s+(?:hips|waist)|arms?\s+(?:crossed|raised|up|out)/i;

  function isPoseGestureEdit(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    return POSE_GESTURE_RE.test(t);
  }

  function localEditChangeDirective(core) {
    var t = String(core || '').replace(/\s+/g, ' ').trim();
    if (!t) return 'CRITICAL EDIT (must be clearly visible): apply the stated local change so it is obvious';
    if (/抬起左手|左手抬起|左手举起|raise(?:s|d|ing)?\s+(?:(?:the|her|his|their)\s+)?left\s+(?:hand|arm)/i.test(t)) {
      return 'CRITICAL EDIT (must be clearly visible): left hand raised high, left arm lifted upward, raised left hand clearly visible';
    }
    if (/抬起右手|右手抬起|右手举起|raise(?:s|d|ing)?\s+(?:(?:the|her|his|their)\s+)?right\s+(?:hand|arm)/i.test(t)) {
      return 'CRITICAL EDIT (must be clearly visible): right hand raised high, right arm lifted upward, raised right hand clearly visible';
    }
    if (/举手|抬起|举起|抬手|伸手|挥手|raise(?:s|d|ing)?\s+(?:(?:the|her|his|their)\s+)?(?:left\s+|right\s+)?(?:hand|arm)|arms?\s+(?:raised|up)/i.test(t)) {
      return 'CRITICAL EDIT (must be clearly visible): hand/arm raised as requested, pose change obvious and limbs clearly different from the reference';
    }
    if (/转头|回头|侧头|扭头|侧过脸|低头|抬头|turn(?:s|ed|ing)?\s+(?:(?:the)\s+)?head|look(?:s|ing)?\s+(?:left|right|away)/i.test(t)) {
      return 'CRITICAL EDIT (must be clearly visible): head turned/oriented as requested, new head direction clearly visible';
    }
    if (isPoseGestureEdit(t)) {
      return 'CRITICAL EDIT (must be clearly visible): apply the requested pose/gesture change strongly so limbs/posture clearly differ from the reference';
    }
    return 'CRITICAL EDIT (must be clearly visible): apply the stated local change so it is obvious';
  }

  function isLocalEditCore(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (/换背景|改背景|更换背景|只换背景|纯背景|change (?:the )?background|replace (?:the )?background|new scene|全新场景|重画整|整张重绘|redraw (?:the )?(?:whole |entire )?scene|from scratch/i.test(t)) {
      return false;
    }
    var keepCue = /图中|图里|图上|参考图|原图中|保持|只|仅仅|仅将|仅把|不要改|别改|其余不变|其他不变|in the (?:image|picture|photo)|from the reference|keep (?:the )?(?:rest|same|identity|everything)|only (?:change|edit|raise|turn|smile)/i.test(t);
    var strongAction = /抬起|举起|放下|伸手|举手|挥手|叉腰|转头|回头|侧头|低头|抬头|扭头|侧过脸|微笑|浅笑|闭眼|睁眼|眨眼|张嘴|闭嘴|raise(?:s|d)? (?:(?:the |her |his |their )?(?:left |right )?)?(?:hand|arm)|turn(?:s|ed|ing)? (?:(?:the )?head)|smil(?:e|ing)\b|frown|wink|look(?:s|ing)? (?:left|right|away)|change(?:s|d)? (?:(?:the |her |his )?hair colou?r)|slightly (?:change|adjust)/i.test(t);
    var mildAction = /换发型|染发|发色|头发颜色|换一件|换衣服|改发型|改发色|hair colou?r|clothing tweak|\bpose\b/i.test(t);
    var compact = t.length <= 96;
    if (strongAction && (compact || keepCue)) return true;
    if (keepCue && mildAction && (compact || t.length <= 180)) return true;
    return false;
  }

  function applyLocalEditOutbound(promptEn, core, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var hasRef = !!(opts.img2img || opts.hasSourceImage);
    if (!hasRef) return String(promptEn || '');
    if (!opts.force && !isLocalEditCore(core || promptEn)) return String(promptEn || '');
    var t = String(promptEn || '').replace(/\s+/g, ' ').trim();
    var pose = isPoseGestureEdit(core || t);
    var change = localEditChangeDirective(core || t);
    var keep = pose ? LOCAL_EDIT_KEEP_REST_POSE : LOCAL_EDIT_KEEP_REST;
    if (pose) {
      t = t
        .replace(/IMG2IMG local edit of the REFERENCE IMAGE only:\s*/gi, '')
        .replace(/Keep the same person identity[^.]*\./gi, '')
        .replace(/do NOT invent a new person or background[^.]*\./gi, '')
        .replace(/the stated local change must stay clearly visible[^.]*\./gi, '')
        .replace(/apply ONLY the stated local change[^.]*\./gi, '')
        .replace(/do not (?:redraw|recompose)[^.]*\./gi, '')
        .replace(/same camera angle and crop as the reference image/gi, '')
        .replace(/body proportions, clothing, accessories, background, and lighting/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/[，,]{2,}/g, ',')
        .replace(/^[,\s]+|[,\s]+$/g, '')
        .trim();
    } else if (/CRITICAL EDIT \(must be clearly visible\)|keep the (?:EXACT )?same person identity|the stated local change must stay clearly visible|apply ONLY the stated local change|do not (?:redraw|recompose)/i.test(t)) {
      return t;
    }
    if (/CRITICAL EDIT \(must be clearly visible\)/i.test(t)) {
      if (pose && !/allow pose\/gesture\/limbs to change/i.test(t)) {
        return (t + ', ' + keep).replace(/\s{2,}/g, ' ').trim();
      }
      return t;
    }
    return (change + (t ? ', ' + t : '') + ', ' + keep).replace(/\s{2,}/g, ' ').trim();
  }

  function preferLocalEditStrength(current, core) {
    var n = Number(current);
    var base = isFinite(n) && n > 0 ? n : 0.6;
    var coreText = String(core || '').replace(/\s+/g, ' ').trim();
    if (isPoseGestureEdit(coreText)) {
      // Pose/gesture: 0.45–0.55 still often left limbs frozen; use 0.55–0.65.
      var poseFloor = 0.55;
      var poseCap = 0.65;
      if (base > poseCap) return poseCap;
      if (base < poseFloor) return poseFloor;
      return base;
    }
    // Tiny color / expression tweaks stay lower.
    var shortEdit = coreText.length > 0 && coreText.length <= 48;
    var cap = shortEdit ? 0.22 : 0.28;
    var floor = 0.2;
    if (base > cap) return cap;
    if (base < floor) return floor;
    return base;
  }

  function resolveLocalEditSeed(fallback, core) {
    // Pose/gesture: identical seed freezes composition/limbs — omit lock so Horde can vary.
    if (isPoseGestureEdit(core)) return '';
    var locked = Number(($('参考图种子') && $('参考图种子').value) || '');
    if (isFinite(locked) && locked > 0) return String(Math.floor(locked));
    var box = $('随机种子');
    var fromBox = Number(box && box.value);
    if (isFinite(fromBox) && fromBox >= 0 && String(box.value || '').trim() !== '' && String(box.value) !== '-1') {
      return String(Math.floor(fromBox));
    }
    var n = Number(fallback);
    if (isFinite(n) && n >= 0) return String(Math.floor(n));
    return String(Math.floor(Math.random() * 2147483646));
  }

  function hasExplicitCropFraming(text) {
    var t = String(text || '');
    if (wantsFullBodyFraming(t)) return false;
    return /半身|七分身|胸像|头像|特写|近景|肖像|close[\s-]?up|bust\b|headshot|waist[\s-]?up|upper[\s-]?body|half[\s-]?body|from (the )?waist|face only|面部特写|脸部特写|肩部以上|(?:close[\s-]?up|head|bust|waist[\s-]?up|upper[\s-]?body|half[\s-]?body)\s+portrait|portrait\s+(?:shot|close|crop|headshot|of the face)/i.test(t);
  }

  function hasExplicitCameraAngle(text) {
    return /侧脸|侧面|侧身|背面|背影|后视|微仰|俯拍|仰拍|three[\s-]?quarter|profile|from behind|back view|side view|rear view|over[\s-]?shoulder|low angle|high angle/i.test(String(text || ''));
  }

  // East Asian ethnicity cues from core/desc — reinforce outbound English; never invent Western beauty defaults.
  function hasEastAsianCue(text) {
    return /东亚|东亚洲|亞洲裔|亚洲裔|亚洲人|亞洲人|中国人|中國人|华人|華人|汉族|漢族|韩国人|韓國人|韩系|韓系|日本人|日系|东方人|東方人|中国女性|中国男人|韩国女性|日本女性|east[\s-]?asian|han chinese|\bchinese\b|\bkorean\b|\bjapanese\b|asian (?:woman|man|girl|boy|female|male|person|features|face|facial|look)/i.test(String(text || ''));
  }

  function stripWesternBeautyDefaults(text) {
    return String(text || '')
      .replace(/\b(blonde|blond|caucasian|european|western european|blue[\s-]?eyes|light[\s-]?brown hair|auburn hair|fair[\s-]?skinned european|nordic features)\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/[，,]{2,}/g, ',')
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
  }

  function applyEastAsianEthnicity(text, coreHint) {
    var src = String(coreHint || '') + ' ' + String(text || '');
    if (!hasEastAsianCue(src)) return String(text || '');
    var t = stripWesternBeautyDefaults(text);
    var bits = [];
    if (!/east[\s-]?asian/i.test(t)) bits.push('East Asian');
    if (!/east[\s-]?asian facial features|asian facial features|east[\s-]?asian appearance/i.test(t)) {
      bits.push('East Asian facial features', 'distinctly East Asian appearance');
    }
    if (!bits.length) return t.replace(/\s{2,}/g, ' ').trim();
    var inject = bits.join(', ');
    var m = t.match(/^(photorealistic RAW photo,\s*shot on DSLR,\s*(?:35|50|85)mm,\s*natural skin pores(?:,\s*realistic fabric texture)?)/i);
    if (m) {
      t = m[1] + ', ' + inject + t.slice(m[1].length);
    } else if (/^photorealistic photograph of /i.test(t)) {
      t = t.replace(/^(photorealistic photograph of )/i, '$1' + inject + ', ');
    } else {
      t = inject + ', ' + t;
    }
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  function applyRealisticFrontFullBody(text) {
    var t = String(text || '');
    var userFull = wantsFullBodyFraming(t);
    if (hasExplicitCropFraming(t) && !userFull) return t;
    var bits = [];
    if (!userFull) {
      bits.push(
        'full body head-to-toe visible',
        'feet in frame',
        'head and feet both visible',
        'standing full figure',
        'entire body in frame',
        'not cropped at waist or chest'
      );
    } else {
      // User asked 全身 / full body: stronger, earlier, repeated constraints win over model defaults.
      bits.push(
        'full body head-to-toe visible',
        'feet in frame',
        'head and feet both visible',
        'standing full figure',
        'entire body in frame',
        'wide FOV full-body shot',
        'wide enough field of view',
        'complete figure from crown to shoes',
        'uncropped standing full figure',
        'space above head and below feet',
        'subject fills vertical frame from head to toe',
        'not cropped at waist or chest',
        'not a close-up',
        'not a half-body portrait',
        'no waist crop'
      );
    }
    if (!hasExplicitCameraAngle(t) && !/front[\s-]?view|front[\s-]?facing|facing (the )?camera|looking at (the )?camera|eye[\s-]?level|正面|面向镜头|平视/i.test(t)) {
      bits.push('front view facing camera', 'eye-level', 'looking at camera');
    }
    if (!bits.length) return t;
    var inject = bits.join(', ');
    // Prefer wider FOV for full-body; rewrite portrait-biased 85/50mm lead if present.
    if (userFull) {
      t = t.replace(/\bshot on DSLR,\s*(?:85|50|35)mm\b/gi, 'shot on DSLR, 28mm');
    } else {
      t = t.replace(/\bshot on DSLR,\s*85mm\b/gi, 'shot on DSLR, 35mm');
    }
    // Higher priority: place framing right after the photoreal camera lead, before scene text.
    var m = t.match(/^(photorealistic RAW photo,\s*shot on DSLR,\s*(?:28|35|50|85)mm,\s*natural skin pores(?:,\s*realistic fabric texture)?)/i);
    if (m) {
      t = m[1] + ', ' + inject + t.slice(m[1].length);
    } else {
      t = inject + ', ' + t;
    }
    // Repeat a short full-body anchor near the end when user explicitly asked, so truncation still keeps framing.
    if (userFull && !/, full body head-to-toe visible, feet in frame, head and feet both visible\s*$/i.test(t)) {
      t += ', full body head-to-toe visible, feet in frame, head and feet both visible';
    }
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  /** When user asks 全身 and UI size is square, nudge outbound to portrait 2:3 (safe sizes only). Does not rewrite core text. */
  function preferPortraitAspectForFullBody(width, height, coreText) {
    var w = Number(width) || 512;
    var h = Number(height) || 512;
    if (!(w > 0 && h > 0) || w !== h) return { width: w, height: h, nudged: false };
    if (!wantsFullBodyFraming(coreText)) return { width: w, height: h, nudged: false };
    var map = {
      512: { width: 512, height: 768 },
      768: { width: 768, height: 1024 },
      1024: { width: 768, height: 1024 }
    };
    var next = map[w] || { width: 512, height: 768 };
    return { width: next.width, height: next.height, nudged: true };
  }

  function forcePhotorealPrompt(prompt, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var coreHint = opts.core != null ? String(opts.core) : '';
    var text = stripArtStyleWords(String(prompt || '').replace(/\s+/g, ' ').trim());
    if (!text) text = 'a fictional adult, natural light, DSLR';
    var bare = /nude|naked|nudity|unclothed|topless|bottomless|无衣|裸体|裸身|全裸|裸露|不穿|未穿衣/i.test(text);
    // Wider FOV favors full-body over classic 85mm portrait crop; 28mm when user asked 全身.
    var fullCue = wantsFullBodyFraming(coreHint) || wantsFullBodyFraming(text);
    var lensMm = fullCue ? '28mm' : '35mm';
    var lead = bare
      ? 'photorealistic RAW photo, shot on DSLR, ' + lensMm + ', natural skin pores'
      : 'photorealistic RAW photo, shot on DSLR, ' + lensMm + ', natural skin pores, realistic fabric texture';
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
    // Merge core cue text so 全身 / 东亚 survive structure-prompt rewrite.
    // Local img2img edits must keep original composition — skip full-body redraw injection.
    if (!opts.localEdit) {
      var framingSource = (coreHint ? coreHint + ', ' : '') + text;
      if (wantsFullBodyFraming(coreHint) && !wantsFullBodyFraming(text)) {
        text = 'full body head-to-toe visible, feet in frame, ' + text;
      }
      text = applyRealisticFrontFullBody(wantsFullBodyFraming(framingSource) && !wantsFullBodyFraming(text) ? ('full body, ' + text) : text);
    }
    text = applyEastAsianEthnicity(text, coreHint || text);
    text = stripInjectedFemaleDefaults(text, coreHint || text);
    text = applyCoreFidelityLead(text);
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  function hasSmartModifier() {
    try {
      return !!(typeof window.读取智能修饰后缀 === 'function' && String(window.读取智能修饰后缀() || '').trim());
    } catch (e) { return false; }
  }

  var CORE_FIDELITY_LEAD =
    'Faithful to core description: depict only what the core states; include every explicitly described element (clothing, props, pose, scene, actions, counts) and omit none; prefer completeness of core facts over filler style words; do not invent clothing, props, pose, identity, gender, or setting not in the core; when gender is unspecified stay gender-neutral; lead with core facts';

  function applyCoreFidelityLead(prompt) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) return text;
    if (/faithful to core description/i.test(text)) return text;
    return (CORE_FIDELITY_LEAD + ', ' + text).replace(/\s{2,}/g, ' ').trim();
  }

  /** Smart-mod layer must not contradict core clothing/pose/identity/scene. */
  function sanitizeModifierAgainstCore(suffix, core) {
    var mod = String(suffix || '');
    var c = String(core || '');
    if (!mod) return mod;
    // Pose / camera contradictions
    if (/侧脸|侧面|侧身|背面|背影|后视|profile|from behind|back view|side view|rear view|three[\s-]?quarter/i.test(c)) {
      mod = mod
        .replace(/,?\s*full-body front view eye-level facing camera/gi, '')
        .replace(/,?\s*full-body front view(?: eye-level)?/gi, '')
        .replace(/,?\s*full-body facing camera(?: head to toe)?/gi, '')
        .replace(/,?\s*front view(?: facing camera)?/gi, '')
        .replace(/,?\s*facing camera/gi, '')
        .replace(/,?\s*eye-level facing camera/gi, '');
    }
    if (/半身|七分身|胸像|头像|特写|近景|close[\s-]?up|bust\b|headshot|waist[\s-]?up|upper[\s-]?body|half[\s-]?body/i.test(c)) {
      mod = mod
        .replace(/,?\s*full-body(?: framing)?(?: head to toe)?(?: feet in frame)?/gi, '')
        .replace(/,?\s*full figure visible head to toe/gi, '')
        .replace(/,?\s*complete figure from crown to shoes/gi, '');
    }
    if (/坐着|坐下|坐姿|躺|卧|蹲|kneel|sitting|seated|lying|reclining|squatting/i.test(c)) {
      mod = mod.replace(/,?\s*standing(?: full figure| art)?/gi, '').replace(/,?\s*full-character standing-art feel/gi, '');
    }
    // Outdoor/indoor scene contradiction
    if (/室内|屋内|房间|卧室|书房|图书馆|indoors?|indoor|library|bedroom|studio/i.test(c) && !/室外|户外|outdoors?/i.test(c)) {
      mod = mod.replace(/,?\s*outdoor natural-light photoreal photography[^,]*/gi, ', natural-light photoreal photography');
    }
    // Gender: never let smart-mod inject woman/female when core lacks it
    if (!hasFemaleIntent(c)) {
      mod = stripInjectedFemaleDefaults(mod, c);
    }
    mod = mod.replace(/\s{2,}/g, ' ').replace(/[，,]{2,}/g, ',').trim();
    if (!mod) return '';
    if (mod.charAt(0) !== ',') mod = ', ' + mod.replace(/^[,\s]+/, '');
    return mod;
  }

  function ensureNoTextOnImage(prompt) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) return text;
    if (!/no text in image|no watermark|no pinyin|no romanization|no letters or characters on image/i.test(text)) {
      text += ', no text in image, no watermark, no pinyin, no romanization, no letters or characters on image';
    }
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  /** 未点智能修饰：出图英文=核心翻译为主，仅保留产品必需的成人/东亚/全身锁，不堆写实修饰词库 */
  function minimalOutboundPrompt(prompt, options) {
    var opts = options && typeof options === 'object' ? options : {};
    var coreHint = opts.core != null ? String(opts.core) : '';
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) text = String(coreHint || '').replace(/\s+/g, ' ').trim() || 'a fictional adult';
    // Strip leftover photoreal enrich packs if somehow present when smart-mod is off
    text = text
      .replace(/,?\s*photorealistic RAW photo(?:,\s*shot on DSLR,?\s*(?:28|35|50|85)mm)?(?:,\s*natural skin pores)?(?:,\s*realistic fabric texture)?/gi, '')
      .replace(/,?\s*cinematic still/gi, '')
      .replace(/,?\s*shallow depth of field/gi, '')
      .replace(/,?\s*natural skin texture, clear material detail, sharp focus, real human/gi, '')
      .replace(/,?\s*not anime, not manga, not cartoon, not illustration, not 2d art, not cel shading/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[,,\s]+|[,,\s]+$/g, '')
      .trim() || text;
    if (!opts.localEdit) {
      var framingSource = (coreHint ? coreHint + ', ' : '') + text;
      if (wantsFullBodyFraming(coreHint) && !wantsFullBodyFraming(text)) {
        text = 'full body head-to-toe visible, feet in frame, ' + text;
      }
      // 产品默认全身正面锁（与写实通道一致）；有半身/特写意图时 applyRealisticFrontFullBody 会尊重
      text = applyRealisticFrontFullBody(wantsFullBodyFraming(framingSource) && !wantsFullBodyFraming(text) ? ('full body, ' + text) : text);
    }
    text = applyEastAsianEthnicity(text, coreHint || text);
    text = stripInjectedFemaleDefaults(text, coreHint || text);
    if (!/fictional adult|18\+|no minors/i.test(text)) {
      text += ', fictional adult 18+ only, no minors';
    }
    text = applyCoreFidelityLead(text);
    return ensureNoTextOnImage(text);
  }

    function animePrompt(prompt) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!text) text = 'anime illustration of a fictional adult, clean lineart, cel shading';
    if (hasExplicitArtStyle(text)) {
      if (!/fictional adult|18\+|no minors|虚构成年/i.test(text)) {
        text += ', fictional adult 18+ only, no minors';
      }
      return text.replace(/\s{2,}/g, ' ').trim();
    }
    if (!/anime|manga|二次元|动漫|插画|illustration/i.test(text)) {
      text = 'anime illustration, clean lineart, cel shading, vivid colors, detailed character design, ' + text;
    }
    if (!/fictional adult|18\+|no minors|虚构成年/i.test(text)) {
      text += ', fictional adult 18+ only, no minors';
    }
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  var ADULT_DIR_BASE =
    'adult mode enabled; NSFW allowed when requested in the core description; follow the core description literally and completely including every described clothing, prop, pose, scene, action, and count and clothing as written or implied; omit none of the core facts; do not invent clothing, props, pose, identity, gender defaults, or setting not in the core; do not invent undressing or remove clothes unless the core explicitly asks; fictional consenting adults 18+ only; no minors';
  var ADULT_DIR_NUDE =
    'explicit adult nudity as described is permitted; if nude or undressed do not add clothes, fabric coverage, or modest outfits; keep requested nudity and sexual details visible';
  var NUDE_INTENT_RE = /nude|naked|nudity|unclothed|topless|bottomless|无衣|裸体|裸身|全裸|裸露|不穿|未穿衣|脱光|赤裸/i;

  function hasNudeIntent(text) {
    return NUDE_INTENT_RE.test(String(text || ''));
  }

  // Female / woman cues from core — never invent woman/female defaults when absent.
  var FEMALE_INTENT_RE = /女人|女性|女的|女主|女孩|少女|美女|女郎|姑娘|女士|小姐|女王|公主|妻子|女友|女战士|女角色|\bwoman\b|\bwomen\b|\bfemale\b|\bgirl\b|\blady\b|\bladies\b|\bshe\b|\bher\b|\bhers\b|\b1girl\b|beautiful (?:young )?(?:woman|girl)/i;

  function hasFemaleIntent(text) {
    return FEMALE_INTENT_RE.test(String(text || ''));
  }

  /** Strip injected woman/female/girl tokens when core did not state female gender. */
  function stripInjectedFemaleDefaults(text, core) {
    if (hasFemaleIntent(core)) return String(text || '');
    var t = String(text || '');
    if (!t || !/\b(woman|women|female|girl|lady|ladies|1girl|she|her|hers)\b|beautiful (?:young )?(?:woman|girl)/i.test(t)) return t;
    t = t
      .replace(/\bbeautiful (?:young )?(?:woman|girl|lady)\b/gi, 'adult')
      .replace(/\bfictional adult woman\b/gi, 'fictional adult')
      .replace(/\badult woman\b/gi, 'adult')
      .replace(/\ba woman\b/gi, 'a person')
      .replace(/\bthe woman\b/gi, 'the person')
      .replace(/\bwomen\b/gi, 'people')
      .replace(/\bwoman\b/gi, 'person')
      .replace(/\bfemale\b/gi, 'person')
      .replace(/\bgirl\b/gi, 'person')
      .replace(/\bladies\b/gi, 'people')
      .replace(/\blady\b/gi, 'person')
      .replace(/\b1girl\b/gi, '1person')
      .replace(/\bshe\b/gi, 'they')
      .replace(/\bher\b/gi, 'their')
      .replace(/\bhers\b/gi, 'theirs')
      .replace(/\s{2,}/g, ' ')
      .replace(/[，,]{2,}/g, ',')
      .replace(/^[\s,]+|[\s,]+$/g, '')
      .trim();
    return t;
  }

  function adultDirectiveText(options) {
    if (typeof window.成人主题已开启 !== 'undefined' && !window.成人主题已开启) return '';
    var opts = options && typeof options === 'object' ? options : {};
    var el = $('成人功能状态');
    var text = el && el.value ? String(el.value).trim() : '';
    // Legacy #73 wording preferred/forced nudity — normalize to clothing-faithful base.
    if (!text || /preferred when described|NSFW fully allowed/i.test(text)) {
      text = ADULT_DIR_BASE;
      if (el) el.value = ADULT_DIR_BASE;
    }
    var src = String(opts.core || '') + ' ' + String(opts.prompt || '');
    if (hasNudeIntent(src)) {
      if (!/do not add clothes/i.test(text)) text = text.replace(/[;.\s]+$/, '') + '; ' + ADULT_DIR_NUDE;
    } else {
      text = text
        .replace(/;?\s*explicit nudity and adult sexual content are permitted and preferred when described/gi, '')
        .replace(/;?\s*explicit adult nudity as described is permitted/gi, '')
        .replace(/;?\s*if nude or undressed do not add clothes, fabric coverage, or modest outfits/gi, '')
        .replace(/;?\s*keep requested nudity and sexual details visible/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/[;,]{2,}/g, ';')
        .replace(/^[;\s]+|[;\s]+$/g, '')
        .trim();
      if (!text) text = ADULT_DIR_BASE;
    }
    return text;
  }

  function withAdultDirective(prompt, options) {
    var text = String(prompt || '').replace(/\s+/g, ' ').trim();
    var opts = options && typeof options === 'object' ? options : {};
    var dir = adultDirectiveText({ core: opts.core, prompt: text });
    if (!dir) return text;
    if (text && text.toLowerCase().indexOf('adult mode enabled') >= 0) return text;
    var nudeOn = hasNudeIntent(text) || hasNudeIntent(opts.core);
    if (nudeOn) {
      text = text
        .replace(/,?\s*realistic fabric texture/gi, '')
        .replace(/,?\s*clear clothing and skin texture/gi, ', natural skin texture')
        .replace(/,?\s*readable fabric and environment materials/gi, ', natural skin and environment materials')
        .replace(/,?\s*clear skin and clothing materials/gi, ', natural skin texture')
        .replace(/,?\s*visible knitwear texture/gi, '')
        .replace(/,?\s*fabric weave/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[,\s]+|[,\s]+$/g, '')
        .trim();
    }
    // Prepend adult directive so NSFW scale is not diluted by trailing photoreal material words.
    return (dir ? dir + ', ' : '') + text;
  }

  function hideStatusPanel() {
    var box = $('状态提示');
    if (!box) return;
    box.style.display = 'none';
    box.setAttribute('aria-busy', 'false');
    box.replaceChildren();
  }

  function progress(run, job) {
    var detail = '有结果立即显示。';
    if (job.waitTimeSeconds > 0 && job.waitTimeSeconds < 45) {
      detail = '大约 ' + Math.ceil(job.waitTimeSeconds) + ' 秒。';
    }
    if (run.translationNote) detail += ' ' + run.translationNote;
    status('正在出图 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', detail, true);
  }

  async function poll(run, job, providerSignal) {
    var errors = 0;
    var first = true;
    while (!['done', 'failed', 'cancelled'].includes(job.state)) {
      ensureActive(run);
      if (Date.now() > job.expiresAt + 35000) throw new Error('任务等待超时，请稍后重试');
      if (!first) {
        progress(run, job);
        await pause(run, 800);
      } else {
        progress(run, job);
      }
      first = false;
      ensureActive(run);
      try {
        job = await api('/' + encodeURIComponent(job.id), { signal: providerSignal || run.controller.signal });
        run.job = job;
        errors = 0;
      } catch (error) {
        ensureActive(run);
        if (error.status && error.status < 500 && error.status !== 429) throw error;
        errors += 1;
        if (errors >= 4) throw error;
        status('连接暂时中断，正在重新查询', '不会重复提交生图任务。', true);
        await pause(run, Math.min(2000 + errors * 1000, 5000));
      }
    }
    ensureActive(run);
    if (job.state !== 'done') throw new Error(job.error || '任务未完成，请重试');
    return job;
  }

  function galleryUrl(node) {
    if (!node) return '';
    var card = node.closest ? node.closest('.生图卡片') : null;
    var img = node.tagName === 'IMG' ? node : (card && card.querySelector('img'));
    return (card && card.getAttribute('data-full-url'))
      || (img && img.getAttribute('data-full-url'))
      || (img && (img.currentSrc || img.src))
      || '';
  }

  function ensurePreviewLayer() {
    var layer = document.getElementById('图片预览层');
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = '图片预览层';
    layer.className = '图片预览层';
    layer.setAttribute('hidden', '');
    layer.innerHTML = '<button type="button" class="图片预览关闭" aria-label="关闭预览" title="关闭">×</button>'
      + '<figure class="图片预览框">'
      + '<img alt="预览大图" referrerpolicy="no-referrer">'
      + '<figcaption class="图片预览状态"></figcaption>'
      + '<p class="图片预览提示">点击图片再放大 · 右上角关闭</p>'
      + '<button type="button" class="次按钮 图片预览重试" hidden>重新加载图片</button>'
      + '</figure>';
    document.body.appendChild(layer);
    layer.addEventListener('click', function (e) {
      if (e.target === layer || (e.target.classList && e.target.classList.contains('图片预览关闭'))) {
        closeImagePreview();
      }
    });
    var previewImg = layer.querySelector('img');
    previewImg.addEventListener('click', function (e) {
      e.stopPropagation();
      if (previewImg.hidden) return;
      // Two-step: first open is fit-to-screen; click again toggles further zoom / pan.
      layer.classList.toggle('放大');
      var tip = layer.querySelector('.图片预览提示');
      if (tip) tip.textContent = layer.classList.contains('放大') ? '点击缩小 · 右上角关闭' : '点击图片再放大 · 右上角关闭';
    });
    var retry = layer.querySelector('.图片预览重试');
    retry.addEventListener('click', function (e) {
      e.stopPropagation();
      var url = layer.getAttribute('data-full-url');
      var id = layer.getAttribute('data-thumb-id');
      var thumb = id ? document.getElementById(id) : null;
      if (url) loadPreviewImage(url, thumb);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeImagePreview();
    });
    return layer;
  }

  function closeImagePreview() {
    var layer = document.getElementById('图片预览层');
    if (!layer) return;
    layer.setAttribute('hidden', '');
    layer.classList.remove('开');
    layer.classList.remove('放大');
    var tip = layer.querySelector('.图片预览提示');
    if (tip) tip.textContent = '点击图片再放大 · 右上角关闭';
  }

  function markCardFailed(card, url, thumb) {
    if (!card || card.querySelector('.生图重试')) return;
    var note = document.createElement('figcaption');
    note.className = '生图失败';
    note.textContent = '图片已生成，但下载失败。';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = '次按钮 生图重试';
    retry.textContent = '重新加载图片';
    retry.addEventListener('click', function (e) {
      e.stopPropagation();
      openImagePreview(url, thumb);
    });
    card.append(note, retry);
  }

  function loadPreviewImage(url, thumb) {
    var layer = ensurePreviewLayer();
    var img = layer.querySelector('img');
    var note = layer.querySelector('.图片预览状态');
    var retry = layer.querySelector('.图片预览重试');
    note.textContent = '正在加载大图…';
    retry.hidden = true;
    img.hidden = true;
    img.onload = function () {
      img.onload = null;
      img.onerror = null;
      if (!img.naturalWidth) {
        img.dispatchEvent(new Event('error'));
        return;
      }
      img.hidden = false;
      note.textContent = '';
      if (thumb) {
        thumb.hidden = false;
        if ((thumb.getAttribute('src') || '') !== url) thumb.src = url;
        var card = thumb.closest && thumb.closest('.生图卡片');
        if (card) {
          card.classList.add('已加载');
          var hint = card.querySelector('.点击查看');
          if (hint) hint.hidden = true;
          var fail = card.querySelector('.生图失败');
          var failBtn = card.querySelector('.生图重试');
          if (fail) fail.remove();
          if (failBtn) failBtn.remove();
        }
      }
    };
    img.onerror = function () {
      img.onload = null;
      img.onerror = null;
      img.hidden = true;
      note.textContent = '图片已生成，但下载失败。';
      retry.hidden = false;
      if (thumb) {
        var card = thumb.closest && thumb.closest('.生图卡片');
        if (card) markCardFailed(card, url, thumb);
      }
    };
    img.removeAttribute('src');
    img.src = url;
  }

  function openImagePreview(url, thumb) {
    if (!url) return;
    var layer = ensurePreviewLayer();
    layer.removeAttribute('hidden');
    layer.classList.add('开');
    layer.classList.remove('放大');
    var tip = layer.querySelector('.图片预览提示');
    if (tip) tip.textContent = '点击图片再放大 · 右上角关闭';
    layer.setAttribute('data-full-url', url);
    if (thumb) {
      if (!thumb.id) thumb.id = '生图预览_' + String(Date.now()) + '_' + Math.floor(Math.random() * 10000);
      layer.setAttribute('data-thumb-id', thumb.id);
    } else {
      layer.removeAttribute('data-thumb-id');
    }
    loadPreviewImage(url, thumb);
  }

  function bindGalleryPreview() {
    function bind(area) {
      if (!area || area.getAttribute('data-preview') === '1') return;
      area.setAttribute('data-preview', '1');
      area.addEventListener('click', function (event) {
        if (event.target.closest && event.target.closest('button')) return;
        var card = event.target.closest ? event.target.closest('.生图卡片') : null;
        var img = event.target.closest ? event.target.closest('img') : null;
        var url = galleryUrl(card || img);
        if (!url) return;
        event.preventDefault();
        openImagePreview(url, (card && card.querySelector('img')) || img);
      });
    }
    bind($('图像输出'));
    bind($('官方画廊'));
  }

  function addImage(run, result, engine) {
    var url = result && result.url;
    if (!url) return;
    bindGalleryPreview();
    var card = document.createElement('figure');
    card.className = '生图卡片 加载中';
    card.setAttribute('data-full-url', url);
    card.setAttribute('data-engine', engine || 'horde');
    var progressNote = document.createElement('figcaption');
    progressNote.className = '生图进度';
    progressNote.textContent = '正在加载预览…';
    var img = document.createElement('img');
    img.alt = run.description || '生成的图片';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.setAttribute('data-engine', engine || 'horde');
    img.setAttribute('data-full-url', url);
    try {
      var usedSeed = run && run.payload && run.payload.seed;
      if (usedSeed !== '' && usedSeed != null && String(usedSeed) !== '-1') {
        card.setAttribute('data-seed', String(usedSeed));
        img.setAttribute('data-seed', String(usedSeed));
      }
    } catch (eSeed) {}
    card.append(progressNote, img);
    $('图像输出').appendChild(card);
    recordImageProvider(engine || 'horde');

    // Show something immediately (progress + start decode); hi-res stays in data-full-url for click.
    img.onload = function () {
      img.onload = null;
      img.onerror = null;
      card.classList.remove('加载中');
      card.classList.add('已加载');
      progressNote.textContent = '点击查看原图';
      progressNote.className = '点击查看';
    };
    img.onerror = function () {
      img.onload = null;
      img.onerror = null;
      progressNote.remove();
      markCardFailed(card, url, img);
    };
    img.src = url;

    // Cache a thumbnail in the background for history/gallery; do not block first paint.
    makeThumbnailDataUrl(url, 280, 0.7).then(function (thumb) {
      if (thumb) {
        img.setAttribute('data-thumb-url', thumb);
        // Prefer thumb on the card to save memory; original remains in data-full-url.
        if (img.complete && img.naturalWidth > 0) {
          img.src = thumb;
        }
      }
      try {
        if (typeof window.收入历史 === 'function') window.收入历史(url, thumb || '');
      } catch (eHist) {}
    });
  }

  window.打开图片预览 = openImagePreview;
  window.structurePromptForGen = structurePromptForGen;
  window.makeThumbnailDataUrl = makeThumbnailDataUrl;
  window.reportImageFailure = reportImageFailure;


  async function stopJob(run) {
    if (!run.job || ['done', 'failed', 'cancelled'].includes(run.job.state)) return;
    if (run.job.upstream === 'horde' && run.job.id) {
      try {
        await fetch(HORDE_API + '/generate/status/' + encodeURIComponent(run.job.id), {
          method: 'DELETE',
          headers: hordeHeaders()
        });
      } catch (e) {}
      run.job.state = 'cancelled';
      return;
    }
    if (!run.job.id) return;
    run.job = await api('/' + encodeURIComponent(run.job.id), { method: 'DELETE', timeoutMs: 30000 });
  }

  function workshopTicket() {
    try { return new URLSearchParams(location.search).get('k') || ''; } catch (e) { return ''; }
  }

  function pollinationsProxyUrl(model, prompt, width, height, seed) {
    return '/api/workshop/image'
      + '?k=' + encodeURIComponent(workshopTicket())
      + '&model=' + encodeURIComponent(model || 'sana')
      + '&prompt=' + encodeURIComponent(String(prompt || 'photo').slice(0, 1400))
      + '&width=' + (width || 512)
      + '&height=' + (height || 512)
      + '&seed=' + seed;
  }

  // A provider must either return a usable image within this budget or be
  // removed from the current workshop session. This prevents one free
  // upstream queue from holding the whole workshop open indefinitely.
  var PROVIDER_RESULT_TIMEOUT_MS = 30000;
  var HORDE_BUDGET_MS = 180000;
  var disabledEngines = Object.create(null);

  function disableEngine(engine, reason) {
    engine = normalizeEngineName(engine);
    // Never disable the only remaining image channel.
    if (!engine || engine === 'perchance') return;
    disabledEngines[engine] = String(reason || '30秒内未返回可用图片');
    try { window.__sushiDisabledImageEngines = Object.keys(disabledEngines); } catch (e) {}
  }

  function isEngineDisabled(engine) {
    return !!disabledEngines[normalizeEngineName(engine)];
  }

  function resetDisabledEnginesForNewRun() {
    disabledEngines = Object.create(null);
    try { window.__sushiDisabledImageEngines = []; } catch (e) {}
  }

  async function runWithProviderBudget(run, engine, task, budgetMs) {
    engine = normalizeEngineName(engine);
    var providerController = new AbortController();
    // Do not use AbortSignal.any here: embedded WebViews and jsdom can expose
    // incompatible AbortSignal implementations. Forward the run cancellation
    // into one native controller instead.
    var signal = providerController.signal;
    var forwardAbort = function () { providerController.abort(); };
    if (run.controller.signal.aborted) forwardAbort();
    else run.controller.signal.addEventListener('abort', forwardAbort, { once: true });
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; providerController.abort(); }, budgetMs || PROVIDER_RESULT_TIMEOUT_MS);
    try {
      return await task(signal);
    } catch (error) {
      if (timedOut && !run.cancelled) {
        var isHorde = engine === 'horde' || engine === 'horde-real' || engine === 'horde-anime' || engine === 'perchance';

        var timeoutError = new Error(engineLabel(engine) + (isHorde ? ' 排队超时，请稍后重试' : ' 30秒内未返回图片，仍保留当前平台'));
        timeoutError.code = 'ENGINE_TIMEOUT';
        timeoutError.engine = engine;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      run.controller.signal.removeEventListener('abort', forwardAbort);
    }
  }

  function turboUrl(prompt, width, height, seed) {
    return pollinationsProxyUrl('sana', prompt, width, height, seed);
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

  async function generatePollinations(run, prompt, index, model, providerSignal) {
    var requested = String(model || 'sana').trim().toLowerCase();
    if (requested === 'perch' || requested === '官方') requested = 'perchance';
    if (requested === 'turbo' || requested === 'flux' || requested === 'flux-realism' || requested === 'auto-real' || requested === 'auto') requested = 'sana';
    if (requested === 'auto-anime') requested = 'sana';
    var proxyModel = requested === 'perchance' ? 'perchance' : 'sana';
    if (isEngineCool(proxyModel) || isEngineCool(requested)) {
      var coolErr = new Error(coolHint(proxyModel) + '（限流跳过）');
      coolErr.status = 429;
      coolErr.code = 'ENGINE_COOLDOWN';
      throw coolErr;
    }
    var seedBase = run.payload.seed !== '' && run.payload.seed != null
      ? Number(run.payload.seed)
      : Math.floor(Math.random() * 2147483646);
    if (!Number.isFinite(seedBase)) seedBase = Math.floor(Math.random() * 2147483646);
    var seed = seedBase + (index || 0) * 97;
    var label = engineLabel(requested);
    status('正在用 ' + label + ' 生成 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', '同源代理出图；失败时保留所选通道，不自动切换。', true);
    var lastError = null;
    var maxAttempts = proxyModel === 'perchance' ? 1 : 3;
    for (var attempt = 0; attempt < maxAttempts; attempt += 1) {
      ensureActive(run);
      var url = pollinationsProxyUrl(proxyModel, prompt, run.payload.width, run.payload.height, seed + attempt * 131);
      try {
        var response = await fetch(url, { method: 'GET', credentials: 'include', cache: 'no-store', headers: authHeaders(), signal: providerSignal || run.controller.signal });
        if (!response.ok) {
          var httpErr = new Error(label + (response.status === 429 ? ' 限流(429)' : (' HTTP ' + response.status)));
          httpErr.status = response.status;
          if (response.status === 429 || response.status >= 500) {
            markEngineCool(proxyModel, response.status);
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
        return { url: dataUrl, engine: requested === 'perchance' ? 'perchance' : 'sana' };
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
    return generatePollinations(run, prompt, index, 'sana');
  }

  var HORDE_API = 'https://aihorde.net/api/v2';
  var HORDE_ANON_KEY = '0000000000';
  var HORDE_REAL_MODELS = [
    "ICBINP - I Can't Believe It's Not Photography",
    'AbsoluteReality',
    'Realistic Vision',
    'Photon',
    'ICBINP XL',
    'Edge Of Realism',
    'majicMIX realistic'
  ];
  var HORDE_ANIME_MODELS = [
    'Counterfeit',
    'Anima-Turbo-v1.1',
    'Anything v5',
    'Flat-2D Animerge',
    'Rev Animated',
    'WAI-NSFW-illustrious-SDXL'
  ];

  // English default for #负面提示 (must match workshop.html textarea default).
  var DEFAULT_EN_NEGATIVE = 'lowres, blurry, out of focus, bad anatomy, multiple heads, fused bodies, extra arms, extra legs, missing arms, missing legs, wrong number of limbs, extra fingers, missing fingers, malformed hands, duplicated limbs, distorted face, blurry face, deformed face, misplaced facial features, plastic skin, wax figure, cartoon, anime, illustration, digital painting, manga, child, minor, underage, real celebrity, UI, text, watermark, pinyin, romanization, letters on image, chinese characters on image, subtitle, caption, logo, signature, anime, manga, cartoon, illustration, cel shading';

  // Markers from the pre-PR#73 Chinese default — localStorage/autofill may restore these.
  var OLD_CN_NEG_MARKERS = [
    '低清晰度', '错误解剖', '畸形手部', '身体融合', '五官错位', '蜡像感',
    '真实名人', '电脑界面', '手脚数量不对', '多余手臂', '缺失手指', '未成年人'
  ];

  // Longest-first phrase map for generate-time conversion.
  var CN_NEG_PHRASE_MAP = [
    ['手脚数量不对', 'wrong number of limbs'],
    ['多余手指', 'extra fingers'],
    ['缺失手指', 'missing fingers'],
    ['多余手臂', 'extra arms'],
    ['多余腿', 'extra legs'],
    ['缺失手臂', 'missing arms'],
    ['缺失腿', 'missing legs'],
    ['身体融合', 'fused bodies'],
    ['畸形手部', 'malformed hands'],
    ['重复肢体', 'duplicated limbs'],
    ['扭曲五官', 'distorted face'],
    ['五官错位', 'misplaced facial features'],
    ['塑料皮肤', 'plastic skin'],
    ['数字绘画', 'digital painting'],
    ['电脑界面', 'UI'],
    ['真实名人', 'real celebrity'],
    ['未成年人', 'underage'],
    ['低清晰度', 'lowres'],
    ['错误解剖', 'bad anatomy'],
    ['模糊脸', 'blurry face'],
    ['变形脸', 'deformed face'],
    ['蜡像感', 'wax figure'],
    ['二次元', 'anime'],
    ['三只手', 'extra arms'],
    ['三只腿', 'extra legs'],
    ['多头', 'multiple heads'],
    ['双头', 'multiple heads'],
    ['三头', 'multiple heads'],
    ['失焦', 'out of focus'],
    ['模糊', 'blurry'],
    ['卡通', 'cartoon'],
    ['动漫', 'anime'],
    ['插画', 'illustration'],
    ['漫画', 'manga'],
    ['儿童', 'child'],
    ['文字', 'text'],
    ['水印', 'watermark'],
    ['赛璐璐', 'cel shading'],
    ['手绘', 'drawing']
  ];

  function hasCjk(text) {
    return /[\u4e00-\u9fff]/.test(String(text || ''));
  }

  function looksLikeOldCnNegative(text) {
    var s = String(text || '');
    if (!s) return false;
    for (var i = 0; i < OLD_CN_NEG_MARKERS.length; i += 1) {
      if (s.indexOf(OLD_CN_NEG_MARKERS[i]) !== -1) return true;
    }
    return false;
  }

  function migrateNegativePromptBox() {
    var el = $('负面提示');
    if (!el) return false;
    var cur = String(el.value || '');
    if (!cur.trim()) return false;
    if (!hasCjk(cur) && !looksLikeOldCnNegative(cur)) return false;
    el.value = DEFAULT_EN_NEGATIVE;
    return true;
  }

  function englishizeNegativePrompt(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    if (!hasCjk(raw)) return raw;
    var out = raw;
    var i = 0;
    for (; i < CN_NEG_PHRASE_MAP.length; i += 1) {
      var cn = CN_NEG_PHRASE_MAP[i][0];
      var en = CN_NEG_PHRASE_MAP[i][1];
      if (out.indexOf(cn) !== -1) out = out.split(cn).join(en);
    }
    out = out
      .replace(/[\u4e00-\u9fff]+/g, ' ')
      .replace(/[，；、]/g, ',')
      .replace(/[，,]\s*[，,]/g, ',')
      .replace(/^[，,\s]+|[，,\s]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    var parts = out.split(/[,]+/).map(function (p) { return p.trim(); }).filter(Boolean);
    var kept = [];
    var seen = Object.create(null);
    for (i = 0; i < parts.length; i += 1) {
      var tok = parts[i];
      if (hasCjk(tok)) continue;
      if (!/[A-Za-z0-9]/.test(tok)) continue;
      var key = tok.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      kept.push(tok);
    }
    if (!kept.length) return DEFAULT_EN_NEGATIVE;
    // Old Chinese default (or mostly-CN): prefer full English default, then append unique extras.
    if (looksLikeOldCnNegative(raw) || kept.length < 4) {
      var base = DEFAULT_EN_NEGATIVE.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
      var baseSeen = Object.create(null);
      base.forEach(function (p) { baseSeen[p.toLowerCase()] = true; });
      for (i = 0; i < kept.length; i += 1) {
        if (!baseSeen[kept[i].toLowerCase()]) base.push(kept[i]);
      }
      return base.join(', ');
    }
    return kept.join(', ');
  }

  var HORDE_REAL_NEGATIVE = 'anime, manga, cartoon, illustration, cel shading, 2d, lineart, chibi, drawing, painting, cgi, render, lowres, blurry, bad anatomy, extra limbs, child, minor, underage, watermark, text, pinyin, romanization, letters on image, chinese characters on image, subtitle, caption, logo, signature';

  function hordeHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: HORDE_ANON_KEY,
      'Client-Agent': 'sushi-club:1.1.45:https://aihorde.net'
    };
  }

  function preferNsfwModels(models, isReal, aggressive) {
    var preferred = isReal
      ? ['Realistic Vision', 'majicMIX realistic', 'AbsoluteReality', 'Photon']
      : ['WAI-NSFW-illustrious-SDXL', 'Counterfeit', 'Anima-Turbo-v1.1'];
    var rest = models.slice();
    var head = [];
    var i = 0;
    for (; i < preferred.length; i += 1) {
      var idx = rest.indexOf(preferred[i]);
      if (idx >= 0) {
        head.push(preferred[i]);
        rest.splice(idx, 1);
      }
    }
    if (aggressive && head.length) return head.concat(rest.slice(0, 2));
    return head.concat(rest);
  }

  function buildHordeBody(run, prompt, index, styleName, shrink, aggressiveNsfw) {
    var width = Number(run.payload && run.payload.width) || 512;
    var height = Number(run.payload && run.payload.height) || 512;
    if (shrink) {
      width = Math.min(width, 512);
      height = Math.min(height, 512);
    }
    var negative = String((run.payload && run.payload.negativePrompt) || '');
    var isReal = styleName !== 'anime';
    if (isReal) negative = negative ? (negative + ', ' + HORDE_REAL_NEGATIVE) : HORDE_REAL_NEGATIVE;
    var params = {
      n: 1,
      width: width,
      height: height,
      steps: shrink ? 8 : (run.localEdit ? 20 : 12),
      cfg_scale: Number((run.payload && run.payload.cfgScale) || 7)
    };
    if (run.localEdit && isPoseGestureEdit(run.coreSource || (run.payload && run.payload.prompt) || '')) {
      if (!(Number(params.cfg_scale) > 7)) params.cfg_scale = 8;
    }
    var seed = run.payload && run.payload.seed;
    if (seed !== '' && seed != null) {
      if (run.localEdit) params.seed = String(Number(seed));
      else params.seed = String(Number(seed) + (index || 0));
    }
    var nsfwOn = typeof window.成人主题已开启 === 'undefined' ? true : !!window.成人主题已开启;
    var models = isReal ? HORDE_REAL_MODELS.slice() : HORDE_ANIME_MODELS.slice();
    if (nsfwOn) models = preferNsfwModels(models, isReal, !!aggressiveNsfw);
    var body = {
      prompt: String(prompt || '') + (negative ? ' ### ' + negative : ''),
      params: params,
      r2: true,
      nsfw: nsfwOn,
      censor_nsfw: !nsfwOn,
      slow_workers: true,
      models: models
    };
    var source = run.payload && run.payload.sourceImage;
    if (run.localEdit && !source) {
      try { console.warn('[改动] localEdit 无 source_image，无法走 Horde img2img'); } catch (eAssert) {}
    }
    if (source) {
      var text = String(source);
      var comma = text.indexOf(',');
      body.source_image = comma >= 0 ? text.slice(comma + 1) : text;
      body.source_processing = 'img2img';
      var ds = Number((run.payload && run.payload.strength) || 0.6);
      if (!isFinite(ds) || ds <= 0) ds = 0.6;
      if (run.localEdit && isPoseGestureEdit(run.coreSource || (run.payload && run.payload.prompt) || '')) {
        if (ds < 0.55) ds = 0.55;
        if (ds > 0.65) ds = 0.65;
      }
      params.denoising_strength = ds;
    }
    return body;
  }

  async function hordeFetch(path, method, body, signal) {
    var response = await fetch(HORDE_API + path, {
      method: method || 'GET',
      headers: hordeHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
    });
    var data;
    try { data = await response.json(); } catch (e) { throw new Error('平台返回异常，请稍后重试'); }
    if (!response.ok) {
      var err = new Error(
        response.status === 429 ? '免费生图服务繁忙，请稍后重试'
          : (data && (data.error || data.message)) || '生图服务暂时不可用，请稍后重试'
      );
      err.status = response.status === 429 ? 429 : response.status;
      throw err;
    }
    return data;
  }

  async function pollHorde(run, id, signal) {
    var errors = 0;
    var first = true;
    while (true) {
      ensureActive(run);
      if (!first) await pause(run, 400);
      first = false;
      ensureActive(run);
      var check;
      try {
        check = await hordeFetch('/generate/check/' + encodeURIComponent(id), 'GET', undefined, signal);
        errors = 0;
      } catch (error) {
        ensureActive(run);
        if (error.status && error.status < 500 && error.status !== 429) throw error;
        errors += 1;
        if (errors >= 4) throw error;
        status('连接暂时中断，正在重新查询', '不会重复提交生图任务。', true);
        await pause(run, Math.min(2000 + errors * 1000, 5000));
        continue;
      }
      run.job = {
        id: id,
        state: check.done ? 'processing' : (check.processing > 0 ? 'processing' : 'queued'),
        upstream: 'horde',
        queuePosition: check.queue_position,
        waitTimeSeconds: check.wait_time
      };
      progress(run, run.job);
      if (check.faulted) throw new Error('生图任务失败，请重新尝试');
      if (!check.done && check.is_possible === false) throw new Error('当前没有可处理此任务的工作节点，请减小尺寸或稍后重试');
      if (!check.done) continue;
      var result = await hordeFetch('/generate/status/' + encodeURIComponent(id), 'GET', undefined, signal);
      var gens = Array.isArray(result.generations) ? result.generations : [];
      var image = null;
      var hadCensored = false;
      var i = 0;
      for (; i < gens.length; i += 1) {
        if (gens[i] && gens[i].censored) hadCensored = true;
        if (gens[i] && gens[i].img && !gens[i].censored) { image = gens[i]; break; }
      }
      if (!image || !image.img) {
        if (hadCensored) {
          var censoredErr = new Error('成人内容被生图节点审查');
          censoredErr.code = 'HORDE_CENSORED';
          throw censoredErr;
        }
        throw new Error('任务结束但没有可显示的图片，请修改描述后重试');
      }
      run.job.state = 'done';
      return image.img;
    }
  }

  async function generateHorde(run, prompt, index, providerSignal, engineName) {
    var reported = engineName === 'perchance' ? 'perchance' : (engineName === 'horde-anime' ? 'horde-anime' : 'horde-real');
    var styleName = reported === 'horde-anime' ? 'anime' : 'real';
    var signal = providerSignal || run.controller.signal;
    var lastError = null;
    var shrink = false;
    var censoredRetries = 0;
    var maxCensoredRetries = 3;
    var rateRetries = 0;
    if (run.payload && run.payload.sourceImage) {
      try {
        run.payload.sourceImage = await materializeSourceImage(run.payload.sourceImage);
      } catch (eMat) {
        if (run.localEdit) throw new Error('改动参考图无法读取，请重新点选记忆路线图片或插入参考图');
      }
      if (run.localEdit) {
        var srcNow = String(run.payload.sourceImage || '');
        if (!/^data:image\//i.test(srcNow)) {
          throw new Error('改动需要可用的参考图（base64），当前源图无法用于 img2img');
        }
      }
    }
    for (var attempt = 0; attempt < 8; attempt += 1) {
      ensureActive(run);
      var payload = buildHordeBody(run, prompt, index, styleName, shrink, censoredRetries > 0);
      status('正在出图 · 第 ' + (run.completed + 1) + '/' + run.total + ' 张', '有结果立即显示。', true);
      try {
        var accepted = await hordeFetch('/generate/async', 'POST', payload, signal);
        if (!accepted || !accepted.id) throw new Error('平台没有返回任务编号');
        run.job = { id: accepted.id, state: 'queued', upstream: 'horde' };
        ensureActive(run);
        var url = await pollHorde(run, accepted.id, signal);
        return { url: url, engine: reported };
      } catch (error) {
        lastError = error;
        if (run.cancelled || (error && error.name === 'AbortError')) throw error;
        if (error && error.code === 'HORDE_CENSORED') {
          var nsfwOn = typeof window.成人主题已开启 === 'undefined' ? true : !!window.成人主题已开启;
          if (nsfwOn && censoredRetries < maxCensoredRetries) {
            censoredRetries += 1;
            status('节点审查了成人内容，正在换节点重试', '换用更适合成人内容的模型重试（' + censoredRetries + '/' + maxCensoredRetries + '）。', true);
            await pause(run, 400);
            continue;
          }
          throw new Error(nsfwOn
            ? '成人内容被生图节点审查，请换写实/动漫通道或稍后再试'
            : '任务结束但没有可显示的图片，请修改描述后重试');
        }
        var statusCode = error && error.status;
        if (statusCode === 403 && !shrink) {
          shrink = true;
          await pause(run, 300);
          continue;
        }
        if ((statusCode === 429 || statusCode === 409 || statusCode === 503) && rateRetries < 3) {
          rateRetries += 1;
          await pause(run, 800);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error(engineLabel(reported) + ' 提交失败');
  }

  // Workshop image generation never imposes an application-side cool-down.
  // Upstream 429/5xx responses end the current attempt immediately; the user may retry.
  var ENGINE_COOLDOWN_MS = 0;
  var lastRateLimited = false;

  function markEngineCool(eng, statusCode) {
    if (statusCode === 429) lastRateLimited = true;
  }

  function isEngineCool() {
    return false;
  }

  function coolHint() {
    return '';
  }

  // Perchance cool-down cancelled: explicit Perchance and auto race may always try.
  // Keep lost-race handling so auto-race losers exit without hanging; never gate on cooldown.
  var perchanceCooldownUntil = 0;
  var PERCHANCE_COOLDOWN_MS = 0;

  function markPerchanceFailure(reason) {
    // no-op — cool-down UX removed; keep symbol for older callers/tests.
    try { window.__sushiPerchanceCoolReason = String(reason || 'failure'); } catch (e) {}
  }

  function isPerchanceCooling() {
    return false;
  }

  function perchanceCoolHint() {
    return '';
  }

  function raceFailMessage(errors) {
    var msgs = (errors || []).map(function (e) { return e && e.message; }).filter(Boolean);
    var rate = lastRateLimited || msgs.some(function (m) { return /429|限流|繁忙|冷却/.test(String(m)); });
    if (rate) {
      return '出图通道繁忙，本次请求已结束，未设置冷却，可立即重试或手动换通道。';
    }
    return msgs.length ? msgs.join('；') : '自动抢出失败：各平台均未成功';
  }

  var REAL_RACE_ENGINES = ['perchance'];
  var ANIME_RACE_ENGINES = [];
  var FREE_RACE_ENGINES = REAL_RACE_ENGINES;

  function applyImageConfig(cfg) {
    void cfg;
    var glmOpt = document.querySelector('#出图引擎 option[value="glm"]');
    var glmAdmin = document.querySelector('#管理默认平台 option[value="glm"]');
    if (glmOpt && glmOpt.parentNode) glmOpt.parentNode.removeChild(glmOpt);
    if (glmAdmin && glmAdmin.parentNode) glmAdmin.parentNode.removeChild(glmAdmin);
    REAL_RACE_ENGINES = ['perchance'];
    FREE_RACE_ENGINES = REAL_RACE_ENGINES;
    enableProviderPickers();
  }

  function normalizeEngineName(raw) {
    var name = String(raw || '').trim().toLowerCase();
    if (name === '官方' || name === 'perch') return 'perchance';
    if (name === 'horde') return 'horde-real';
    return name || 'perchance';
  }

  function engineFamily(name) {
    name = normalizeEngineName(name);
    if (name === 'auto-anime' || name === 'horde-anime' || name === 'sana') return 'anime';
    if (name === 'perchance') return 'perchance';
    return 'real';
  }

  function engineLabel(name) {
    var map = {
      auto: '自动抢出 · 写实', 'auto-real': '自动抢出 · 写实', 'auto-anime': '自动抢出 · 动漫',
      turbo: 'Sana', horde: 'AI Horde · 写实', 'horde-real': 'AI Horde · 写实', 'horde-anime': 'AI Horde · 动漫',
      flux: 'Sana', 'flux-realism': 'Sana', sana: 'Sana · 动漫/插画', perchance: 'Perchance'
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

  async function generatePerchancePlugin(run, prompt, index, timeoutMs) {
    // In-app Perchance plugin (only exists when hosted on perchance.org).
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
      if (styleBox && !hasExplicitArtStyle(prompt)) {
        styleBox.value = '写实摄影，电影剧照，自然皮肤质感，非卡通，非动漫，非插画，真实照片';
      }
      gallery.hidden = false;
      // Clear the previous Perch result so repeated generations observe only this attempt.
      if (typeof gallery.replaceChildren === 'function') gallery.replaceChildren();
      else while (gallery.firstChild) gallery.removeChild(gallery.firstChild);
      var before = 0;
      trigger.value = String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000)) + '-p' + String(index || 0);
      try {
        trigger.dispatchEvent(new Event('input', { bubbles: true }));
        trigger.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {}
      try { window.update(gallery); } catch (error) { throw new Error('Perchance 未能启动'); }
      var deadline = Date.now() + (timeoutMs || 8000);
      while (Date.now() < deadline) {
        ensureActive(run);
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
        await pause(run, 400);
      }
      throw new Error('Perchance 插件超时');
    } finally {
      if (safeBox) safeBox.value = prevSafe;
      if (styleBox) styleBox.value = prevStyle;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      if (!blob) {
        reject(new Error('官方没有返回图片'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('官方图片读取失败')); };
      reader.readAsDataURL(blob);
    });
  }

  function perchanceResolution(run) {
    var w = Number(run && run.payload && run.payload.width) || 512;
    var h = Number(run && run.payload && run.payload.height) || 512;
    if (w === h) return '512x512';
    if (w > h) return '768x512';
    return '512x768';
  }

  function signalWithTimeout(parent, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) {}
    }, ms);
    function onParent() {
      clearTimeout(timer);
      try { ctrl.abort(); } catch (e) {}
    }
    if (parent) {
      if (parent.aborted) onParent();
      else parent.addEventListener('abort', onParent);
    }
    ctrl.signal.__clearTimeout = function () { clearTimeout(timer); };
    return ctrl.signal;
  }

  function parentAborted(parent, run) {
    return !!(run && run.cancelled) || !!(parent && parent.aborted);
  }

  async function perchanceOfficialJson(url, signal) {
    var response = await fetch(url, { method: 'GET', cache: 'no-store', signal: signal });
    var text = await response.text();
    if (!text || text.trim().charAt(0) === '<' || /Just a moment|cf-mitigated|cloudflare/i.test(text)) {
      var blocked = new Error('官方出图接口被拦截，未转接其他平台');
      blocked.code = 'PERCH_CF';
      blocked.status = response.status;
      throw blocked;
    }
    var data;
    try { data = JSON.parse(text); } catch (e) {
      var bad = new Error('官方返回异常，未转接其他平台');
      bad.status = response.status;
      throw bad;
    }
    if (!response.ok) {
      var err = new Error((data && (data.message || data.status || data.error)) || '官方出图失败');
      err.status = response.status;
      throw err;
    }
    return data;
  }

  async function generatePerchanceOfficial(run, prompt, index, providerSignal) {
    if (run.payload && run.payload.sourceImage) {
      throw new Error('Perchance 出图暂不支持参考图，未转接其他平台。');
    }
    var signal = providerSignal || run.controller.signal;
    status(
      '正在用 Perchance 出图 · 第 ' + ((run.completed || 0) + 1) + '/' + (run.total || 1) + ' 张',
      '按所选 Perchance 通道出图，失败不更换平台。',
      true
    );
    var key = '';
    try {
      var verified = await perchanceOfficialJson(
        'https://image-generation.perchance.org/api/verifyUser?thread=0&__cacheBust=' + Math.random(),
        signal
      );
      key = (verified && verified.userKey) || '';
    } catch (error) {
      ensureActive(run);
      if (run.cancelled || (error && error.name === 'AbortError')) throw error;
    }
    var params = new URLSearchParams({
      prompt: String(prompt || ''),
      negativePrompt: String((run.payload && run.payload.negativePrompt) || ''),
      userKey: key,
      seed: '-1',
      resolution: perchanceResolution(run),
      guidanceScale: String((run.payload && run.payload.cfgScale) || 7),
      channel: 'ai-text-to-image-generator',
      subChannel: 'public',
      requestId: String(Math.random()) + '-p' + String(index || 0),
      __cache_bust: String(Math.random())
    });
    var created = null;
    var attempt = 0;
    for (; attempt < 2; attempt += 1) {
      ensureActive(run);
      created = await perchanceOfficialJson(
        'https://image-generation.perchance.org/api/generate?' + params.toString(),
        signal
      );
      if (created && created.imageId) break;
      if (created && /invalid_key|failed_verification/i.test(String(created.status || created.message || ''))) {
        throw new Error('官方校验未通过，未转接其他平台');
      }
    }
    if (!created || !created.imageId) throw new Error('官方没有返回图片，未转接其他平台');
    var imageUrl = 'https://image-generation.perchance.org/api/downloadTemporaryImage?imageId=' + encodeURIComponent(created.imageId);
    var imgRes = await fetch(imageUrl, { method: 'GET', cache: 'no-store', signal: signal });
    if (!imgRes.ok) throw new Error('官方图片下载失败，未转接其他平台');
    var blob = await imgRes.blob();
    if (!blob || !blob.size || blob.size < 32) throw new Error('官方图片无效，未转接其他平台');
    var url = await blobToDataUrl(blob);
    return { url: url, engine: 'perchance' };
  }

  async function generatePerchance(run, prompt, index, providerSignal) {
    // Do not embed perchance.org. Do not window.open. Opening official site limits first usually does NOT unlock in-app embed (session/cookies do not transfer into iframe).
    // Try official generate first; if the official host blocks this origin, in-app photoreal still displays.
    if (typeof window.update === 'function' && !(run.payload && run.payload.sourceImage)) {
      try {
        return await generatePerchancePlugin(run, prompt, index, 5000);
      } catch (error) {
        var pluginMsg = String(error && error.message || error || '');
        if (!error || /已取消生成|lost-race/.test(pluginMsg)) throw error;
      }
    }
    var parent = providerSignal || (run && run.controller && run.controller.signal);
    var officialSignal = signalWithTimeout(parent, 1200);
    try {
      var official = await generatePerchanceOfficial(run, prompt, index, officialSignal);
      if (officialSignal.__clearTimeout) officialSignal.__clearTimeout();
      return official;
    } catch (error) {
      if (officialSignal.__clearTimeout) officialSignal.__clearTimeout();
      var officialMsg = String(error && error.message || error || '');
      if (!error || /已取消生成|lost-race/.test(officialMsg)) throw error;
      if (parentAborted(parent, run)) throw error;
      status(
        '正在出图 · 第 ' + ((run.completed || 0) + 1) + '/' + (run.total || 1) + ' 张',
        '应用内直出，有结果立即显示。',
        true
      );
      var result = await generateHorde(run, prompt, index, providerSignal, 'perchance');
      return { url: result.url, engine: 'perchance' };
    }
  }

  async function generateOne(run, prompt, index) {
    var engine = run.engine;
    if (run.payload.sourceImage && engine === 'sana') throw new Error('Sana 当前未接入图生图，未切换平台。');
    var coreHint = String(run.coreSource || '') || (typeof value === 'function' ? (value('角色描述') || '') : '');
    var localEdit = !!(run.localEdit && run.payload && run.payload.sourceImage);
    var smartOn = hasSmartModifier();
    run.enrichPrompt = smartOn;
    if (engineFamily(engine) === 'anime') {
      // Honor anime channel wording; still reinject East Asian cues from core when present.
      prompt = applyEastAsianEthnicity(String(prompt || ''), coreHint);
      prompt = stripInjectedFemaleDefaults(prompt, coreHint);
      prompt = applyCoreFidelityLead(prompt);
      prompt = ensureNoTextOnImage(prompt);
    } else if (smartOn) {
      prompt = forcePhotorealPrompt(prompt, { core: coreHint, localEdit: localEdit });
      prompt = ensureNoTextOnImage(prompt);
    } else {
      // 未智能修饰：以核心描述翻译为主，不堆写实修饰词库
      prompt = minimalOutboundPrompt(prompt, { core: coreHint, localEdit: localEdit });
    }
    // Adult/NSFW instructions from core + hidden 成人功能状态 must survive photoreal enrich.
    prompt = withAdultDirective(prompt, { core: coreHint });
    if (localEdit) prompt = applyLocalEditOutbound(prompt, coreHint, { img2img: true, force: true });
    run.payload.prompt = prompt;
    return runWithProviderBudget(run, engine, function (signal) {
      if (engine === 'perchance') return generatePerchance(run, prompt, index, signal);
      if (engine === 'horde-real' || engine === 'horde-anime') return generateHorde(run, prompt, index, signal, engine);
      if (engine === 'sana') return generatePollinations(run, prompt, index, engine, signal);
      throw new Error('所选通道尚未接入，未切换平台。');
    }, HORDE_BUDGET_MS);
  }

  function resolveEngine() {
    return normalizeEngineName(value('出图引擎'));
  }

  function resolveImg2imgEngine(selected) {
    var name = normalizeEngineName(selected);
    // Perchance / Sana cannot img2img — force Horde so 改动 keeps source_image path.
    if (!name || name === 'perchance' || name === 'sana' || name === 'turbo' || name === 'flux' || name === 'flux-realism') {
      var txt = normalizeEngineName(value('出图引擎'));
      if (engineFamily(txt) === 'anime' || name === 'sana') return 'horde-anime';
      return 'horde-real';
    }
    return name;
  }

  async function materializeSourceImage(src) {
    var text = String(src || '').trim();
    if (!text) return '';
    if (/^data:image\//i.test(text)) return text;
    if (!/^https?:\/\//i.test(text)) return text;
    try {
      var response = await fetch(text, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error('ref-http-' + response.status);
      var blob = await response.blob();
      if (!blob || !blob.size) throw new Error('ref-empty');
      return await blobToDataUrl(blob);
    } catch (eFetch) {
      try {
        var dataUrl = await new Promise(function (resolve, reject) {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            try {
              var maxSide = 768;
              var w = img.naturalWidth || img.width || 512;
              var h = img.naturalHeight || img.height || 512;
              var scale = Math.min(1, maxSide / Math.max(w, h));
              var canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(w * scale));
              canvas.height = Math.max(1, Math.round(h * scale));
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/jpeg', 0.9));
            } catch (eDraw) { reject(eDraw); }
          };
          img.onerror = function () { reject(new Error('ref-img')); };
          img.src = text;
        });
        return dataUrl;
      } catch (eImg) {
        return text;
      }
    }
  }

  async function execute(run, restored) {
    try {
      if (!restored) {
        if (!run.coreSource) run.coreSource = String(run.description || '');
        var structured = '';
        var smartOn = hasSmartModifier();
        run.enrichPrompt = smartOn;
        // 未点智能修饰：跳过结构化扩写，只把核心描述译成英文出图
        if (smartOn) {
          try { structured = await structurePromptForGen(run); } catch (eStruct) {
            ensureActive(run);
            if (run.cancelled || (eStruct && eStruct.name === 'AbortError')) throw eStruct;
          }
        }
        if (structured) {
          // Structured English is outbound only; keep coreSource for ethnicity/framing cues.
          run.description = structured;
          run.payload.prompt = structured;
        } else {
          run.payload.prompt = await promptFor(run);
        }
        if (run.localEdit && run.payload.sourceImage) {
          run.payload.prompt = applyLocalEditOutbound(run.payload.prompt, run.coreSource || run.description, { img2img: true, force: !!run.localEdit });
        } else if (run.backgroundOnly && run.payload.sourceImage) {
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
        var gotUrl = '';
        var gotEngine = 'horde';
        if (restored) {
          var done = await poll(run, run.job);
          addImage(run, done.image, (done.provider || 'horde'));
          gotUrl = done && done.image && done.image.url ? done.image.url : '';
          gotEngine = done && done.provider ? done.provider : 'horde';
        } else {
          var result = await generateOne(run, run.payload.prompt, run.completed);
          ensureActive(run);
          addImage(run, result, result.engine);
          gotUrl = result && result.url ? result.url : '';
          gotEngine = result && result.engine ? result.engine : gotEngine;
        }
        ensureActive(run);
        try {
          if (gotUrl && typeof window.记忆已开 === 'function' && window.记忆已开()) {
            var routeMeta = { image: gotUrl, seed: run.payload && run.payload.seed };
            var routeItem = null;
            if (run.completed === 0 && typeof window.追加记忆路线 === 'function') {
              routeItem = window.追加记忆路线(run.coreSource || value('角色描述') || run.description || '', routeMeta);
            } else if (typeof window.更新记忆路线图片 === 'function') {
              var cur = typeof window.当前记忆路线 === 'function' ? window.当前记忆路线() : null;
              routeItem = window.更新记忆路线图片(cur && cur.id, routeMeta) || cur;
            }
            if (typeof window.makeThumbnailDataUrl === 'function' && routeItem) {
              window.makeThumbnailDataUrl(gotUrl, 120, 0.65).then(function (thumb) {
                if (!thumb) return;
                try {
                  if (typeof window.更新记忆路线图片 === 'function') {
                    window.更新记忆路线图片(routeItem.id, { thumb: thumb, image: gotUrl, seed: run.payload && run.payload.seed });
                  }
                } catch (eThumb) {}
              });
            }
            try {
              // Soft-adopt as next 改动 base; do not auto-check「改动」(keeps Perchance t2i intact).
              var addr = $('参考图地址');
              var seedEl = $('参考图种子');
              if (addr) addr.value = String(gotUrl);
              if (seedEl) {
                var sk = run.payload && run.payload.seed;
                seedEl.value = (sk !== '' && sk != null && String(sk) !== '-1') ? String(sk) : (seedEl.value || '');
              }
              try { if (typeof window.预览参考图 === 'function') window.预览参考图(); } catch (ePrev) {}
            } catch (eAdopt) {}
          }
        } catch (eRouteImg) {}
        run.completed += 1;
        restored = false;
      }
      // Hide the bulky status card so placeholders sit directly under 「角色画廊」.
      hideStatusPanel();
    } catch (error) {
      if (active !== run) return;
      var cleanupError = '';
      try { await stopJob(run); } catch (e) { cleanupError = ' 未收到取消确认，任务最迟在 10 分钟上限后结束。'; }
      var title = run.cancelled ? '已停止本轮生成' : (run.completed ? '已生成 ' + run.completed + ' 张，后续未完成' : '本次未完成');
      var detail = run.cancelled ? '已保留已完成的图片。' : String(error && error.message || error || '');
      if (/Load failed|Failed to fetch|NetworkError|正在唤醒服务|CLIENT_TIMEOUT/i.test(detail) || (error && (error.wake || error.code === 'CLIENT_TIMEOUT'))) {
        if (/Perchance|perchance/i.test(detail) && !/唤醒|cold|timeout|Failed to fetch/i.test(detail)) {
          detail = 'Perchance 出图接口不可用，未完成，未更换平台。';
        } else if (/唤醒|CLIENT_TIMEOUT|Failed to fetch|NetworkError|Load failed/i.test(detail) || (error && (error.wake || error.code === 'CLIENT_TIMEOUT'))) {
          title = run.completed ? title : '正在唤醒服务';
          detail = '服务冷启动中，请稍候再试；这不是通用连接失败。';
        }
      }
      if (!run.cancelled && (error && (error.status === 429 || error.code === 'ENGINE_COOLDOWN' || error.code === 'ALL_COOLDOWN' || /限流|冷却|429/.test(detail)))) {
        title = run.completed ? title : '出图通道限流';
        if (!/限流|冷却/.test(detail)) detail = '免费通道繁忙，本次请求已结束且未设置冷却；可立即重试或更换平台。';
      } else if (!run.cancelled && /各平台均未成功|自动抢出失败/.test(detail)) {
        title = run.completed ? title : '各通道均未成功';
      }
      status(title, detail + cleanupError, false);
      if (!run.cancelled) reportImageFailure(run.engine || 'unknown', error, run.startedAt || Date.now());
    } finally {
      if (active === run) { active = null; controls(false); }
    }
  }

  function newRun(description, total) {
    return { engine: value('参考图地址') ? resolveImg2imgEngine(value('图生图平台')) : resolveEngine(), description: description, total: total, completed: 0, payload: {}, job: null, cancelled: false, controller: new AbortController(), startedAt: Date.now() };
  }

  window.开始生成 = function () {
    var genBtn = $('生成按钮');
    if (active || (genBtn && genBtn.disabled)) return Promise.resolve();
    // Preserve the user selection for the entire run.

    enableProviderPickers();

    // 记忆开且核心已改写：以最新核心描述为准，记忆仅补充；勿沿用过期英文
    var enBox = $('英文描述');
    if (enBox && enBox.dataset && enBox.dataset.staleFromCore === '1') {
      try { enBox.value = ''; delete enBox.dataset.staleFromCore; } catch (e) {}
    }
    var description = (typeof window.组装出图描述含记忆 === 'function' && window.组装出图描述含记忆())
      || value('角色描述') || value('英文描述');
    var smartMod = typeof window.读取智能修饰后缀 === 'function' ? String(window.读取智能修饰后缀() || '') : '';
    // Modifiers live only on the outbound layer — never rewrite visible core; must not contradict core.
    if (smartMod) {
      var coreForMod = String(value('角色描述') || description || '');
      smartMod = sanitizeModifierAgainstCore(smartMod, coreForMod);
      if (smartMod && description.indexOf(smartMod) === -1) {
        description = description + (smartMod.charAt(0) === ',' ? smartMod : ', ' + smartMod);
      }
    }
    if (!description) { status('请先填写画面描述', '也可以点击“随机生成图片”。', false); $('角色描述').focus(); return Promise.resolve(); }
    if (typeof window.标记核心已用于生成 === 'function') window.标记核心已用于生成();
    resetDisabledEnginesForNewRun();
    try { if (typeof window.同步生图方式默认 === 'function') window.同步生图方式默认(false); } catch (eSync) {}
    try { if (typeof window.确保改动参考图 === 'function') window.确保改动参考图(); } catch (eRefMem) {}
    var run = newRun(description, [1, 3, 5, 7].includes(Number(value('生成数量'))) ? Number(value('生成数量')) : 1);
    run.coreSource = String(value('角色描述') || description || '');
    run.backgroundOnly = !!($('只换背景') && $('只换背景').checked);
    var genMode = typeof window.读取生图方式 === 'function' ? String(window.读取生图方式() || '') : '';
    var memSrc = '';
    try { memSrc = typeof window.当前记忆路线图 === 'function' ? String(window.当前记忆路线图() || '') : ''; } catch (eMemSrc) { memSrc = ''; }
    var hasRef = !!(value('参考图地址') || memSrc);
    var useRef = hasRef && genMode !== '重新生成';
    if (typeof window.本轮使用参考图 === 'function') useRef = !!window.本轮使用参考图() || !!(genMode === '改动' && (value('参考图地址') || memSrc));
    if (genMode === '重新生成') {
      run.localEdit = false;
      useRef = false;
    } else if (useRef && (genMode === '改动' || isLocalEditCore(run.coreSource))) {
      run.localEdit = true;
    } else if (typeof window.应用局部改图 === 'function') {
      run.localEdit = !!window.应用局部改图();
    } else {
      run.localEdit = !!(useRef && isLocalEditCore(run.coreSource));
    }
    if (run.localEdit) {
      run.backgroundOnly = false;
      useRef = true;
    }
    run.engine = useRef ? resolveImg2imgEngine(value('图生图平台')) : resolveEngine();
    if ($('纯背景出图') && $('纯背景出图').checked) {
      run.backgroundOnly = false;
      run.localEdit = false;
      useRef = false;
      if (!/no people|no characters|empty scenic/i.test(description)) {
        description = 'empty scenic environment background only, no people, no characters, no humans, no faces, cinematic atmosphere, ' + description;
        run.description = description;
      }
    }
    var dimensions = value('图像比例').split('x');
    var aspect = run.localEdit
      ? { width: Number(dimensions[0]) || 512, height: Number(dimensions[1]) || 512, nudged: false }
      : preferPortraitAspectForFullBody(
      Number(dimensions[0]) || 512,
      Number(dimensions[1]) || 512,
      String(value('角色描述') || run.coreSource || description || '')
    );
    dimensions = [String(aspect.width), String(aspect.height)];
    var negative = englishizeNegativePrompt(value('负面提示'));
    if (hasCjk(value('负面提示'))) {
      // Keep the textarea English after convert so cached CN does not stick.
      var negBox = $('负面提示');
      if (negBox) negBox.value = negative || DEFAULT_EN_NEGATIVE;
    }
    var family = engineFamily(run.engine);
    var styleAware = family === 'anime';
    if (!negative) {
      negative = styleAware
        ? 'lowres, blurry, out of focus, bad anatomy, extra limbs, malformed hands, child, minor, underage, watermark, text'
        : 'anime, manga, cartoon, illustration, cel shading, 2d, lineart, chibi, drawing, painting, cgi, child, minor, underage, watermark, text, lowres, blurry, out of focus, bad anatomy, extra limbs, malformed hands';
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
      negative += ', anime, manga, cartoon, illustration, cel shading, 2d, lineart';
    }
    // Only core/角色描述 — never smart-mod phrases like "Japanese anime illustration".
    var ethSrc = String(value('角色描述') || run.coreSource || '');
    if (hasEastAsianCue(ethSrc) && !/caucasian|blonde|european/i.test(negative)) {
      negative += ', caucasian, european, blonde, blue eyes, western european features';
    }
    if (wantsFullBodyFraming(ethSrc) || wantsFullBodyFraming(description)) {
      if (!/cropped at waist|cut off feet|half-body shot|upper body only/i.test(negative)) {
        negative += ', cropped at waist, cropped legs, cut off feet, cut off head, close-up portrait, half-body shot, upper body only, waist-up crop';
      }
    }
    if (run.localEdit && !/different person|identity change|full scene redraw/i.test(negative)) {
      if (isPoseGestureEdit(run.coreSource || description)) {
        negative += ', different person, different face, different clothes, new background, full scene redraw, identity change, restyle';
      } else {
        negative += ', different person, different face, different clothes, new background, full scene redraw, identity change, full recompose, restyle, camera move, new composition';
      }
    }
    if (!/pinyin|romanization|letters on image/i.test(negative)) {
      negative += ', pinyin, romanization, letters on image, chinese characters on image, subtitle, caption, logo, signature';
    }
    var sourceForRun = '';
    if (useRef || run.localEdit) {
      sourceForRun = value('参考图地址') || memSrc || '';
    }
    if (run.localEdit && !sourceForRun) {
      try { console.warn('[改动] 勾选改动但无 source_image/参考图，回退全文生图'); } catch (eNoSrc) {}
      try { status('改动需要参考图', '未找到源图，本轮将改走全文生图。请点记忆路线某步或插入参考图后再改动。', false); } catch (eSt) {}
      run.localEdit = false;
      useRef = false;
    } else if (run.localEdit) {
      useRef = true;
      run.engine = resolveImg2imgEngine(value('图生图平台'));
    }
    if (genMode === '改动' && !sourceForRun) {
      try { console.warn('[改动] genMode=改动 仍无 source_image'); } catch (eMode) {}
    }
    run.payload = {
      prompt: description, width: Number(dimensions[0]) || 512, height: Number(dimensions[1]) || 512,
      negativePrompt: negative, seed: value('随机种子'), cfgScale: Number(value('引导强度')) || 7,
      sourceImage: (useRef || run.localEdit) ? sourceForRun : '', strength: Number(value('图生图强度')) || 0.6
    };
    if (run.localEdit) {
      var poseEdit = isPoseGestureEdit(run.coreSource || description);
      run.payload.strength = preferLocalEditStrength(run.payload.strength, run.coreSource || description);
      run.payload.seed = resolveLocalEditSeed(run.payload.seed, run.coreSource || description);
      try {
        var seedBox = $('参考图种子');
        // Pose: do not re-lock seed into 参考图种子 (omit seed so composition can move).
        if (!poseEdit && seedBox && run.payload.seed !== '' && run.payload.seed != null) seedBox.value = String(run.payload.seed);
      } catch (eLock) {}
      if (poseEdit) {
        // Soften: "new composition / camera move / full recompose" fight raised-hand limb edits.
        if (!/different person|identity change|new background|restyle/i.test(negative)) {
          negative += ', different person, different face, different clothes, new background, identity change, restyle';
          run.payload.negativePrompt = negative;
        }
      } else if (!/recompose|restyle|invent a new scene|leave every other region unchanged/i.test(negative)) {
        negative += ', full recompose, restyle, new scene, different composition, camera move, identity change';
        run.payload.negativePrompt = negative;
      }
      try {
        if (!run.payload.sourceImage) console.warn('[改动] payload 缺 source_image');
        else console.info('[改动] img2img', { strength: run.payload.strength, seed: run.payload.seed || '(omit)', engine: run.engine, pose: poseEdit });
      } catch (eLog) {}
    } else if (run.payload && run.payload.seed !== '' && run.payload.seed != null && String(run.payload.seed) !== '-1') {
      try {
        var seedKeep = $('参考图种子');
        if (seedKeep && !seedKeep.value) seedKeep.value = String(run.payload.seed);
      } catch (eKeep) {}
    }
    try { if (typeof window.刷新记忆生成线路 === 'function') window.刷新记忆生成线路(); } catch (eLine) {}
    active = run; controls(true);
    $('图像输出').replaceChildren(); $('官方画廊').replaceChildren(); $('官方画廊').hidden = true;
    window.设平台提示(resolveEngine());
    run.promise = execute(run, false);
    return run.promise;
  };

  window.开始随机生成 = function () {
    var randBtn = $('随机按钮');
    if (active || (randBtn && randBtn.disabled)) return Promise.resolve();

    enableProviderPickers();
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
  window.forcePhotorealPrompt = forcePhotorealPrompt;
  window.hasSmartModifier = hasSmartModifier;
  window.minimalOutboundPrompt = minimalOutboundPrompt;
  window.CORE_FIDELITY_LEAD = CORE_FIDELITY_LEAD;
  window.applyCoreFidelityLead = applyCoreFidelityLead;
  window.sanitizeModifierAgainstCore = sanitizeModifierAgainstCore;
  window.ensureNoTextOnImage = ensureNoTextOnImage;
  window.hasEastAsianCue = hasEastAsianCue;
  window.applyEastAsianEthnicity = applyEastAsianEthnicity;
  window.wantsFullBodyFraming = wantsFullBodyFraming;
  window.isLocalEditCore = isLocalEditCore;
  window.isPoseGestureEdit = isPoseGestureEdit;
  window.localEditChangeDirective = localEditChangeDirective;
  window.applyLocalEditOutbound = applyLocalEditOutbound;
  window.preferLocalEditStrength = preferLocalEditStrength;
  window.resolveLocalEditSeed = resolveLocalEditSeed;
  window.resolveImg2imgEngine = resolveImg2imgEngine;
  window.materializeSourceImage = materializeSourceImage;
  window.采用参考图地址 = function (url, seed) {
    var addr = $('参考图地址');
    var seedEl = $('参考图种子');
    if (addr && url) addr.value = String(url);
    if (seedEl) seedEl.value = (seed !== '' && seed != null && String(seed) !== '-1') ? String(seed) : '';
    try { if (typeof window.预览参考图 === 'function') window.预览参考图(); } catch (e) {}
    try { if (typeof window.同步生图方式默认 === 'function') window.同步生图方式默认(false); } catch (e2) {}
  };
  window.preferPortraitAspectForFullBody = preferPortraitAspectForFullBody;
  window.hasExplicitCropFraming = hasExplicitCropFraming;
  window.applyRealisticFrontFullBody = applyRealisticFrontFullBody;
  window.applyRealisticFrontFullBody = applyRealisticFrontFullBody;
  window.hasExplicitCropFraming = hasExplicitCropFraming;
  window.animePrompt = animePrompt;
  window.DEFAULT_EN_NEGATIVE = DEFAULT_EN_NEGATIVE;
  window.migrateNegativePromptBox = migrateNegativePromptBox;
  window.englishizeNegativePrompt = englishizeNegativePrompt;
  window.hasCjkNegative = hasCjk;
  window.withAdultDirective = withAdultDirective;
  window.adultDirectiveText = adultDirectiveText;
  window.hasNudeIntent = hasNudeIntent;
  window.hasFemaleIntent = hasFemaleIntent;
  window.stripInjectedFemaleDefaults = stripInjectedFemaleDefaults;
  window.ADULT_DIR_BASE = ADULT_DIR_BASE;
  window.ADULT_DIR_NUDE = ADULT_DIR_NUDE;
  window.hasExplicitArtStyle = hasExplicitArtStyle;
  window.engineFamily = engineFamily;
  window.设平台提示 = function (engine) {
    var tip = $('平台提示');
    if (!tip) return;
    tip.textContent = engineLabel(engine) + ' · 按所选通道 · 失败不更换平台';
    try { if (typeof window.刷新记忆生成线路 === 'function') window.刷新记忆生成线路(); } catch (eTip) {}
  };

  async function init() {
    migrateNegativePromptBox();
    // Autofill / form restore may land after first paint — remigrate once more.
    try { setTimeout(migrateNegativePromptBox, 0); setTimeout(migrateNegativePromptBox, 250); } catch (e) {}
    ['角色描述', '英文描述', '中文译文'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        lastEdited = id;
        if (id === '中文译文') $('角色描述').value = value(id);
        randomPair = null;
      });
    });
    enableProviderPickers();
    window.设平台提示(resolveEngine());
    window.__sushiReady = true; window.__sushiLoadError = '';
    bindGalleryPreview();
    controls(true); $('取消生成按钮').hidden = true;
    status('正在唤醒服务', '如果 Render 服务刚休眠，首次连接会自动等待并重试。', true);
    try {
      var results = await Promise.all([safeGet('/config', 2), safeGet('/current', 2)]);
      applyImageConfig(results[0]);
      if (results[1].job) {
        var run = newRun('', 1);
        run.job = results[1].job;
        active = run; controls(true);
        run.promise = execute(run, true);
        return;
      }
      status('生图服务已就绪', '可以按所选通道生成图片。', false);
    } catch (error) {
      status('暂时无法准备生图', error.message + ' 可稍后直接再次点击生成。', false);
    }
    controls(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
