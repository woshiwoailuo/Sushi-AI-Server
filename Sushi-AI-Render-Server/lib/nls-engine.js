var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../tmp/nls-entry.ts
var nls_entry_exports = {};
__export(nls_entry_exports, {
  CATEGORIES: () => CATEGORIES,
  QUESTIONS: () => QUESTIONS,
  beijingDate: () => beijingDate,
  beijingMsToNextMidnight: () => beijingMsToNextMidnight,
  evaluate: () => evaluate,
  matchFill: () => matchFill,
  nicknameFor: () => nicknameFor,
  optionSeedFor: () => optionSeedFor,
  pickDaily: () => pickDaily,
  pickPractice: () => pickPractice,
  pickSet: () => pickSet,
  publicize: () => publicize,
  roomCode: () => roomCode,
  shuffle: () => shuffle,
  weightOf: () => weightOf
});
module.exports = __toCommonJS(nls_entry_exports);

// src/lib/brain/meta.ts
var CATEGORIES = ["\u6570\u5B57\u89C4\u5F8B", "\u56FE\u5F62\u63A8\u7406", "\u8BED\u8A00\u7C7B\u6BD4", "\u903B\u8F91\u5224\u65AD", "\u7A7A\u95F4\u65B9\u5411"];
function beijingDate(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1e3).toISOString().slice(0, 10);
}
function beijingMsToNextMidnight(now = Date.now()) {
  const day = beijingDate(now);
  const next = Date.parse(day + "T00:00:00+08:00") + 24 * 3600 * 1e3;
  return Math.max(0, next - now);
}
function nicknameFor(guestId) {
  const hex = guestId.replace(/-/g, "").slice(-6).toUpperCase();
  return "\u73A9\u5BB6" + (hex || "000000");
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function shuffle(arr, seed) {
  const a = [...arr];
  let n = seed >>> 0;
  const rand = () => {
    n = n + 1831565813 | 0;
    let t = Math.imul(n ^ n >>> 15, 1 | n);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

// src/lib/brain/questions.ts
var QUESTIONS = [
  {
    "id": 0,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6309\u7167\u76F8\u90BB\u9879\u7684\u53D8\u5316\u89C4\u5F8B\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "2\uFF0C5\uFF0C8\uFF0C11\uFF0C\uFF1F",
    "options": [
      "15",
      "13",
      "16",
      "14"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "14",
    "explanation": "\u6BCF\u6B21\u589E\u52A0 3\uFF0C\u56E0\u6B64 11 + 3 = 14\u3002",
    "aliases": []
  },
  {
    "id": 1,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6309\u7167\u76F8\u90BB\u9879\u7684\u53D8\u5316\u89C4\u5F8B\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "3\uFF0C6\uFF0C12\uFF0C24\uFF0C\uFF1F",
    "options": [
      "42",
      "36",
      "48",
      "54"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "48",
    "explanation": "\u6BCF\u4E00\u9879\u662F\u524D\u4E00\u9879\u7684 2 \u500D\u3002",
    "aliases": []
  },
  {
    "id": 2,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u76F8\u90BB\u4E24\u9879\u7684\u5DEE\u4F9D\u6B21\u589E\u52A0 2\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "1\uFF0C4\uFF0C9\uFF0C16\uFF0C\uFF1F",
    "options": [
      "26",
      "32",
      "24",
      "25"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "25",
    "explanation": "\u76F8\u90BB\u5DEE\u4E3A 3\u30015\u30017\uFF0C\u63A5\u4E0B\u6765\u662F 9\uFF0C16 + 9 = 25\u3002",
    "aliases": []
  },
  {
    "id": 3,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6BCF\u9879\u662F\u524D\u4E24\u9879\u4E4B\u548C\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "2\uFF0C3\uFF0C5\uFF0C8\uFF0C13\uFF0C\uFF1F",
    "options": [
      "21",
      "20",
      "23",
      "18"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "21",
    "explanation": "8 + 13 = 21\u3002",
    "aliases": []
  },
  {
    "id": 4,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6309\u4EA4\u66FF\u8FD0\u7B97\u7684\u89C4\u5F8B\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "2\uFF0C4\uFF0C5\uFF0C10\uFF0C11\uFF0C\uFF1F",
    "options": [
      "22",
      "12",
      "21",
      "24"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "22",
    "explanation": "\u8FD0\u7B97\u4EA4\u66FF\u4E3A\u4E58 2\u3001\u52A0 1\uFF0C\u63A5\u4E0B\u6765 11 \xD7 2 = 22\u3002",
    "aliases": []
  },
  {
    "id": 5,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u76F8\u90BB\u4E24\u9879\u7684\u5DEE\u4F9D\u6B21\u7FFB\u500D\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "1\uFF0C3\uFF0C7\uFF0C15\uFF0C\uFF1F",
    "options": [
      "31",
      "32",
      "30",
      "29"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "31",
    "explanation": "\u5DEE\u4E3A 2\u30014\u30018\uFF0C\u63A5\u4E0B\u6765\u662F 16\uFF0C15 + 16 = 31\u3002",
    "aliases": []
  },
  {
    "id": 6,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u5947\u6570\u4F4D\u7F6E\u548C\u5076\u6570\u4F4D\u7F6E\u5206\u522B\u6210\u89C4\u5F8B\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "1\uFF0C10\uFF0C2\uFF0C20\uFF0C3\uFF0C\uFF1F",
    "options": [
      "30",
      "40",
      "4",
      "25"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "30",
    "explanation": "\u5947\u6570\u4F4D\u7F6E\u4E3A 1\u30012\u30013\uFF0C\u5076\u6570\u4F4D\u7F6E\u4E3A 10\u300120\u300130\u3002",
    "aliases": []
  },
  {
    "id": 7,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6BCF\u6B21\u51CF\u53BB\u7684\u6570\u589E\u52A0 1\uFF0C\u4E0B\u4E00\u4E2A\u6570\u662F\uFF1F",
    "visual": "30\uFF0C28\uFF0C25\uFF0C21\uFF0C\uFF1F",
    "options": [
      "16",
      "15",
      "18",
      "17"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "16",
    "explanation": "\u4F9D\u6B21\u51CF 2\u30013\u30014\uFF0C\u63A5\u4E0B\u6765\u51CF 5\uFF0C\u5F97\u5230 16\u3002",
    "aliases": []
  },
  {
    "id": 8,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6309\u76F8\u540C\u987A\u5E8F\u5FAA\u73AF\uFF0C\u95EE\u53F7\u5904\u662F\u4EC0\u4E48\uFF1F",
    "visual": "\u25CF \u25B2 \u25A0 \u25CF \u25B2 \uFF1F",
    "options": [
      "\u25C6",
      "\u25CF",
      "\u25A0",
      "\u25B2"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u25A0",
    "explanation": "\u4E09\u4E2A\u56FE\u5F62\u6309\u5706\u3001\u4E09\u89D2\u3001\u65B9\u5757\u5FAA\u73AF\u3002",
    "aliases": []
  },
  {
    "id": 9,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6BCF\u7EC4\u589E\u52A0\u4E00\u4E2A\u5706\uFF0C\u4E0B\u4E00\u7EC4\u662F\u4EC0\u4E48\uFF1F",
    "visual": "\u25CF  /  \u25CF\u25CF  /  \u25CF\u25CF\u25CF  /  \uFF1F",
    "options": [
      "\u25CF\u25CF",
      "\u25CF",
      "\u25CF\u25CF\u25CF\u25CF",
      "\u25CF\u25CF\u25CF\u25CF\u25CF"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u25CF\u25CF\u25CF\u25CF",
    "explanation": "\u6BCF\u7EC4\u5706\u7684\u6570\u91CF\u4F9D\u6B21\u662F 1\u30012\u30013\u30014\u3002",
    "aliases": []
  },
  {
    "id": 10,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6BCF\u6B21\u987A\u65F6\u9488\u8F6C 90\xB0\uFF0C\u4E0B\u4E00\u4E2A\u65B9\u5411\u662F\uFF1F",
    "visual": "\u2191 \u2192 \u2193 \uFF1F",
    "options": [
      "\u2192",
      "\u2193",
      "\u2190",
      "\u2191"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u2190",
    "explanation": "\u4ECE\u5411\u4E0B\u987A\u65F6\u9488\u8F6C 90\xB0\uFF0C\u6307\u5411\u5DE6\u3002",
    "aliases": []
  },
  {
    "id": 11,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6BCF\u884C\u6309\u540C\u6837\u89C4\u5F8B\u5411\u5DE6\u5FAA\u73AF\u4E00\u683C\uFF0C\u7F3A\u5C11\u4EC0\u4E48\uFF1F",
    "visual": "\u25CF \u25B2 \u25A0\n\u25B2 \u25A0 \u25CF\n\u25A0 \u25CF \uFF1F",
    "options": [
      "\u25C6",
      "\u25CF",
      "\u25B2",
      "\u25A0"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u25B2",
    "explanation": "\u6BCF\u884C\u90FD\u7531\u5706\u3001\u4E09\u89D2\u3001\u65B9\u5757\u5FAA\u73AF\u7EC4\u6210\uFF0C\u6700\u540E\u7F3A\u4E09\u89D2\u3002",
    "aliases": []
  },
  {
    "id": 12,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u4E24\u79CD\u72B6\u6001\u4EA4\u66FF\u51FA\u73B0\uFF0C\u4E0B\u4E00\u9879\u662F\uFF1F",
    "visual": "\u25CB \u25CF \u25CB \u25CF \u25CB \uFF1F",
    "options": [
      "\u25A0",
      "\u25CB",
      "\u25A1",
      "\u25CF"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u25CF",
    "explanation": "\u7A7A\u5FC3\u5706\u4E0E\u5B9E\u5FC3\u5706\u4EA4\u66FF\uFF0C\u4E0B\u4E00\u9879\u4E3A\u5B9E\u5FC3\u5706\u3002",
    "aliases": []
  },
  {
    "id": 13,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6BCF\u884C\u53F3\u4FA7\u6570\u91CF\u7B49\u4E8E\u524D\u4E24\u683C\u4E4B\u548C\uFF0C\u7F3A\u591A\u5C11\u4E2A\u70B9\uFF1F",
    "visual": "1 \xB7 2 \xB7 3\n2 \xB7 3 \xB7 5\n3 \xB7 4 \xB7 \uFF1F",
    "options": [
      "6",
      "8",
      "7",
      "9"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "7",
    "explanation": "\u524D\u4E24\u884C\u5206\u522B\u662F 1 + 2 = 3\u30012 + 3 = 5\uFF0C\u6700\u540E\u4E3A 3 + 4 = 7\u3002",
    "aliases": []
  },
  {
    "id": 14,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u56FE\u5F62\u6309\u8FB9\u6570\u9010\u4E2A\u589E\u52A0\uFF0C\u63A5\u4E0B\u6765\u5E94\u662F\u4EC0\u4E48\uFF1F",
    "visual": "\u4E09\u89D2\u5F62 \u2192 \u56DB\u8FB9\u5F62 \u2192 \u4E94\u8FB9\u5F62 \u2192 \uFF1F",
    "options": [
      "\u5706\u5F62",
      "\u516D\u8FB9\u5F62",
      "\u4E09\u89D2\u5F62",
      "\u4E03\u8FB9\u5F62"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u516D\u8FB9\u5F62",
    "explanation": "\u8FB9\u6570\u4F9D\u6B21\u4E3A 3\u30014\u30015\u30016\u3002",
    "aliases": []
  },
  {
    "id": 15,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u4E24\u79CD\u56FE\u5F62\u6309\u201C\u4E24\u4E2A\u4E00\u7EC4\u201D\u91CD\u590D\uFF0C\u4E0B\u4E00\u9879\u662F\uFF1F",
    "visual": "\u25B2 \u25B2 \u25CF \u25CF \u25B2 \u25B2 \uFF1F",
    "options": [
      "\u25CF",
      "\u25C6",
      "\u25A0",
      "\u25B2"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u25CF",
    "explanation": "\u91CD\u590D\u5355\u5143\u662F\u4E24\u4E2A\u4E09\u89D2\u5F62\u3001\u4E24\u4E2A\u5706\uFF0C\u56E0\u6B64\u4E0B\u4E00\u9879\u4E3A\u5706\u3002",
    "aliases": []
  },
  {
    "id": 16,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u9E1F : \u7FBD\u6BDB \uFF1D \u9C7C : \uFF1F",
    "options": [
      "\u6C34",
      "\u9C7C\u5375",
      "\u9CDE\u7247",
      "\u9C7C\u9CCD"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u9CDE\u7247",
    "explanation": "\u7FBD\u6BDB\u548C\u9CDE\u7247\u5206\u522B\u8986\u76D6\u9E1F\u4E0E\u9C7C\u7684\u8EAB\u4F53\u8868\u9762\u3002",
    "aliases": []
  },
  {
    "id": 17,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u533B\u751F : \u533B\u9662 \uFF1D \u6559\u5E08 : \uFF1F",
    "options": [
      "\u8BB2\u53F0",
      "\u8BFE\u672C",
      "\u5B66\u6821",
      "\u5B66\u751F"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u5B66\u6821",
    "explanation": "\u524D\u8005\u662F\u804C\u4E1A\uFF0C\u540E\u8005\u662F\u5178\u578B\u5DE5\u4F5C\u673A\u6784\u3002",
    "aliases": []
  },
  {
    "id": 18,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u6E29\u5EA6\u8BA1 : \u6E29\u5EA6 \uFF1D \u5929\u5E73 : \uFF1F",
    "options": [
      "\u901F\u5EA6",
      "\u957F\u5EA6",
      "\u65F6\u95F4",
      "\u8D28\u91CF"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u8D28\u91CF",
    "explanation": "\u6E29\u5EA6\u8BA1\u6D4B\u91CF\u6E29\u5EA6\uFF0C\u5929\u5E73\u6D4B\u91CF\u8D28\u91CF\u3002",
    "aliases": []
  },
  {
    "id": 19,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u79CD\u5B50 : \u690D\u7269 \uFF1D \u9E1F\u5375 : \uFF1F",
    "options": [
      "\u5DE2",
      "\u6811",
      "\u7FBD\u6BDB",
      "\u9E1F"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u9E1F",
    "explanation": "\u79CD\u5B50\u53EF\u4EE5\u53D1\u80B2\u6210\u690D\u7269\uFF0C\u9E1F\u5375\u53EF\u4EE5\u5B75\u5316\u51FA\u9E1F\u3002",
    "aliases": []
  },
  {
    "id": 20,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u624B\u5957 : \u624B \uFF1D \u889C\u5B50 : \uFF1F",
    "options": [
      "\u5E3D\u5B50",
      "\u978B",
      "\u811A",
      "\u817F"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u811A",
    "explanation": "\u624B\u5957\u7A7F\u6234\u5728\u624B\u4E0A\uFF0C\u889C\u5B50\u7A7F\u6234\u5728\u811A\u4E0A\u3002",
    "aliases": []
  },
  {
    "id": 21,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u4F5C\u5BB6 : \u5C0F\u8BF4 \uFF1D \u4F5C\u66F2\u5BB6 : \uFF1F",
    "options": [
      "\u4E50\u66F2",
      "\u4E50\u5668",
      "\u753B\u4F5C",
      "\u821E\u53F0"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u4E50\u66F2",
    "explanation": "\u524D\u8005\u662F\u521B\u4F5C\u8005\uFF0C\u540E\u8005\u662F\u5176\u521B\u4F5C\u7684\u4F5C\u54C1\u3002",
    "aliases": []
  },
  {
    "id": 22,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u76EE\u5F55 : \u4E66\u7C4D \uFF1D \u83DC\u5355 : \uFF1F",
    "options": [
      "\u53A8\u5E08",
      "\u9910\u5177",
      "\u83DC\u54C1",
      "\u9910\u684C"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u83DC\u54C1",
    "explanation": "\u76EE\u5F55\u5217\u51FA\u4E66\u7C4D\u5185\u5BB9\uFF0C\u83DC\u5355\u5217\u51FA\u53EF\u9009\u83DC\u54C1\u3002",
    "aliases": []
  },
  {
    "id": 23,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u9009\u62E9\u4E0E\u524D\u4E00\u7EC4\u5173\u7CFB\u6700\u4E00\u81F4\u7684\u4E00\u9879\u3002",
    "visual": "\u5C0F\u65F6 : \u5206\u949F \uFF1D \u5206\u949F : \uFF1F",
    "options": [
      "\u65E5",
      "\u5468",
      "\u79D2",
      "\u5E74"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u79D2",
    "explanation": "\u524D\u540E\u4E24\u79CD\u65F6\u95F4\u5355\u4F4D\u90FD\u76F8\u5DEE 60 \u500D\u3002",
    "aliases": []
  },
  {
    "id": 24,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u6240\u6709\u84DD\u5361\u90FD\u662F\u5706\u5F62\u3002\u67D0\u5F20\u5361\u662F\u84DD\u5361\u3002\u54EA\u9879\u4E00\u5B9A\u6B63\u786E\uFF1F",
    "visual": "",
    "options": [
      "\u8FD9\u5F20\u5361\u662F\u5706\u5F62",
      "\u6240\u6709\u5706\u5F62\u5361\u90FD\u662F\u84DD\u5361",
      "\u8FD9\u5F20\u5361\u662F\u65B9\u5F62",
      "\u8FD9\u5F20\u5361\u4E0D\u662F\u5706\u5F62"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u8FD9\u5F20\u5361\u662F\u5706\u5F62",
    "explanation": "\u84DD\u5361\u5C5E\u4E8E\u5706\u5F62\u5361\uFF0C\u6240\u4EE5\u8FD9\u5F20\u84DD\u5361\u4E00\u5B9A\u662F\u5706\u5F62\u3002",
    "aliases": []
  },
  {
    "id": 25,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u5C0F\u5B89\u6BD4\u5C0F\u767D\u9AD8\uFF0C\u5C0F\u767D\u6BD4\u5C0F\u9648\u9AD8\u3002\u8C01\u6700\u9AD8\uFF1F",
    "visual": "",
    "options": [
      "\u65E0\u6CD5\u5224\u65AD",
      "\u5C0F\u767D",
      "\u5C0F\u9648",
      "\u5C0F\u5B89"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u5C0F\u5B89",
    "explanation": "\u9AD8\u5EA6\u987A\u5E8F\u4E3A\u5C0F\u5B89 > \u5C0F\u767D > \u5C0F\u9648\u3002",
    "aliases": []
  },
  {
    "id": 26,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u5982\u679C\u5F00\u706F\uFF0C\u6307\u793A\u5668\u5C31\u4F1A\u4EAE\u3002\u73B0\u5728\u6307\u793A\u5668\u6CA1\u4EAE\uFF0C\u80FD\u63A8\u51FA\u4EC0\u4E48\uFF1F",
    "visual": "",
    "options": [
      "\u6709\u4EBA\u521A\u521A\u5173\u706F",
      "\u706F\u6CA1\u6709\u6253\u5F00",
      "\u706F\u5DF2\u7ECF\u6253\u5F00",
      "\u6307\u793A\u5668\u4E00\u5B9A\u574F\u4E86"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u706F\u6CA1\u6709\u6253\u5F00",
    "explanation": "\u6309\u9898\u8BBE\u201C\u5F00\u706F\u5FC5\u4EAE\u201D\uFF0C\u4E0D\u4EAE\u53EF\u4EE5\u63A8\u51FA\u6CA1\u6709\u5F00\u706F\uFF1B\u4E0D\u80FD\u63A8\u51FA\u5176\u4ED6\u7EC6\u8282\u3002",
    "aliases": []
  },
  {
    "id": 27,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u6709\u4E9B\u8BFB\u8005\u662F\u753B\u5BB6\uFF0C\u6240\u6709\u753B\u5BB6\u90FD\u4F1A\u753B\u753B\u3002\u54EA\u9879\u4E00\u5B9A\u6B63\u786E\uFF1F",
    "visual": "",
    "options": [
      "\u6CA1\u6709\u8BFB\u8005\u4F1A\u753B\u753B",
      "\u6240\u6709\u753B\u5BB6\u662F\u8BFB\u8005",
      "\u6709\u4E9B\u8BFB\u8005\u4F1A\u753B\u753B",
      "\u6240\u6709\u8BFB\u8005\u4F1A\u753B\u753B"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u6709\u4E9B\u8BFB\u8005\u4F1A\u753B\u753B",
    "explanation": "\u90A3\u4E9B\u540C\u65F6\u662F\u753B\u5BB6\u7684\u8BFB\u8005\u4E00\u5B9A\u4F1A\u753B\u753B\u3002",
    "aliases": []
  },
  {
    "id": 28,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u7532\u3001\u4E59\u3001\u4E19\u6392\u961F\u3002\u7532\u4E0D\u5728\u7B2C\u4E00\uFF0C\u4E19\u4E0D\u5728\u7B2C\u4E09\uFF0C\u4E59\u5728\u7B2C\u4E09\u3002\u8C01\u5728\u7B2C\u4E00\uFF1F",
    "visual": "",
    "options": [
      "\u4E59",
      "\u4E19",
      "\u7532",
      "\u65E0\u6CD5\u5224\u65AD"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u4E19",
    "explanation": "\u4E59\u5728\u7B2C\u4E09\uFF0C\u7532\u4E0D\u80FD\u7B2C\u4E00\uFF0C\u53EA\u80FD\u7B2C\u4E8C\uFF0C\u4E19\u5728\u7B2C\u4E00\u3002",
    "aliases": []
  },
  {
    "id": 29,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u76D2\u91CC\u53EA\u6709\u7EA2\u7403\u548C\u84DD\u7403\u3002\u95ED\u773C\u81F3\u5C11\u62FF\u51FA\u51E0\u4E2A\u7403\uFF0C\u624D\u80FD\u4FDD\u8BC1\u6709\u4E24\u4E2A\u540C\u8272\uFF1F",
    "visual": "",
    "options": [
      "5 \u4E2A",
      "2 \u4E2A",
      "4 \u4E2A",
      "3 \u4E2A"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "3 \u4E2A",
    "explanation": "\u524D\u4E24\u4E2A\u53EF\u80FD\u4E00\u7EA2\u4E00\u84DD\uFF0C\u7B2C\u4E09\u4E2A\u5FC5\u7136\u4E0E\u5176\u4E2D\u4E00\u4E2A\u540C\u8272\u3002",
    "aliases": []
  },
  {
    "id": 30,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u6240\u6709 A \u90FD\u662F B\uFF0C\u6240\u6709 B \u90FD\u662F C\u3002\u54EA\u9879\u4E00\u5B9A\u6B63\u786E\uFF1F",
    "visual": "",
    "options": [
      "\u6240\u6709 B \u90FD\u662F A",
      "\u6240\u6709 A \u90FD\u662F C",
      "\u6240\u6709 C \u90FD\u662F A",
      "\u6CA1\u6709 A \u662F C"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u6240\u6709 A \u90FD\u662F C",
    "explanation": "A \u5305\u542B\u5728 B \u4E2D\uFF0CB \u5305\u542B\u5728 C \u4E2D\uFF0C\u56E0\u6B64 A \u5305\u542B\u5728 C \u4E2D\u3002",
    "aliases": []
  },
  {
    "id": 31,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u4E09\u4E2A\u4EBA\u5404\u63E1\u4E00\u6B21\u624B\uFF0C\u6BCF\u4E24\u4EBA\u4E4B\u95F4\u53EA\u63E1\u4E00\u6B21\uFF0C\u4E00\u5171\u63E1\u51E0\u6B21\uFF1F",
    "visual": "",
    "options": [
      "3 \u6B21",
      "9 \u6B21",
      "2 \u6B21",
      "6 \u6B21"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "3 \u6B21",
    "explanation": "\u4E09\u5BF9\u5206\u522B\u4E3A\u7532\u4E59\u3001\u7532\u4E19\u3001\u4E59\u4E19\uFF0C\u5171 3 \u6B21\u3002",
    "aliases": []
  },
  {
    "id": 32,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u9762\u5411\u5317\uFF0C\u5148\u5411\u53F3\u8F6C 90\xB0\uFF0C\u518D\u5411\u5DE6\u8F6C 180\xB0\u3002\u73B0\u5728\u9762\u5411\u54EA\u91CC\uFF1F",
    "visual": "",
    "options": [
      "\u5357",
      "\u897F",
      "\u5317",
      "\u4E1C"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u897F",
    "explanation": "\u5317\u5411\u53F3\u8F6C\u5230\u4E1C\uFF0C\u4E1C\u5411\u5DE6\u8F6C 180\xB0 \u5230\u897F\u3002",
    "aliases": []
  },
  {
    "id": 33,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5411\u4E1C\u8D70 3 \u7C73\uFF0C\u518D\u5411\u5317\u8D70 4 \u7C73\uFF0C\u7EC8\u70B9\u5728\u8D77\u70B9\u54EA\u4E2A\u65B9\u5411\uFF1F",
    "visual": "",
    "options": [
      "\u897F\u5317",
      "\u4E1C\u5357",
      "\u4E1C\u5317",
      "\u897F\u5357"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u4E1C\u5317",
    "explanation": "\u7EC8\u70B9\u540C\u65F6\u4F4D\u4E8E\u8D77\u70B9\u4E1C\u4FA7\u548C\u5317\u4FA7\uFF0C\u5373\u4E1C\u5317\u3002",
    "aliases": []
  },
  {
    "id": 34,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u949F\u8868\u4E0A\uFF0C\u4ECE 12 \u70B9\u65B9\u5411\u987A\u65F6\u9488\u8F6C 90\xB0\uFF0C\u6307\u5411\u51E0\uFF1F",
    "visual": "",
    "options": [
      "6",
      "3",
      "9",
      "12"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "3",
    "explanation": "\u4E00\u5468 360\xB0\uFF0C90\xB0 \u662F\u56DB\u5206\u4E4B\u4E00\u5708\uFF0C\u4ECE 12 \u6307\u5411 3\u3002",
    "aliases": []
  },
  {
    "id": 35,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u6B63\u65B9\u5F62\u65CB\u8F6C 90\xB0 \u540E\uFF0C\u4E0E\u539F\u6765\u7684\u8F6E\u5ED3\u662F\u4EC0\u4E48\u5173\u7CFB\uFF1F",
    "visual": "",
    "options": [
      "\u9762\u79EF\u53D8\u4E3A\u4E00\u534A",
      "\u5B8C\u5168\u91CD\u5408",
      "\u53D8\u6210\u957F\u65B9\u5F62",
      "\u53D8\u6210\u4E09\u89D2\u5F62"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u5B8C\u5168\u91CD\u5408",
    "explanation": "\u6B63\u65B9\u5F62\u7ED5\u4E2D\u5FC3\u8F6C 90\xB0 \u540E\u8F6E\u5ED3\u5B8C\u5168\u91CD\u5408\u3002",
    "aliases": []
  },
  {
    "id": 36,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u9762\u5411\u5357\uFF0C\u8FDE\u7EED\u5411\u5DE6\u8F6C\u4E24\u6B21\uFF0C\u6BCF\u6B21 90\xB0\uFF0C\u73B0\u5728\u9762\u5411\u54EA\u91CC\uFF1F",
    "visual": "",
    "options": [
      "\u5357",
      "\u5317",
      "\u4E1C",
      "\u897F"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u5317",
    "explanation": "\u5357\u5411\u5DE6\u8F6C\u5230\u4E1C\uFF0C\u518D\u5411\u5DE6\u8F6C\u5230\u5317\u3002",
    "aliases": []
  },
  {
    "id": 37,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5411\u5317\u8D70 2 \u7C73\uFF0C\u5411\u4E1C\u8D70 2 \u7C73\uFF0C\u518D\u5411\u5357\u8D70 2 \u7C73\u3002\u73B0\u5728\u5728\u8D77\u70B9\u54EA\u91CC\uFF1F",
    "visual": "",
    "options": [
      "\u539F\u70B9",
      "\u6B63\u897F 2 \u7C73",
      "\u6B63\u5317 2 \u7C73",
      "\u6B63\u4E1C 2 \u7C73"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u6B63\u4E1C 2 \u7C73",
    "explanation": "\u5357\u5317\u79FB\u52A8\u62B5\u6D88\uFF0C\u5269\u4E0B\u5411\u4E1C\u7684 2 \u7C73\u3002",
    "aliases": []
  },
  {
    "id": 38,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u5927\u7ACB\u65B9\u4F53\u7531 2\xD72\xD72 \u4E2A\u76F8\u540C\u5C0F\u7ACB\u65B9\u4F53\u7EC4\u6210\uFF0C\u5171\u6709\u51E0\u4E2A\u5C0F\u7ACB\u65B9\u4F53\uFF1F",
    "visual": "",
    "options": [
      "12",
      "8",
      "4",
      "6"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "8",
    "explanation": "\u957F\u3001\u5BBD\u3001\u9AD8\u5404 2 \u4E2A\uFF0C\u603B\u6570\u4E3A 2 \xD7 2 \xD7 2 = 8\u3002",
    "aliases": []
  },
  {
    "id": 39,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5C06\u5411\u53F3\u7684\u7BAD\u5934\u5173\u4E8E\u7AD6\u76F4\u955C\u9762\u5DE6\u53F3\u7FFB\u8F6C\uFF0C\u5B83\u6307\u5411\u54EA\u91CC\uFF1F",
    "visual": "\u2192",
    "options": [
      "\u5DE6",
      "\u4E0B",
      "\u53F3",
      "\u4E0A"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u5DE6",
    "explanation": "\u5DE6\u53F3\u955C\u50CF\u4F7F\u5411\u53F3\u53D8\u6210\u5411\u5DE6\u3002",
    "aliases": []
  },
  {
    "id": 40,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u8FDE\u7EED\u4E09\u4E2A\u6574\u6570\u7684\u548C\u4E00\u5B9A\u80FD\u88AB 3 \u6574\u9664\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u6B63\u786E",
    "explanation": "\u4E09\u4E2A\u8FDE\u7EED\u6574\u6570\u53EF\u5199\u4E3A n\u22121\u3001n\u3001n+1\uFF0C\u603B\u548C\u4E3A 3n\u3002",
    "aliases": []
  },
  {
    "id": 41,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u4E00\u4E2A\u6570\u5148\u589E\u52A0\u4E00\u500D\uFF0C\u518D\u51CF\u5C11\u4E00\u534A\uFF0C\u4E00\u5B9A\u56DE\u5230\u539F\u6570\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u6B63\u786E",
    "explanation": "\u589E\u52A0\u4E00\u500D\u53D8\u6210 2n\uFF0C\u518D\u51CF\u5C11\u5176\u4E00\u534A\uFF0C\u5F97\u5230 n\u3002",
    "aliases": []
  },
  {
    "id": 42,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u4E00\u4E2A\u4EF7\u683C\u5148\u6DA8 20%\uFF0C\u518D\u964D 20%\uFF0C\u6700\u7EC8\u4EF7\u683C\u4E0D\u53D8\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u6700\u7EC8\u4E3A\u539F\u4EF7\u7684 1.2 \xD7 0.8 = 0.96\uFF0C\u5373\u51CF\u5C11\u4E86 4%\u3002",
    "aliases": []
  },
  {
    "id": 43,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u4EFB\u610F\u4E24\u4E2A\u5947\u6570\u7684\u4E58\u79EF\u90FD\u662F\u5076\u6570\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u9519\u8BEF",
    "explanation": "\u5947\u6570\u4E58\u5947\u6570\u4ECD\u662F\u5947\u6570\uFF0C\u4F8B\u5982 3 \xD7 5 = 15\u3002",
    "aliases": []
  },
  {
    "id": 44,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u5728 1 \u5230 20 \u7684\u6574\u6570\u4E2D\uFF0C5 \u7684\u500D\u6570\u6709 4 \u4E2A\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u5206\u522B\u662F 5\u300110\u300115\u300120\u3002",
    "aliases": []
  },
  {
    "id": 45,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u82E5 a \u5927\u4E8E b\uFF0C\u90A3\u4E48 a \u7684\u5E73\u65B9\u4E00\u5B9A\u5927\u4E8E b \u7684\u5E73\u65B9\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u53CD\u4F8B\uFF1A1 > \u22122\uFF0C\u4F46 1\xB2 < (\u22122)\xB2\u3002",
    "aliases": []
  },
  {
    "id": 46,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6309\u201C\u25CB\u3001\u25CB\u3001\u25CF\u201D\u5FAA\u73AF\u6392\u5217\uFF0C\u7B2C 8 \u4E2A\u56FE\u5F62\u662F \u25CB\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u6B63\u786E",
    "explanation": "8 \u9664\u4EE5 3 \u4F59 2\uFF0C\u6240\u4EE5\u5BF9\u5E94\u5FAA\u73AF\u5355\u5143\u7684\u7B2C 2 \u4E2A\u56FE\u5F62\u3002",
    "aliases": []
  },
  {
    "id": 47,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6B63\u65B9\u5F62\u548C\u957F\u65B9\u5F62\u90FD\u4E00\u5B9A\u6709\u56DB\u6761\u5BF9\u79F0\u8F74\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u9519\u8BEF",
    "explanation": "\u975E\u6B63\u65B9\u5F62\u7684\u957F\u65B9\u5F62\u53EA\u6709\u4E24\u6761\u5BF9\u79F0\u8F74\u3002",
    "aliases": []
  },
  {
    "id": 48,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u5E73\u9762\u4E09\u89D2\u5F62\u7684\u4E09\u4E2A\u5185\u89D2\u90FD\u53EF\u80FD\u5927\u4E8E 90\xB0\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u9519\u8BEF",
    "explanation": "\u5E73\u9762\u4E09\u89D2\u5F62\u7684\u5185\u89D2\u548C\u4E3A 180\xB0\uFF0C\u4E0D\u53EF\u80FD\u4E09\u4E2A\u90FD\u5927\u4E8E 90\xB0\u3002",
    "aliases": []
  },
  {
    "id": 49,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u628A\u7BAD\u5934\u987A\u65F6\u9488\u65CB\u8F6C\u56DB\u6B21\uFF0C\u6BCF\u6B21 90\xB0\uFF0C\u5B83\u4F1A\u6062\u590D\u539F\u65B9\u5411\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u603B\u5171\u65CB\u8F6C 360\xB0\uFF0C\u56DE\u5230\u539F\u65B9\u5411\u3002",
    "aliases": []
  },
  {
    "id": 50,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6309\u201C\u25B2\u3001\u25A0\u3001\u25CF\u3001\u25C6\u201D\u5FAA\u73AF\uFF0C\u7B2C 19 \u4E2A\u56FE\u5F62\u662F \u25CF\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u6B63\u786E",
    "explanation": "19 \u9664\u4EE5 4 \u4F59 3\uFF0C\u5BF9\u5E94\u7B2C\u4E09\u4E2A\u56FE\u5F62 \u25CF\u3002",
    "aliases": []
  },
  {
    "id": 51,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6B63\u516D\u8FB9\u5F62\u7ED5\u4E2D\u5FC3\u65CB\u8F6C 120\xB0\uFF0C\u8F6E\u5ED3\u53EF\u4EE5\u4E0E\u539F\u56FE\u91CD\u5408\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u6B63\u786E",
    "explanation": "\u6B63\u516D\u8FB9\u5F62\u6BCF\u8F6C 60\xB0 \u5C31\u91CD\u5408\uFF0C120\xB0 \u662F 60\xB0 \u7684\u4E24\u500D\u3002",
    "aliases": []
  },
  {
    "id": 52,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u94A5\u5319\uFF1A\u5F00\u9501\u201D\u4E0E\u201C\u526A\u5200\uFF1A\u526A\u88C1\u201D\u7684\u5173\u7CFB\u4E00\u81F4\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u4E24\u7EC4\u5747\u4E3A\u5DE5\u5177\u4E0E\u5176\u5178\u578B\u7528\u9014\u3002",
    "aliases": []
  },
  {
    "id": 53,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u82F9\u679C\uFF1A\u6C34\u679C\u201D\u4E0E\u201C\u6C7D\u8F66\uFF1A\u8F66\u8F6E\u201D\u7684\u5173\u7CFB\u4E00\u81F4\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u9519\u8BEF",
    "explanation": "\u82F9\u679C\u5C5E\u4E8E\u6C34\u679C\uFF0C\u8F66\u8F6E\u662F\u6C7D\u8F66\u7684\u7EC4\u6210\u90E8\u5206\uFF0C\u5173\u7CFB\u4E0D\u540C\u3002",
    "aliases": []
  },
  {
    "id": 54,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u708E\u70ED\uFF1A\u5BD2\u51B7\u201D\u4E0E\u201C\u5BBD\u9614\uFF1A\u72ED\u7A84\u201D\u90FD\u662F\u53CD\u4E49\u5173\u7CFB\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u524D\u4E00\u7EC4\u63CF\u8FF0\u6E29\u5EA6\u76F8\u53CD\uFF0C\u540E\u4E00\u7EC4\u63CF\u8FF0\u5BBD\u7A84\u76F8\u53CD\u3002",
    "aliases": []
  },
  {
    "id": 55,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u4E66\u9875\uFF1A\u4E66\u7C4D\u201D\u4E0E\u201C\u6811\u53F6\uFF1A\u6811\u6728\u201D\u90FD\u662F\u90E8\u5206\u4E0E\u6574\u4F53\u7684\u5173\u7CFB\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u4E66\u9875\u662F\u4E66\u7C4D\u7684\u4E00\u90E8\u5206\uFF0C\u6811\u53F6\u662F\u6811\u6728\u7684\u4E00\u90E8\u5206\u3002",
    "aliases": []
  },
  {
    "id": 56,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u5FC5\u8981\u201D\u4E0E\u201C\u5145\u5206\u201D\u53EF\u4EE5\u5728\u903B\u8F91\u5224\u65AD\u4E2D\u968F\u610F\u4E92\u6362\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u5FC5\u8981\u6761\u4EF6\u662F\u4E0D\u53EF\u7F3A\u5C11\u7684\u6761\u4EF6\uFF0C\u5145\u5206\u6761\u4EF6\u662F\u8DB3\u4EE5\u63A8\u51FA\u7ED3\u8BBA\u7684\u6761\u4EF6\u3002",
    "aliases": []
  },
  {
    "id": 57,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u56E0\u4E3A\u4E0B\u96E8\uFF0C\u6240\u4EE5\u8DEF\u6E7F\u201D\u4E0E\u201C\u8DEF\u6E7F\uFF0C\u6240\u4EE5\u4E00\u5B9A\u4E0B\u8FC7\u96E8\u201D\u610F\u601D\u5B8C\u5168\u76F8\u540C\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u8DEF\u6E7F\u8FD8\u53EF\u80FD\u6765\u81EA\u6D12\u6C34\u7B49\u539F\u56E0\uFF0C\u540E\u4E00\u53E5\u628A\u56E0\u679C\u5012\u7F6E\u4E86\u3002",
    "aliases": []
  },
  {
    "id": 58,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u6240\u6709\u732B\u90FD\u662F\u52A8\u7269\uFF0C\u56E0\u6B64\u6240\u6709\u52A8\u7269\u90FD\u662F\u732B\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u9519\u8BEF",
    "explanation": "\u732B\u53EA\u662F\u52A8\u7269\u7684\u4E00\u7C7B\uFF0C\u4E0D\u80FD\u53CD\u63A8\u6240\u6709\u52A8\u7269\u90FD\u662F\u732B\u3002",
    "aliases": []
  },
  {
    "id": 59,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u53EA\u8981\u6709\u7968\u5C31\u80FD\u5165\u573A\u3002\u5C0F\u6797\u6709\u7968\uFF0C\u6240\u4EE5\u6309\u9898\u8BBE\u4ED6\u80FD\u5165\u573A\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u6709\u7968\u662F\u80FD\u5165\u573A\u7684\u5145\u5206\u6761\u4EF6\uFF0C\u53EF\u76F4\u63A5\u63A8\u51FA\u7ED3\u8BBA\u3002",
    "aliases": []
  },
  {
    "id": 60,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u7532\u6BD4\u4E59\u65E9\u5230\uFF0C\u4E59\u6BD4\u4E19\u65E9\u5230\uFF0C\u6240\u4EE5\u4E19\u6BD4\u7532\u665A\u5230\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u987A\u5E8F\u662F\u7532\u3001\u4E59\u3001\u4E19\uFF0C\u4E19\u665A\u4E8E\u7532\u3002",
    "aliases": []
  },
  {
    "id": 61,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u6709\u4E9B A \u662F B\uFF0C\u6709\u4E9B B \u662F C\uFF0C\u56E0\u6B64\u5FC5\u6709\u4E00\u4E9B A \u662F C\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u4E24\u7EC4\u201C\u6709\u4E9B B\u201D\u53EF\u80FD\u5B8C\u5168\u4E0D\u540C\uFF0CA \u4E0E C \u53EF\u4EE5\u4E0D\u76F8\u4EA4\u3002",
    "aliases": []
  },
  {
    "id": 62,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u72EC\u7ACB\u629B\u51FA\u4E24\u679A\u516C\u5E73\u786C\u5E01\uFF0C\u4E24\u679A\u90FD\u6B63\u9762\u4E0E\u4E00\u6B63\u4E00\u53CD\u7684\u53EF\u80FD\u6027\u76F8\u540C\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u9519\u8BEF",
    "explanation": "\u7B49\u53EF\u80FD\u7ED3\u679C\u6709\u6B63\u6B63\u3001\u6B63\u53CD\u3001\u53CD\u6B63\u3001\u53CD\u53CD\uFF0C\u4E00\u6B63\u4E00\u53CD\u6709\u4E24\u79CD\u3002",
    "aliases": []
  },
  {
    "id": 63,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u4E09\u4EBA\u6BD4\u8D5B\u65E0\u5E76\u5217\uFF0C\u5C0F\u5468\u4E0D\u662F\u7B2C\u4E00\u4E5F\u4E0D\u662F\u7B2C\u4E09\uFF0C\u4ED6\u4E00\u5B9A\u7B2C\u4E8C\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u53EA\u6709\u7B2C\u4E00\u3001\u7B2C\u4E8C\u3001\u7B2C\u4E09\u4E09\u4E2A\u540D\u6B21\uFF0C\u6392\u9664\u4E24\u8005\u540E\u53EA\u5269\u7B2C\u4E8C\u3002",
    "aliases": []
  },
  {
    "id": 64,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u9762\u5411\u4E1C\u65F6\uFF0C\u53F3\u624B\u6307\u5411\u5357\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u6B63\u786E",
    "explanation": "\u4ECE\u4E1C\u5411\u53F3\u65CB\u8F6C 90\xB0 \u5C31\u662F\u5357\u3002",
    "aliases": []
  },
  {
    "id": 65,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5148\u5411\u5317\u8D70 3 \u7C73\uFF0C\u518D\u5411\u5357\u8D70 5 \u7C73\uFF0C\u7EC8\u70B9\u5728\u8D77\u70B9\u5317\u4FA7\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u9519\u8BEF",
    "explanation": "\u5357\u5317\u62B5\u6D88\u540E\uFF0C\u7EC8\u70B9\u5728\u8D77\u70B9\u5357\u4FA7 2 \u7C73\u5904\u3002",
    "aliases": []
  },
  {
    "id": 66,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E0D\u900F\u660E\u7ACB\u65B9\u4F53\u4ECE\u5916\u90E8\u4EFB\u610F\u89D2\u5EA6\u770B\uFF0C\u6700\u591A\u80FD\u540C\u65F6\u770B\u5230 4 \u4E2A\u5B8C\u6574\u7684\u5916\u8868\u9762\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u9519\u8BEF",
    "explanation": "\u5BF9\u4E0D\u900F\u660E\u7ACB\u65B9\u4F53\u4ECE\u5916\u90E8\u89C2\u5BDF\uFF0C\u6700\u591A\u540C\u65F6\u770B\u5230 3 \u4E2A\u9762\u3002",
    "aliases": []
  },
  {
    "id": 67,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5411\u5DE6\u8F6C 90\xB0 \u548C\u5411\u53F3\u8F6C 270\xB0\uFF0C\u6700\u7EC8\u671D\u5411\u76F8\u540C\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 2,
    "answer": "\u6B63\u786E",
    "explanation": "\u4E24\u79CD\u8F6C\u6CD5\u76F8\u5DEE\u4E00\u6574\u5708\uFF0C\u671D\u5411\u76F8\u540C\u3002",
    "aliases": []
  },
  {
    "id": 68,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u5927\u7ACB\u65B9\u4F53\u5207\u6210 3\xD73\xD73 \u4E2A\u5C0F\u7ACB\u65B9\u4F53\u540E\uFF0C\u5171\u6709 9 \u4E2A\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 1,
    "answer": "\u9519\u8BEF",
    "explanation": "\u603B\u6570\u4E3A 3 \xD7 3 \xD7 3 = 27\u3002",
    "aliases": []
  },
  {
    "id": 69,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5411\u4E1C\u8D70 4 \u7C73\u3001\u5411\u5317\u8D70 3 \u7C73\uFF0C\u4E0E\u8D77\u70B9\u7684\u76F4\u7EBF\u8DDD\u79BB\u662F 5 \u7C73\u3002",
    "visual": "",
    "options": [
      "\u6B63\u786E",
      "\u9519\u8BEF"
    ],
    "type": "boolean",
    "difficulty": 3,
    "answer": "\u6B63\u786E",
    "explanation": "\u7531\u52FE\u80A1\u5B9A\u7406\uFF0C\u8DDD\u79BB\u4E3A \u221A(4\xB2+3\xB2)=5 \u7C73\u3002",
    "aliases": []
  },
  {
    "id": 70,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6BCF\u9879\u662F\u524D\u4E00\u9879\u7684 3 \u500D\uFF1A2\uFF0C6\uFF0C18\uFF0C54\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "162",
    "explanation": "54 \xD7 3 = 162\u3002",
    "aliases": [],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 71,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u76F8\u90BB\u5DEE\u4F9D\u6B21\u589E\u52A0 2\uFF1A2\uFF0C6\uFF0C12\uFF0C20\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "30",
    "explanation": "\u76F8\u90BB\u5DEE\u4E3A 4\u30016\u30018\uFF0C\u4E0B\u4E00\u5DEE\u4E3A 10\uFF0C\u5F97\u5230 30\u3002",
    "aliases": [],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 72,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u76F8\u90BB\u5DEE\u4F9D\u6B21\u589E\u52A0 1\uFF1A4\uFF0C7\uFF0C11\uFF0C16\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "22",
    "explanation": "\u5DEE\u4E3A 3\u30014\u30015\uFF0C\u4E0B\u4E00\u5DEE\u4E3A 6\uFF0C16 + 6 = 22\u3002",
    "aliases": [],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 73,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u6BCF\u6B21\u9664\u4EE5 2\uFF1A160\uFF0C80\uFF0C40\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "20",
    "explanation": "40 \xF7 2 = 20\u3002",
    "aliases": [
      "\u4E8C\u5341"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 74,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u4E00\u4EF6\u5546\u54C1 80 \u5143\uFF0C\u6253\u516B\u6298\u540E\u7684\u4EF7\u683C\u662F ____ \u5143\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "64",
    "explanation": "80 \xD7 0.8 = 64 \u5143\u3002",
    "aliases": [
      "\u516D\u5341\u56DB"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 75,
    "category": "\u6570\u5B57\u89C4\u5F8B",
    "title": "\u5148\u4E58 2 \u518D\u52A0 1\uFF1A1\uFF0C3\uFF0C7\uFF0C15\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "31",
    "explanation": "15 \xD7 2 + 1 = 31\u3002",
    "aliases": [
      "\u4E09\u5341\u4E00"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 76,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6309\u201C\u25CB\u3001\u25B2\u3001\u25A0\u201D\u5FAA\u73AF\uFF0C\u7B2C 14 \u4E2A\u56FE\u5F62\u662F ____\u3002\u8BF7\u9009\u62E9\u6B63\u786E\u56FE\u5F62\u3002",
    "visual": "",
    "options": [
      "\u5706",
      "\u4E09\u89D2",
      "\u83F1\u5F62",
      "\u65B9\u5F62"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u4E09\u89D2",
    "explanation": "14 \u9664\u4EE5 3 \u4F59 2\uFF0C\u5BF9\u5E94\u7B2C\u4E8C\u4E2A\u56FE\u5F62\u3002",
    "aliases": []
  },
  {
    "id": 77,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u4E00\u6392 5 \u4E2A\u6B63\u65B9\u5F62\u9996\u5C3E\u76F8\u8FDE\uFF0C\u76F8\u90BB\u6B63\u65B9\u5F62\u5171\u7528\u4E00\u6761\u8FB9\uFF0C\u5171\u9700\u8981 ____ \u6839\u7B49\u957F\u706B\u67F4\u3002",
    "visual": "",
    "options": [
      "12",
      "16",
      "20",
      "15"
    ],
    "type": "choice",
    "difficulty": 3,
    "answer": "16",
    "explanation": "\u9996\u4E2A\u9700 4 \u6839\uFF0C\u4E4B\u540E\u6BCF\u4E2A\u65B0\u589E 3 \u6839\uFF1A4 + 4 \xD7 3 = 16\u3002",
    "aliases": [
      "\u5341\u516D"
    ]
  },
  {
    "id": 78,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u4E94\u8FB9\u5F62\u6709 ____ \u6761\u5BF9\u89D2\u7EBF\u3002",
    "visual": "",
    "options": [
      "4",
      "5",
      "6",
      "10"
    ],
    "type": "choice",
    "difficulty": 3,
    "answer": "5",
    "explanation": "\u6BCF\u4E2A\u9876\u70B9\u8FDE\u5411\u4E24\u4E2A\u4E0D\u76F8\u90BB\u9876\u70B9\uFF0C\u53BB\u6389\u91CD\u590D\u5F97\u5230 5 \xD7 2 \xF7 2 = 5\u3002",
    "aliases": [
      "\u4E94"
    ]
  },
  {
    "id": 79,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6BCF\u7EC4\u5706\u70B9\u6570\u662F\u524D\u4E00\u7EC4\u7684 2 \u500D\uFF1A3\u30016\u300112\u3001____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "24",
    "explanation": "12 \xD7 2 = 24\u3002",
    "aliases": [
      "\u4E8C\u5341\u56DB"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 80,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6B63\u65B9\u5F62\u6709 ____ \u6761\u5BF9\u79F0\u8F74\u3002",
    "visual": "",
    "options": [
      "2",
      "4",
      "3",
      "8"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "4",
    "explanation": "\u4E24\u6761\u5BF9\u89D2\u7EBF\u548C\u4E24\u6761\u5BF9\u8FB9\u4E2D\u70B9\u8FDE\u7EBF\uFF0C\u5171\u56DB\u6761\u3002",
    "aliases": [
      "\u56DB"
    ]
  },
  {
    "id": 81,
    "category": "\u56FE\u5F62\u63A8\u7406",
    "title": "\u6309\u201C\u25CF\u3001\u25CF\u3001\u25CB\u3001\u25CB\u201D\u5FAA\u73AF\uFF0C\u524D 12 \u4E2A\u56FE\u5F62\u4E2D\u6709 ____ \u4E2A\u5B9E\u5FC3\u5706\u3002",
    "visual": "",
    "options": [
      "4",
      "6",
      "8",
      "12"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "6",
    "explanation": "\u6BCF\u56DB\u4E2A\u542B\u4E24\u4E2A\u5B9E\u5FC3\u5706\uFF0C12 \u4E2A\u6709\u4E09\u7EC4\uFF0C\u5171 6 \u4E2A\u3002",
    "aliases": [
      "\u516D"
    ]
  },
  {
    "id": 82,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u542C\u89C9\uFF1A\u8033\u6735\u201D\u5BF9\u5E94\u201C\u89C6\u89C9\uFF1A____\u201D\u3002",
    "visual": "",
    "options": [
      "\u820C\u5934",
      "\u8033\u6735",
      "\u9F3B\u5B50",
      "\u773C\u775B"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u773C\u775B",
    "explanation": "\u8033\u6735\u662F\u542C\u89C9\u5668\u5B98\uFF0C\u773C\u775B\u662F\u89C6\u89C9\u5668\u5B98\u3002",
    "aliases": []
  },
  {
    "id": 83,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u98DE\u884C\u5458\uFF1A\u98DE\u673A\u201D\u5BF9\u5E94\u201C\u8239\u957F\uFF1A____\u201D\u3002",
    "visual": "",
    "options": [
      "\u6C7D\u8F66",
      "\u8239",
      "\u98DE\u673A",
      "\u706B\u8F66"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u8239",
    "explanation": "\u4E24\u7EC4\u5747\u4E3A\u64CD\u63A7\u8005\u4E0E\u4EA4\u901A\u5DE5\u5177\u3002",
    "aliases": []
  },
  {
    "id": 84,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u767D\u5929\uFF1A\u9ED1\u591C\u201D\u5BF9\u5E94\u201C\u524D\u8FDB\uFF1A____\u201D\u3002",
    "visual": "",
    "options": [
      "\u52A0\u901F",
      "\u540E\u9000",
      "\u505C\u6B62",
      "\u8F6C\u5F2F"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u540E\u9000",
    "explanation": "\u4E24\u7EC4\u5747\u4E3A\u542B\u4E49\u76F8\u53CD\u7684\u8BCD\u3002",
    "aliases": []
  },
  {
    "id": 85,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u9C7C\uFF1A\u6C34\u201D\u5BF9\u5E94\u201C\u4EBA\uFF1A____\u201D\uFF0C\u4E24\u7EC4\u540E\u9879\u90FD\u662F\u547C\u5438\u6240\u9700\u6C14\u4F53\u6240\u5728\u7684\u4E3B\u8981\u73AF\u5883\u3002",
    "visual": "",
    "options": [
      "\u98DF\u7269",
      "\u571F\u58E4",
      "\u7A7A\u6C14",
      "\u9633\u5149"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u7A7A\u6C14",
    "explanation": "\u9C7C\u901A\u8FC7\u9CC3\u4ECE\u6C34\u4E2D\u83B7\u53D6\u6C27\uFF0C\u4EBA\u901A\u8FC7\u80BA\u4ECE\u7A7A\u6C14\u4E2D\u83B7\u53D6\u6C27\u3002",
    "aliases": []
  },
  {
    "id": 86,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u8702\u871C\uFF1A\u871C\u8702\u201D\u5BF9\u5E94\u201C\u8695\u4E1D\uFF1A____\u201D\u3002",
    "visual": "",
    "options": [
      "\u8718\u86DB",
      "\u8774\u8776",
      "\u8695",
      "\u871C\u8702"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u8695",
    "explanation": "\u4E24\u7EC4\u5747\u4E3A\u4EA7\u7269\u4E0E\u4EA7\u751F\u8BE5\u4EA7\u7269\u7684\u52A8\u7269\u3002",
    "aliases": []
  },
  {
    "id": 87,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u201C\u5398\u7C73\uFF1A\u957F\u5EA6\u201D\u5BF9\u5E94\u201C\u5343\u514B\uFF1A____\u201D\u3002",
    "visual": "",
    "options": [
      "\u8D28\u91CF",
      "\u6E29\u5EA6",
      "\u65F6\u95F4",
      "\u957F\u5EA6"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u8D28\u91CF",
    "explanation": "\u5398\u7C73\u662F\u957F\u5EA6\u5355\u4F4D\uFF0C\u5343\u514B\u662F\u8D28\u91CF\u5355\u4F4D\u3002",
    "aliases": []
  },
  {
    "id": 88,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u56DB\u4E2A\u4EBA\u4E92\u76F8\u63E1\u624B\uFF0C\u6BCF\u4E24\u4EBA\u53EA\u63E1\u4E00\u6B21\uFF0C\u4E00\u5171\u63E1 ____ \u6B21\u3002",
    "visual": "",
    "options": [
      "4",
      "6",
      "8",
      "12"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "6",
    "explanation": "\u56DB\u4EBA\u53EF\u7EC4\u6210 4 \xD7 3 \xF7 2 = 6 \u5BF9\u3002",
    "aliases": [
      "\u516D"
    ]
  },
  {
    "id": 89,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u76D2\u4E2D\u6709\u7EA2\u3001\u84DD\u3001\u9EC4\u4E09\u79CD\u7403\uFF0C\u5404\u6709\u8DB3\u591F\u591A\u3002\u81F3\u5C11\u53D6\u51FA ____ \u4E2A\uFF0C\u624D\u80FD\u4FDD\u8BC1\u5176\u4E2D\u4E24\u4E2A\u540C\u8272\u3002",
    "visual": "",
    "options": [
      "3",
      "4",
      "5",
      "6"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "4",
    "explanation": "\u6700\u574F\u60C5\u51B5\u5148\u53D6\u5230\u4E09\u79CD\u4E0D\u540C\u989C\u8272\uFF0C\u7B2C\u56DB\u4E2A\u5FC5\u4E0E\u5DF2\u6709\u67D0\u8272\u76F8\u540C\u3002",
    "aliases": [
      "\u56DB"
    ]
  },
  {
    "id": 90,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u7532\u4E59\u4E19\u4E01\u6392\u961F\uFF0C\u7532\u7B2C\u4E00\uFF0C\u4E01\u6700\u540E\uFF0C\u4E59\u5728\u4E19\u524D\u9762\u3002\u4E19\u6392\u7B2C ____\u3002",
    "visual": "",
    "options": [
      "2",
      "3",
      "4",
      "1"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "3",
    "explanation": "\u987A\u5E8F\u53EA\u80FD\u662F\u7532\u3001\u4E59\u3001\u4E19\u3001\u4E01\uFF0C\u6240\u4EE5\u4E19\u7B2C\u4E09\u3002",
    "aliases": [
      "\u4E09"
    ]
  },
  {
    "id": 91,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u7236\u4EB2\u73B0\u5728\u662F\u513F\u5B50\u5E74\u9F84\u7684 3 \u500D\uFF0C10 \u5E74\u540E\u662F\u513F\u5B50\u7684 2 \u500D\u3002\u513F\u5B50\u73B0\u5728 ____ \u5C81\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 3,
    "answer": "10",
    "explanation": "\u8BBE\u513F\u5B50 x \u5C81\uFF1A3x+10=2(x+10)\uFF0C\u89E3\u5F97 x=10\u3002",
    "aliases": [
      "\u5341"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 92,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "5 \u53F0\u540C\u901F\u673A\u5668 5 \u5206\u949F\u751F\u4EA7 5 \u4E2A\u96F6\u4EF6\uFF0C100 \u53F0\u673A\u5668\u751F\u4EA7 100 \u4E2A\u96F6\u4EF6\u8981 ____ \u5206\u949F\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 3,
    "answer": "5",
    "explanation": "\u6BCF\u53F0\u673A\u5668 5 \u5206\u949F\u751F\u4EA7\u4E00\u4E2A\u96F6\u4EF6\uFF0C100 \u53F0\u540C\u65F6\u5DE5\u4F5C\u4ECD\u9700 5 \u5206\u949F\u3002",
    "aliases": [
      "\u4E94"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 93,
    "category": "\u903B\u8F91\u5224\u65AD",
    "title": "\u76D2\u91CC\u6709 3 \u4E2A\u82F9\u679C\uFF0C\u4F60\u4ECE\u4E2D\u62FF\u8D70 2 \u4E2A\u3002\u4F60\u624B\u91CC\u6709 ____ \u4E2A\u82F9\u679C\u3002",
    "visual": "",
    "options": [
      "1",
      "2",
      "3",
      "0"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "2",
    "explanation": "\u95EE\u7684\u662F\u4F60\u62FF\u5230\u7684\u6570\u91CF\uFF0C\u4E0D\u662F\u76D2\u91CC\u5269\u4E0B\u7684\u6570\u91CF\u3002",
    "aliases": [
      "\u4E8C",
      "\u4E24"
    ]
  },
  {
    "id": 94,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u9762\u5411\u897F\uFF0C\u5411\u53F3\u8F6C 90\xB0 \u540E\u9762\u5411 ____\u3002\u8BF7\u9009\u62E9\u6B63\u786E\u65B9\u5411\u3002",
    "visual": "",
    "options": [
      "\u4E1C",
      "\u5317",
      "\u5357",
      "\u897F"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "\u5317",
    "explanation": "\u897F\u5411\u53F3\u8F6C 90\xB0 \u662F\u5317\u3002",
    "aliases": []
  },
  {
    "id": 95,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u5411\u5357\u8D70 5 \u7C73\uFF0C\u518D\u5411\u5317\u8D70 2 \u7C73\uFF0C\u73B0\u5728\u8DDD\u8D77\u70B9 ____ \u7C73\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "3",
    "explanation": "\u76F8\u53CD\u65B9\u5411\u76F8\u62B5\u6D88\uFF0C\u51C0\u79FB\u52A8\u4E3A\u5411\u5357 3 \u7C73\u3002",
    "aliases": [
      "\u4E09"
    ],
    "fillKind": "number",
    "inputMode": "decimal"
  },
  {
    "id": 96,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u7ACB\u65B9\u4F53\u5171\u6709 ____ \u6761\u68F1\u3002",
    "visual": "",
    "options": [
      "8",
      "6",
      "12",
      "24"
    ],
    "type": "choice",
    "difficulty": 1,
    "answer": "12",
    "explanation": "\u4E0A\u4E0B\u9762\u5404 4 \u6761\uFF0C\u52A0 4 \u6761\u7AD6\u76F4\u68F1\uFF0C\u5171 12 \u6761\u3002",
    "aliases": [
      "\u5341\u4E8C"
    ]
  },
  {
    "id": 97,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u7ACB\u65B9\u4F53\u6240\u6709\u5916\u8868\u9762\u6D82\u8272\uFF0C\u518D\u5207\u6210 3\xD73\xD73 \u4E2A\u5C0F\u7ACB\u65B9\u4F53\u3002\u6070\u6709\u4E09\u9762\u6D82\u8272\u7684\u5C0F\u7ACB\u65B9\u4F53\u6709 ____ \u4E2A\u3002",
    "visual": "",
    "options": [
      "6",
      "8",
      "9",
      "1"
    ],
    "type": "choice",
    "difficulty": 3,
    "answer": "8",
    "explanation": "\u53EA\u6709\u5927\u7ACB\u65B9\u4F53\u516B\u4E2A\u9876\u89D2\u5904\u7684\u5C0F\u7ACB\u65B9\u4F53\u4E09\u9762\u6D82\u8272\u3002",
    "aliases": [
      "\u516B"
    ]
  },
  {
    "id": 98,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u4E00\u4E2A\u7ACB\u65B9\u4F53\u6240\u6709\u5916\u8868\u9762\u6D82\u8272\uFF0C\u518D\u5207\u6210 3\xD73\xD73 \u4E2A\u5C0F\u7ACB\u65B9\u4F53\u3002\u5B8C\u5168\u6CA1\u6709\u6D82\u8272\u7684\u5C0F\u7ACB\u65B9\u4F53\u6709 ____ \u4E2A\u3002",
    "visual": "",
    "options": [
      "0",
      "1",
      "8",
      "9"
    ],
    "type": "choice",
    "difficulty": 3,
    "answer": "1",
    "explanation": "\u53EA\u6709\u6B63\u4E2D\u5FC3\u7684\u4E00\u4E2A\u5C0F\u7ACB\u65B9\u4F53\u6CA1\u6709\u63A5\u89E6\u5916\u8868\u9762\u3002",
    "aliases": [
      "\u4E00"
    ]
  },
  {
    "id": 99,
    "category": "\u7A7A\u95F4\u65B9\u5411",
    "title": "\u9762\u5411\u5317\uFF0C\u8FDE\u7EED\u5411\u53F3\u8F6C 3 \u6B21\uFF0C\u6BCF\u6B21 90\xB0\uFF0C\u73B0\u5728\u9762\u5411 ____\u3002",
    "visual": "",
    "options": [
      "\u897F",
      "\u5357",
      "\u5317",
      "\u4E1C"
    ],
    "type": "choice",
    "difficulty": 2,
    "answer": "\u897F",
    "explanation": "\u4F9D\u6B21\u8F6C\u5411\u4E1C\u3001\u5357\u3001\u897F\u3002",
    "aliases": []
  },
  {
    "id": 100,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u674E\u767D\u300A\u9759\u591C\u601D\u300B\uFF1A\u5E8A\u524D\u660E\u6708\u5149\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "\u7591\u662F\u5730\u4E0A\u971C",
    "explanation": "\u539F\u53E5\uFF1A\u5E8A\u524D\u660E\u6708\u5149\uFF0C\u7591\u662F\u5730\u4E0A\u971C\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  },
  {
    "id": 101,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u738B\u4E4B\u6DA3\u300A\u767B\u9E73\u96C0\u697C\u300B\uFF1A\u6B32\u7A77\u5343\u91CC\u76EE\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "\u66F4\u4E0A\u4E00\u5C42\u697C",
    "explanation": "\u539F\u53E5\uFF1A\u6B32\u7A77\u5343\u91CC\u76EE\uFF0C\u66F4\u4E0A\u4E00\u5C42\u697C\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  },
  {
    "id": 102,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u5B5F\u6D69\u7136\u300A\u6625\u6653\u300B\uFF1A\u6625\u7720\u4E0D\u89C9\u6653\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 1,
    "answer": "\u5904\u5904\u95FB\u557C\u9E1F",
    "explanation": "\u539F\u53E5\uFF1A\u6625\u7720\u4E0D\u89C9\u6653\uFF0C\u5904\u5904\u95FB\u557C\u9E1F\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  },
  {
    "id": 103,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u675C\u752B\u300A\u6625\u591C\u559C\u96E8\u300B\uFF1A\u968F\u98CE\u6F5C\u5165\u591C\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "\u6DA6\u7269\u7EC6\u65E0\u58F0",
    "explanation": "\u539F\u53E5\uFF1A\u968F\u98CE\u6F5C\u5165\u591C\uFF0C\u6DA6\u7269\u7EC6\u65E0\u58F0\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  },
  {
    "id": 104,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u738B\u7EF4\u300A\u76F8\u601D\u300B\uFF1A\u613F\u541B\u591A\u91C7\u64B7\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "\u6B64\u7269\u6700\u76F8\u601D",
    "explanation": "\u539F\u53E5\uFF1A\u613F\u541B\u591A\u91C7\u64B7\uFF0C\u6B64\u7269\u6700\u76F8\u601D\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  },
  {
    "id": 105,
    "category": "\u8BED\u8A00\u7C7B\u6BD4",
    "title": "\u82CF\u8F7C\u300A\u6C34\u8C03\u6B4C\u5934\u300B\uFF1A\u4F46\u613F\u4EBA\u957F\u4E45\uFF0C____\u3002",
    "visual": "",
    "options": [],
    "type": "fill",
    "difficulty": 2,
    "answer": "\u5343\u91CC\u5171\u5A75\u5A1F",
    "explanation": "\u539F\u53E5\uFF1A\u4F46\u613F\u4EBA\u957F\u4E45\uFF0C\u5343\u91CC\u5171\u5A75\u5A1F\u3002",
    "aliases": [],
    "fillKind": "poetry",
    "inputMode": "text"
  }
];

// src/lib/brain/engine.ts
var TYPE_BASE = { choice: 4, boolean: 3, fill: 5 };
function byId(id) {
  const q = QUESTIONS.find((x) => x.id === id);
  if (!q) throw new Error("\u9898\u76EE\u4E0D\u5B58\u5728");
  return q;
}
function weightOf(q) {
  return TYPE_BASE[q.type] * q.difficulty;
}
function pickSet(seed) {
  const ids = [];
  for (const cat of CATEGORIES) {
    const pool = QUESTIONS.filter((q) => q.category === cat);
    const picked = shuffle(pool, hashStr(seed + "|" + cat)).slice(0, 2);
    ids.push(...picked.map((q) => q.id));
  }
  return shuffle(ids, hashStr(seed + "|order"));
}
function pickDaily(day) {
  return pickSet("daily:" + day);
}
function pickPractice(salt) {
  return pickSet("practice:" + salt);
}
function publicize(q, optionSeed) {
  const options = q.type === "fill" ? [] : q.type === "boolean" ? [...q.options] : shuffle(q.options, optionSeed);
  return {
    id: q.id,
    category: q.category,
    title: q.title,
    visual: q.visual,
    options,
    type: q.type,
    difficulty: q.difficulty,
    fillKind: q.fillKind,
    inputMode: q.inputMode
  };
}
function optionSeedFor(key, id) {
  return hashStr(key + ":opt:" + id);
}
var FW = "\uFF10\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18\uFF19\uFF0E";
var HW = "0123456789.";
function toHalfWidth(s) {
  return s.replace(/[０-９．]/g, (c) => {
    const i = FW.indexOf(c);
    return i >= 0 ? HW[i] : c;
  });
}
function stripPoetry(s) {
  return s.replace(/[\s,，。、．.！!？?；;：:"""''“”‘’《》〈〉·…—\-_+]/g, "");
}
function matchFill(q, raw) {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const candidates = [q.answer, ...q.aliases];
  if (q.fillKind === "poetry") {
    const n = stripPoetry(t);
    return candidates.some((c) => stripPoetry(c) === n);
  }
  const half = toHalfWidth(t).replace(/,/g, "").replace(/\s/g, "");
  const num = Number(half);
  for (const c of candidates) {
    const ch = toHalfWidth(String(c)).replace(/,/g, "").replace(/\s/g, "");
    if (ch === half) return true;
    const cn = Number(ch);
    if (!Number.isNaN(num) && !Number.isNaN(cn) && num === cn) return true;
  }
  return false;
}
function isCorrect(q, chosen, options) {
  if (chosen === null || chosen === void 0) return false;
  if (q.type === "fill") return matchFill(q, String(chosen));
  if (typeof chosen !== "number") return false;
  const picked = options[chosen];
  return picked === q.answer;
}
function chosenLabel(q, chosen, options) {
  if (q.type === "fill") return String(chosen ?? "");
  if (typeof chosen !== "number") return "";
  return options[chosen] ?? "";
}
function evaluate(ids, answers, optionKey) {
  if (ids.length !== 10 || answers.length !== 10) {
    throw new Error("\u672C\u8F6E\u5E94\u4E3A 10 \u9053\u9898");
  }
  const qs = ids.map(byId);
  const publics = qs.map((q) => publicize(q, optionSeedFor(optionKey, q.id)));
  const dimMap = /* @__PURE__ */ new Map();
  for (const cat of CATEGORIES) {
    dimMap.set(cat, {
      name: cat,
      correct: 0,
      total: 0,
      earned: 0,
      possible: 0
    });
  }
  let base = 0;
  let correctCount = 0;
  let fillRight = 0;
  let fillTotal = 0;
  let hardRight = 0;
  let hardTotal = 0;
  const review = [];
  qs.forEach((q, i) => {
    const pub = publics[i];
    const w = weightOf(q);
    const ok = isCorrect(q, answers[i] ?? null, pub.options);
    const dim = dimMap.get(q.category);
    dim.total += 1;
    dim.possible += w;
    if (ok) {
      dim.correct += 1;
      dim.earned += w;
      base += w;
      correctCount += 1;
    }
    if (q.type === "fill") {
      fillTotal += 1;
      if (ok) fillRight += 1;
    }
    if (q.difficulty === 3) {
      hardTotal += 1;
      if (ok) hardRight += 1;
    }
    review.push({
      ...pub,
      answer: q.answer,
      explanation: q.explanation,
      chosen: answers[i] ?? null,
      chosenLabel: chosenLabel(q, answers[i] ?? null, pub.options),
      correct: ok,
      weight: w
    });
  });
  let consistency = 0;
  for (const dim of dimMap.values()) {
    if (dim.total > 0 && dim.correct === dim.total) consistency += 2;
  }
  const score = base + consistency;
  const possible = [...dimMap.values()].reduce((s, d) => s + d.possible, 0) + 10;
  const ratio = possible > 0 ? score / possible : 0;
  const tier = tierFor(ratio, correctCount);
  const dimensions = CATEGORIES.map((c) => dimMap.get(c)).filter((d) => d.total > 0);
  const weakest = [...dimensions].sort((a, b) => a.earned / (a.possible || 1) - b.earned / (b.possible || 1))[0];
  return {
    score,
    assessment: {
      version: "weighted-v3",
      score,
      base,
      consistency,
      tier,
      correct: correctCount,
      dimensions,
      fillRight,
      fillTotal,
      hardRight,
      hardTotal,
      roast: roastFor({ correctCount, fillRight, fillTotal, hardRight, hardTotal, ratio, weakest }),
      advice: adviceFor(weakest, fillRight, fillTotal)
    },
    review
  };
}
function tierFor(ratio, correct) {
  if (correct === 10 && ratio >= 0.9) return "\u950B\u8292\u6BD5\u9732";
  if (ratio >= 0.82) return "\u950B\u8292\u6BD5\u9732";
  if (ratio >= 0.64) return "\u72B6\u6001\u5728\u7EBF";
  if (ratio >= 0.46) return "\u6E10\u5165\u4F73\u5883";
  if (ratio >= 0.28) return "\u6B63\u5728\u70ED\u8EAB";
  return "\u8FD8\u5728\u70ED\u673A";
}
function roastFor(p) {
  const { correctCount, fillRight, fillTotal, hardRight, hardTotal, ratio, weakest } = p;
  if (correctCount === 10) {
    return "\u5341\u9053\u5168\u4E2D\u3002\u8FD9\u4E0D\u662F\u8FD0\u6C14\uFF0C\u662F\u5927\u8111\u4ECA\u5929\u613F\u610F\u52A0\u73ED\u3002\u53EF\u4EE5\u628A\u8FD9\u4EFD\u72B6\u6001\u501F\u7ED9\u5F85\u529E\u6E05\u5355\u770B\u770B\u3002";
  }
  if (ratio >= 0.82) {
    return "\u8FD9\u8F6E\u51E0\u4E4E\u628A\u9898\u5E93\u6309\u5728\u5730\u4E0A\u6469\u64E6\u3002\u7559\u4E00\u4E24\u9053\u7ED9\u660E\u5929\u7684\u6392\u884C\u699C\uFF0C\u4E5F\u7B97\u8BB2\u7A76\u3002";
  }
  if (fillTotal > 0 && fillRight === 0) {
    return `\u8FD9\u8F6E\u50CF\u662F\u624B\u6307\u5DF2\u7ECF\u4EA4\u5377\uFF0C\u5927\u8111\u8FD8\u5728\u8BFB\u9898\u3002\u586B\u7A7A\u7B54\u5BF9 ${fillRight}/${fillTotal}\uFF0C\u9009\u9879\u4E00\u64A4\uFF0C\u63A8\u7406\u5C31\u9700\u8981\u81EA\u5DF1\u642D\u53F0\u9636\u4E86\u3002`;
  }
  if (hardTotal > 0 && hardRight === hardTotal && correctCount < 8) {
    return "\u6311\u6218\u9898\u5012\u662F\u54AC\u4E0B\u6765\u4E86\uFF0C\u57FA\u7840\u9898\u5374\u5728\u978B\u5E26\u4E0A\u7ECA\u4E86\u4E00\u8DE4\u3002\u950B\u5229\u5F52\u950B\u5229\uFF0C\u978B\u5E26\u4E5F\u5F97\u7CFB\u3002";
  }
  if (correctCount <= 2) {
    return "\u8FD9\u8F6E\u66F4\u50CF\u70ED\u8EAB\u524D\u7684\u4F38\u5C55\u3002\u4E0B\u4E00\u8F6E\u5148\u8BA9\u773C\u775B\u548C\u9009\u9879\u5BF9\u4E0A\u53F7\uFF0C\u5206\u6570\u4F1A\u81EA\u5DF1\u8DDF\u4E0A\u6765\u3002";
  }
  if (weakest && weakest.correct === 0 && weakest.total > 0) {
    return `${weakest.name}\u8FD9\u7EC4\u4ECA\u5929\u96C6\u4F53\u653E\u5047\u3002\u5176\u4F59\u79D1\u76EE\u8FD8\u5728\u5C97\uFF0C\u8BF4\u660E\u4E0D\u662F\u6CA1\u7535\uFF0C\u662F\u6709\u4EBA\u6CA1\u6253\u5361\u3002`;
  }
  if (ratio >= 0.5) {
    return "\u4E2D\u6BB5\u53D1\u6325\uFF0C\u7A33\uFF0C\u4F46\u4E0D\u5435\u3002\u518D\u76EF\u7D27\u586B\u7A7A\u548C\u5224\u65AD\u7684\u63AA\u8F9E\uFF0C\u6307\u6570\u4F1A\u518D\u8DF3\u4E00\u622A\u3002";
  }
  return "\u6709\u5BF9\u6709\u9519\uFF0C\u50CF\u4E00\u676F\u6E29\u5EA6\u521A\u597D\u7684\u8336\uFF1A\u80FD\u559D\uFF0C\u8FD8\u6CA1\u5230\u56DE\u7518\u3002\u4E0B\u4E00\u8F6E\u628A\u770B\u8D70\u773C\u7684\u90A3\u4E24\u9053\u63EA\u51FA\u6765\u3002";
}
function adviceFor(weakest, fillRight, fillTotal) {
  if (fillTotal > 0 && fillRight / fillTotal < 0.5) {
    return "\u586B\u7A7A\u4E0D\u5FC5\u8FFD\u6C42\u534E\u4E3D\uFF1A\u8BA1\u7B97\u9898\u5199\u534A\u89D2\u6570\u5B57\uFF0C\u8BD7\u8BCD\u53EA\u586B\u7F3A\u7684\u90A3\u53E5\uFF0C\u6807\u70B9\u53EF\u5E26\u53EF\u4E0D\u5E26\u3002";
  }
  if (weakest && weakest.total > 0 && weakest.correct < weakest.total) {
    return `${weakest.name}\u8FD9\u8F6E\u8FD8\u6709\u63D0\u5347\u7A7A\u95F4\uFF1A\u5148\u6392\u9664\u4E0D\u7B26\u5408\u6761\u4EF6\u7684\u7B54\u6848\uFF0C\u518D\u68C0\u67E5\u7ED3\u8BBA\u3002`;
  }
  return "\u4E94\u79CD\u601D\u8003\u65B9\u5F0F\u8F6E\u7740\u7EC3\uFF0C\u6BD4\u6B7B\u78D5\u540C\u4E00\u7C7B\u66F4\u63A5\u8FD1\u771F\u5B9E\u7684\u70ED\u8EAB\u3002";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CATEGORIES,
  QUESTIONS,
  beijingDate,
  beijingMsToNextMidnight,
  evaluate,
  matchFill,
  nicknameFor,
  optionSeedFor,
  pickDaily,
  pickPractice,
  pickSet,
  publicize,
  roomCode,
  shuffle,
  weightOf
});
