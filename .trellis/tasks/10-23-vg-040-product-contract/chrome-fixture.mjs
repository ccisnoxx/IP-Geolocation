// VG-040 当前Chrome验收用本机观测页；不注入扩展实现、不接收预期配置。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../../src/shared/font-families.ts', import.meta.url), 'utf8');
const blocked = [...source.matchAll(/^  '([^']+)'/gm)].map(match => match[1]);
if (blocked.length !== 43) throw new Error('固定名单必须为43项');
const probe = `async function scan() {
  const blocked=${JSON.stringify(blocked)};
  const ordinary=['VG040 Normal Probe','Mi Sans','PingFangSC','PingFang  SC','PingFang\\u00a0SC','测试字体'];
  const faces=[...blocked,...ordinary];
  const loaded=await Promise.all(faces.map(async name=>{
    const face=new FontFace(name,'local("Courier New"), local("Courier"), local("Liberation Mono")');
    document.fonts.add(await face.load());return face.status==='loaded';
  }));
  const ctx=document.createElement('canvas').getContext('2d');
  const text='Vg040 AaWWWiiii xyz 0123456789';
  const measure=font=>{ctx.font=font;const saved=ctx.font;const m=ctx.measureText(text);return {width:m.width,restored:ctx.font===saved,nativeMetrics:m instanceof TextMetrics};};
  const baseline=measure('40px serif');
  const normal=measure('40px "VG040 Normal Probe", serif');
  const targets=blocked.map(name=>({name,visible:document.fonts.check('40px "'+name+'"'),...measure('40px "'+name+'", serif')}));
  const nonTargets=ordinary.map(name=>({name,visible:document.fonts.check('40px "'+name+'"'),...measure('40px "'+name+'", serif')}));
  const result={first:firstRead,language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    loaded:loaded.every(Boolean),positiveWidthControl:normal.width!==baseline.width,
    blockedChecks:targets.filter(x=>!x.visible).length,blockedWidths:targets.filter(x=>x.width===baseline.width).length,
    nativeTargetWidths:targets.filter(x=>x.width===normal.width).length,
    ordinaryChecks:nonTargets.every(x=>x.visible),ordinaryWidths:nonTargets.every(x=>x.width===normal.width),
    restored:[...targets,...nonTargets].every(x=>x.restored),nativeMetrics:[...targets,...nonTargets].every(x=>x.nativeMetrics)};
  document.getElementById('result').textContent=JSON.stringify(result,null,2);
  return result;
}`;
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/header') {
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({acceptLanguage:req.headers['accept-language']||null}));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><script>const firstRead={language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};</script><title>VG-040 本机验收</title><style>body{font:16px system-ui;margin:24px}pre{white-space:pre-wrap;background:#eef;padding:16px}iframe{width:95%;height:470px}</style></head><body><h1>VG-040 本机验收</h1><p id="scope"></p><pre id="result">采样中</pre><pre id="headers"></pre>${url.pathname==='/frame'?'':'<h2>同源普通 iframe</h2><iframe src="/frame"></iframe>'}<script>document.getElementById('scope').textContent=location.hostname+' / '+(window===top?'top':'iframe');${probe};scan().catch(error=>{document.getElementById('result').textContent=JSON.stringify({error:error.name+': '+error.message})});fetch('/header').then(r=>r.json()).then(x=>{document.getElementById('headers').textContent=JSON.stringify(x)});</script></body></html>`);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
