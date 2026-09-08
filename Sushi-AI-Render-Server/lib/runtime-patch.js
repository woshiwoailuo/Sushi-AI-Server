'use strict';

const fs = require('fs');
const path = require('path');
const originalReadFileSync = fs.readFileSync.bind(fs);

function patchWorkshop(source) {
  let html = String(source || '');

  html = html.replace(
    /function 规范化出图平台\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化出图平台(值, 用户选过) {\n' +
      '    值 = String(值 || "").trim();\n' +
      '    if (值 === "官方") 值 = "perchance";\n' +
      '    var 可用 = ["auto","turbo","horde","flux","flux-real","flux-realism","sana","zimage","sdxl","krea2","liblib","anishort","perchance"];\n' +
      '    if (用户选过 && 可用.indexOf(值) >= 0) return 值;\n' +
      '    return 可用.indexOf(值) >= 0 ? 值 : "auto";\n' +
      '  }'
  );

  const providerOptions =
      '<select id="出图引擎" name="出图引擎">\n' +
      '            <option value="auto" selected>自动抢出 · 全平台</option>\n' +
      '            <option value="turbo">Turbo · 极速</option>\n' +
      '            <option value="horde">Horde · 免费共享算力</option>\n' +
      '            <option value="flux">Flux · 通用高质量</option>\n' +
      '            <option value="flux-realism">Flux写实 · 人像优先</option>\n' +
      '            <option value="sana">Sana · 中文友好</option>\n' +
      '            <option value="perchance">Perchance · 应用内生成</option>\n' +
      '          </select>';
  html = html.replace(/<select id="出图引擎" name="出图引擎">[\s\S]*?<\/select>/, providerOptions);

  html = html.replace(
    /<select id="管理默认平台"[\s\S]*?<\/select>/,
    '<select id="管理默认平台" onchange="保存默认平台(this.value, true)">\n' +
      '              <option value="auto" selected>自动抢出 · 全平台</option>\n' +
      '              <option value="turbo">Turbo</option>\n' +
      '              <option value="horde">Horde</option>\n' +
      '              <option value="flux">Flux</option>\n' +
      '              <option value="flux-realism">Flux写实</option>\n' +
      '              <option value="sana">Sana</option>\n' +
      '              <option value="perchance">Perchance · 应用内</option>\n' +
      '            </select>'
  );

  html = html.replace(
    /<select id="AI通道"[\s\S]*?<\/select>/,
    '<select id="AI通道" disabled aria-label="自动抢答已锁定">\n' +
      '            <option value="auto" selected>自动抢答 · 已锁定</option>\n' +
      '          </select>\n' +
      '          <small class="说明文字">多通道同时抢答，采用最先成功的回复。</small>'
  );

  html = html.replace(
    /function 规范化对话通道\(值, 用户选过\) \{[\s\S]*?\n  \}/,
    'function 规范化对话通道(值, 用户选过) {\n    return "auto";\n  }'
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
    'function 对话通道已改() {\n    对话抢出通道 = "";\n    保存对话通道("auto", false);\n  }'
  );

  const providerGuard = `
<script id="sushi-provider-pack-v3">
(function () {
  'use strict';
  var priority = ['auto','turbo','horde','flux','flux-realism','sana','perchance'];
  var labels = {
    auto:'自动抢出', turbo:'Turbo', horde:'Horde', flux:'Flux', 'flux-realism':'Flux写实', sana:'Sana',
    'flux-real':'Flux写实', perchance:'Perchance'
  };
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
  function selected(){ var box=el('出图引擎'); return box ? box.value : 'auto'; }
  function tipFor(name){
    if(name==='auto') return '自动抢出 · Turbo / Flux / Flux写实 / Sana / Horde 全平台同时开跑，先到先得';
    if(name==='turbo') return 'Turbo · Pollinations 极速免费通道';
    if(name==='horde') return 'AI Horde · 免费共享算力，繁忙时需要排队';
    if(name==='flux') return 'Flux · 通用高质量免费通道';
    if(name==='flux-realism' || name==='flux-real') return 'Flux写实 · 人像优先免费通道';
    if(name==='sana') return 'Sana · 中文友好免费通道';
    if(name==='perchance') return 'Perchance · 应用内生成（不跳转官网）';
    return (labels[name]||name) + ' · 应用内免费通道';
  }
  function updateTip(){ var tip=el('平台提示'); if(tip) tip.textContent=tipFor(selected()); }
  function installProviderSelect(){
    var box=el('出图引擎'); if(!box || box.__sushiV3) return;
    box.__sushiV3=true;
    // Ensure Perchance stays selectable for in-app generation (still block perchance.org jumps).
    if(!box.querySelector('option[value="perchance"]')){
      var po=document.createElement('option'); po.value='perchance'; po.textContent='Perchance · 应用内生成'; box.appendChild(po);
    }
    try {
      var saved=localStorage.getItem('角色生成器_默认平台');
      if(saved==='官方') saved='perchance';
      if(priority.indexOf(saved)>=0) box.value=saved; else box.value='auto';
    } catch(e){ box.value='auto'; }
    box.disabled=false; box.removeAttribute('disabled');
    box.addEventListener('change',function(){
      if(box.value==='flux-real') box.value='flux-realism';
      try { localStorage.setItem('角色生成器_默认平台',box.value); } catch(e){}
      window.__sushiPreferredProvider=box.value; updateTip();
    });
    window.__sushiPreferredProvider=box.value; updateTip();
  }
  function installGenerationGuard() {
    if (typeof window.开始生成 !== 'function' || window.__sushiProviderGuardV3) return;
    window.__sushiProviderGuardV3=true;
    var original=window.开始生成;
    window.开始生成=function(){
      var box=el('出图引擎');
      if(box){ box.disabled=false; box.removeAttribute('disabled'); }
      if(box && box.value==='flux-real') box.value='flux-realism';
      var chosen=box ? box.value : 'auto';
      window.__sushiPreferredProvider=chosen;
      // Keep the user's selected free engine / Perchance in-app; only remap removed stub names.
      if(chosen==='krea2'||chosen==='anishort'||chosen==='liblib'||chosen==='zimage'||chosen==='sdxl'){
        if(box) box.value = chosen==='anishort' ? 'sana' : 'flux';
      }
      return original.apply(this,arguments);
    };
  }
  function installHistoryMetadata(){
    var area=el('图像输出'); if(!area || area.__sushiMeta) return;
    area.__sushiMeta=true;
    new MutationObserver(function(){
      area.querySelectorAll('img:not([data-sushi-meta])').forEach(function(img){
        img.setAttribute('data-sushi-meta','1');
        img.setAttribute('data-preferred-engine',window.__sushiPreferredProvider||selected());
        img.setAttribute('data-engine',img.getAttribute('data-engine')||'horde');
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
    removeExternalLinks(); installProviderSelect(); installGenerationGuard(); installHistoryMetadata();
    var observer=new MutationObserver(function(){removeExternalLinks();installProviderSelect();installGenerationGuard();installHistoryMetadata();});
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
