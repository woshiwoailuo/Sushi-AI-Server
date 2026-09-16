'use strict';

function contentText(value) {
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        return part.text || part.content || '';
      })
      .join('')
      .trim();
  }
  return value == null ? '' : String(value).trim();
}

function chatError(message) {
  return Object.assign(new Error(message), { status: 502 });
}

/** Collapse consecutive duplicate sentences / lines / whole-string repeats. Keep short replies intact. */
function collapseRepeatedText(raw) {
  let text = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim();
  if (!text) return text;

  // Whole-string doubled / tripled (e.g. "你好。你好。" or three identical blocks).
  for (let guard = 0; guard < 6; guard += 1) {
    let changed = false;
    if (text.length >= 12) {
      const half = Math.floor(text.length / 2);
      const a = text.slice(0, half).trim();
      const b = text.slice(half).trim();
      if (a.length >= 6 && a === b) {
        text = a;
        changed = true;
      }
    }
    if (!changed && text.length >= 18) {
      const third = Math.floor(text.length / 3);
      const a = text.slice(0, third).trim();
      const b = text.slice(third, third * 2).trim();
      const c = text.slice(third * 2).trim();
      if (a.length >= 6 && a === b && b === c) {
        text = a;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Consecutive duplicate lines (ignore blank lines between equals).
  const lines = text.split('\n');
  const lineOut = [];
  let prevLineKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const key = line.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) {
      lineOut.push(line);
      continue;
    }
    if (key === prevLineKey) continue;
    lineOut.push(line);
    prevLineKey = key;
  }
  text = lineOut.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Consecutive duplicate sentences (Chinese / Latin punctuation).
  const pieces = text.match(/[^。！？.!?]+[。！？.!?]*|\n+/g);
  if (!pieces) return text;
  const out = [];
  let prevKey = null;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    if (/^\n+$/.test(piece)) {
      out.push(piece);
      continue;
    }
    const key = piece.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) {
      out.push(piece);
      continue;
    }
    if (key === prevKey) continue;
    out.push(piece);
    prevKey = key;
  }
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function geminiPartsText(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (part.thought) return '';
      return part.text || '';
    })
    .join('')
    .trim();
}

function geminiTextFromPayload(payload) {
  const feedback = payload && payload.promptFeedback;
  const block = feedback && feedback.blockReason;
  if (block && String(block).toUpperCase() !== 'BLOCK_REASON_UNSPECIFIED') {
    throw chatError('Gemini 安全策略拦截：' + block);
  }
  const cand = payload && Array.isArray(payload.candidates) ? payload.candidates[0] : null;
  if (!cand) return '';
  const reason = String(cand.finishReason || '').toUpperCase();
  const text = geminiPartsText(cand.content && cand.content.parts);
  if (!text && (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'PROHIBITED_CONTENT')) {
    throw chatError('Gemini 未返回文本（' + reason + '）');
  }
  return text;
}

/** Convert OpenAI-style messages to Gemini generateContent body. */
function buildGeminiRequest(messages) {
  const systemParts = [];
  const contents = [];
  for (const item of Array.isArray(messages) ? messages : []) {
    if (!item || item.content == null) continue;
    const text = String(item.content).slice(0, 6000).trim();
    if (!text) continue;
    const roleRaw = String(item.role || 'user').toLowerCase();
    if (roleRaw === 'system') {
      systemParts.push(text);
      continue;
    }
    const role = roleRaw === 'assistant' || roleRaw === 'model' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += '\n' + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  if (contents.length && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '请继续。' }] });
  }
  if (!contents.length) {
    contents.push({ role: 'user', parts: [{ text: '你好' }] });
  }
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join('\n').slice(0, 4000) }] };
  }
  return body;
}

function normalizeChatPayload(raw, model) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) throw chatError('上游返回空回复');

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return openaiStyleChat(text, model);
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const message = choice && choice.message;
  const content = contentText(
    (message && (message.content || message.reasoning_content)) ||
    (payload && (payload.output_text || payload.response || payload.content)) ||
    geminiTextFromPayload(payload)
  );
  if (!content) throw chatError('上游返回空回复');
  return openaiStyleChat(content, (payload && payload.model) || model);
}

function openaiStyleChat(content, model) {
  const cleaned = collapseRepeatedText(content);
  return {
    id: 'sushi-chat-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'openai',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: String(cleaned || '').trim() },
      finish_reason: 'stop',
    }],
  };
}

function normalizeChatModel(raw) {
  const model = String(raw || 'openai').trim().toLowerCase();
  if (model === 'deepseek') return 'deepseek';
  if (model === 'grok' || model === 'xai' || model === 'x-ai') return 'grok';
  if (model === 'groq' || model === 'groqcloud' || model === 'groq-cloud') return 'groq';
  if (model === 'gemini' || model === 'google' || model === 'google-gemini') return 'gemini';
  if (model === 'openrouter' || model === 'open-router') return 'openrouter';
  if (model === 'glm' || model === 'zhipu' || model === 'zhipuai' || model === 'chatglm' || model === 'zai' || model === 'z-ai' || model === 'z.ai') return 'glm';
  if (model === 'horde' || model === 'aihorde' || model === 'ai-horde') return 'horde';
  // Pollinations legacy ids: turbo is gone; openai-fast often 402s while alias "openai" still works anonymously.
  if (model === 'turbo' || model === 'openai-fast' || model === 'fast' || model === 'openai' || model === 'gpt-oss') {
    return 'openai';
  }
  return model;
}

/** Clear 503 copy when a keyed chat platform is selected but env is empty. */
function missingChatApiKeyMessage(model) {
  const m = normalizeChatModel(model);
  if (m === 'groq') return 'Groq 尚未配置（未设置 GROQ_API_KEY），请改用其他对话通道或稍后重试';
  if (m === 'grok') return 'Grok 尚未配置（未设置 XAI_API_KEY），请改用其他对话通道或稍后重试';
  if (m === 'deepseek') return 'DeepSeek 尚未配置（未设置 DEEPSEEK_API_KEY），请改用其他对话通道或稍后重试';
  if (m === 'gemini') return 'Gemini 尚未配置（未设置 GEMINI_API_KEY），请改用其他对话通道或稍后重试';
  if (m === 'openrouter') return 'OpenRouter 尚未配置（未设置 OPENROUTER_API_KEY），请改用其他对话通道或稍后重试';
  if (m === 'glm') return 'GLM 尚未配置（未设置 GLM_API_KEY），请改用其他对话通道或稍后重试';
  return '对话通道尚未配置，请改用其他对话通道或稍后重试';
}

function chatChannelLabel(model) {
  const m = normalizeChatModel(model);
  if (m === 'deepseek') return 'DeepSeek';
  if (m === 'grok') return 'Grok';
  if (m === 'groq') return 'Groq';
  if (m === 'gemini') return 'Gemini';
  if (m === 'openrouter') return 'OpenRouter';
  if (m === 'glm') return 'GLM';
  if (m === 'horde') return 'Horde';
  return '快速对话';
}

function configuredChatChannels(env) {
  const e = env || {};
  return {
    groq: Boolean(String(e.GROQ_API_KEY || '').trim()),
    gemini: Boolean(String(e.GEMINI_API_KEY || '').trim()),
    openrouter: Boolean(String(e.OPENROUTER_API_KEY || '').trim()),
    deepseek: Boolean(String(e.DEEPSEEK_API_KEY || '').trim()),
    glm: Boolean(String(e.GLM_API_KEY || e.ZHIPUAI_API_KEY || e.ZAI_API_KEY || e.ZHIPU_API_KEY || '').trim()),
    grok: Boolean(String(e.XAI_API_KEY || e.GROK_API_KEY || '').trim()),
    horde: true,
  };
}

/** Auto-race never includes Grok (needs a paid/configured key and 503s otherwise). */
function autoRaceModels(channels) {
  const c = channels || {};
  const models = [];
  if (c.glm) models.push('glm');
  if (c.deepseek) models.push('deepseek');
  if (c.groq) models.push('groq');
  if (c.gemini) models.push('gemini');
  if (c.openrouter) models.push('openrouter');
  models.push('horde');
  return models;
}

function buildKeyedChatRequest(model, messages, cfg) {
  const conf = cfg || {};
  if (model === 'gemini') {
    return {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/'
        + encodeURIComponent(conf.geminiModel || 'gemini-2.5-flash-lite')
        + ':generateContent',
      headers: { 'x-goog-api-key': conf.geminiKey || '' },
      body: buildGeminiRequest(messages),
    };
  }
  if (model === 'openrouter') {
    return {
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        Authorization: 'Bearer ' + (conf.openrouterKey || ''),
        'HTTP-Referer': 'https://sushi-ai-server.vercel.app',
        'X-Title': 'Sushi AI',
      },
      body: {
        model: conf.openrouterModel || 'openrouter/free',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      },
    };
  }
  if (model === 'groq') {
    return {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { Authorization: 'Bearer ' + (conf.groqKey || '') },
      body: {
        model: conf.groqModel || 'openai/gpt-oss-20b',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      },
    };
  }
  if (model === 'grok') {
    return {
      endpoint: 'https://api.x.ai/v1/chat/completions',
      headers: { Authorization: 'Bearer ' + (conf.xaiKey || '') },
      body: {
        model: conf.grokModel || 'grok-4-fast',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      },
    };
  }
  if (model === 'deepseek') {
    return {
      endpoint: 'https://api.deepseek.com/chat/completions',
      headers: { Authorization: 'Bearer ' + (conf.deepseekKey || '') },
      body: {
        model: conf.deepseekModel || 'deepseek-v4-flash',
        messages,
        max_tokens: 800,
        temperature: 0.7,
        thinking: { type: 'disabled' },
      },
    };
  }
  if (model === 'glm') {
    const base = String(conf.glmBase || 'https://open.bigmodel.cn/api/paas/v4/chat/completions').trim()
      || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    return {
      endpoint: base,
      headers: { Authorization: 'Bearer ' + (conf.glmKey || '') },
      body: {
        model: conf.glmModel || 'glm-4.7-flash',
        messages,
        max_tokens: 800,
        temperature: 0.7,
      },
    };
  }
  return {
    endpoint: 'https://text.pollinations.ai/openai',
    headers: {},
    body: { model: 'openai', messages },
  };
}

module.exports = {
  contentText,
  collapseRepeatedText,
  normalizeChatPayload,
  normalizeChatModel,
  missingChatApiKeyMessage,
  chatChannelLabel,
  configuredChatChannels,
  autoRaceModels,
  buildGeminiRequest,
  geminiTextFromPayload,
  buildKeyedChatRequest,
};
