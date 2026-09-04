'use strict';

// Locks image generation to the first successful in-app provider for the current app session.
// This keeps normal generation and random generation on the same provider once one wins.
const fs = require('fs');
const path = require('path');

const previousReadFileSync = fs.readFileSync.bind(fs);

function patchGenerationScript(source) {
  let js = String(source || '');

  // Keep an app-session provider lock. Do not persist it forever across app restarts.
  js = js.replace(
    "  var officialUrl = 'https://perchance.org/ai-text-to-image-generator';",
    "  var officialUrl = 'https://perchance.org/ai-text-to-image-generator';\n" +
    "  var lockedImageProvider = (window.__sushiImageProviderLock || '');\n" +
    "  function lockImageProvider(name) {\n" +
    "    name = String(name || '').trim();\n" +
    "    if (!name) return;\n" +
    "    if (!lockedImageProvider) {\n" +
    "      lockedImageProvider = name;\n" +
    "      window.__sushiImageProviderLock = name;\n" +
    "    }\n" +
    "    var box = document.getElementById('出图引擎');\n" +
    "    if (box) {\n" +
    "      box.value = lockedImageProvider === 'horde' ? 'auto' : box.value;\n" +
    "      box.disabled = true;\n" +
    "      box.title = '本次会话已锁定生图平台：' + lockedImageProvider;\n" +
    "    }\n" +
    "  }\n"
  );

  // Once a real image is loaded, lock the provider that produced it.
  js = js.replace(
    "      function loaded() {\n        if (settled || !img.naturalWidth) return;",
    "      function loaded() {\n        if (settled || !img.naturalWidth) return;\n        lockImageProvider(img.getAttribute('data-engine') || 'horde');"
  );

  // Normal generation and random generation share the same locked provider.
  js = js.replace(
    "  window.开始生成 = function () {\n    if (active || $('生成按钮').disabled) return Promise.resolve();",
    "  window.开始生成 = function () {\n    if (active || $('生成按钮').disabled) return Promise.resolve();\n    if (lockedImageProvider) {\n      var providerBox = $('出图引擎');\n      if (providerBox) {\n        if (lockedImageProvider === 'horde') providerBox.value = 'auto';\n        providerBox.disabled = true;\n      }\n    }"
  );

  js = js.replace(
    "  window.开始随机生成 = function () {\n    if (active || $('随机按钮').disabled) return Promise.resolve();",
    "  window.开始随机生成 = function () {\n    if (active || $('随机按钮').disabled) return Promise.resolve();\n    if (lockedImageProvider) {\n      var providerBox = $('出图引擎');\n      if (providerBox) {\n        if (lockedImageProvider === 'horde') providerBox.value = 'auto';\n        providerBox.disabled = true;\n      }\n    }"
  );

  // The current in-app generator is Horde. Perchance external navigation is disabled by runtime-patch,
  // so selecting the Perchance label still stays inside the APK and uses the in-app generator.
  js = js.replace(
    "    if (window.当前引擎() === 'perchance') { openOfficial(); return Promise.resolve(); }",
    "    if (window.当前引擎() === 'perchance') {\n      var providerBox = $('出图引擎');\n      if (providerBox) providerBox.value = 'auto';\n    }"
  );

  return js;
}

function patchWorkshopHtml(source) {
  let html = String(source || '');
  html = html.replace(
    '</body>',
    '<script>window.__sushiImageProviderLock = window.__sushiImageProviderLock || \"\";</script>\n</body>'
  );
  return html;
}

fs.readFileSync = function patchedReadFileSync(file, options) {
  const result = previousReadFileSync(file, options);
  let filename = '';
  try { filename = path.resolve(String(file)); } catch { return result; }

  const wasBuffer = Buffer.isBuffer(result);
  let text = wasBuffer ? result.toString('utf8') : String(result);

  if (filename.endsWith(path.join('public', 'assets', 'workshop-generation.js'))) {
    text = patchGenerationScript(text);
  } else if (filename.endsWith(path.join('public', 'workshop.html'))) {
    text = patchWorkshopHtml(text);
  } else {
    return result;
  }

  return wasBuffer ? Buffer.from(text, 'utf8') : text;
};
