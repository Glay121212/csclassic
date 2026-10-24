const WebSocket=require('ws');let done=0,res=0;
for(let i=0;i<10;i++){const w=new WebSocket('ws://localhost:'+(process.env.PORT||3000)+'/ws');let me,team;
 w.on('open',()=>w.send(JSON.stringify({t:'hello'})));
 w.on('message',d=>{const m=JSON.parse(d);
  if(m.t==='me'){me=m.me;w.send(JSON.stringify({t:'queue',region:'eu',maps:['de_dust2'],name:'Bot'+i}))}
  if(m.t==='match'){done++;team=m.match.A.includes(me.id)?'A':'B';setTimeout(()=>w.send(JSON.stringify({t:'report',w:'A'})),300)}
  if(m.t==='result'){res++;if(res===10){console.log('matches',done,'results',res,'last delta',m.d,'elo',m.me.elo);process.exit(0)}}})}
setTimeout(()=>{console.log('TIMEOUT',done,res);process.exit(1)},6000);
