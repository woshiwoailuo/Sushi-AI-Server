'use strict';

const fs = require('fs');
const path = require('path');
const previousReadFileSync = fs.readFileSync.bind(fs);

function patchWorkshop(source) {
  let html = String(source || '');

  html = html.replace(
    /<select id="出图引擎" name="出图引擎">[\s\S]*?<\/select>/,
    '<select id="出图引擎" name="出图引擎">\n' +
      '            <option value="perchance" selected>Perchance · 默认</option>\n' +
      '            <option value="krea2">Krea 2 · 高质量写实</option>\n' +
      '            <option value="anishort">AniShort · AI短剧/角色</option>\n' +
      '            <option value="liblib">LiblibAI · 模型/LoRA丰富</option>\n' +
      '            <option value="auto">自动抢图 · 当前可用免费通道</option>\n' +
      '          </select>'
  );

  html = html.replace(
    '<div id="管理面板" class="分区" hidden>',
    '<label class="换背景行" style="margin-top:10px">\n' +
      '  <input id="生成记忆模式" type="checkbox" checked>\n' +
      '  <span>生成记忆模式 · 自动记住描述、比例、参数与上次创作设置</span>\n' +
      '</label>\n' +
      '<div id="管理面板" class="分区" hidden>'
  );

  html = html.replace(
    '<button type="button" class="次按钮" onclick="清空对话()">清空对话</button>',
    '<button type="button" class="次按钮" id="AI直接生图按钮">AI 直接生图</button>\n' +
      '          <button type="button" class="次按钮" onclick="清空对话()">清空对话</button>'
  );

  const script = `
<script id="sushi-feature-pack">
(function(){
  'use strict';
  var memoryKey = 'sushi_generation_memory_v2';
  var memoryEnabledKey = 'sushi_generation_memory_enabled';
  var ids = ['角色描述','英文描述','中文译文','图像比例','生成数量','引导强度','随机种子','负面提示','图生图强度'];

  function byId(id){ return document.getElementById(id); }
  function enabled(){ var box=byId('生成记忆模式'); return !box || box.checked; }
  function saveMemory(){
    if (!enabled()) return;
    var data = {};
    ids.forEach(function(id){ var el=byId(id); if(el) data[id]=el.value; });
    var bg=byId('只换背景'); if(bg) data['只换背景']=!!bg.checked;
    var engine=byId('出图引擎'); if(engine) data['出图引擎']=engine.value;
    data.savedAt=Date.now();
    try { localStorage.setItem(memoryKey, JSON.stringify(data)); } catch(e) {}
  }
  function restoreMemory(){
    var box=byId('生成记忆模式');
    var pref='1'; try { pref=localStorage.getItem(memoryEnabledKey)||'1'; } catch(e) {}
    if(box) box.checked=pref!=='0';
    if(pref==='0') return;
    var raw=''; try { raw=localStorage.getItem(memoryKey)||''; } catch(e) {}
    if(!raw) return;
    try {
      var data=JSON.parse(raw);
      ids.forEach(function(id){ var el=byId(id); if(el && data[id]!==undefined && data[id]!=='') el.value=String(data[id]); });
      var bg=byId('只换背景'); if(bg && data['只换背景']!==undefined) bg.checked=!!data['只换背景'];
      if(typeof window.刷新画面说明==='function') window.刷新画面说明();
    } catch(e) {}
  }
  function installMemory(){
    var box=byId('生成记忆模式');
    if(box) box.addEventListener('change',function(){
      try { localStorage.setItem(memoryEnabledKey,box.checked?'1':'0'); } catch(e) {}
      if(box.checked) saveMemory();
    });
    ids.forEach(function(id){ var el=byId(id); if(el){ el.addEventListener('input',saveMemory); el.addEventListener('change',saveMemory); } });
    var bg=byId('只换背景'); if(bg) bg.addEventListener('change',saveMemory);
    var engine=byId('出图引擎'); if(engine) engine.addEventListener('change',function(){ providerChanged(engine.value); saveMemory(); });
    restoreMemory();
  }
  function removePerchanceLinks(){
    document.querySelectorAll('a[href]').forEach(function(a){
      var href=String(a.getAttribute('href')||'');
      if(/perchance\\.org/i.test(href)){ a.removeAttribute('href'); a.removeAttribute('target'); a.style.display='none'; }
    });
  }
  function providerChanged(name){
    var tip=byId('平台提示');
    if(!tip) return;
    var messages={
      perchance:'Perchance 默认 · 优先使用；不可用时自动回到免费备用通道',
      krea2:'Krea 2 · 高质量写实；服务器未配置 KREA_API_TOKEN 时自动使用免费备用通道',
      anishort:'AniShort · AI短剧/角色创作入口；无公开第三方API时自动使用免费备用通道',
      liblib:'LiblibAI · 模型与 LoRA 丰富；服务器未配置 LiblibAI API 凭证时自动使用免费备用通道',
      auto:'自动抢图 · 使用当前可用免费通道'
    };
    tip.textContent=messages[name]||messages.auto;
  }
  function forceDefaultProvider(){
    var box=byId('出图引擎');
    if(!box) return;
    if(!window.__sushiImageProviderLock){ box.value='perchance'; box.disabled=false; }
    try { localStorage.setItem('角色生成器_默认平台','perchance'); } catch(e) {}
    providerChanged(box.value);
  }
  function lockProvider(name){
    name=String(name||'').trim()||'horde';
    if(window.__sushiImageProviderLock) return;
    window.__sushiImageProviderLock=name;
    var box=byId('出图引擎');
    if(box){ if(name==='horde') box.value='auto'; box.disabled=true; box.title='本次会话已锁定：'+name; }
    var tip=byId('平台提示'); if(tip) tip.textContent='本次会话实际生图通道：'+name+' · 普通与随机生成共用';
  }
  function watchImages(){
    var area=byId('图像输出'); if(!area || area.__sushiWatching) return;
    area.__sushiWatching=true;
    function scan(){
      var img=area.querySelector('img');
      if(img && (img.complete ? img.naturalWidth>0 : true)) lockProvider(img.getAttribute('data-engine')||'horde');
    }
    area.addEventListener('load',function(e){ if(e.target && e.target.tagName==='IMG') lockProvider(e.target.getAttribute('data-engine')||'horde'); },true);
    new MutationObserver(scan).observe(area,{childList:true,subtree:true});
    scan();
  }
  function installRandomRecovery(){
    if(window.__sushiRandomRecoveryInstalled) return;
    window.__sushiRandomRecoveryInstalled=true;
    function recover(){
      var btn=byId('随机按钮');
      if(!btn) return;
      if(!window.正在生成图片){
        btn.disabled=false;
        btn.removeAttribute('aria-disabled');
      }
    }
    setInterval(recover,500);
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) recover(); });
    window.addEventListener('pageshow',recover);
    recover();
  }
  function installAiImage(){
    var btn=byId('AI直接生图按钮');
    if(!btn || btn.__wired) return;
    btn.__wired=true;
    btn.addEventListener('click',function(){
      var q=byId('AI问题'); var text=q?String(q.value||'').trim():'';
      if(!text){ if(q) q.focus(); return; }
      var prompt=byId('角色描述');
      if(prompt){ prompt.value=text; prompt.dispatchEvent(new Event('input',{bubbles:true})); }
      saveMemory();
      if(typeof window.开始生成==='function'){
        Promise.resolve(window.开始生成()).finally(function(){
          var result=document.querySelector('.结果区'); if(result) result.scrollIntoView({behavior:'smooth',block:'start'});
        });
      }
    });
  }
  function installProviderFallback(){
    if(window.__sushiProviderFallbackInstalled) return;
    window.__sushiProviderFallbackInstalled=true;
    var original=window.开始生成;
    if(typeof original!=='function') return;
    window.开始生成=function(){
      var box=byId('出图引擎');
      var chosen=box?box.value:'perchance';
      if(chosen==='krea2'||chosen==='anishort'||chosen==='liblib'){
        if(box) box.value='auto';
        providerChanged(chosen);
        var p=Promise.resolve(original.apply(this,arguments));
        p.finally(function(){ if(box && !window.__sushiImageProviderLock){ box.value=chosen; providerChanged(chosen); } });
        return p;
      }
      return original.apply(this,arguments);
    };
  }
  function ready(){
    removePerchanceLinks();
    forceDefaultProvider();
    installMemory();
    installAiImage();
    installRandomRecovery();
    installProviderFallback();
    watchImages();
    var observer=new MutationObserver(function(){ removePerchanceLinks(); installAiImage(); watchImages(); });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready); else ready();
})();
</script>`;

  html = html.replace(/<\/body>/i, script + '\n</body>');
  return html;
}

fs.readFileSync = function patchedReadFileSync(file, options) {
  const result = previousReadFileSync(file, options);
  let filename = '';
  try { filename = path.resolve(String(file)); } catch { return result; }
  if (!filename.endsWith(path.join('public', 'workshop.html'))) return result;
  const wasBuffer = Buffer.isBuffer(result);
  const patched = patchWorkshop(wasBuffer ? result.toString('utf8') : result);
  return wasBuffer ? Buffer.from(patched, 'utf8') : patched;
};