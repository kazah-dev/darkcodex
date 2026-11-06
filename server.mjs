import http from 'node:http';
import {WebSocketServer} from 'ws';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CodexClient} from './codex-client.mjs';
import {Pending,validate,mutations} from './tools.mjs';

export const root=path.dirname(fileURLToPath(import.meta.url));
const local=path.join(root,'.local');
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function allowedOrigin(origin){return !origin||origin==='null'||origin==='file://';}

export async function startServer({port=27153,remotePort=27152,withCodex=true,stateDir=local}={}) {
  const local=stateDir;
  await mkdir(path.join(local,'backups'),{recursive:true});
  // A fresh, local-only capability expires on each service restart.
  const token=randomBytes(32).toString('hex');
  let game=null,remote=null,snapshot=null,closed=false;
  const gamePending=new Pending(),remotePending=new Pending(),approvals=new Map(),history=[],audit=[];
  try{const saved=JSON.parse(await readFile(path.join(local,'history.json'),'utf8'));if(Array.isArray(saved))history.push(...saved.slice(-120));}catch{}
  let persist=Promise.resolve();
  const send=(ws,m)=>{if(ws?.readyState===1)ws.send(JSON.stringify(m));};
  const event=m=>{
    if(m.type==='message'){
      const existing=history.find(x=>x.id===m.id);if(existing)Object.assign(existing,m);else history.push(m);
      if(history.length>120)history.shift();
      const saved=JSON.stringify(history);persist=persist.then(()=>writeFile(path.join(local,'history.json'),saved,{mode:0o600})).catch(()=>{});
    }
    send(game,m);
  };
  const note=(name,status,detail)=>{audit.push({name,status,detail,time:Date.now()});if(audit.length>80)audit.shift();event({type:'audit',items:audit});};
  const remoteCall=(method,params={})=>{
    if(remote?.readyState!==1)throw Error('Remote API disconnected. Connect to 127.0.0.1:'+remotePort+' in Bitburner Options.');
    return remotePending.create(id=>send(remote,{jsonrpc:'2.0',id,method,params}));
  };
  const gameCall=(name,args)=>{
    if(game?.readyState!==1)throw Error('Game window disconnected. Run bridge.js on home.');
    return gamePending.create(id=>send(game,{type:'command',id,name,args}));
  };
  const approval=(name,args)=>new Promise((resolve,reject)=>{
    const id=randomBytes(12).toString('hex');
    const timer=setTimeout(()=>{approvals.delete(id);event({type:'approvalClosed',id});reject(Error('Approval expired; nothing executed.'));},180000);
    approvals.set(id,{resolve,reject,timer});
    event({type:'approval',id,name,args});
  });
  async function execute(name,args){
    validate(name,args);
    note(name,'requested',mutations.has(name)?'Waiting for your approval':'Reading game data');
    try{
      if(mutations.has(name))await approval(name,args);
      let result;
      if(name==='game_write_script'){
        const names=await remoteCall('getFileNames',{server:'home'});
        if(names.includes(args.filename)){
          const content=await remoteCall('getFile',{server:'home',filename:args.filename});
          await writeFile(path.join(local,'backups',Date.now()+'-'+args.filename.replaceAll('/','_')),content);
        }
        await remoteCall('pushFile',{server:'home',...args});
        const saved=await remoteCall('getFile',{server:'home',filename:args.filename});
        if(saved!==args.content)throw Error('Write verification failed');
        result={written:args.filename,ram:await remoteCall('calculateRam',{server:'home',filename:args.filename})};
      }else result=await gameCall(name,args);
      note(name,'completed','Result received and verified');return result;
    }catch(e){note(name,'failed',e.message);throw e;}
  }
  const codex=withCodex?new CodexClient({cwd:local,onEvent:event,onTool:execute}):null;
  const api=http.createServer(async(req,res)=>{
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){json(403,{error:'Invalid host'});return;}
    if(req.url==='/health'&&req.method==='GET'){json(200,{game:!!game,remote:!!remote,codex:codex?.ready??false,busy:codex?.busy??false});return;}
    if(req.headers.origin || !equal(req.headers.authorization,'Bearer '+token)){json(403,{error:'Unauthorized'});return;}
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>150000)throw Error('Request too large');}
      const data=body?JSON.parse(body):{};
      if(req.url==='/shutdown'&&req.method==='POST'){json(200,{stopped:true});setImmediate(()=>close());}
      else if(req.url==='/tool'&&req.method==='POST')json(200,{result:await execute(data.name,data.args)});
      else if(req.url==='/install'&&req.method==='POST'){
        const script=await readFile(path.join(root,'game-client.js'),'utf8');
        await remoteCall('pushFile',{server:'home',filename:'bridge.js',content:script});
        await remoteCall('pushFile',{server:'home',filename:'bridge-config.txt',content:JSON.stringify({url:`ws://127.0.0.1:${port}/game`,token})});
        json(200,{installed:true,ram:await remoteCall('calculateRam',{server:'home',filename:'bridge.js'}),next:'run bridge.js'});
      }else json(404,{error:'Not found'});
    }catch(e){json(400,{error:e.message});}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:200000});
  api.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/game'||!allowedOrigin(req.headers.origin)||!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    let authed=false;const timer=setTimeout(()=>ws.close(1008,'Pairing required'),3000);
    ws.on('message',async raw=>{
      try{
        const m=JSON.parse(String(raw));
        if(!authed){
          if(m.type!=='hello'||!equal(m.token,token)||game){ws.close(1008,'Invalid pairing or window already connected');return;}
          clearTimeout(timer);authed=true;game=ws;
          send(ws,{type:'welcome',history,audit,codex:codex?.ready??false,busy:codex?.busy??false});return;
        }
        if(m.type==='result')gamePending.settle(m.id,m.result,m.error);
        else if(m.type==='snapshot')snapshot=m.data;
        else if(m.type==='chat'){
          if(typeof m.text!=='string'||!m.text.trim()||m.text.length>12000)throw Error('Message must contain 1–12,000 characters');
          if(codex?.busy)throw Error('A reply is already in progress');
          if(!codex?.ready)throw Error('Codex is not signed in or connected. Run codex login, then restart.');
          event({type:'message',id:randomBytes(8).toString('hex'),role:'user',text:m.text});
          event({type:'busy'});await codex.chat(m.text);
        }else if(m.type==='interrupt'){for(const [id,p] of approvals){clearTimeout(p.timer);p.reject(Error('Action cancelled'));event({type:'approvalClosed',id});}approvals.clear();await codex?.interrupt();}
        else if(m.type==='approval'){
          const p=approvals.get(m.id);if(!p)return;
          clearTimeout(p.timer);approvals.delete(m.id);
          m.accept===true?p.resolve():p.reject(Error('User declined; nothing executed.'));
          event({type:'approvalClosed',id:m.id});
        }
      }catch(e){event({type:'error',message:e.message});}
    });
    ws.on('error',()=>{});
    ws.on('close',()=>{clearTimeout(timer);if(game===ws){game=null;gamePending.close();for(const p of approvals.values()){clearTimeout(p.timer);p.reject(Error('Window disconnected before approval'));}approvals.clear();}});
  });
  const remoteServer=new WebSocketServer({host:'127.0.0.1',port:remotePort,maxPayload:20*1024*1024,verifyClient:({origin})=>allowedOrigin(origin)});
  remoteServer.on('connection',ws=>{
    if(remote){ws.close(1008,'A game is already connected');return;}remote=ws;console.log('Bitburner Remote API connected. Run npm run install-game, then run bridge.js in the game.');
    ws.on('message',raw=>{try{const m=JSON.parse(String(raw));remotePending.settle(m.id,m.result,m.error);}catch{}});
    ws.on('error',()=>{});ws.on('close',()=>{if(remote===ws){remote=null;remotePending.close();}});
  });
  try{
    await Promise.all([
      new Promise((resolve,reject)=>{api.once('error',reject);api.listen(port,'127.0.0.1',resolve);}),
      new Promise((resolve,reject)=>{remoteServer.once('error',reject);remoteServer.once('listening',resolve);})
    ]);
  }catch(e){remoteServer.close();wss.close();api.close();throw e;}
  // Do not invalidate a running service's capability if a second start fails to bind.
  await writeFile(path.join(local,'connection.json'),JSON.stringify({port,token}),{mode:0o600});
  console.log(`Bitburner Bridge: 127.0.0.1:${port}; game Remote API: 127.0.0.1:${remotePort}`);
  if(codex)codex.start().catch(e=>event({type:'error',message:e.message}));
  const close=()=>{if(closed)return;closed=true;codex?.close();gamePending.close();remotePending.close();for(const p of approvals.values()){clearTimeout(p.timer);p.reject(Error('Bridge stopped'));}game?.terminate();remote?.terminate();wss.close();remoteServer.close();api.close();};
  return {close,execute,health:()=>({game:!!game,remote:!!remote,codex:codex?.ready??false,snapshot})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const bridge=await startServer();process.once('SIGINT',()=>bridge.close());process.once('SIGTERM',()=>bridge.close());
}
