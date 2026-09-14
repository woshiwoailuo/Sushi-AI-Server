'use strict';

/** Field order for compact English gen prompts (platform-friendly, not long NL). */
const STRUCTURE_FIELDS = [
  'subject',
  'pose',
  'clothing',
  'appearance',
  'scene',
  'camera',
  'lighting',
  'style',
  'extras',
];

const STRUCTURE_SYSTEM = [
  'You convert a user scene description into a compact STRUCTURED image prompt.',
  'Reply with ONLY one JSON object (no markdown fences) using these English keys:',
  '{"subject":"","pose":"","clothing":"","appearance":"","scene":"","camera":"","lighting":"","style":"","extras":""}',
  'Rules: FAITHFUL TO CORE — translate and slot ONLY facts present in the core; ACTION-FIRST order: put concrete verbs/actions and key props in pose/subject before filler style; include every explicitly described clothing, prop, pose, scene, action, lighting, and count — omit none (e.g. 翻炒→stir-frying/tossing food in wok mid-motion; 蒸汽升腾→visible rising steam/vapor; 不锈钢锅→stainless steel wok with specular highlights; 围裙/食材→apron + ingredients clearly visible); when core says 纪实/写实/抓拍 amplify documentary candid photojournalistic photoreal language; prefer completeness of core facts over filler style words; do NOT invent clothing, props, pose, identity, gender, background, or setting absent from the core; empty string if unknown;',
  'fictional consenting adults 18+ only; no minors; keep adult/NSFW details if the user asked; do NOT invent nudity, undressing, revealing outfits, lingerie, cleavage, skimpy clothes, seductive posing, or remove clothing unless the core explicitly describes nude/naked/unclothed/全裸/裸体/暴露/性感;',
  'do NOT invent woman, female, girl, beautiful woman, breasts, feminine body, or gendered identity unless the core explicitly states female gender (女人/女性/woman/female/girl); if the core explicitly states male gender (男人/男性/男主/帅哥/大叔/男孩/male/man/him/he as person), subject MUST lead with adult man / male / masculine and MUST NOT be woman/girl/female/she/her/breasts; if gender is unspecified use gender-neutral subject (person/adult/figure) with NO woman/sexy female default; do NOT invent revealing outfits, lingerie, cleavage, nude, or extra people unless explicitly in the core;',
  'prefer photoreal photography wording unless the user explicitly asked for anime/manga/illustration;',
  'PRESERVE ethnicity/race/nationality from the core literally in appearance (e.g. East Asian, Chinese, Korean, Japanese, East Asian facial features);',
  'NEVER invent blonde, caucasian, european, blue eyes, or Western/European beauty defaults unless the user asked;',
  'if core asks full body / 全身 / head-to-toe / feet in frame, put full-body framing in pose (head and feet both visible, uncropped standing full figure, space above head and below feet) and use wide/28mm FOV camera — never half-body, waist crop, or close-up portrait crop;',
  'keep each value short (under 40 words); empty string if unknown; do not invent a celebrity.',
  'if img2img LOCAL EDIT (short pose/hand/expression/clothing tweak on a reference image), fill pose with only that change; extras must keep identity/background/composition/clothing unchanged; do not invent a new scene.',
].join(' ');

/** Outbound lead: models must prioritize core facts over style/filler packs. Visible 核心描述 is never rewritten. */
const CORE_FIDELITY_LEAD =
  'Faithful to core description: depict only what the core states; include every explicitly described element (clothing, props, pose, scene, actions, counts) and omit none; prefer completeness of core facts over filler style words; lead with described actions then subject props lighting camera before generic fillers; do not invent clothing, props, pose, identity, gender, revealing outfits, extra people, or setting not in the core; when gender is unspecified stay gender-neutral with no woman default; lead with core facts';

function applyCoreFidelityLead(prompt) {
  let text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return text;
  if (/faithful to core description/i.test(text)) return text;
  return (CORE_FIDELITY_LEAD + ', ' + text).replace(/\s{2,}/g, ' ').trim();
}

/** Outbound-only lock for img2img local edits. Visible 核心描述 is never rewritten. */
const LOCAL_EDIT_KEEP_REST =
  'Keep the same person identity, face, hairstyle, body proportions, clothing, accessories, background, and lighting as the reference image; do NOT invent a new person or background; the stated local change must stay clearly visible while preserving likeness';

/** Shorter lock for pose/gesture: avoid camera/crop/framing freezes that fight limb changes. */
const LOCAL_EDIT_KEEP_REST_POSE =
  'Keep the same person identity, face, hairstyle, clothing, and background as the reference; allow pose/gesture/limbs to change as stated; do not invent a new person or background';

const POSE_GESTURE_RE =
  /抬起|举起|放下|伸手|举手|挥手|叉腰|转头|回头|侧头|低头|抬头|扭头|侧过脸|抬手|站姿|raise(?:s|d|ing)?\s+(?:(?:the|her|his|their)\s+)?(?:left\s+|right\s+)?(?:hand|arm)|lower(?:s|ed|ing)?\s+(?:(?:the|her|his|their)\s+)?(?:left\s+|right\s+)?(?:hand|arm)|turn(?:s|ed|ing)?\s+(?:(?:the)\s+)?head|look(?:s|ing)?\s+(?:left|right|away)|wave(?:s|d|ing)?\b|hands?\s+on\s+(?:hips|waist)|arms?\s+(?:crossed|raised|up|out)/i;

function isPoseGestureEdit(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return POSE_GESTURE_RE.test(t);
}

function localEditChangeDirective(core) {
  const t = String(core || '').replace(/\s+/g, ' ').trim();
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
  let text = String(promptEn || '').replace(/\s+/g, ' ').trim();
  const pose = isPoseGestureEdit(core || text);
  const change = localEditChangeDirective(core || text);
  const keep = pose ? LOCAL_EDIT_KEEP_REST_POSE : LOCAL_EDIT_KEEP_REST;
  // Pose: strip long composition locks that fight limb changes, then (re)prefix CRITICAL EDIT.
  if (pose) {
    text = text
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
  } else if (/CRITICAL EDIT \(must be clearly visible\)|keep the (?:EXACT )?same person identity|the stated local change must stay clearly visible|apply ONLY the stated local change|do not (?:redraw|recompose)/i.test(text)) {
    return text;
  }
  if (/CRITICAL EDIT \(must be clearly visible\)/i.test(text)) {
    // Already has directive; still append pose-friendly keep-rest if missing.
    if (pose && !/allow pose\/gesture\/limbs to change/i.test(text)) {
      return (text + ', ' + keep).replace(/\s{2,}/g, ' ').trim();
    }
    return text;
  }
  return (change + (text ? ', ' + text : '') + ', ' + keep).replace(/\s{2,}/g, ' ').trim();
}

function preferLocalEditStrength(current, core) {
  const n = Number(current);
  const base = Number.isFinite(n) && n > 0 ? n : 0.6;
  const coreText = String(core || '').replace(/\s+/g, ' ').trim();
  if (isPoseGestureEdit(coreText)) {
    // Pose/gesture needs stronger denoising so raised-hand etc. are visible (0.55–0.65).
    const floor = 0.55;
    const cap = 0.65;
    if (base > cap) return cap;
    if (base < floor) return floor;
    return base;
  }
  // Tiny color / expression tweaks stay lower.
  const shortEdit = coreText.length > 0 && coreText.length <= 48;
  const floor = 0.2;
  const cap = shortEdit ? 0.22 : 0.28;
  if (base > cap) return cap;
  if (base < floor) return floor;
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
  const cookAction = /翻炒|颠勺|炒菜|stir[\s-]?fry|wok[\s-]?toss/i.test(cleaned);
  const cookSteam = /蒸汽升腾|冒着?蒸汽|热气腾腾|steam\s+ris|rising\s+steam/i.test(cleaned);
  const cookKitchen = /厨房|kitchen/i.test(cleaned);
  const docuCue = /纪实|抓拍|documentary|candid|photojournal/i.test(cleaned);
  const poseBits = [];
  if (cookAction) poseBits.push('stir-frying tossing food in wok mid-motion');
  if (cookSteam) poseBits.push('visible rising steam vapor');
  if (/运动感|略带运动|motion/i.test(cleaned)) poseBits.push('slight motion blur hint from cooking action');
  if (wantFull) {
    poseBits.push(wantAnime
      ? 'full body standing, entire figure visible, head and feet in frame'
      : 'full body front view, head-to-toe, feet in frame, head and feet both visible, uncropped standing full figure, not cropped');
  }
  const clothingBits = [];
  if (/围裙|apron/i.test(cleaned)) clothingBits.push('apron clearly visible');
  if (/不锈钢锅|炒锅|锅具|stainless|wok/i.test(cleaned)) clothingBits.push('stainless steel wok with specular highlights');
  if (/食材|ingredients/i.test(cleaned)) clothingBits.push('ingredients and food details clearly visible');
  const fields = {
    subject: localEdit ? 'same person as the reference image' : cleaned.slice(0, 220),
    appearance: eastAsian
      ? 'East Asian, East Asian facial features, distinctly East Asian appearance'
      : (localEdit ? 'same face, same hair, same identity as the reference image' : ''),
    clothing: localEdit ? 'same clothing as the reference image' : clothingBits.join(', '),
    pose: localEdit
      ? (isPoseGestureEdit(cleaned) ? localEditChangeDirective(cleaned) : cleaned.slice(0, 220))
      : poseBits.join(', '),
    scene: localEdit ? 'same background and composition as the reference image' : (cookKitchen ? 'kitchen' : ''),
    camera: localEdit
      ? 'same camera angle and crop as the reference image'
      : (wantAnime ? '' : (wantFull ? 'eye-level, 28mm wide FOV full-body framing, vertical portrait composition' : 'eye-level, 50mm')),
    lighting: wantAnime ? '' : (/顶灯|窗光|overhead|window light/i.test(cleaned) && cookKitchen
      ? 'mixed overhead and window light'
      : 'natural light'),
    style: wantAnime
      ? 'anime illustration'
      : (docuCue
        ? 'documentary candid photojournalistic photorealistic RAW photo, DSLR'
        : 'photorealistic RAW photo, DSLR'),
    extras: (localEdit ? ((isPoseGestureEdit(cleaned) ? LOCAL_EDIT_KEEP_REST_POSE : LOCAL_EDIT_KEEP_REST) + ', ') : '') + 'fictional adult 18+ only, no minors; faithful to core, include all described elements, omit none, do not invent gender, woman, revealing outfits, or clothing absent from core',
  };
  const promptEn = applyCoreFidelityLead(assembleStructuredPrompt(fields));
  return { fields, promptEn };
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
    { role: 'user', content: 'Core description (source of truth; translate faithfully; include ALL explicitly described clothing, props, pose, scene, actions, counts — omit none; do not invent gender/woman/female/revealing/lingerie/cleavage unless stated; if core is male lead with adult man/male/masculine and never woman; if gender omitted stay gender-neutral with no sexy female default; do not invent or contradict):\n' + coreText },
  ];
}

module.exports = {
  STRUCTURE_FIELDS,
  STRUCTURE_SYSTEM,
  CORE_FIDELITY_LEAD,
  LOCAL_EDIT_KEEP_REST,
  LOCAL_EDIT_KEEP_REST_POSE,
  parseStructureJson,
  assembleStructuredPrompt,
  heuristicStructureFromText,
  buildStructureMessages,
  isLocalEditCore,
  isPoseGestureEdit,
  localEditChangeDirective,
  applyLocalEditOutbound,
  preferLocalEditStrength,
  applyCoreFidelityLead,
};
