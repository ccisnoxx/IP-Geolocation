// 仅重算本次普通 HTTP 验收记录；原始文件不写回，缺阶段不冒充产品失败或通过。
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [input,output]=process.argv.slice(2);
if(!input||!output||existsSync(output))throw new Error('需要原始证据和新的核验输出路径');
const bytes=await readFile(input),raw=JSON.parse(bytes);
const phases=['baseline','utc','la-old','la-new','off-old','off-new','restored'];
const expectedConfigHashes={baseline:'a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca',utc:'444e684acaa5605fc17dd2a32893d41f8359b53de58eeb925a3fdb2bca89034f','la-old':'f52f6f1b64068e9a4b57d383bf91705abb120f432647a1b3b4a7413791924804','la-new':'f52f6f1b64068e9a4b57d383bf91705abb120f432647a1b3b4a7413791924804','off-old':'e8667c910d130b009acf5f6a30f824f387ba826c3f4b45417b79883e75461cca','off-new':'e8667c910d130b009acf5f6a30f824f387ba826c3f4b45417b79883e75461cca',restored:'a489d3c7cc1600d5ca6e4386e1859287178aa823fca233ea78e14787241e0aca'};
const records=new Map(raw.records.map(x=>[x.phase,x]));
const checks=[],pending=phases.filter(x=>!records.has(x));
function check(phase,name,pass){checks.push({phase,name,pass:Boolean(pass)});}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
const equal=(a,b)=>a!==undefined&&b!==undefined&&JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const rtcPolicies=['default','default_public_interface_only','default_public_and_private_interfaces','disable_non_proxied_udp'];
const rtcControls=['not_controllable','controlled_by_other_extensions','controllable_by_this_extension','controlled_by_this_extension'];
function validSignal(x){return x&&['language','locale','timeZone'].every(k=>typeof x[k]==='string'&&x[k])&&Array.isArray(x.languages)&&x.languages.length&&x.languages.every(s=>typeof s==='string')&&['winter','summer'].every(k=>Number.isSafeInteger(x[k]));}
function signalsMatch(observation,expected){
  const child=observation?.child;
  return Boolean(validSignal(expected)&&!observation?.error&&validSignal(child?.first)&&validSignal(child?.live)&&equal(child.first,expected)&&equal(child.live,expected)&&Array.isArray(child.workers)&&child.workers.length===2&&['classic','module'].every(type=>{
    const items=child.workers.filter(x=>x?.type===type);
    return items.length===1&&!items[0].error&&validSignal(items[0].signal)&&equal(items[0].signal,expected);
  }));
}
const baseline=records.get('baseline'),native=baseline?.observation?.parent?.first;
const utc={language:'en-US',languages:['en-US','en'],locale:'en-US',timeZone:'UTC',winter:0,summer:0};
const la={...utc,timeZone:'America/Los_Angeles',winter:480,summer:420};
check('structure','阶段唯一且顺序正确',raw.records.length===records.size&&equal(raw.records.map(x=>x.phase),phases.slice(0,raw.records.length)));
check('structure','预期配置摘要格式有效',validHash(raw.baselineHash));
check('structure','原始档案摘要及数量有效',validHash(raw.baselineProfileHash)&&Number.isSafeInteger(raw.baselineVerifiedCount)&&raw.baselineVerifiedCount>=0&&Number.isSafeInteger(raw.baselineBoundCount)&&raw.baselineBoundCount>=0);
for(const phase of phases){
  const record=records.get(phase);if(!record)continue;
  const {privileged:p,observation:o}=record;
  check(phase,'配置、档案和请求头摘要存在且格式有效',validHash(p?.configHash)&&validHash(p?.profileHash)&&validHash(p?.headerHash));
  check(phase,'完整配置符合保留原规则的已核验阶段',p?.configHash===expectedConfigHashes[phase]);
  check(phase,'真实浏览器版本为Chrome155',Array.isArray(o?.browser)&&o.browser.some(x=>x.brand==='Google Chrome'&&/^155\./.test(x.version)));
  check(phase,'父页保持原生首次值及当前值',!o?.error&&validSignal(native)&&equal(o?.parent?.first,native)&&equal(o?.parent?.live,native));
  check(phase,'父子文档标识存在且不同',typeof o?.parent?.token==='string'&&typeof o?.child?.token==='string'&&o.parent.token!==o.child.token);
  check(phase,'总开关与WebRTC配置保留',p?.masterEnabled===true&&p.webRtcMode==='strict'&&equal([p.masterEnabled,p.webRtcMode],[baseline?.privileged?.masterEnabled,baseline?.privileged?.webRtcMode]));
  check(phase,'WebRTC实际策略及控制级别保持',rtcPolicies.includes(p?.rtcPolicy)&&rtcControls.includes(p?.rtcControl)&&equal([p?.rtcPolicy,p?.rtcControl],[baseline?.privileged?.rtcPolicy,baseline?.privileged?.rtcControl]));
  check(phase,'原有可信档案完整保持',p?.verified===raw.baselineVerifiedCount&&p?.profileHash===raw.baselineProfileHash);
  check(phase,'原有规则绑定全程保留',p?.bound===raw.baselineBoundCount);
  check(phase,'特权摘要来源标注明确',record.source==='user-copied-read-only-counts'||(['la-new','off-new'].includes(phase)&&record.source==='previous-phase-readback'));
  const expected=['utc','la-old'].includes(phase)?utc:['la-new','off-old'].includes(phase)?la:native;
  check(phase,'iframe首次和当前值、classic/module Blob Worker符合该文档快照',signalsMatch(o,expected));
  const expectedHeader=['baseline','restored','off-new'].includes(phase)?baseline?.observation?.child?.header:'en-US,en;q=0.9';
  check(phase,'iframe导航请求头符合创建时配置',typeof o?.child?.header==='string'&&o.child.header===expectedHeader);
}
if(baseline){
  check('baseline','完整当前配置摘要等于原始备份',baseline.privileged.configHash===raw.baselineHash&&raw.baselineChecks?.configMatches&&raw.baselineChecks?.profilesMatch);
  check('baseline','只读门禁确认父子及Worker原生可比较',raw.baselineChecks?.realmsComparable&&raw.baselineChecks?.chrome155);
}
for(const [phase,previous,same]of [['utc','baseline',false],['la-old','utc',true],['la-new','la-old',false],['off-old','la-new',true],['off-new','off-old',false],['restored','off-new',false]]){
  const a=records.get(phase)?.observation,b=records.get(previous)?.observation;if(!a||!b)continue;
  check(phase,same?'旧父页及iframe没有重载':'完整重载产生新的父子文档',Boolean(a.parent?.token&&a.child?.token&&b.parent?.token&&b.child?.token)&&(a.parent.token===b.parent.token)===same&&(a.child.token===b.child.token)===same);
}
for(const phase of ['utc','la-old','la-new']){
  const p=records.get(phase)?.privileged;if(!p)continue;
  check(phase,'语言时区、定位、字体注册已建立且计数读回一致',['page','geo','font'].every(k=>p[k]>0&&p[k+'Count']===p[k]&&p[k+'State']==='ready'));
  check(phase,'请求头所属规则已建立且无遗留注册',p.dynamic>0&&p.legacy===0&&p.session===0);
  check(phase,'注册及请求头同步成功',['status','headers','content','webrtc'].every(k=>p[k]==='ok'));
}
const old=records.get('la-old');
if(records.has('utc'))check('utc','新建观测标签没有之前的页面重载欠账',records.get('utc').privileged.probeTabs===1&&records.get('utc').privileged.probePageDebt===0);
if(old){
  check('la-old','仅时区变化给同一观测标签新增页面重载欠账',old.privileged.probeTabs===1&&old.privileged.probePageDebt===1);
  check('la-old','页面时区变化触发持久化重载提示',old.privileged.pageReload===true);
  check('la-old','用户确认动态页面语言时区提示可见',old.sawHint===true);
  if(records.has('utc'))check('la-old','时区变更没有改变请求头规则',old.privileged.headerHash===records.get('utc').privileged.headerHash);
}
for(const phase of ['off-old','off-new']){
  const p=records.get(phase)?.privileged;if(!p)continue;
  check(phase,'关闭后所属脚本及请求头规则读回为零',['page','geo','font','legacy','dynamic','session'].every(k=>p[k]===0));
  check(phase,'三种页面注册状态为disabled且数量确认零',['page','geo','font'].every(k=>p[k+'State']==='disabled'&&p[k+'Count']===0));
  check(phase,'关闭清理同步成功',['status','headers','content','webrtc'].every(k=>p[k]==='ok'));
}
const restored=records.get('restored');
if(restored&&baseline){
  check('restored','恢复后的完整配置摘要等于测试前',restored.privileged.configHash===baseline.privileged.configHash);
  const keys=['page','geo','font','legacy','dynamic','session','headerHash','pageState','geoState','fontState','pageCount','geoCount','fontCount','status','headers','content','webrtc'];
  check('restored','注册、请求头及同步状态回到当前基线',keys.every(k=>equal(restored.privileged[k],baseline.privileged[k])));
}
const failed=checks.filter(x=>!x.pass);
const collectionComplete=raw.status==='COLLECTED'&&raw.cleanup?.serverClosed===true&&raw.cleanup?.controlRemoved===true;
const result={task:'VG-039',status:failed.length?'OBSERVED_FAILURES':pending.length||!collectionComplete?'INCOMPLETE':'PASS',sourceSha256:createHash('sha256').update(bytes).digest('hex'),checks,passed:checks.length-failed.length,failed:failed.length,pending,collectionComplete,limitations:raw.limitations,cleanup:raw.cleanup};
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,passed:result.passed,failed:result.failed,pending:result.pending}));
