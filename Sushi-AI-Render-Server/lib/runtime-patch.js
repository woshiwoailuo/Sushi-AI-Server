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
      '    var 可用 = ["perchance","turbo","flux","flux-real","zimage","sdxl","krea2","liblib","anishort","auto"];\n' +
      '    if (用户选过 && 可用.indexOf(值) >= 0) return 值;\n' +
      '    return "perchance";\n' +
      '  }'
  );

  const providerOptions =
      '<select id="出图引擎" name="出图引擎">\n' +
      '            <option value="perchance" selected>Perchance · 默认第一优先</option>\n' +
      '            <option value="turbo">Turbo · 极速</option>\n' +
      '            <option value="flux">Flux · 通用高质量</option>\n' +
      '            <option value="flux-real">Flux 写实 · 人像优先</option>\n' +
      '            <option value="zimage">Z-Image · 中文友好</option>\n' +
      '            <option value="sdxl">SDXL · 稳定通用</option>\n' +
      '            <option value="krea2">Krea 2 · 高质量写实</option>\n' +
      '            <option value="liblib">LiblibAI · 模型/LoRA</option>\n' +
      '            <option value="anishort">AniShort · 角色/短剧</option>\n' +
      '            <option value="auto">自动免费通道 · AI Horde 兜底</option>\n' +
      '          </select>';
  html = html.replace(/<select id="出图引擎" name="出图引擎">[\s\S]*?<\/select>/, providerOptions);

  html = html.replace(
    /<select id="管理默认平台"[\s\S]*?<\/select>/,
    '<select id="管理默认平台" onchange="保存默认平台(this.value, true)">\n' +
      '              <option value="perchance" selected>Perchance · 默认第一优先</option>\n' +
      '              <option value="turbo">Turbo</option>\n' +
      '              <option value="flux">Flux</option>\n' +
      '              <option value="flux-real">Flux 写实</option>\n' +
      '              <option value="zimage">Z-Image</option>\n' +
      '              <option value="sdxl">SDXL</option>\n' +
      '              <option value="krea2">Krea 2</option>\n' +
      '              <option value="liblib">LiblibAI</option>\n' +
      '              <option value="anishort">AniShort</option>\n' +
      '              <option value="auto">自动免费通道</option>\n' +
      '            </select>'
  );

  html = html.replace(
    /<select id="AI通道"[\s\S]*?<\/select>/,
    '<select id="AI通道" disabled aria-label="自动抢答已锁定">\n' +
      '            <option value="auto" selected>自动抢答 · 已锁定</option>\n' +
      '          </select>\n' +
      '          <small class="说明文字">Turbo + Fast + Horde 同时抢答，采用最先成功的回复。</small>'
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
  var priority = ['perchance','krea2','liblib','anishort','turbo','flux-real','flux','zimage','sdxl','auto'];
  var labels = {
    perchance:'Perchance', turbo:'Turbo', flux:'Flux', 'flux-real':'Flux 写实', zimage:'Z-Image', sdxl:'SDXL',
    krea2:'Krea 2', liblib:'LiblibAI', anishort:'AniShort', auto:'AI Horde'
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
  function selected(){ var box=el('出图引擎'); return box ? box.value : 'perchance'; }
  function tipFor(name){
    if(name==='perchance') return 'Perchance 默认第一优先 · APK 内运行；当前无直连时自动使用免费兜底通道';
    if(name==='krea2') return 'Krea 2 · 配置官方 API 后直连；未配置时自动免费兜底';
    if(name==='liblib') return 'LiblibAI · 配置开放平台凭证后直连；未配置时自动免费兜底';
    if(name==='anishort') return 'AniShort · 当前无公开第三方生图 API，自动免费兜底';
    if(name==='auto') return '自动免费通道 · AI Horde 兜底';
    return (labels[name]||name) + ' · 当前兼容模式，自动使用可用免费通道';
  }
  function updateTip(){ var tip=el('平台提示'); if(tip) tip.textContent=tipFor(selected()); }
  function installProviderSelect(){
    var box=el('出图引擎'); if(!box || box.__sushiV3) return;
    box.__sushiV3=true;
    try {
      var saved=localStorage.getItem('角色生成器_默认平台');
      if(priority.indexOf(saved)>=0) box.value=saved; else box.value='perchance';
    } catch(e){ box.value='perchance'; }
    box.addEventListener('change',function(){
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
      var chosen=box ? box.value : 'perchance';
      window.__sushiPreferredProvider=chosen;
      if(!box || chosen==='auto') return original.apply(this,arguments);
      box.value='auto';
      var result;
      try { result=original.apply(this,arguments); }
      finally { box.value=chosen; try{localStorage.setItem('角色生成器_默认平台',chosen);}catch(e){} updateTip(); }
      return result;
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
