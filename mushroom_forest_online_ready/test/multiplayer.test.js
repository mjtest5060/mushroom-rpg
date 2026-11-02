'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGameServer}=require('../server');
let game,port;
async function start(){game=createGameServer();await new Promise(resolve=>game.server.listen(0,'127.0.0.1',resolve));port=game.server.address().port}
async function finish(){await game.close()}
async function connect(){
  const s=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve,reject)=>{s.addEventListener('open',resolve,{once:true});s.addEventListener('error',reject,{once:true})});
  const queue=[];let notify=null;
  s.addEventListener('message',e=>{const data=JSON.parse(e.data);queue.push(data);if(notify){notify();notify=null}});
  const wait=async(type,predicate=()=>true,timeout=2500)=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const i=queue.findIndex(m=>m.type===type&&predicate(m));if(i>=0)return queue.splice(i,1)[0];await new Promise((resolve,reject)=>{let timer=setTimeout(()=>{notify=null;resolve()},Math.min(30,deadline-Date.now()));notify=()=>{clearTimeout(timer);resolve()}})}
    throw Error(`Timed out for ${type} from ${JSON.stringify(queue.slice(-4))}`);
  };
  return {s,send:obj=>s.send(JSON.stringify(obj)),wait,close:()=>s.close(),queue};
}
test('2 players share a room, movement, chat, and room cleanup',async()=>{
  await start();try{
    const a=await connect();a.send({type:'create',name:'주인'});const joined=await a.wait('joined');
    assert.match(joined.room,/^[A-Z2-9]{5}$/);const code=joined.room;
    const b=await connect();b.send({type:'join',room:code,name:'친구'});await b.wait('joined');
    const shared=await a.wait('state',s=>s.players.length===2);assert.equal(shared.players.length,2);
    a.send({type:'move',dir:'right'});
    const moved=await b.wait('state',s=>s.players.some(p=>p.id===joined.id&&p.x===8));assert.equal(moved.players.length,2);
    b.send({type:'chat',text:'반가워요!'});
    const chat=await a.wait('chat',m=>m.text==='반가워요!');assert.equal(chat.name,'친구');
    const outside=await connect();outside.send({type:'join',room:'ZZZZZ',name:'없는방'});
    await outside.wait('error',m=>m.message.includes('찾을 수'));outside.close();
    b.close();await a.wait('state',s=>s.players.length===1);
    a.close();await new Promise(r=>setTimeout(r,150));assert.equal(game.rooms.size,0);
  }finally{await finish()}
});
test('cap of 8 and untrusted commands cannot teleport or buy remotely',async()=>{
  await start();try{
    const clients=[];const lead=await connect();clients.push(lead);lead.send({type:'create',name:'팀장'});const {room}=await lead.wait('joined');
    for(let i=1;i<8;i++){const c=await connect();clients.push(c);c.send({type:'join',room,name:'팀원'+i});await c.wait('joined')}
    const ninth=await connect();ninth.send({type:'join',room,name:'9번'});await ninth.wait('error',m=>m.message.includes('8명'));ninth.close();
    const roomObj=game.rooms.get(room),host=[...roomObj.players.values()][0];
    const gold=host.gold;lead.send({type:'buy'});await lead.wait('notice',m=>m.message.includes('토비'));assert.equal(host.gold,gold);
    lead.send({type:'move',dir:'diagonal',x:49,y:20});await new Promise(r=>setTimeout(r,80));assert.equal(host.x,7);assert.equal(host.y,14);
    for(const c of clients)c.close();await new Promise(r=>setTimeout(r,150));assert.equal(game.rooms.size,0);
  }finally{await finish()}
});
test('shared kills unlock boss, co-op rewards and boss victory',async()=>{
  await start();try{
    const a=await connect();a.send({type:'create',name:'검사'});const j=await a.wait('joined');
    const b=await connect();b.send({type:'join',room:j.room,name:'힐러'});await b.wait('joined');
    const room=game.rooms.get(j.room),hero=room.players.get(j.id);
    const initialGold=[...room.players.values()].map(p=>p.gold);
    for(const enemy of room.enemies.slice(0,5)){
      hero.x=enemy.x-1;hero.y=enemy.y;hero.facing='right';
      while(enemy.alive){hero.lastAttack=0;a.send({type:'attack'});await new Promise(r=>setTimeout(r,8))}
    }
    assert.ok(room.kills>=5);
    assert.ok([...room.players.values()].every((p,i)=>p.gold>initialGold[i]));
    hero.x=10;hero.y=13;hero.lastInteract=0;a.send({type:'interact'});
    await a.wait('dialog',d=>d.text.includes('70G'));
    assert.equal(room.quest,2);assert.ok(room.enemies.some(e=>e.boss));
    const boss=room.enemies.find(e=>e.boss);
    hero.x=36;hero.y=14;hero.facing='right';
    while(boss.alive){hero.lastAttack=0;a.send({type:'attack'});await new Promise(r=>setTimeout(r,8))}
    assert.equal(room.quest,3);assert.equal(room.bossDead,true);
    a.close();b.close();
  }finally{await finish()}
});

test('online hosting health endpoint, static assets, and websocket origin protection',async()=>{
  await start();try{
    const health=await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status,200);
    assert.deepEqual(await health.json(),{ok:true,rooms:0,players:0});
    const gamePage=await fetch(`http://127.0.0.1:${port}/?room=ABCDE`);
    assert.equal(gamePage.status,200);
    assert.match(await gamePage.text(),/버섯숲의 전설/);
    const script=await fetch(`http://127.0.0.1:${port}/client.js`);
    assert.equal(script.status,200);
    assert.match(await script.text(),/친구 방에서 바로 시작/);
    const net=require('node:net'),crypto=require('node:crypto');
    const response=await new Promise((resolve,reject)=>{
      const socket=net.connect({host:'127.0.0.1',port},()=>{
        socket.write('GET /ws HTTP/1.1\r\n'+
          `Host: 127.0.0.1:${port}\r\n`+
          'Origin: https://untrusted.example\r\n'+
          'Upgrade: websocket\r\nConnection: Upgrade\r\n'+
          'Sec-WebSocket-Version: 13\r\n'+
          `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n\r\n`);
      });
      socket.setTimeout(1500,()=>{socket.destroy();reject(Error('Socket timed out'))});
      socket.once('data',chunk=>{resolve(chunk.toString('utf8'));socket.destroy()});
      socket.once('error',reject);
    });
    assert.match(response,/403 Forbidden/);
  }finally{await finish()}
});
