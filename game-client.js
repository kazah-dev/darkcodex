/** Bitburner Bridge: local conversation window and explicit game command adapter. */
const h=(...args)=>React.createElement(...args);
const colors={bg:'#0b1420',panel:'#152333',border:'#2b4054',ink:'#e7eff7',muted:'#9fb2c7',accent:'#79e2c3',blue:'#90bdff',warn:'#f0c47b'};
const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n||0);
const button={padding:'9px 13px',border:'1px solid '+colors.border,borderRadius:8,background:'#203449',color:colors.ink,cursor:'pointer',fontSize:13};
const safeFile=name=>typeof name==='string'&&/^[\w./-]{1,150}\.(js|ns|ts|txt)$/.test(name)&&!name.includes('..')&&!name.startsWith('/')&&!/bridge|config|secret|credential|token|save|\.env/i.test(name);
function hosts(ns){const found=['home'];for(const host of found)for(const peer of ns.scan(host))if(!found.includes(peer))found.push(peer);return found;}
function snapshot(ns){
  const all=hosts(ns),player=ns.getPlayer();let ram=0,used=0,rooted=0,processes=[];
  for(const host of all){const s=ns.getServer(host);if(s.hasAdminRights){rooted++;ram+=s.maxRam;used+=s.ramUsed;}processes.push(...ns.ps(host).map(p=>({host,...p})));}
  let controller=null;try{controller=JSON.parse(ns.read('cycle-status.txt')||'null');}catch{}
  return {at:Date.now(),money:player.money,hacking:player.skills.hacking,city:player.city,factions:player.factions,ram,used,rooted,servers:all.length,processes,controller};
}
export async function dispatch(ns,name,args){
  if(name==='game_status')return snapshot(ns);
  if(name==='game_servers')return hosts(ns).map(host=>{const s=ns.getServer(host);return {host,root:s.hasAdminRights,level:s.requiredHackingSkill,ports:s.numOpenPortsRequired,ram:s.maxRam,used:s.ramUsed,money:s.moneyAvailable,maxMoney:s.moneyMax,security:s.hackDifficulty,minSecurity:s.minDifficulty};});
  if(name==='game_files'){if(typeof args.host!=='string'||!ns.serverExists(args.host))throw Error('Unknown server');return ns.ls(args.host).filter(safeFile);}
  if(name==='game_read_script'){if(!safeFile(args.filename))throw Error('Protected or invalid filename');if(!ns.fileExists(args.filename,'home'))throw Error('File does not exist');const content=ns.read(args.filename);if(content.length>100000)throw Error('File too large');return {filename:args.filename,content};}
  if(name==='game_run_script'){
    if(!safeFile(args.filename)||!ns.fileExists(args.filename,'home')||!args.filename.endsWith('.js'))throw Error('Invalid or missing JavaScript script');
    if(!Number.isSafeInteger(args.threads)||args.threads<1||args.threads>100000||!Array.isArray(args.args)||args.args.length>20||args.args.some(x=>!['string','number','boolean'].includes(typeof x)))throw Error('Invalid run arguments');
    const cost=ns.getScriptRam(args.filename,'home')*args.threads;
    if(cost<=0||cost>ns.getServerMaxRam('home')-ns.getServerUsedRam('home'))throw Error('Not enough home RAM, or script has errors');
    const pid=ns.exec(args.filename,'home',args.threads,...args.args);if(!pid)throw Error('Game refused to launch script');return {pid,filename:args.filename,threads:args.threads};
  }
  if(name==='game_stop_script'){
    if(!Number.isSafeInteger(args.pid)||args.pid<1||args.pid===ns.pid)throw Error('Invalid or protected PID');
    const process=hosts(ns).flatMap(host=>ns.ps(host)).find(p=>p.pid===args.pid);if(!process)throw Error('Process no longer exists');
    if(/bridge/i.test(process.filename))throw Error('Bridge processes cannot be stopped through chat');
    if(!ns.kill(args.pid))throw Error('Process was not stopped');return {stopped:args.pid,filename:process.filename};
  }
  throw Error('Unsupported game command');
}

export function ChatWindow({model,send}){
  const [,refresh]=React.useState(0),[draft,setDraft]=React.useState(''),[tab,setTab]=React.useState('Chat');
  const bottom=React.useRef(null),root=React.useRef(null);
  React.useLayoutEffect(()=>{
    const viewport=root.current?.closest('[tabindex="-1"]'),wrapper=viewport?.firstElementChild;if(!wrapper)return;
    const old=[viewport.style.flexDirection,viewport.style.backgroundColor,wrapper.style.flex];
    viewport.style.flexDirection='column';viewport.style.backgroundColor=colors.bg;wrapper.style.flex='1 0 auto';
    return()=>{[viewport.style.flexDirection,viewport.style.backgroundColor,wrapper.style.flex]=old;};
  },[]);
  React.useEffect(()=>{const id=setInterval(()=>refresh(v=>v+1),300);return()=>clearInterval(id);},[]);
  React.useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'});},[model.messages.length,model.messages.at(-1)?.text?.length]);
  const submit=()=>{const text=draft.trim();if(!text||model.busy||!model.connected||!model.codex)return;send({type:'chat',text});setDraft('');};
  const state=model.snapshot||{};
  const pill=(text,color)=>h('span',{style:{fontSize:12,color,padding:'5px 8px',border:'1px solid '+colors.border,borderRadius:20}},text);
  const card=(label,value)=>h('div',{style:{padding:12,background:colors.panel,borderRadius:9}},h('div',{style:{fontSize:11,color:colors.muted,marginBottom:5}},label),h('strong',{style:{fontSize:20}},value));
  return h('div',{ref:root,style:{background:colors.bg,color:colors.ink,fontFamily:'Inter, Segoe UI, sans-serif',height:650,minHeight:440,boxSizing:'border-box',display:'flex',flexDirection:'column',padding:18,gap:12,whiteSpace:'normal',width:'100%',textAlign:'left'}},
    h('header',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}},
      h('div',null,h('div',{style:{fontSize:21,fontWeight:750}},'Bitburner Bridge'),h('div',{style:{fontSize:12,color:colors.muted,marginTop:3}},'Your operations, in conversation')),
      h('div',{style:{display:'flex',gap:6}},pill(model.connected?'Game connected':'Reconnecting…',model.connected?colors.accent:colors.warn),pill(model.codex?'Codex ready':'Codex offline',model.codex?colors.blue:colors.warn))),
    h('div',{style:{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}},card('BALANCE','$'+compact(state.money)),card('HACKING',compact(state.hacking)),card('NETWORK RAM',state.ram?Math.round(100*state.used/state.ram)+'%':'—'),card('SERVERS',state.servers?state.rooted+' / '+state.servers:'—')),
    h('nav',{style:{display:'flex',gap:8}},...['Chat','Activity'].map(t=>h('button',{key:t,style:{...button,background:tab===t?'#25473f':'#152333'},onClick:()=>setTab(t)},t)),h('span',{style:{marginLeft:'auto',fontSize:12,color:colors.muted,alignSelf:'center'}},model.busy?'Working…':'Ready when you are')),
    model.error&&h('div',{role:'alert',style:{padding:10,border:'1px solid #986835',borderRadius:8,color:colors.warn,fontSize:13}},model.error,h('button',{style:{...button,float:'right',padding:'0 7px'},onClick:()=>{model.error='';}},'Dismiss')),
    h('div',{style:{flex:1,overflowY:'auto',minHeight:130,paddingRight:4}},
      tab==='Chat'?h(React.Fragment,null,
        !model.messages.length&&h('div',{style:{padding:'26px 15px',color:colors.muted,textAlign:'center',lineHeight:1.6}},h('h3',{style:{color:colors.ink,margin:'0 0 8px'}},'A conversation with your live game'),h('div',null,'Ask what is happening, inspect a script, or plan your next upgrade.'),h('div',{style:{fontSize:12,marginTop:10}},'Game changes appear for your approval. This is a separate conversation from the desktop app.')),
        ...model.messages.map(m=>h('article',{key:m.id,style:{margin:'0 0 12px',padding:14,borderRadius:10,background:m.role==='user'?'#1d3747':colors.panel,border:'1px solid '+colors.border}},h('div',{style:{fontSize:11,fontWeight:700,color:m.role==='user'?colors.blue:colors.accent,marginBottom:7}},m.role==='user'?'YOU':'ASSISTANT'),h('div',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:14,lineHeight:1.6}},m.text))),h('div',{ref:bottom})):
        h('div',null,!model.audit.length&&h('p',{style:{color:colors.muted}},'Actions and their confirmed results will appear here.'),...model.audit.slice().reverse().map((a,i)=>h('div',{key:i,style:{padding:'11px 0',borderBottom:'1px solid '+colors.border,fontSize:13}},h('strong',{style:{color:a.status==='completed'?colors.accent:a.status==='failed'?colors.warn:colors.blue}},a.name+' · '+a.status),h('div',{style:{color:colors.muted,marginTop:5}},a.detail))))),
    ...model.approvals.map(a=>h('div',{key:a.id,style:{background:'#28251d',border:'1px solid #927647',padding:12,borderRadius:10}},h('strong',null,'Review game action: '+a.name),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:170,overflow:'auto',fontSize:12}},JSON.stringify(a.args,null,2)),h('button',{style:{...button,background:'#245244'},onClick:()=>send({type:'approval',id:a.id,accept:true})},'Approve action'),h('button',{style:{...button,marginLeft:8},onClick:()=>send({type:'approval',id:a.id,accept:false})},'Decline'))),
    h('div',{style:{display:'flex',gap:8}},h('textarea',{'aria-label':'Message',placeholder:'Ask about your game…',value:draft,rows:2,onChange:e=>setDraft(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}},style:{flex:1,resize:'vertical',minHeight:45,maxHeight:140,border:'1px solid '+colors.border,borderRadius:9,padding:10,background:'#101e2c',color:colors.ink,font:'14px Segoe UI, sans-serif'}}),h('button',{disabled:!draft.trim()||model.busy||!model.connected||!model.codex,onClick:submit,style:{...button,background:colors.accent,color:'#071912',opacity:!model.connected||!model.codex?.valueOf()||model.busy?.valueOf()?0.5:1}},'Send'),h('button',{disabled:!model.busy,onClick:()=>send({type:'interrupt'}),style:button},'Stop')),
    h('footer',{style:{fontSize:11,color:colors.muted}},'Local connection · Enter to send · Shift+Enter for a new line · Closing this window does not stop your game automation')
  );
}

/** @param {NS} ns */
export async function main(ns){
  if(ns.getHostname()!=='home')throw Error('Run bridge.js on home');
  if(ns.ps('home').filter(p=>p.filename===ns.getScriptName()).length>1)throw Error('Bridge is already running');
  ns.disableLog('ALL');
  const config=JSON.parse(ns.read('bridge-config.txt')||'null');
  if(!config||!/^ws:\/\/127\.0\.0\.1:\d+\/game$/.test(config.url))throw Error('Run npm run install-game while the Remote API is connected');
  const model={connected:false,codex:false,busy:false,messages:[],audit:[],approvals:[],error:'',snapshot:null};
  let ws=null,nextConnect=0,lastSnapshot=0,queue=[],running=true;
  const send=m=>{if(ws?.readyState===1)ws.send(JSON.stringify(m));};
  const connect=()=>{
    ws=new WebSocket(config.url);
    ws.onopen=()=>send({type:'hello',token:config.token});
    ws.onclose=()=>{model.connected=false;model.codex=false;nextConnect=Date.now()+3000;queue=[];};
    ws.onerror=()=>{model.error='Local bridge unavailable. Start npm start, reconnect Remote API and run npm run install-game after restarting the service.';};
    ws.onmessage=e=>{
      try{const m=JSON.parse(e.data);
        if(m.type==='welcome'){model.connected=true;model.codex=m.codex;model.busy=m.busy;model.messages=m.history;model.audit=m.audit;model.approvals=[];model.error='';}
        if(m.type==='connection'){model.codex=m.codex;if(m.message&&!m.codex)model.error=m.message;}
        if(m.type==='message'){const old=model.messages.find(x=>x.id===m.id);if(old)Object.assign(old,m);else model.messages.push(m);}
        if(m.type==='delta'){let old=model.messages.find(x=>x.id===m.id);if(!old){old={id:m.id,role:'assistant',text:''};model.messages.push(old);}old.text+=m.text;}
        if(m.type==='busy')model.busy=true;
        if(m.type==='done'){model.busy=false;if(m.error)model.error=m.error;}
        if(m.type==='error'){model.error=m.message;model.busy=false;}
        if(m.type==='audit')model.audit=m.items;
        if(m.type==='approval')model.approvals.push(m);
        if(m.type==='approvalClosed')model.approvals=model.approvals.filter(a=>a.id!==m.id);
        if(m.type==='command'&&queue.length<30)queue.push(m);
      }catch{model.error='Received an invalid bridge message';}
    };
  };
  ns.ui.openTail();const [width,height]=ns.ui.windowSize();ns.ui.resizeTail(Math.min(960,width-40),Math.min(740,height-100));ns.ui.moveTail(Math.max(10,Math.min(300,width-980)),45);ns.ui.setTailTitle('Bitburner Bridge / Conversation');
  ns.clearLog();ns.printRaw(h(ChatWindow,{model,send}));
  ns.atExit(()=>{running=false;ws?.close();});
  connect();
  while(running){
    if(ws?.readyState===3&&Date.now()>=nextConnect)connect();
    const command=queue.shift();if(command){try{send({type:'result',id:command.id,result:await dispatch(ns,command.name,command.args||{})});}catch(e){send({type:'result',id:command.id,error:String(e.message||e)});}}
    if(Date.now()-lastSnapshot>2000){lastSnapshot=Date.now();try{model.snapshot=snapshot(ns);send({type:'snapshot',data:model.snapshot});}catch(e){model.error=String(e.message||e);}}
    await ns.sleep(100);
  }
}
