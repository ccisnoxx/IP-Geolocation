#!/usr/bin/env node
// 对保留原始观测做可重复判定；不启动浏览器，不替代原生 UI 人工过程证据。
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=join(root,'docs/stabilization/chrome138');
const observations=await readFile(join(directory,'observations.json'));
const tls=await readFile(join(directory,'https.json'));
const data=JSON.parse(observations),https=JSON.parse(tls),checks=[];
function check(name,verify){verify();checks.push({name,result:'PASS'});}
function report(phase){const p=data.phases[phase];assert.equal(p.navigations.length,1,phase);assert.equal(p.reports.length,1,phase);const r=p.reports[0];assert.equal(r.nonce,p.navigations[0].nonce);assert.equal(r.header,p.navigations[0].header);assert.equal(r.subresourceHeader,r.header);assert.equal(r.firstInline,true);return r;}
function values(r){const {language,languages,timezone,fonts,header,subresourceHeader}=r;return {language,languages,timezone,fonts,header,subresourceHeader};}
const native=report('native'),enabled=report('enabled');
check('只接受已记录的提前重启拒绝，其余采集错误不得忽略',()=>assert.deepEqual(data.errors,[{command:'restart',message:'必须先用UI完全退出\n\nnull !== 0\n'}]));
check('Chrome 138 实际版本与已完成清理',()=>{assert.equal(data.chrome,'Chrome/138.0.7204.183');assert.equal(data.result,'OBSERVATIONS_COMPLETE');assert.equal(data.cleanup,'PASS');});
check('新安装关闭且无规则，缺用户脚本开关准确报告',()=>{const s=data.phases.installed.state;assert.equal(s.masterEnabled,false);assert.deepEqual(s.rules,[]);assert.equal(s.dynamicCount,0);assert.equal(s.sync.pageRuntime.state,'switch-required');});
check('已确认推荐不隐式保存规则或启用',()=>{const s=data.phases.recommendation.state;assert.equal(s.masterEnabled,false);assert.deepEqual(s.rules,[]);assert.deepEqual(s.verified,['verified']);assert.match(s.ui.recommendation,/ja-JP/);assert.match(s.ui.recommendation,/未交叉验证/);assert.equal(data.providerRequests,1);});
check('明确应用后页面、定位、字体注册与语言头同步成功',()=>{const s=data.phases.enabled.state;assert.equal(s.masterEnabled,true);assert.equal(s.sync.status,'ok');for(const k of ['pageRuntime','geolocationRuntime','fontRuntime'])assert.equal(s.sync[k].state,'ready');assert.equal(s.sync.components.headers.status,'ok');assert.equal(s.dynamicCount,4);assert.deepEqual(s.rules.map(r=>r.domain),['localhost','example.com']);});
check('匹配首inline语言、时区与实际导航/子请求头一致',()=>{assert.equal(enabled.language,'ja-JP');assert.deepEqual(enabled.languages,['ja-JP','ja']);assert.equal(enabled.timezone,'Asia/Tokyo');assert.equal(enabled.header,'ja-JP,ja;q=0.9');assert.notEqual(native.language,enabled.language);assert.notEqual(native.timezone,enabled.timezone);});
check('固定字体过滤有原生正对照',()=>{assert.equal(native.fonts.pingfang,true);assert.equal(enabled.fonts.pingfang,false);assert.notEqual(native.fonts.times,native.fonts.sans);assert.equal(enabled.fonts.times,enabled.fonts.sans);assert.equal(enabled.fonts.sans,native.fonts.sans);assert.equal(enabled.fonts.serif,native.fonts.serif);});
check('未匹配站点保持原生',()=>assert.deepEqual(values(report('unmatched')),values(native)));
for(const [phase,expected]of [['enabled-restart-clean',enabled],['disabled-restart',native]]){
 check(phase+' 完整退出、单次首导航和首inline在CDP前一致',()=>{const p=data.phases[phase],r=report(phase);assert.equal(p.navigations[0].host.startsWith('localhost:'),true);assert.equal(p.navigations[0].path,'/probe');assert.equal(p.navigations[0].beforeCdp,true);assert.equal(r.beforeCdp,true);assert.deepEqual(values(r),values(expected));const cold=data.coldStarts.find(c=>c.phase===phase);assert.equal(cold.gracefulExit,true);assert.equal(cold.observedProcessTreeExited,true);assert.ok(cold.observedProcessCount>1);assert.equal(cold.noStartupUrl,true);});
}
check('总开关关闭保存并重载后原生，规则退出且配置跨重启保持',()=>{for(const phase of ['disabled','disabled-restart']){const s=data.phases[phase].state;assert.equal(s.masterEnabled,false);assert.equal(s.dynamicCount,0);assert.equal(s.sync.status,'ok');for(const k of ['pageRuntime','geolocationRuntime','fontRuntime'])assert.equal(s.sync[k].registeredRuleCount,0);}assert.deepEqual(values(report('disabled')),values(native));});
check('真实HTTPS两次网络响应可信且语言头随开关恢复',()=>{assert.deepEqual(https.failures,[]);assert.equal(https.responses.length,2);for(const r of https.responses){assert.equal(r.status,200);assert.equal(r.securityState,'secure');assert.equal(r.protocol,'TLS 1.3');assert.equal(r.subjectName,'example.com');assert.equal(r.fromServiceWorker,false);assert.equal(r.fromDiskCache,false);}assert.equal(https.responses[0].acceptLanguage,enabled.header);assert.equal(https.responses[1].acceptLanguage,native.header);});
check('HTTPS页面语言/时区/合成定位生效，旧快照保留与重载恢复',()=>{const [on,old,off]=https.observations;assert.equal(on.phase,'enabled');assert.equal(on.secure,true);assert.equal(on.language,enabled.language);assert.deepEqual(on.languages,enabled.languages);assert.equal(on.timezone,enabled.timezone);assert.deepEqual(on.geolocation,{latitude:0,longitude:0});assert.equal(old.phase,'disabled-old-document');assert.equal(old.language,on.language);assert.equal(off.phase,'disabled-reloaded');assert.equal(off.secure,true);assert.equal(off.language,native.language);assert.deepEqual(off.languages,native.languages);assert.equal(off.timezone,native.timezone);assert.equal(off.geolocation,'not-called');});
const h=createHash('sha256');
async function visit(relative=''){for(const item of(await readdir(join(root,'dist',relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(!relative&&item.name==='_metadata')continue;const p=join(relative,item.name);if(item.isDirectory())await visit(p);else{h.update(p);h.update(await readFile(join(root,'dist',p)));}}}
await visit();check('实际dist与浏览器取证构建指纹一致',()=>assert.equal(h.digest('hex'),data.distSha256));
const summary={result:'PASS',scope:'selected Chrome 138 machine evidence assertions; human acceptance recorded separately',checks,
 evidenceSha256:{observations:createHash('sha256').update(observations).digest('hex'),https:createHash('sha256').update(tls).digest('hex')},
 excludedAttempts:['首次浏览器准备超过20秒等待窗口，未开始正式产品验收','enabled-restart 出现系统窗口恢复提示且自动导航未完成；后续手动诊断不得计入首请求通过','第一次restart命令在浏览器尚未退出时被拒绝，保留原始errors'],
 limitations:['原生安装/操作过程由人工操作记录支持，JSON不能单独证明鼠标操作来源','HTTPS为实际网络响应和加载后页面观测，未测HTTPS最早inline或HTTPS会话恢复','Chrome138仅当前macOS arm64、新安装、单窗口单活动HTTP标签正常恢复；不是全部138补丁版本、其他OS、升级迁移、多窗口或崩溃恢复通过','关闭后未调用原生定位，不能宣称实际传感器交付已验证']};
await writeFile(join(directory,'verification.json'),JSON.stringify(summary,null,2)+'\n');console.log(`Chrome 138 evidence PASS: ${checks.length} checks`);
