'use strict';

const fs = require('fs');
const path = require('path');
const originalReadFileSync = fs.readFileSync.bind(fs);

function patchWorkshop(source) {
  let html = String(source || '');

  html = html.replace(
    /function 规范化出图平台\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化出图平台(值, 用户选过) {\n' +
      '    void 值; void 用户选过;\n' +
      '    return "perchance";\n' +
      '  }'
  );

  const providerOptions =
      '<select id="出图引擎" name="出图引擎" disabled aria-label="Perch 已锁定">\n' +
      '            <option value="perchance" selected>Perch · 已锁定</option>\n' +
      '          </select>';
  html = html.replace(/<select id="出图引擎"[\s\S]*?<\/select>/, providerOptions);

  html = html.replace(
    /<select id="管理默认平台"[\s\S]*?<\/select>/,
    '<select id="管理默认平台" disabled aria-label="Perch 已锁定">\n' +
      '              <option value="perchance" selected>Perch · 已锁定</option>\n' +
      '            </select>'
  );

  html = html.replace(
    /<select id="图生图平台"[\s\S]*?<\/select>/,
    '<select id="图生图平台" name="图生图平台" disabled aria-label="Perch 已锁定">\n' +
      '              <option value="perchance" selected>Perch · 已锁定</option>\n' +
      '            </select>'
  );

  html = html.replace(
    /<select id="AI通道"[\s\S]*?<\/select>/,
    '<select id="AI通道" disabled aria-label="GLM 已锁定">\n' +
      '            <option value="glm" selected>GLM · 已锁定</option>\n' +
      '          </select>\n' +
      '          <small class="说明文字">对话已锁定 GLM，不再更换通道。</small>'
  );

  html = html.replace(
    /function 规范化对话通道\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化对话通道(值, 用户选过) {\n    void 值; void 用户选过;\n    return "glm";\n  }'
  );
  html = html.replace(
    /function 保存对话通道\(值, 用户选的\) \{[\s\S]*?\n  \}/,
    'function 保存对话通道(值, 用户选的) {\n' +
      '    void 值; void 用户选的;\n' +
      '    var 框 = document.getElementById("AI通道");\n' +
      '    if (框) { 框.value = "glm"; 框.disabled = true; 框.setAttribute("disabled", "disabled"); }\n' +
      '    try { localStorage.setItem("角色生成器_对话通道", "glm"); } catch (e) {}\n' +
      '  }'
  );
  html = html.replace(
    /function 对话通道已改\(\) \{[\s\S]*?\n  \}/,
    'function 对话通道已改() {\n    对话抢出通道 = "";\n    保存对话通道("glm", false);\n  }'
  );

  const providerGuard = `
<script id="sushi-provider-pack-v3">
(function () {
  'use strict';
  function el(id){ return document.getElementById(id); }
  function isPerchanceUrl(value) {
    try { return new URL(String(value || ''), location.href).hostname === 'perchance.org'; }
    catch (e) { return /perchance\\.org/i.test(String(value || '')); }
  }
  function removeExternalLinks() {
    document.querySelectorAll('a[href]').forEach(function (a) {
      if (!isPerchanceUrl(a.href)) return;
      a.removeAttribute('href'); a.removeAttribute('target'); a.setAttribute('aria-disabled','true'); a.style.display='none';
    });
  }
  function lockPicker(){
    ['出图引擎','管理默认平台','图生图平台'].forEach(function(id){
      var box=el(id); if(!box) return;
      box.value='perchance';
      box.disabled=true;
      box.setAttribute('disabled','disabled');
      box.title='生图已锁定 Perch，不再更换通道';
    });
    window.__sushiPreferredProvider='perchance';
    window.__sushiImageProviderLock='perchance';
    var tip=el('平台提示');
    if(tip) tip.textContent='Perch · 已锁定 · 官网无法内嵌，改用写实后端（不跳转官网）';
    var chat=el('AI通道');
    if(chat){
      chat.value='glm';
      chat.disabled=true;
      chat.setAttribute('disabled','disabled');
    }
  }
  function installGenerationGuard() {
    if (typeof window.开始生成 !== 'function' || window.__sushiProviderGuardV3) return;
    window.__sushiProviderGuardV3=true;
    var original=window.开始生成;
    window.开始生成=function(){
      lockPicker();
      return original.apply(this,arguments);
    };
  }
  function installHistoryMetadata(){
    var area=el('图像输出'); if(!area || area.__sushiMeta) return;
    area.__sushiMeta=true;
    new MutationObserver(function(){
      area.querySelectorAll('img:not([data-sushi-meta])').forEach(function(img){
        img.setAttribute('data-sushi-meta','1');
        img.setAttribute('data-preferred-engine','perchance');
        img.setAttribute('data-engine',img.getAttribute('data-engine')||'perchance');
        img.setAttribute('data-created-at',new Date().toISOString());
      });
    }).observe(area,{childList:true,subtree:true});
  }
  var nativeOpen=window.open;
  window.open=function(url){ if(isPerchanceUrl(url)) return null; return nativeOpen.apply(window,arguments); };
  document.addEventListener('click',function(event){
    var a=event.target&&event.target.closest?event.target.closest('a[href]'):null;
    if(a&&isPerchanceUrl(a.href)){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  function ready(){
    removeExternalLinks(); lockPicker(); installGenerationGuard(); installHistoryMetadata();
    var observer=new MutationObserver(function(){removeExternalLinks();lockPicker();installGenerationGuard();installHistoryMetadata();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready); else ready();
})();
</script>`;
  html = html.replace(/<\/body>/i, providerGuard + '\n</body>');
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
