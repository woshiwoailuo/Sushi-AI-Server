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
  return {
    id: 'sushi-chat-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'openai',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: String(content).trim() },
      finish_reason: 'stop',
    }],
  };
}

module.exports = { contentText, normalizeChatPayload };
