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
      '    if (值 === "官方" || 值 === "perch") 值 = "perchance";\n' +
      '    if (值 === "turbo" || 值 === "flux" || 值 === "flux-realism" || 值 === "flux-real" || 值 === "auto" || 值 === "horde") 值 = "auto-real";\n' +
      '    if (值 === "zimage" || 值 === "sdxl" || 值 === "krea2" || 值 === "liblib") 值 = "auto-real";\n' +
      '    if (值 === "anishort") 值 = "sana";\n' +
      '    var 可用 = ["auto-real", "auto-anime", "perchance", "horde-real", "horde-anime", "sana", "glm"];\n' +
      '    if (用户选过 && 可用.indexOf(值) >= 0) return 值;\n' +
      '    if (!用户选过 && (!值 || 值 === "auto-real")) return "auto-real";\n' +
      '    return 可用.indexOf(值) >= 0 ? 值 : "auto-real";\n' +
      '  }'
  );

  const providerOptions =
      '<select id="出图引擎" name="出图引擎">\n' +
      '            <optgroup label="写实">\n' +
      '              <option value="auto-real" selected>自动抢出 · 写实</option>\n' +
      '              <option value="horde-real">Horde · 写实</option>\n' +
      '              <option value="glm">智谱 GLM · 写实</option>\n' +
      '            </optgroup>\n' +
      '            <optgroup label="动漫">\n' +
      '              <option value="auto-anime">自动抢出 · 动漫</option>\n' +
      '              <option value="sana">Sana · 动漫/插画</option>\n' +
      '              <option value="horde-anime">Horde · 动漫</option>\n' +
      '            </optgroup>\n' +
      '            <optgroup label="独立">\n' +
      '              <option value="perchance">Perch · 独立通道</option>\n' +
      '            </optgroup>\n' +
      '          </select>';
  html = html.replace(/<select id="出图引擎" name="出图引擎">[\s\S]*?<\/select>/, providerOptions);

  html = html.replace(
    /<select id="管理默认平台"[\s\S]*?<\/select>/,
    '<select id="管理默认平台" onchange="保存默认平台(this.value, true)">\n' +
      '              <optgroup label="写实">\n' +
      '                <option value="auto-real" selected>自动抢出 · 写实</option>\n' +
      '                <option value="horde-real">Horde · 写实</option>\n' +
      '                <option value="glm">智谱 GLM · 写实</option>\n' +
      '              </optgroup>\n' +
      '              <optgroup label="动漫">\n' +
      '                <option value="auto-anime">自动抢出 · 动漫</option>\n' +
      '                <option value="sana">Sana · 动漫/插画</option>\n' +
      '                <option value="horde-anime">Horde · 动漫</option>\n' +
      '              </optgroup>\n' +
      '              <optgroup label="独立">\n' +
      '                <option value="perchance">Perch · 独立通道</option>\n' +
      '              </optgroup>\n' +
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
  var priority = ['auto-real','glm','perchance','horde-real','auto-anime','sana','horde-anime'];
  var labels = {
    'auto-real':'自动抢出 · 写实', 'auto-anime':'自动抢出 · 动漫', auto:'自动抢出 · 写实',
    perchance:'Perch · 独立通道', 'horde-real':'Horde · 写实', horde:'Horde · 写实',
    'horde-anime':'Horde · 动漫', sana:'Sana · 动漫/插画', glm:'智谱 GLM · 写实'
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
  function normalizeSaved(name){
    name = String(name || '').trim();
    if (name === '官方' || name === 'perch') return 'perchance';
    if (name === 'anishort') return 'sana';
    if (name === 'turbo' || name === 'flux' || name === 'flux-realism' || name === 'flux-real' || name === 'auto' || name === 'horde' || name === 'zimage' || name === 'sdxl' || name === 'krea2' || name === 'liblib') return 'auto-real';
    if (name === 'zhipu' || name === 'zhipuai' || name === 'chatglm' || name === 'cogview') return 'glm';
    return name || 'auto-real';
  }
  function selected(){ var box=el('出图引擎'); return box ? box.value : 'auto-real'; }
  function tipFor(name){
    name = normalizeSaved(name);
    if(name==='auto-real') return '自动抢出 · 写实：智谱优先，失败再走 Horde 写实，不含动漫通道';
    if(name==='auto-anime') return '自动抢出 · 动漫：Sana 与 Horde 动漫同时开跑，先到先得';
    if(name==='horde-real' || name==='horde') return 'Horde · 写实 · 免费共享算力，繁忙时需要排队';
    if(name==='horde-anime') return 'Horde · 动漫 · 免费共享算力，繁忙时需要排队';
    if(name==='sana') return 'Sana · 动漫/插画 · Pollinations 目前唯一可用模型';
    if(name==='glm') return '智谱 GLM · 写实 · CogView 文生图，不走动漫模型';
    if(name==='perchance') return 'Perch · 独立通道 · 官网无法内嵌，改用写实后端（不跳转官网）';
    return (labels[name]||name) + ' · 应用内免费通道';
  }
  function updateTip(){ var tip=el('平台提示'); if(tip) tip.textContent=tipFor(selected()); }
  function installProviderSelect(){
    var box=el('出图引擎'); if(!box || box.__sushiV3) return;
    box.__sushiV3=true;
    try {
      var saved=normalizeSaved(localStorage.getItem('角色生成器_默认平台'));
      if(priority.indexOf(saved)>=0) box.value=saved; else box.value='auto-real';
    } catch(e){ box.value='auto-real'; }
    box.disabled=false; box.removeAttribute('disabled');
    box.addEventListener('change',function(){
      box.value=normalizeSaved(box.value);
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
      if(box){ box.disabled=false; box.removeAttribute('disabled'); box.value=normalizeSaved(box.value); }
      var chosen=box ? box.value : 'auto-real';
      window.__sushiPreferredProvider=chosen;
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
