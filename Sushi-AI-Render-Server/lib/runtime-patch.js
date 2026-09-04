'use strict';

// Runtime compatibility patch for the encrypted workshop page.
// Keeping these small UI/routing changes here avoids duplicating the large workshop.html.
const fs = require('fs');
const path = require('path');

const originalReadFileSync = fs.readFileSync.bind(fs);

function patchWorkshop(source) {
  let html = String(source || '');

  // Image generation: migrate old/default state to Perchance unless the user explicitly chose Horde.
  html = html.replace(
    /function 规范化出图平台\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化出图平台(值, 用户选过) {\n' +
      '    值 = String(值 || "").trim();\n' +
      '    if (用户选过 && 值 === "auto") return "auto";\n' +
      '    return "perchance";\n' +
      '  }'
  );

  html = html.replace(
    /<select id="出图引擎" name="出图引擎">[\s\S]*?<\/select>/,
    '<select id="出图引擎" name="出图引擎">\n' +
      '            <option value="perchance" selected>Perchance · 默认优先</option>\n' +
      '            <option value="auto">免费生图 · AI Horde · 备用</option>\n' +
      '          </select>'
  );

  html = html.replace(
    /<select id="管理默认平台"[\s\S]*?<\/select>/,
    '<select id="管理默认平台" onchange="保存默认平台(this.value, true)">\n' +
      '              <option value="perchance" selected>Perchance · 默认优先</option>\n' +
      '              <option value="auto">免费生图 · AI Horde · 备用</option>\n' +
      '            </select>'
  );

  // AI chat: the user must not be able to pin one provider. Every request is an automatic race.
  html = html.replace(
    /<select id="AI通道"[\s\S]*?<\/select>/,
    '<select id="AI通道" disabled aria-label="自动抢答已锁定">\n' +
      '            <option value="auto" selected>自动抢答 · 已锁定</option>\n' +
      '          </select>\n' +
      '          <small class="说明文字">Turbo + Fast + Horde 同时抢答，采用最先成功的回复。</small>'
  );

  html = html.replace(
    /function 规范化对话通道\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化对话通道(值, 用户选过) {\n' +
      '    return "auto";\n' +
      '  }'
  );

  html = html.replace(
    /function 保存对话通道\(值, 用户选的\) \{[\s\S]*?\n  \}/,
    'function 保存对话通道(值, 用户选的) {\n' +
      '    var 框 = document.getElementById("AI通道");\n' +
      '    if (框) { 框.value = "auto"; 框.disabled = true; }\n' +
      '    try { localStorage.setItem("角色生成器_对话通道", "auto"); } catch (e) {}\n' +
      '  }'
  );

  html = html.replace(
    /function 对话通道已改\(\) \{[\s\S]*?\n  \}/,
    'function 对话通道已改() {\n' +
      '    对话抢出通道 = "";\n' +
      '    保存对话通道("auto", false);\n' +
      '  }'
  );

  // Replace the whole dispatcher: always race three free routes, first valid response wins.
  html = html.replace(
    /async function 问免费模型\(问句, 模型\) \{[\s\S]*?\n  \}\n\n  async function 提问AI/,
    'async function 问免费模型(问句, 模型) {\n' +
      '    var 赛道 = [\n' +
      '      问花粉(问句, "turbo"),\n' +
      '      问花粉(问句, "openai-fast"),\n' +
      '      问群体模型(问句)\n' +
      '    ];\n' +
      '    return new Promise(function (成功, 失败) {\n' +
      '      var 剩余 = 赛道.length;\n' +
      '      var 末错 = "";\n' +
      '      var 已中 = false;\n' +
      '      var 定时 = setTimeout(function () {\n' +
      '        if (已中) return;\n' +
      '        已中 = true;\n' +
      '        失败(new Error("抢答超时"));\n' +
      '      }, 12500);\n' +
      '      function 一条(任务) {\n' +
      '        任务.then(function (文) {\n' +
      '          if (已中 || !文) {\n' +
      '            剩余 -= 1;\n' +
      '            if (!已中 && 剩余 <= 0) { clearTimeout(定时); 失败(new Error(末错 || "问答不可用")); }\n' +
      '            return;\n' +
      '          }\n' +
      '          已中 = true;\n' +
      '          clearTimeout(定时);\n' +
      '          成功(文);\n' +
      '        }).catch(function (错) {\n' +
      '          末错 = String(错 && 错.message ? 错.message : 错);\n' +
      '          剩余 -= 1;\n' +
      '          if (!已中 && 剩余 <= 0) { clearTimeout(定时); 失败(new Error(末错)); }\n' +
      '        });\n' +
      '      }\n' +
      '      for (var i = 0; i < 赛道.length; i++) 一条(赛道[i]);\n' +
      '    });\n' +
      '  }\n\n  async function 提问AI'
  );

  // Force every submitted chat turn to race mode even if stale localStorage exists.
  html = html.replace(
    'var 选择通道 = (选 && 选.value) || "auto";\n    var 本轮通道 = 选择通道;\n    if (选择通道 !== "auto") 本轮通道 = 选择通道;',
    'var 选择通道 = "auto";\n    var 本轮通道 = "auto";\n    if (选) { 选.value = "auto"; 选.disabled = true; }'
  );

  return html;
}

fs.readFileSync = function patchedReadFileSync(file, options) {
  const result = originalReadFileSync(file, options);
  let filename = '';
  try { filename = path.resolve(String(file)); } catch { return result; }
  if (!filename.endsWith(path.join('public', 'workshop.html'))) return result;

  const wasBuffer = Buffer.isBuffer(result);
  const patched = patchWorkshop(wasBuffer ? result.toString('utf8') : result);
  return wasBuffer ? Buffer.from(patched, 'utf8') : patched;
};
