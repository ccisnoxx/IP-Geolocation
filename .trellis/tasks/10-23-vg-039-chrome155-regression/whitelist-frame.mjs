// 仅本轮验收：本机父页承载用户指定白名单站点，不访问扩展API或配置。
import {createServer} from 'node:http';
import {writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const [control,port='0']=process.argv.slice(2);
if(!control||existsSync(control))throw new Error('需要新的本轮控制文件');
const html=`<!doctype html><meta charset="utf-8"><title>VG-039 白名单iframe回归</title>
<style>body{font:14px system-ui;margin:12px}pre{white-space:pre-wrap}iframe{width:100%;height:1100px;border:1px solid #aaa}button{padding:8px}</style>
<h1>白名单iframe回归</h1><pre id="parent"></pre>
<p>子文档序号：<span id="generation"></span> <button id="rebuild">重建白名单iframe</button></p><div id="frameSlot"></div>
<script>
const r=Intl.DateTimeFormat().resolvedOptions();
document.getElementById('parent').textContent=JSON.stringify({documentToken:crypto.randomUUID(),language:navigator.language,languages:Array.from(navigator.languages),locale:r.locale,timeZone:r.timeZone,winter:new Date(Date.UTC(2026,0,15)).getTimezoneOffset(),summer:new Date(Date.UTC(2026,6,15)).getTimezoneOffset()});
let generation=0;
function rebuild(){const f=document.createElement('iframe');f.id='targetFrame';f.title='用户指定白名单网站';f.src='https://fuck-claude.vercel.app/zh/';document.getElementById('frameSlot').replaceChildren(f);document.getElementById('generation').textContent=String(++generation);}
document.getElementById('rebuild').onclick=rebuild;rebuild();
</script>`;
const server=createServer((request,response)=>{response.setHeader('Cache-Control','no-store');if(request.method!=='GET'||request.url!=='/parent'){response.writeHead(404);response.end();return;}response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);});
await new Promise(resolve=>server.listen(Number(port),'127.0.0.1',resolve));
const parent='http://127.0.0.1:'+server.address().port+'/parent';
await writeFile(control,JSON.stringify({pid:process.pid,parent})+'\n',{mode:0o600});console.log(parent);
async function finish(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(control);}
process.once('SIGTERM',finish);process.once('SIGINT',finish);
