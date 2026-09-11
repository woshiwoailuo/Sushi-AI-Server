'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const generation=fs.readFileSync(path.join(root,'public/assets/workshop-generation.js'),'utf8');
const workshop=fs.readFileSync(path.join(root,'public/workshop.html'),'utf8');
const home=fs.readFileSync(path.join(root,'public/app/index.html'),'utf8');
function extract(source,name,indent=2){
 const match=source.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?\\n'+' '.repeat(indent)+'\\}'));
 assert.ok(match,name);return match[0];
}
test('manual image choice survives both successful and failed generation',async()=>{
 for(const engine of ['perchance','horde-real','horde-anime','sana']) for(const fail of [false,true]){
  const calls=[];const run={engine,payload:{},controller:new AbortController()};
  const dispatch=async(name)=>{calls.push(name);if(fail)throw Error('upstream unavailable');return {engine:name,url:'https://example.com/image.png'}};
  const ctx={HORDE_BUDGET_MS:30000,engineFamily:e=>e==='horde-anime'||e==='sana'?'anime':'real',forcePhotorealPrompt:p=>p,
   runWithProviderBudget:(r,e,task)=>task(r.controller.signal),generatePerchance:()=>dispatch('perchance'),generateHorde:(r,p,i,s,e)=>dispatch(e),generatePollinations:(r,p,i,e)=>dispatch(e)};
  vm.createContext(ctx);vm.runInContext(extract(generation,'generateOne'),ctx);
  if(fail)await assert.rejects(ctx.generateOne(run,'a landscape',0),/upstream unavailable/);else await ctx.generateOne(run,'a landscape',0);
  assert.deepEqual(calls,[engine]);assert.equal(run.engine,engine);
 }
});
test('Perch uses official generate without Horde relay',async()=>{
 const calls=[];
 const ctx={window:{},status:()=>{},generatePerchanceOfficial:async()=>{calls.push('official');return {url:'https://example.com/p.png',engine:'perchance'}},generateHorde:async()=>{calls.push('horde');return {url:'https://example.com/h.png',engine:'perchance'}}};
 vm.createContext(ctx);vm.runInContext(extract(generation,'generatePerchance'),ctx);
 const result=await ctx.generatePerchance({payload:{},completed:0,total:1},'landscape',0);
 assert.deepEqual(calls,['official']);assert.equal(result.engine,'perchance');
});
test('blocked official Perch uses in-app photoreal',async()=>{
 const calls=[];
 const ctx={window:{},status:()=>{},generatePerchanceOfficial:async()=>{calls.push('official');throw Object.assign(new TypeError('Load failed'),{name:'TypeError'})},generateHorde:async()=>{calls.push('horde');return {url:'https://example.com/h.png',engine:'perchance'}}};
 vm.createContext(ctx);vm.runInContext(extract(generation,'generatePerchance'),ctx);
 const result=await ctx.generatePerchance({payload:{},completed:0,total:1},'landscape',0);
 assert.deepEqual(calls,['official','horde']);assert.equal(result.engine,'perchance');
});
test('unsupported reference image remains on selected provider',async()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(extract(generation,'generateOne'),ctx);
 await assert.rejects(ctx.generateOne({engine:'sana',payload:{sourceImage:'image'}},'landscape',0),/未切换平台/);
});
test('workshop and home submit selected chat model',async()=>{
 let used;const ctx={setTimeout,clearTimeout,规范化对话通道:x=>x,问花粉:async(q,m)=>{used=m;return '回答'}};
 vm.createContext(ctx);vm.runInContext(extract(workshop,'问免费模型'),ctx);
 assert.equal(await ctx.问免费模型('你好','deepseek'),'回答');assert.equal(used,'deepseek');
 const h={setTimeout,clearTimeout,normalizeChatChannel:x=>x,askOneChat:async(q,m)=>{used=m;return 'answer'}};
 vm.createContext(h);vm.runInContext(extract(home,'raceChat',4),h);
 await h.raceChat('hello','gemini');assert.equal(used,'gemini');
});
test('UTF-8 workshop and scripts remain valid after production read patches',()=>{
 require('../lib/runtime-patch');require('../lib/image-lock-patch');require('../lib/feature-patch');
 const bytes=fs.readFileSync(path.join(root,'public/workshop.html'));
 const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 assert.ok(html.includes('核心描述'));assert.ok(!html.includes('\uFFFD'));
 for(const id of ['出图引擎','图生图平台','AI通道']){
  const select=html.match(new RegExp('<select id="'+id+'"[^>]*>'));
  assert.ok(select);assert.doesNotMatch(select[0],/disabled/);
 }
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 assert.doesNotMatch(html,/function lockPicker/);
});
