'use strict';

// Locks image generation to the first successful in-app provider for the current app session.
// Provider lock logic now lives in workshop-generation.js; this patch only seeds the session flag
// and strips any leftover official-site redirect stubs from the generation client.
const fs = require('fs');
const path = require('path');

const previousReadFileSync = fs.readFileSync.bind(fs);

function patchGenerationScript(source) {
  let js = String(source || '');
  // Hard-disable any residual openOfficial / perchance.org jump helpers if reintroduced.
  js = js.replace(/function openOfficial\s*\([\s\S]*?\n  \}/g, 'function openOfficial() { /* disabled: in-app free race only */ }');
  js = js.replace(
    /if\s*\(\s*window\.当前引擎\(\)\s*===\s*'perchance'\s*\)\s*\{\s*openOfficial\(\);\s*return Promise\.resolve\(\);\s*\}/g,
    "if (window.当前引擎() === 'perchance') { /* keep in-app perchance; never openOfficial */ }"
  );
  js = js.replace(/https:\/\/perchance\.org\/ai-text-to-image-generator/g, '#');
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
