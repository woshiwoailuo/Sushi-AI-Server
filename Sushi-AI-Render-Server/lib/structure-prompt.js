'use strict';

/** Field order for compact English gen prompts (platform-friendly, not long NL). */
const STRUCTURE_FIELDS = [
  'subject',
  'appearance',
  'clothing',
  'pose',
  'scene',
  'camera',
  'lighting',
  'style',
  'extras',
];

const STRUCTURE_SYSTEM = [
  'You convert a user scene description into a compact STRUCTURED image prompt.',
  'Reply with ONLY one JSON object (no markdown fences) using these English keys:',
  '{"subject":"","appearance":"","clothing":"","pose":"","scene":"","camera":"","lighting":"","style":"","extras":""}',
  'Rules: fictional consenting adults 18+ only; no minors; keep adult/NSFW details if the user asked;',
  'prefer photoreal photography wording unless the user explicitly asked for anime/manga/illustration;',
  'keep each value short (under 40 words); empty string if unknown; do not invent a celebrity.',
].join(' ');

function parseStructureJson(text) {
  const raw = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('结构化提示词未返回 JSON');
  const data = JSON.parse(raw.slice(start, end + 1));
  if (!data || typeof data !== 'object') throw new Error('结构化提示词无效');
  const fields = {};
  for (const key of STRUCTURE_FIELDS) {
    const v = data[key];
    fields[key] = v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  return fields;
}

function assembleStructuredPrompt(fields, options = {}) {
  const parts = [];
  const src = fields && typeof fields === 'object' ? fields : {};
  for (const key of STRUCTURE_FIELDS) {
    const v = String(src[key] || '').trim();
    if (v) parts.push(v);
  }
  let prompt = parts.join(', ').replace(/\s{2,}/g, ' ').replace(/[，,]{2,}/g, ',').trim();
  if (!prompt) return '';
  const maxLen = Number(options.maxLen) > 0 ? Number(options.maxLen) : 1400;
  if (prompt.length > maxLen) prompt = prompt.slice(0, maxLen).replace(/[,，\s]+$/g, '');
  return prompt;
}

/** Local fallback when chat is unavailable: squeeze long natural language into tagged slots. */
function heuristicStructureFromText(text, options = {}) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { fields: {}, promptEn: '' };
  const wantAnime = options.anime === true
    || /anime|manga|cartoon|二次元|动漫|卡通|漫画|插画/i.test(cleaned);
  const fields = {
    subject: cleaned.slice(0, 220),
    appearance: '',
    clothing: '',
    pose: /full[\s-]?body|全身|head to toe|feet in (?:the )?frame/i.test(cleaned)
      ? (wantAnime ? 'full body standing' : 'full body front view, head-to-toe, feet in frame')
      : '',
    scene: '',
    camera: wantAnime ? '' : 'eye-level, 50mm',
    lighting: wantAnime ? '' : 'natural light',
    style: wantAnime
      ? 'anime illustration'
      : 'photorealistic RAW photo, DSLR',
    extras: 'fictional adult 18+ only, no minors',
  };
  return { fields, promptEn: assembleStructuredPrompt(fields) };
}

function buildStructureMessages(core, options = {}) {
  const coreText = String(core || '').trim().slice(0, 2000);
  const styleHint = options.anime
    ? 'User wants anime/manga illustration style.'
    : 'User wants photoreal photography unless they explicitly asked otherwise.';
  return [
    { role: 'system', content: STRUCTURE_SYSTEM + ' ' + styleHint },
    { role: 'user', content: 'Core description (source of truth, do not contradict):\n' + coreText },
  ];
}

module.exports = {
  STRUCTURE_FIELDS,
  STRUCTURE_SYSTEM,
  parseStructureJson,
  assembleStructuredPrompt,
  heuristicStructureFromText,
  buildStructureMessages,
};
