'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {accept}=require('./socket');
const World=require('./world');
const {W,H,npcs,enemySpawns,rand}=World;
const world=World.generate();
const PUBLIC=path.join(__dirname,'public');
const MAX_PLAYERS=8, MAX_ROOMS=100, MAX_CONNECTIONS=256;
const MOVE_MS=115,ATTACK_MS=420,POTION_MS=600,INTERACT_MS=350;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const directions={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
const between=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cleanName=v=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,14)||'모험가';
const cleanRoom=v=>String(v??'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
const xpNeed=level=>Math.round(35+(level-1)*29+(level-1)**2*8);
function createRoom(code){
  return {code,players:new Map(),enemies:enemySpawns.map((s,i)=>newEnemy(s.x,s.y,'m'+i)),kills:0,quest:0,bossDead:false,events:[],created:Date.now(),lastSnapshot:0};
}
function newEnemy(x,y,id,boss=false){return {id,x,y,rx:x,ry:y,boss,hp:boss?240:45,maxHp:boss?240:45,alive:true,respawn:0,lastMove:0,lastAttack:0,lastDamaged:0};}
function makePlayer(id,name,host=false){return {id,name,host,x:7,y:14,facing:'right',hp:100,maxHp:100,xp:0,level:1,power:20,gold:30,potions:3,kills:0,attackUntil:0,invulnUntil:0,respawnAt:0,lastMove:0,lastAttack:0,lastPotion:0,lastInteract:0,lastChat:0,connection:null};}
function publicPlayer(p){const {id,name,host,x,y,facing,hp,maxHp,xp,level,power,gold,potions,kills,attackUntil,invulnUntil,respawnAt}=p;return {id,name,host,x,y,facing,hp,maxHp,xp,level,power,gold,potions,kills,attackUntil,invulnUntil,respawnAt};}
function snapshot(room){return {type:'state',room:room.code,kills:room.kills,quest:room.quest,bossDead:room.bossDead,players:[...room.players.values()].map(publicPlayer),enemies:room.enemies.map(e=>({id:e.id,x:e.x,y:e.y,boss:e.boss,hp:e.hp,maxHp:e.maxHp,alive:e.alive,lastDamaged:e.lastDamaged}))};}
function broadcast(room,msg){for(const p of room.players.values())p.connection?.send(msg)}
function event(room,message,x=null,y=null,color='gold'){broadcast(room,{type:'event',message,x,y,color})}
function addXp(p,value){p.xp+=value;while(p.xp>=xpNeed(p.level)){p.xp-=xpNeed(p.level);p.level++;p.maxHp+=18;p.hp=p.maxHp;p.power+=5;p.connection?.send({type:'notice',message:`✨ 레벨 업! Lv.${p.level} · 체력 완전 회복`})}}
function rewards(room,boss){for(const p of room.players.values()){
  if(p.respawnAt)continue;
  const xp=boss?120:12,gold=boss?90:8;
  addXp(p,xp);p.gold+=gold;
  p.connection?.send({type:'notice',message:`${boss?'👑 보스':'🍄 주황버섯'} 처치 보상 +${xp} EXP / +${gold}G`});
}}
function nearbyAlivePlayers(room,e){return [...room.players.values()].filter(p=>p.hp>0&&!p.respawnAt).sort((a,b)=>distance(a,e)-distance(b,e))}
function enemyAt(room,x,y,except=null){return room.enemies.some(e=>e!==except&&e.alive&&e.x===x&&e.y===y)}
function move(room,p,dir,now){
  if(!directions[dir]||p.respawnAt||p.hp<=0)return;
  p.facing=dir;
  if(now-p.lastMove<MOVE_MS)return;
  p.lastMove=now;
  const [dx,dy]=directions[dir],nx=p.x+dx,ny=p.y+dy;
  if(!world.isWall(nx,ny)&&!enemyAt(room,nx,ny)){p.x=nx;p.y=ny}
}
function attack(room,p,now){
  if(p.respawnAt||p.hp<=0||now-p.lastAttack<ATTACK_MS)return;
  p.lastAttack=now;p.attackUntil=now+180;
  const [dx,dy]=directions[p.facing],target=room.enemies.filter(e=>e.alive&&distance(e,p)<2.05&&((e.x-p.x)*dx+(e.y-p.y)*dy)>=-.2).sort((a,b)=>distance(a,p)-distance(b,p))[0];
  if(!target)return;
  const amount=p.power+crypto.randomInt(0,8);
  target.hp=Math.max(0,target.hp-amount);target.lastDamaged=now;
  broadcast(room,{type:'hit',x:target.x,y:target.y,value:amount,source:p.id});
  if(target.hp>0)return;
  target.alive=false;target.respawn=now+(target.boss?Number.MAX_SAFE_INTEGER:8500);
  if(target.boss){room.bossDead=true;room.quest=3;rewards(room,true);event(room,`🏆 ${p.name}님과 동료들이 거대 주황버섯을 물리쳤습니다!`,target.x,target.y);}
  else {room.kills++;p.kills++;rewards(room,false);event(room,`🍄 ${p.name}님이 주황버섯을 처치했어요! (${Math.min(room.kills,5)}/5)`,target.x,target.y);}
}
function usePotion(room,p,now){
  if(p.hp<=0||p.respawnAt||now-p.lastPotion<POTION_MS)return;
  p.lastPotion=now;
  if(!p.potions){p.connection.send({type:'notice',message:'🧪 물약이 없어요. 토비를 찾아가세요.'});return}
  if(p.hp>=p.maxHp){p.connection.send({type:'notice',message:'❤️ 체력이 이미 가득 찼어요.'});return}
  const healed=Math.min(45+p.level*4,p.maxHp-p.hp);p.hp+=healed;p.potions--;
  broadcast(room,{type:'heal',id:p.id,x:p.x,y:p.y,value:healed});
}
function interact(room,p,now){
  if(p.hp<=0||p.respawnAt||now-p.lastInteract<INTERACT_MS)return;
  p.lastInteract=now;
  const n=npcs.find(n=>distance(n,p)<2.3);
  if(!n){p.connection.send({type:'notice',message:'💬 NPC에게 가까이 다가가세요.'});return}
  if(n.type==='tobi'){p.connection.send({type:'dialog',title:'🧺 상인 토비',text:`“회복 물약 1개는 15G예요. 현재 ${p.gold}G 보유 중입니다.”`,shop:true});return}
  if(room.quest===0&&room.kills>=5){room.quest=2;for(const ally of room.players.values()){ally.gold+=70;ally.potions+=2;addXp(ally,60)}
    room.enemies.push(newEnemy(37,14,'boss',true));
    broadcast(room,{type:'dialog',title:'🌸 숲지기 루나',text:'“정말 고마워요! 모두에게 70G·물약 2개·60 EXP를 드릴게요. 이제 동쪽 숲의 거대 주황버섯을 함께 물리쳐 주세요!”'});
    event(room,'👑 협동 보스전 개방! 동쪽 숲으로 향하세요.');return;
  }
  const text=room.quest===0?`“주황버섯 다섯 마리를 함께 물리쳐 주세요!” 공동 진행 ${Math.min(room.kills,5)}/5`:
    room.quest===2?'“숲 동쪽에 거대 주황버섯이 나타났어요. 함께 힘을 모아 주세요!”':'“여러분 덕분에 숲에 평화가 돌아왔어요!”';
  p.connection.send({type:'dialog',title:'🌸 숲지기 루나',text});
}
function buy(room,p){
  if(p.hp<=0||p.respawnAt)return;
  if(distance(p,npcs[1])>=2.3){p.connection.send({type:'notice',message:'🧺 상인 토비 근처에서만 구입할 수 있어요.'});return}
  if(p.gold<15){p.connection.send({type:'notice',message:'🪙 골드가 부족해요.'});return}
  p.gold-=15;p.potions++;p.connection.send({type:'notice',message:'🧪 회복 물약 1개 구입 완료! (-15G)'});
}
function tickRoom(room,now){
  for(const p of room.players.values()){
    if(p.respawnAt&&now>=p.respawnAt){p.x=7;p.y=14;p.hp=Math.ceil(p.maxHp*.7);p.respawnAt=0;p.invulnUntil=now+2000;p.connection?.send({type:'notice',message:'🏡 마을에서 다시 일어났어요!'});}
  }
  for(const e of room.enemies){
    if(!e.alive){
      if(!e.boss&&now>=e.respawn&&nearbyAlivePlayers(room,e).every(p=>distance(p,{x:e.rx,y:e.ry})>3)&&!enemyAt(room,e.rx,e.ry,e)){e.x=e.rx;e.y=e.ry;e.hp=e.maxHp;e.alive=true;e.lastAttack=now;}
      continue;
    }
    const target=nearbyAlivePlayers(room,e)[0];if(!target)continue;
    const dist=distance(e,target);
    if(dist>1.1&&dist<7&&now-e.lastMove>(e.boss?550:760)){
      const dx=Math.sign(target.x-e.x),dy=Math.sign(target.y-e.y);
      const options=Math.abs(target.x-e.x)>Math.abs(target.y-e.y)?[[dx,0],[0,dy]]:[[0,dy],[dx,0]];
      for(const [vx,vy] of options){const x=e.x+vx,y=e.y+vy;
        if((vx||vy)&&!world.isWall(x,y)&&!enemyAt(room,x,y,e)&&![...room.players.values()].some(p=>p.hp>0&&!p.respawnAt&&p.x===x&&p.y===y)){e.x=x;e.y=y;break}
      }e.lastMove=now;
    }
    const close=nearbyAlivePlayers(room,e).filter(p=>distance(e,p)<=1.45&&!p.respawnAt);
    if(close.length&&now-e.lastAttack>(e.boss?1100:1450)){
      e.lastAttack=now;
      for(const victim of close){if(now<victim.invulnUntil)continue;
        const dmg=e.boss?22:10+crypto.randomInt(0,5);victim.hp=Math.max(0,victim.hp-dmg);victim.invulnUntil=now+800;
        broadcast(room,{type:'damage',id:victim.id,x:victim.x,y:victim.y,value:dmg});
        if(!victim.hp){victim.respawnAt=now+3000;event(room,`💫 ${victim.name}님이 쓰러졌어요. 잠시 후 마을에서 부활합니다.`,victim.x,victim.y)}
      }
    }
  }
  broadcast(room,snapshot(room));
}
function createGameServer(options={}){
  const rooms=new Map(),sockets=new Set();
  function join(connection,req){
    if(connection.room){connection.send({type:'error',message:'이미 방에 입장했어요.'});return}
    if(!['create','join'].includes(req.type)){connection.send({type:'error',message:'잘못된 입장 요청입니다.'});return}
    const name=cleanName(req.name);let room;
    if(req.type==='create'){
      if(rooms.size>=MAX_ROOMS){connection.send({type:'error',message:'서버에 생성 가능한 방이 가득 찼어요.'});return}
      let code;do{code=Array.from(crypto.randomBytes(5),v=>ALPHABET[v%ALPHABET.length]).join('')}while(rooms.has(code));
      room=createRoom(code);rooms.set(code,room);
    }else{room=rooms.get(cleanRoom(req.room));if(!room){connection.send({type:'error',message:'방을 찾을 수 없어요. 코드를 확인해 주세요.'});return}}
    if(room.players.size>=MAX_PLAYERS){connection.send({type:'error',message:'이 방은 최대 8명까지 입장할 수 있어요.'});return}
    const id=crypto.randomUUID(),p=makePlayer(id,name,room.players.size===0);p.connection=connection;
    connection.room=room;connection.player=p;room.players.set(id,p);
    connection.send({type:'joined',id,room:room.code,capacity:MAX_PLAYERS,chat:room.events.slice(-25)});
    broadcast(room,snapshot(room));event(room,`🌿 ${name}님이 숲에 입장했습니다.`);
  }
  function leave(connection){
    const {room,player}=connection;if(!room||!player)return;
    room.players.delete(player.id);connection.room=null;connection.player=null;
    if(!room.players.size)rooms.delete(room.code);
    else{if(player.host)room.players.values().next().value.host=true;event(room,`👋 ${player.name}님이 퇴장했습니다.`);broadcast(room,snapshot(room))}
  }
  function received(connection,req){
    if(!req||typeof req!=='object'||Array.isArray(req))return;
    if(!connection.room){if(req.type==='join'||req.type==='create')join(connection,req);else connection.send({type:'error',message:'먼저 방에 입장해 주세요.'});return}
    const room=connection.room,p=connection.player,now=Date.now();
    switch(req.type){
      case 'move':move(room,p,req.dir,now);break;
      case 'attack':attack(room,p,now);break;
      case 'potion':usePotion(room,p,now);break;
      case 'interact':interact(room,p,now);break;
      case 'buy':buy(room,p);break;
      case 'chat':{
        if(now-p.lastChat<800)return;
        p.lastChat=now;
        const message=String(req.text??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
        if(!message)return;
        const chat={type:'chat',name:p.name,id:p.id,text:message,time:Date.now()};room.events.push(chat);if(room.events.length>25)room.events.shift();broadcast(room,chat);break;
      }
    }
  }
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
  const files={'/':path.join(PUBLIC,'index.html'),'/index.html':path.join(PUBLIC,'index.html'),'/client.js':path.join(PUBLIC,'client.js'),'/world.js':path.join(__dirname,'world.js'),'/mushroom.png':path.join(PUBLIC,'mushroom.png')};
  const server=http.createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405,{'Content-Type':'text/plain; charset=utf-8'});res.end('Method not allowed');return}
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname}catch(e){res.writeHead(400);res.end();return}
    if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,rooms:rooms.size,players:[...rooms.values()].reduce((n,r)=>n+r.players.size,0)}));return}
    const file=files[pathname];if(!file){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');return}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(500);res.end('Server error');return}res.writeHead(200,{'Content-Type':mime[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(data)});
  });
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/ws'){socket.destroy();return}
    // Browser clients must originate from this site's own address.
    // Render terminates HTTPS at its proxy but preserves the public Host header.
    const origin=req.headers.origin;
    if(origin){
      let originHost;
      try{originHost=new URL(origin).host.toLowerCase()}catch(e){originHost=''}
      if(!originHost||originHost!==String(req.headers.host||'').toLowerCase()){
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
      }
    }
    if(sockets.size>=MAX_CONNECTIONS){
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;
    }
    accept(req,socket,head,(connection)=>{
      sockets.add(connection);
      connection.onMessage=req=>received(connection,req);
      connection.onClose=()=>{leave(connection);sockets.delete(connection)};
      connection.send({type:'hello',message:'버섯숲 서버에 연결되었습니다.'});
    });
  });
  const interval=setInterval(()=>{const now=Date.now();for(const room of rooms.values())tickRoom(room,now)},100);
  interval.unref();
  function close(){clearInterval(interval);for(const c of sockets)c.close();return new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}
  return {server,rooms,close};
}
if(require.main===module){
  const port=Number(process.env.PORT)||3000;
  const host=process.env.HOST||'0.0.0.0';
  const game=createGameServer();game.server.listen(port,host,()=>{
    console.log(`🍄 버섯숲의 전설 멀티플레이 서버 시작`);
    console.log(`   http://localhost:${port}`);
    console.log(`   같은 Wi-Fi의 친구는 http://내컴퓨터IP:${port} 로 접속`);
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>game.close().finally(()=>process.exit(0)));
}
module.exports={createGameServer};
