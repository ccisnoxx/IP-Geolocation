#!/usr/bin/env node
// 只观测普通 HTTP(S) 页面和本页 Blob；不读取、保存或修改扩展配置。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

assert.equal(process.argv[2], '--output');
assert.equal(process.argv[4], '--control');
const output = resolve(process.argv[3]), control = resolve(process.argv[5]);
assert.ok(!existsSync(output) && !existsSync(control), '保留已有证据或控制文件');
const source = await readFile(new URL('./chrome-audit-regression.mjs', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('collector.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name) {
  const nodes = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.equal(nodes.length, 1, `采集器函数必须唯一：${name}`);
  return nodes[0].getText(parsed);
}
// 保留坏实现的 new.target 异常为失败数据，让其余合同继续接受检查。
let realmProbe = declaration('realmProbe');
const construction = 'const custom = Reflect.construct(Date, [0], Custom);';
const result = 'custom: { prototype: Object.getPrototypeOf(custom) === Custom.prototype, time: Date.prototype.getTime.call(custom) }';
assert.equal(realmProbe.split(construction).length, 2);
assert.equal(realmProbe.split(result).length, 2);
realmProbe = realmProbe.replace(construction, 'let customResult; try { const custom = Reflect.construct(Date, [0], Custom); customResult = { prototype: Object.getPrototypeOf(custom) === Custom.prototype, time: Date.prototype.getTime.call(custom) }; } catch (error) { customResult = { error: error.name, message: error.message }; }')
  .replace(result, 'custom: customResult');
const probeSource = [realmProbe, ...['nativeLocaleReference', 'startChain', 'blobCases', 'lifecycleCases'].map(declaration)].join('\n');
const evidence = {
  task: 'VG-039', status: 'IN_PROGRESS', configurationChanged: false,
  scope: '已有个人Chrome，当前配置的只读页面／Blob观测',
  collectorSha256: createHash('sha256').update(source).digest('hex'),
  probeSha256: createHash('sha256').update(probeSource).digest('hex'),
  checks: [], observations: {}, errors: [],
  limitations: ['不访问chrome://或chrome-extension://，不使用扩展管理API或页面桥',
    'Date自定义new.target异常仅转为错误记录；仍由原始checkRealm断言判失败，不替换成功值',
    '不修改其他扩展或浏览器设置；不会执行原采集器的配置写入或总开关操作',
    '页面探针为加载后观测，不能证明页面首业务脚本；Blob记录其入口与依赖首读',
    '关闭注册清理、iframe配置变化及原配置无损恢复尚未验证']
};
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
const check = async (name, operation) => {
  try { await operation(); evidence.checks.push({name, passed: true}); }
  catch (error) { evidence.checks.push({name, passed: false, error: error.message}); }
};
const checkRealm = vm.runInThisContext('(assert, Date, check, evidence) => (' + declaration('checkRealm') + ')')(assert, Date, check, evidence);
let origin, closing = false, queue = Promise.resolve();
async function accept(body) {
  if (body.kind === 'native') {
    assert.ok(!evidence.observations.native, '原生基线不可覆盖');
    assert.ok(body.probe && body.nativeLocales && body.browser);
    evidence.observations.native = body.probe;
    evidence.observations.nativeLocales = body.nativeLocales;
    evidence.browser = body.browser;
  } else {
    assert.equal(body.kind, 'current-page');
    assert.ok(evidence.observations.native, '先采集未匹配回环页面基线');
    assert.ok(!evidence.observations.current, '产品观测不可覆盖');
    const want = {language:'en-US', languages:['en-US','en'], locale:'en-US', timeZone:'America/Los_Angeles', winter:480, summer:420};
    evidence.expected = {intlMode:'strict', signal:want, source:'用户提供的表单导出，经config-resolver解析；未验证持久化快照'};
    evidence.observations.current = body;
    await checkRealm('current-page', body.probe, want, 'en-US', 'America/Los_Angeles');
    await check('Blob:four-chain-combinations', () => assert.deepEqual(body.chains.map(row => row.chain.slice(0,2).join('/')).sort(), ['classic/classic','classic/module','module/classic','module/module']));
    for (const chain of body.chains) {
      const label = 'Blob:' + chain.chain.join('>');
      await check(label + ':three-levels-and-early-message', () => {
        assert.equal(chain.records?.length, 3); assert.ok(chain.records.every(row => row.echo === 'early-message'));
      });
      for (const [index, record] of (chain.records || []).entries()) {
        await checkRealm(label + ':' + index, record.first, want, 'en-US', 'America/Los_Angeles');
        await check(label + ':' + index + ':dependency-signals', () => assert.deepEqual(record.dependency.signal, want));
        if (record.type === 'module') await checkRealm(label + ':' + index + ':dependency', record.dependency, want, 'en-US', 'America/Los_Angeles');
      }
    }
    for (const row of body.lifecycle) await check('Blob:' + row.type + ':' + row.kind, () => assert.equal(row.result, row.kind === 'terminate' ? 'terminated-without-message' : 'worker-error'));
    evidence.status = evidence.checks.every(row => row.passed) ? 'PARTIAL_PASS' : 'FAIL';
  }
  await save();
}
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/source') {
    const escaped = probeSource.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>VanishGeo 只读探针源</title><h1>只读探针源</h1><p>仅用于普通网页的 Intl/Date 和 Blob 观测；不修改配置。</p><pre id="source">' + escaped + '</pre>');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/observations') { response.writeHead(404); response.end('Not Found'); return; }
  if (request.headers.origin !== origin) { response.writeHead(403); response.end('Forbidden'); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw new Error('OBSERVATION_TOO_LARGE');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const operation = queue.then(() => accept(body));
    queue = operation.catch(() => {});
    await operation;
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify({status:evidence.status, checks:evidence.checks.length, failed:evidence.checks.filter(row => !row.passed).map(row => row.name)}));
  } catch (error) {
    response.writeHead(400, {'Content-Type':'application/json'});
    response.end(JSON.stringify({error:error.message}));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = 'http://localhost:' + server.address().port;
await writeFile(control, JSON.stringify({origin, pid:process.pid}) + '\n');
await save();
console.log('OBSERVER_READY', origin + '/source');
async function finish() {
  if (closing) return; closing = true;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await queue; await rm(control, {force:true});
  evidence.cleanup = {serverClosed:!server.listening}; await save();
  console.log('OBSERVER_CLOSED', evidence.status); process.exitCode = 0;
}
process.once('SIGINT', finish); process.once('SIGTERM', finish);
