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
    (payload && (payload.output_text || payload.response || payload.content))
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
  if (m === 'deepseek') return 'DeepSeek 尚未配置，请改用其他对话通道或稍后重试';
  return '对话通道尚未配置，请改用其他对话通道或稍后重试';
}

module.exports = { contentText, collapseRepeatedText, normalizeChatPayload, normalizeChatModel, missingChatApiKeyMessage };
