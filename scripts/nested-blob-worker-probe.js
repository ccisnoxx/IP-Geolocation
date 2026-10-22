// 在当前Chrome DevTools运行；仅创建临时Blob Worker，不发网络请求或改配置。
(async () => {
  function snapshot() {
    return {language:navigator.language,languages:Array.from(navigator.languages),locale:Intl.DateTimeFormat().resolvedOptions().locale,
      timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,winter:new Date(Date.UTC(2026,0,15)).getTimezoneOffset(),summer:new Date(Date.UTC(2026,6,15)).getTimezoneOffset()};
  }
  function start(types) {
    const type=types[0], rest=types.slice(1), urls=[];
    const make=source=>{const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.push(url);return url};
    const dependency=type==='module'?make(`export const first=(${snapshot.toString()})();`):null;
    const source=`${dependency?`import {first as dependency} from ${JSON.stringify(dependency)};`:'"use strict";'}
      const snapshot=${snapshot.toString()}; const first=snapshot();
      const start=${start.toString()};
      onmessage=async event=>{try {
        const rest=${JSON.stringify(rest)};
        const children=rest.length?await start(rest):[];
        postMessage({records:[{type:${JSON.stringify(type)},first,dependency:${dependency?'dependency':'first'},echo:event.data},...children]});
      }catch(e){postMessage({error:e.message})}};`;
    const url=make(source);
    let worker;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(new Error('timeout'))},7000);
      function cleanup(){clearTimeout(timer);worker?.terminate();urls.forEach(url=>URL.revokeObjectURL(url));}
      try {
        worker=new Worker(url,{type});
        worker.onmessage=e=>{cleanup();e.data.error?reject(new Error(e.data.error)):resolve(e.data.records)};
        worker.onerror=e=>{e.preventDefault();cleanup();reject(new Error(e.message||'worker-error'))};
        worker.postMessage('early-message');
        URL.revokeObjectURL(url);
      }catch(e){cleanup();reject(e)}
    });
  }
  const expected=snapshot();
  console.log('VG034_PAGE '+JSON.stringify(expected));
  const results=[];
  for(const parent of ['classic','module']) for(const child of ['classic','module']) {
    try {
      const chain=[parent,child,child==='classic'?'module':'classic'];
      const records=await start(chain);
      const result={chain:chain.join('>'),levels:records.length,firstMatches:records.every(r=>JSON.stringify(r.first)===JSON.stringify(expected)),dependencyMatches:records.every(r=>JSON.stringify(r.dependency)===JSON.stringify(expected)),earlyMessages:records.every(r=>r.echo==='early-message')};
      results.push(result);console.log('VG034_CHAIN '+JSON.stringify(result));
    }catch(e){results.push({chain:parent+'>'+child,error:e.message});console.log('VG034_FAILURE '+JSON.stringify(results.at(-1)))}
  }
  console.log('VG034_DONE '+JSON.stringify({passed:results.length===4&&results.every(r=>r.levels===3&&r.firstMatches&&r.dependencyMatches&&r.earlyMessages)}));
})();

// 父级终止应终止其后代；刻意保留Worker内创建的原URL，观察realm结束时的原生释放。
(async()=>{
  function node(depth){
    onmessage=event=>{
      const port=event.ports[0];
      if(depth){
        const url=URL.createObjectURL(new Blob(['('+node.toString()+')('+(depth-1)+')'],{type:'text/javascript'}));
        const child=new Worker(url);child.postMessage({urls:[...event.data.urls,url]},[port]);
      }else{
        port.postMessage({ready:true,urls:event.data.urls,language:navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
        setInterval(()=>port.postMessage({tick:true}),200);
      }
    };
  }
  const url=URL.createObjectURL(new Blob(['('+node.toString()+')(2)'],{type:'text/javascript'}));
  const root=new Worker(url);URL.revokeObjectURL(url);
  const channel=new MessageChannel();let ticks=0,finished=false;
  const cleanup=()=>{finished=true;clearTimeout(timeout);root.terminate();channel.port1.close();channel.port2.close()};
  const timeout=setTimeout(()=>{cleanup();console.log('VG034_PARENT_TERMINATE '+JSON.stringify({passed:false,error:'timeout'}))},5000);
  channel.port1.onmessage=event=>{
    if(event.data.tick){ticks++;return;}
    if(!event.data.ready)return;
    root.terminate();
    setTimeout(()=>{
      if(finished)return;
      const live=event.data.urls.filter(url=>{try{const x=new XMLHttpRequest();x.open('GET',url,false);x.send();return x.status===200}catch{return false}}).length;
      cleanup();console.log('VG034_PARENT_TERMINATE '+JSON.stringify({passed:ticks===0&&live===0,descendantTicks:ticks,workerOwnedURLsAlive:live,leafLanguage:event.data.language,leafTimeZone:event.data.timeZone}));
    },500);
  };
  root.postMessage({urls:[]},[channel.port2]);
})();
