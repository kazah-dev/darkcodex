import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {validate,Pending} from './tools.mjs';
import {startServer,equal,allowedOrigin} from './server.mjs';
import {dispatch} from './game-client.js';

test('tool boundaries reject path traversal, private files and malformed actions',()=>{
  for(const filename of ['../foo.js','bridge-config.txt','secret.txt','/root.js','assistant/../../x.js'])assert.throws(()=>validate('game_read_script',{filename}));
  assert.throws(()=>validate('game_write_script',{filename:'cycle.js',content:'x'}));
  assert.throws(()=>validate('game_run_script',{filename:'a.js',threads:0,args:[]}));
  assert.throws(()=>validate('game_stop_script',{pid:1,extra:true}));
  assert.throws(()=>validate('game_run_script',{filename:'a.js',threads:1,args:[{}]}));
  assert.throws(()=>validate('unknown',{}));
  assert.deepEqual(validate('game_write_script',{filename:'assistant/report.js',content:'export async function main(ns) {}'}).filename,'assistant/report.js');
});
test('capability comparison and origin checks fail closed',()=>{
  assert(equal('a','a'));assert(!equal('a','b'));assert(!equal('a','é'));assert(!equal(null,''));
  assert(allowedOrigin('null'));assert(!allowedOrigin('https://attacker.example'));assert(!allowedOrigin('http://localhost.evil'));
});
test('pending operations expire without replay; disconnect rejects pending requests',async()=>{
  const pending=new Pending();let count=0;
  await assert.rejects(pending.create(()=>count++,5),/unknown/);assert.equal(count,1);
  const request=pending.create(()=>{});pending.close();await assert.rejects(request,/Connection lost/);
  assert.equal(pending.items.size,0);
});
test('game execution checks actual launch and protects the bridge',async()=>{
  const ns={pid:5,fileExists:()=>true,getScriptRam:()=>4,getServerMaxRam:()=>8,getServerUsedRam:()=>6};
  await assert.rejects(dispatch(ns,'game_run_script',{filename:'test.js',threads:1,args:[]}),/RAM/);
  ns.getServerUsedRam=()=>0;ns.exec=()=>0;
  await assert.rejects(dispatch(ns,'game_run_script',{filename:'test.js',threads:1,args:[]}),/refused/);
  ns.exec=()=>42;assert.equal((await dispatch(ns,'game_run_script',{filename:'test.js',threads:1,args:[]})).pid,42);
  await assert.rejects(dispatch(ns,'game_stop_script',{pid:5}),/protected/);
  await assert.rejects(dispatch(ns,'game_read_script',{filename:'bridge-config.txt'}),/Protected/);
});
test('local transport: authenticated reads, single approval, rejected writes and disconnect',async()=>{
  const stateDir=await mkdtemp(path.join(tmpdir(),'bb-bridge-test-'));
  const port=28353,remotePort=28352;
  const server=await startServer({port,remotePort,withCodex:false,stateDir});
  const {token}=JSON.parse(await readFile(path.join(stateDir,'connection.json'),'utf8'));
  const ws=new WebSocket(`ws://127.0.0.1:${port}/game`);
  const messages=[],waiters=[];let commands=0;
  ws.on('message',raw=>{
    const m=JSON.parse(String(raw));messages.push(m);
    if(m.type==='command'){commands++;ws.send(JSON.stringify({type:'result',id:m.id,result:{ok:true}}));}
    for(const w of [...waiters])if(w.type===m.type){waiters.splice(waiters.indexOf(w),1);w.resolve(m);}
  });
  const next=type=>new Promise(resolve=>waiters.push({type,resolve}));
  const post=(name,args)=>fetch(`http://127.0.0.1:${port}/tool`,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({name,args})});
  try{
    await assert.rejects(startServer({port,remotePort,withCodex:false,stateDir}),/EADDRINUSE/);
    assert.equal(JSON.parse(await readFile(path.join(stateDir,'connection.json'),'utf8')).token,token,'A failed duplicate start must preserve the active pairing');
    if(ws.readyState!==WebSocket.OPEN)await new Promise(resolve=>ws.once('open',resolve));const ready=next('welcome');ws.send(JSON.stringify({type:'hello',token}));await ready;
    assert.equal((await fetch(`http://127.0.0.1:${port}/tool`,{method:'POST'})).status,403);
    assert.equal((await post('game_status',{})).status,200);assert.equal(commands,1);
    let request=next('approval');let response=post('game_stop_script',{pid:42});let approval=await request;
    assert.equal(commands,1,'No mutation before approval');ws.send(JSON.stringify({type:'approval',id:approval.id,accept:false}));
    assert.equal((await response).status,400);assert.equal(commands,1);
    request=next('approval');response=post('game_run_script',{filename:'test.js',threads:1,args:[]});approval=await request;
    ws.send(JSON.stringify({type:'approval',id:approval.id,accept:true}));assert.equal((await response).status,200);assert.equal(commands,2);
    ws.send(JSON.stringify({type:'approval',id:approval.id,accept:true}));
    request=next('approval');response=post('game_stop_script',{pid:42});await request;ws.close();assert.equal((await response).status,400);assert.equal(commands,2);
  }finally{ws.terminate();server.close();await rm(stateDir,{recursive:true,force:true});}
});
