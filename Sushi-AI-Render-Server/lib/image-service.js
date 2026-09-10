'use strict';

const { randomUUID } = require('node:crypto');

class ImageError extends Error {
  constructor(message, status = 502, code = 'IMAGE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function imageSource(value) {
  if (typeof value !== 'string' || !value) throw new ImageError('生图服务没有返回图片');
  if (value.length > 16 * 1024 * 1024) throw new ImageError('返回图片过大，请减小尺寸');
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new ImageError('图片地址无效');
    return url.href;
  }
  const data = value.replace(/^data:image\/(?:png|jpe?g|webp);base64,/i, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ImageError('生图服务返回的图片格式无效');
  const bytes = Buffer.from(data, 'base64');
  let type;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'png';
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = 'jpeg';
  else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') type = 'webp';
  else throw new ImageError('生图服务返回的内容不是可识别的图片');
  return 'data:image/' + type + ';base64,' + bytes.toString('base64');
}

const HORDE_REAL_MODELS = [
  'Flux.1-Schnell fp8 (Compact)',
  'Z-Image-Turbo',
  'ICBINP - I Can\'t Believe It\'s Not Photography',
  'AbsoluteReality',
  'Realistic Vision',
  'Photon',
  'ICBINP XL',
  'Edge Of Realism',
  'majicMIX realistic',
];
const HORDE_IMG2IMG_REAL_MODELS = HORDE_REAL_MODELS.filter((name) => !/flux|z-image/i.test(name));
const HORDE_ANIME_MODELS = [
  'Counterfeit',
  'Anima-Turbo-v1.1',
  'Anything v5',
  'Flat-2D Animerge',
  'Rev Animated',
  'WAI-NSFW-illustrious-SDXL',
];
const REAL_NEGATIVE = 'anime, manga, cartoon, illustration, cel shading, 2d, lineart, chibi, drawing, painting, cgi, render';

function stripArtStyleWords(text) {
  return String(text || '')
    .replace(/\b(anime|manga|cartoon|chibi|illustration|cel[\s-]?shading|pixar|disney|comic(?:\s|-)?style|2d\s*art|visual novel)\b/gi, ' ')
    .replace(/二次元|动漫风格|动漫|卡通|漫画|插画|手绘|赛璐璐|视觉小说/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, ',')
    .trim();
}

function sanitizeRealPrompt(prompt) {
  let text = stripArtStyleWords(String(prompt || '').replace(/\s+/g, ' ').trim());
  if (!text) text = 'a fictional adult, natural light, DSLR';
  if (!/photoreal|RAW photo|DSLR|cinematic still|real human|写实摄影|写实照片/i.test(text)) {
    text = 'photorealistic RAW photo, shot on DSLR, 85mm, natural skin pores, realistic fabric texture, ' + text;
  } else if (!/^\s*photoreal/i.test(text)) {
    text = 'photorealistic photograph of ' + text;
  }
  if (!/not anime|no anime|非卡通|非动漫|NOT anime/i.test(text)) {
    text += ', not anime, not manga, not cartoon, not illustration, not 2d art, not cel shading';
  }
  return text.replace(/\s{2,}/g, ' ').trim();
}

function hordeModelsFor(input = {}, model = '') {
  const style = String((input && input.style) || '').trim().toLowerCase();
  const hasSource = !!(input && input.sourceImage);
  if (style === 'anime' || style === 'horde-anime' || style === 'auto-anime') return HORDE_ANIME_MODELS.slice();
  if (style === 'real' || style === 'photoreal' || style === 'horde-real' || style === 'auto-real' || style === 'perchance') {
    return hasSource ? HORDE_IMG2IMG_REAL_MODELS.slice() : HORDE_REAL_MODELS.slice();
  }
  // Unstyled img2img used to omit models → Horde picked WAI-NSFW-illustrious (anime). Always pin photoreal.
  if (hasSource) return HORDE_IMG2IMG_REAL_MODELS.slice();
  if (model) return [model];
  return null;
}

function generationPayload(input = {}, model = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ImageError('生图参数格式无效', 400, 'BAD_INPUT');
  const promptRaw = String(input.prompt || '').trim();
  if (!promptRaw) throw new ImageError('请先填写画面描述', 400, 'EMPTY_PROMPT');
  const dimension = (value) => {
    const number = Number(value === undefined ? 512 : value);
    if (!Number.isFinite(number) || number < 256 || number > 1024 || number % 64) {
      throw new ImageError('图片边长需为 256–1024 之间的 64 倍数', 400, 'BAD_SIZE');
    }
    return number;
  };
  const negativeRaw = String(input.negativePrompt || '').trim().slice(0, 1000);
  const style = String((input && input.style) || '').trim().toLowerCase();
  const isReal = style === 'real' || style === 'photoreal' || style === 'horde-real' || style === 'auto-real' || style === 'perchance';
  let prompt = isReal ? sanitizeRealPrompt(promptRaw) : promptRaw;
  if (prompt.length > 2000) prompt = prompt.slice(0, 2000);
  let negative = negativeRaw;
  if (isReal) {
    negative = negative ? (negative + ', ' + REAL_NEGATIVE) : REAL_NEGATIVE;
  }
  const cfgScale = Number(input.cfgScale === undefined ? 7 : input.cfgScale);
  if (!Number.isFinite(cfgScale) || cfgScale < 1 || cfgScale > 20) throw new ImageError('引导强度需在 1 到 20 之间', 400, 'BAD_CFG');
  const params = {
    n: 1,
    width: dimension(input.width),
    height: dimension(input.height),
    steps: 16,
    cfg_scale: cfgScale,
  };
  if (input.seed !== undefined && input.seed !== null && input.seed !== '') {
    if (!/^\d{1,10}$/.test(String(input.seed))) throw new ImageError('随机种子格式无效', 400, 'BAD_SEED');
    params.seed = String(input.seed);
  }
  const payload = { prompt: prompt + (negative ? ' ### ' + negative : ''), params, r2: true, nsfw: true, censor_nsfw: false, slow_workers: true };
  const models = hordeModelsFor(input, model);
  if (models && models.length) payload.models = models;
  if (input.sourceImage) {
    const source = String(input.sourceImage);
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(source) || source.length > 10 * 1024 * 1024) {
      throw new ImageError('请上传不超过 7 MB 的 JPG、PNG 或 WebP 参考图', 400, 'BAD_REFERENCE');
    }
    const normalized = imageSource(source);
    const strength = Number(input.strength === undefined ? 0.45 : input.strength);
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
      throw new ImageError('参考图变化强度需在 0 到 1 之间', 400, 'BAD_STRENGTH');
    }
    payload.source_image = normalized.split(',')[1];
    payload.source_processing = 'img2img';
    params.denoising_strength = strength;
  }
  return payload;
}

function createImageService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = options.baseUrl || 'https://aihorde.net/api/v2';
  const apiKey = options.apiKey || '0000000000';
  const now = options.now || Date.now;
  const maxWaitMs = options.maxWaitMs || 10 * 60 * 1000;
  const requestTimeoutMs = options.requestTimeoutMs || 25_000;
  const reserve = options.reserve || (() => null);
  const refund = options.refund || (() => {});
  const commit = options.commit || (() => {});
  const sleep = options.sleep || function (ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) {
        reject(new ImageError('已取消生成', 409, 'CANCELLED'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', function () {
          clearTimeout(timer);
          reject(new ImageError('已取消生成', 409, 'CANCELLED'));
        }, { once: true });
      }
    });
  };
  const jobs = new Map();
  const active = new Map();
  let lastUpstreamId = '';
  const terminal = (job) => ['done', 'failed', 'cancelled'].includes(job.state);

  async function request(path, method = 'GET', body, signal) {
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', apikey: apiKey, 'Client-Agent': 'sushi-club:1.1.13:https://aihorde.net' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new ImageError('生图服务返回了非 JSON 响应，请稍后重试'); }
      if (!response.ok) {
        const messages = {
          400: '生图参数未被接受，请尝试较小尺寸或更简短的描述',
          401: '生图服务的密钥无效，请联系管理员检查配置',
          403: '当前任务未获生图服务许可，请尝试 512×512 或稍后重试',
          404: '生图任务已过期，请重新生成',
          429: '免费生图服务繁忙，请稍后重试',
        };
        const error = new ImageError(messages[response.status] || '生图服务暂时不可用，请稍后重试', response.status === 429 ? 429 : 502, 'UPSTREAM_' + response.status);
        error.upstreamStatus = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error instanceof ImageError) throw error;
      if (signal && signal.aborted) throw new ImageError('已取消生成', 409, 'CANCELLED');
      throw new ImageError('连接生图服务超时或失败，请稍后重试', 503, 'UPSTREAM_UNREACHABLE');
    }
  }

  function snapshot(job) {
    return {
      id: job.id, state: job.state, provider: 'horde',
      queuePosition: job.queuePosition, waitTimeSeconds: job.waitTimeSeconds,
      expiresAt: job.expiresAt,
      image: job.image || null,
      error: job.error || null,
    };
  }

  function ownJob(userId, id) {
    const job = jobs.get(id);
    if (!job || job.userId !== userId) throw new ImageError('任务不存在或已过期', 404, 'NOT_FOUND');
    return job;
  }

  async function finish(job, state, error) {
    if (terminal(job)) return;
    job.state = state;
    job.finishedAt = now();
    job.error = error || null;
    if (active.get(job.userId) === job.id) active.delete(job.userId);
    if (state === 'done' && job.reservation !== null) {
      await Promise.resolve(commit(job.reservation, job.userId));
    }
    if (state !== 'done' && job.reservation !== null) {
      await Promise.resolve(refund(job.reservation, job.userId));
      job.reservation = null;
    }
  }

  async function removeUpstream(job) {
    if (!job.upstreamId) return;
    try { await request('/generate/status/' + encodeURIComponent(job.upstreamId), 'DELETE'); } catch { /* local cancellation still completes */ }
  }

  function isRetryableSubmit(error) {
    if (!error) return false;
    if (error.code === 'CANCELLED') return false;
    const upstream = error.upstreamStatus || error.status;
    return upstream === 429 || upstream === 409 || upstream === 503 || error.code === 'UPSTREAM_UNREACHABLE';
  }

  async function create(userId, input) {
    const payload = generationPayload(input, options.model || '');
    if (active.has(userId)) {
      const prevId = active.get(userId);
      try { await cancel(userId, prevId); } catch { /* previous job may already be gone */ }
      // Horde anonymous keys keep the old slot for a beat after DELETE.
      try { await sleep(500); } catch { /* ignore */ }
    }
    if (jobs.size >= 100) {
      for (const [id, job] of jobs) if (terminal(job)) jobs.delete(id);
      if (jobs.size >= 100) throw new ImageError('当前生成任务较多，请稍后重试', 503, 'SERVER_BUSY');
    }
    // Only await when reserve is thenable so sync fixtures keep registering
    // the job in the same turn (cancel-during-submit race).
    let reservation = reserve(userId);
    if (reservation && typeof reservation.then === 'function') {
      reservation = await reservation;
    }
    const job = {
      id: randomUUID(), userId, state: 'submitting', reservation,
      expiresAt: now() + maxWaitMs, queuePosition: null, waitTimeSeconds: null,
      controller: new AbortController(), lastPoll: -Infinity,
    };
    jobs.set(job.id, job);
    active.set(userId, job.id);
    const submitDelays = [0, 700, 1400];
    let lastError;
    for (let attempt = 0; attempt < submitDelays.length; attempt += 1) {
      if (submitDelays[attempt]) {
        try { await sleep(submitDelays[attempt], job.controller.signal); } catch (error) {
          if (!terminal(job)) await finish(job, 'failed', error.message);
          throw error;
        }
      }
      try {
        const data = await request('/generate/async', 'POST', payload, job.controller.signal);
        if (typeof data.id !== 'string' || !data.id) throw new ImageError('生图服务没有返回任务编号');
        job.upstreamId = data.id;
        lastUpstreamId = data.id;
        if (terminal(job)) {
          await removeUpstream(job);
          return snapshot(job);
        }
        job.state = 'queued';
        return snapshot(job);
      } catch (error) {
        lastError = error;
        if (terminal(job) || !isRetryableSubmit(error) || attempt === submitDelays.length - 1) {
          if (!terminal(job)) await finish(job, 'failed', error.message);
          throw error;
        }
        if (lastUpstreamId) {
          try { await request('/generate/status/' + encodeURIComponent(lastUpstreamId), 'DELETE'); } catch { /* slot may already be free */ }
        }
      }
    }
    if (!terminal(job)) await finish(job, 'failed', (lastError && lastError.message) || '生图提交失败');
    throw lastError || new ImageError('生图提交失败');
  }

  async function refresh(job) {
    try {
      const check = await request('/generate/check/' + encodeURIComponent(job.upstreamId), 'GET', undefined, job.controller.signal);
      if (terminal(job)) return snapshot(job);
      job.lastPoll = now();
      if (check.faulted) throw new ImageError('生图任务失败，请重新尝试');
      if (!check.done && check.is_possible === false) throw new ImageError('当前没有可处理此任务的工作节点，请减小尺寸或稍后重试');
      job.queuePosition = Number.isFinite(check.queue_position) ? check.queue_position : null;
      job.waitTimeSeconds = Number.isFinite(check.wait_time) ? check.wait_time : null;
      job.state = check.processing > 0 ? 'processing' : 'queued';
      if (check.done) {
        const result = await request('/generate/status/' + encodeURIComponent(job.upstreamId), 'GET', undefined, job.controller.signal);
        if (terminal(job)) return snapshot(job);
        const image = Array.isArray(result.generations) && result.generations.find((item) => item && item.img && !item.censored);
        if (!image) throw new ImageError('任务结束但没有可显示的图片，请修改描述后重试');
        job.image = { url: imageSource(image.img), seed: String(image.seed ?? ''), model: String(image.model || '') };
        await finish(job, 'done');
      }
      return snapshot(job);
    } catch (error) {
      if (terminal(job)) return snapshot(job);
      if (error.code === 'UPSTREAM_UNREACHABLE' || error.upstreamStatus === 429 || error.upstreamStatus >= 500) throw error;
      await finish(job, 'failed', error.message);
      void removeUpstream(job);
      return snapshot(job);
    }
  }

  async function get(userId, id) {
    const job = ownJob(userId, id);
    if (!terminal(job) && now() >= job.expiresAt) {
      await finish(job, 'failed', '免费队列等待已超过 10 分钟，请稍后重试');
      job.controller.abort();
      void removeUpstream(job);
    }
    if (terminal(job) || job.state === 'submitting' || now() - job.lastPoll < 800) return snapshot(job);
    if (!job.polling) job.polling = refresh(job).finally(() => { job.polling = null; });
    return job.polling;
  }

  async function cancel(userId, id) {
    const job = ownJob(userId, id);
    if (!terminal(job)) {
      await finish(job, 'cancelled', '已取消生成');
      job.controller.abort();
      await removeUpstream(job);
    }
    return snapshot(job);
  }

  function current(userId) {
    const id = active.get(userId);
    return id ? snapshot(jobs.get(id)) : null;
  }

  async function sweep() {
    const work = [];
    for (const [id, job] of jobs) {
      if (!terminal(job) && now() >= job.expiresAt) work.push(get(job.userId, id));
      if (terminal(job) && now() - job.finishedAt > 30 * 60 * 1000) jobs.delete(id);
    }
    await Promise.allSettled(work);
  }

  return { create, get, cancel, current, sweep };
}

module.exports = { ImageError, imageSource, generationPayload, createImageService, HORDE_REAL_MODELS, HORDE_ANIME_MODELS, HORDE_IMG2IMG_REAL_MODELS, hordeModelsFor, sanitizeRealPrompt };
