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
  'PRESERVE ethnicity/race/nationality from the core literally in appearance (e.g. East Asian, Chinese, Korean, Japanese, East Asian facial features);',
  'NEVER invent blonde, caucasian, european, blue eyes, or Western/European beauty defaults unless the user asked;',
  'if core asks full body / 全身 / head-to-toe / feet in frame, put full-body framing in pose (head and feet both visible, uncropped standing full figure, space above head and below feet) and use wide/28mm FOV camera — never half-body, waist crop, or close-up portrait crop;',
  'keep each value short (under 40 words); empty string if unknown; do not invent a celebrity.',
  'if img2img LOCAL EDIT (short pose/hand/expression/clothing tweak on a reference image), fill pose with only that change; extras must keep identity/background/composition/clothing unchanged; do not invent a new scene.',
].join(' ');

/** Outbound-only lock for img2img local edits. Visible 核心描述 is never rewritten. */
const LOCAL_EDIT_KEEP_REST =
  'Keep the EXACT same person identity, face, hairstyle, body proportions, clothing, accessories, background, lighting, camera angle, crop, framing, and composition as the reference image, do NOT redraw, recompose, restyle, or invent a new scene, apply ONLY the stated local change, leave every other region unchanged, high fidelity lock to the reference photo';

function isLocalEditCore(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/换背景|改背景|更换背景|只换背景|纯背景|change (?:the )?background|replace (?:the )?background|new scene|全新场景|重画整|整张重绘|redraw (?:the )?(?:whole |entire )?scene|from scratch/i.test(t)) {
    return false;
  }
  const keepCue = /图中|图里|图上|参考图|原图中|保持|只|仅仅|仅将|仅把|不要改|别改|其余不变|其他不变|in the (?:image|picture|photo)|from the reference|keep (?:the )?(?:rest|same|identity|everything)|only (?:change|edit|raise|turn|smile)/i.test(t);
  const strongAction = /抬起|举起|放下|伸手|举手|挥手|叉腰|转头|回头|侧头|低头|抬头|扭头|侧过脸|微笑|浅笑|闭眼|睁眼|眨眼|张嘴|闭嘴|raise(?:s|d)? (?:(?:the |her |his |their )?(?:left |right )?)?(?:hand|arm)|turn(?:s|ed|ing)? (?:(?:the )?head)|smil(?:e|ing)\b|frown|wink|look(?:s|ing)? (?:left|right|away)|change(?:s|d)? (?:(?:the |her |his )?hair colou?r)|slightly (?:change|adjust)/i.test(t);
  const mildAction = /换发型|染发|发色|头发颜色|换一件|换衣服|改发型|改发色|hair colou?r|clothing tweak|\bpose\b/i.test(t);
  const compact = t.length <= 96;
  if (strongAction && (compact || keepCue)) return true;
  if (keepCue && mildAction && (compact || t.length <= 180)) return true;
  return false;
}

function applyLocalEditOutbound(promptEn, core, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const hasRef = !!(opts.img2img || opts.hasSourceImage);
  if (!hasRef) return String(promptEn || '');
  if (!opts.force && !isLocalEditCore(core || promptEn)) return String(promptEn || '');
  const text = String(promptEn || '').replace(/\s+/g, ' ').trim();
  if (/keep the (?:EXACT )?same person identity|apply ONLY the stated local change|do not (?:redraw|recompose)/i.test(text)) {
    return text;
  }
  return (LOCAL_EDIT_KEEP_REST + (text ? ', ' + text : '')).replace(/\s{2,}/g, ' ').trim();
}

function preferLocalEditStrength(current, core) {
  const n = Number(current);
  const base = Number.isFinite(n) && n > 0 ? n : 0.45;
  const shortEdit = String(core || '').trim().length > 0 && String(core || '').trim().length <= 48;
  const cap = shortEdit ? 0.22 : 0.26;
  if (base > cap) return cap;
  return base;
}

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
  const eastAsian = /东亚|亚洲人|中国人|韩国人|日本人|华人|east[\s-]?asian|\bchinese\b|\bkorean\b|\bjapanese\b|asian (?:woman|man|features|face)/i.test(cleaned);
  const wantFull = /full[\s-]?body|全身|head to toe|feet in (?:the )?frame|从头到脚/i.test(cleaned);
  const localEdit = options.img2img === true && isLocalEditCore(cleaned);
  const fields = {
    subject: localEdit ? 'same person as the reference image' : cleaned.slice(0, 220),
    appearance: eastAsian
      ? 'East Asian, East Asian facial features, distinctly East Asian appearance'
      : (localEdit ? 'same face, same hair, same identity as the reference image' : ''),
    clothing: localEdit ? 'same clothing as the reference image' : '',
    pose: localEdit
      ? cleaned.slice(0, 220)
      : (wantFull
        ? (wantAnime ? 'full body standing, entire figure visible, head and feet in frame' : 'full body front view, head-to-toe, feet in frame, head and feet both visible, uncropped standing full figure, not cropped')
        : ''),
    scene: localEdit ? 'same background and composition as the reference image' : '',
    camera: localEdit
      ? 'same camera angle and crop as the reference image'
      : (wantAnime ? '' : (wantFull ? 'eye-level, 28mm wide FOV full-body framing, vertical portrait composition' : 'eye-level, 50mm')),
    lighting: wantAnime ? '' : 'natural light',
    style: wantAnime
      ? 'anime illustration'
      : 'photorealistic RAW photo, DSLR',
    extras: (localEdit ? LOCAL_EDIT_KEEP_REST + ', ' : '') + 'fictional adult 18+ only, no minors',
  };
  return { fields, promptEn: assembleStructuredPrompt(fields) };
}

function buildStructureMessages(core, options = {}) {
  const coreText = String(core || '').trim().slice(0, 2000);
  const styleHint = options.anime
    ? 'User wants anime/manga illustration style.'
    : 'User wants photoreal photography unless they explicitly asked otherwise.';
  const localHint = options.img2img && isLocalEditCore(coreText)
    ? ' This is img2img LOCAL EDIT: fill pose with only the requested local change (raise hand, turn head, smile, slight hair/clothing tweak); extras must keep identity/background/composition/clothing unchanged; appearance/clothing/scene/camera = same as reference; do NOT invent a new scene or redraw the whole image.'
    : '';
  return [
    { role: 'system', content: STRUCTURE_SYSTEM + ' ' + styleHint + localHint },
    { role: 'user', content: 'Core description (source of truth, do not contradict):\n' + coreText },
  ];
}

module.exports = {
  STRUCTURE_FIELDS,
  STRUCTURE_SYSTEM,
  LOCAL_EDIT_KEEP_REST,
  parseStructureJson,
  assembleStructuredPrompt,
  heuristicStructureFromText,
  buildStructureMessages,
  isLocalEditCore,
  applyLocalEditOutbound,
  preferLocalEditStrength,
};
