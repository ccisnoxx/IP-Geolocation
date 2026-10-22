import json
from pathlib import Path
root=Path(__file__).resolve().parent
e=json.loads((root/'chrome-evidence.json').read_text())
assert len(e['results'])==9
cases={c['case']:{o['mode']:o for o in c['outcomes']} for c in e['results']}
checks=[]
def check(name, condition):
 assert condition,name
 checks.append(name)
def data(c,m):return cases[c][m]['data']
for c in e['results']:
 check(c['case']+': SharedWorker 未更换',c['sharedUnchanged'])
 check(c['case']+': 无 Service Worker 控制',not c['controlledBySW'])
 for o in c['outcomes']:
  check(c['case']+': '+o['mode']+' 无超时',o['status'] in ['message','error','constructor-error'])
  if o['mode']=='wrapped' and o['status']=='message':
   d=o['data']; snapshots=[d['first'],d['dep']['first']]
   if d['dynamic']['ok']:snapshots.append(d['dynamic']['value']['first'])
   check(c['case']+': 入口与依赖美西快照',all(s=={'language':'en-US','languages':['en-US','en'],'timezone':'America/Los_Angeles','winter':480,'summer':420} for s in snapshots))
for c in ['baseline','redirect']:
 n,w=data(c,'native'),data(c,'wrapped')
 for k in ['dynamic','asset','moduleRelativeChild']:
  check(c+': 模块相对 '+k,n[k]['ok'] and w[k]['ok'])
 for k in ['relativeFetch','relativeXHR','relativeChild']:
  check(c+': 全局相对不兼容 '+k,n[k]['ok'] and not w[k]['ok'])
 check(c+': 依赖最终 URL 相同',n['dep']['url']==w['dep']['url'])
 check(c+': 全局 URL 改变',n['location'].startswith('http:') and w['location'].startswith('blob:'))
check('页面 worker-src self 阻止包装',cases['page-worker-self']['native']['status']=='message' and cases['page-worker-self']['wrapped']['status']=='error')
check('页面 worker-src none 阻止两者',all(o['status']=='error' for o in cases['page-worker-none'].values()))
for c,k in [('response-connect-none','absoluteFetch'),('response-worker-none','moduleRelativeChild'),('response-script-none','dynamic')]:
 n,w=data(c,'native'),data(c,'wrapped')
 check(c+': 原策略丢失',not n[k]['ok'] and w[k]['ok'] and bool(n['violations']) and not w['violations'])
check('页面连接限制反向继承',data('page-connect-none','native')['absoluteFetch']['ok'] and not data('page-connect-none','wrapped')['absoluteFetch']['ok'])
check('Report-Only 报告丢失',bool(data('response-report-only','native')['violations']) and not data('response-report-only','wrapped')['violations'])
assert e['verification']['count']==len(checks)
assert e['verification']['checks']==checks
print(f'{len(checks)} 项历史证据断言通过；结论 NOT_EQUIVALENT；未启动 Chrome。')
