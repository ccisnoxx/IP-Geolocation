#!/usr/bin/env node
// 只读重算Chrome138原始观测；不启动浏览器、不将负例中的VG034_DONE=false当作生产回归。
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dir=process.argv[2];assert.ok(dir,'需要VG-036证据目录');
const load=async n=>JSON.parse(await readFile(dir+'/'+n,'utf8'));
const p=await load('chrome-evidence.json'),q=await load('qualification-evidence.json'),r=await load('reload-evidence.json');
assert.equal(p.chrome,'Chrome/138.0.7204.183');assert.equal(q.browser,p.chrome);assert.equal(r.chrome,p.chrome);
assert.equal(p.status,'PASS');assert.equal(p.cleanup,'PASS');assert.ok(!p.errors?.length);assert.equal(p.production.length,7);assert.ok(p.checks.every(c=>c.passed));
const parsed=(row,key)=>row.records.filter(s=>s.startsWith(key+' ')).map(s=>JSON.parse(s.slice(key.length+1)));
const normal=p.production.filter(x=>x.policy==='normal');assert.equal(normal.length,4);
for(const row of normal){const chains=parsed(row,'VG034_CHAIN');assert.equal(chains.length,4);assert.ok(chains.every(x=>x.levels===3&&x.firstMatches&&x.dependencyMatches&&x.earlyMessages));assert.equal(parsed(row,'VG034_PARENT_TERMINATE')[0].passed,true)}
const connect=p.production.find(x=>x.policy==='connect-blocked');assert.ok(connect.warnings.some(s=>s.includes('本次语言/时区未同步')));const cc=parsed(connect,'VG034_CHAIN');assert.equal(cc.length,4);assert.ok(cc.every(x=>!x.firstMatches&&!x.dependencyMatches&&x.earlyMessages));assert.equal(parsed(connect,'VG034_PARENT_TERMINATE')[0].leafTimeZone,normal[0].first.timeZone);
for(const policy of ['script-blocked','worker-blocked']){const row=p.production.find(x=>x.policy===policy);assert.equal(parsed(row,'VG034_FAILURE').length,4);assert.equal(parsed(row,'VG034_DONE')[0].passed,false)}
assert.equal(q.result,'PASS');assert.equal(q.cleanup,'PASS');assert.equal(q.rows.length,40);assert.ok(q.rows.every(x=>x.passed&&x.settled===0&&x.localLive.length===0));
assert.equal(r.result,'PASS');assert.equal(r.cleanup,'PASS');assert.equal(r.checks.length,7);assert.ok(r.checks.every(x=>x.passed));
const keys=['language','languages','timeZone'];const pick=x=>Object.fromEntries(keys.map(k=>[k,x[k]]));
assert.deepEqual(r.observations.disabledOldDocument,r.observations.enabled);assert.deepEqual(r.observations.disabledAfterReload,pick(normal[0].first));assert.deepEqual(r.observations.reenabledBeforeReload,r.observations.disabledAfterReload);assert.deepEqual(r.observations.reenabledAfterReload,r.observations.enabled);
console.log(`PASS: ${p.checks.length} 生产断言、40组独立资格对照、7项reload边界；不代表HTTP(S)/SharedWorker恢复。`);
