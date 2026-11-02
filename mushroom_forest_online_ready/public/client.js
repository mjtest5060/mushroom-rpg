'use strict';
// HTML5 canvas renderer + WebSocket client. The server owns all gameplay state.
const $=id=>document.getElementById(id);
const canvas=$('game'),ctx=canvas.getContext('2d'),mm=$('miniMap'),mctx=mm.getContext('2d');
ctx.imageSmoothingEnabled=false;mctx.imageSmoothingEnabled=false;
const TW=32,VW=28,VH=18,{W,H,rand,npcs}=World;
const {tiles,trees,decor}=World.generate();
const sprite=new Image();sprite.src='/mushroom.png';
const directions={w:'up',arrowup:'up',s:'down',arrowdown:'down',a:'left',arrowleft:'left',d:'right',arrowright:'right'};
const palette=['#658ab8','#b57392','#6ba98b','#c39a62','#8c79b6','#b5aa6e','#59a3ad','#dc8c71'];
const colors={grass:['#436943','#4b7047','#49734a','#527949']};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const xpNeed=n=>Math.round(35+(n-1)*29+(n-1)**2*8);
let socket=null,myId=null,roomCode='',state={players:[],enemies:[],kills:0,quest:0,bossDead:false};
let playing=false,modalOpen=true,connected=false,lastTime=0,lastStep=0,lastMini=0,lastHit=0,toastTimer=0;
let audioEnabled=false,audioCtx=null,particles=[],popups=[],flash=0;
const keys={up:false,down:false,left:false,right:false};
const params=new URLSearchParams(location.search);
if(params.get('room'))$('roomInput').value=params.get('room').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,8);
$('nameInput').value=localStorage.getItem('mushroom-coop-name')||'';
const me=()=>state.players.find(p=>p.id===myId)||null;
function sound(freq=440,duration=.08,wave='sine',gain=.065){if(!audioEnabled)return;try{audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=wave;o.frequency.setValueAtTime(freq,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(60,freq*.7),audioCtx.currentTime+duration);g.gain.setValueAtTime(gain,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+duration)}catch(e){}}
function showToast(message,ms=2500){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),ms)}
function setStatus(on,message){$('connectionStatus').textContent=(on?'● ':'● ')+message;$('connectionStatus').classList.toggle('online',on)}
function setLobbyError(s){$('lobbyError').textContent=s}
function send(data){if(socket&&socket.readyState===WebSocket.OPEN){socket.send(JSON.stringify(data));return true}return false}
function ensureName(){const name=$('nameInput').value.trim().replace(/[<>]/g,'').slice(0,14)||'모험가';localStorage.setItem('mushroom-coop-name',name);return name}
function joinGame(kind){if(socket&&socket.readyState===WebSocket.OPEN&&myId){setLobbyError('이미 게임에 입장했습니다.');return}
  const code=$('roomInput').value.trim().toUpperCase().replace(/[^A-Z2-9]/g,'');
  if(kind==='join'&&(!code||code.length!==5)){setLobbyError('초대 코드 5자리를 입력해 주세요.');return}
  setLobbyError('서버에 접속 중...');$('createBtn').disabled=true;$('joinBtn').disabled=true;
  if(socket){socket.onclose=null;socket.close()}
  socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');
  socket.onopen=()=>{connected=true;setStatus(true,'서버 연결됨');send({type:kind,name:ensureName(),room:code});};
  socket.onmessage=onMessage;
  socket.onerror=()=>{setLobbyError('서버에 연결할 수 없어요. 주소와 서버 상태를 확인하세요.')};
  socket.onclose=()=>{
    connected=false;playing=false;myId=null;roomCode='';state={players:[],enemies:[],kills:0,quest:0,bossDead:false};
    setStatus(false,'연결 끊김');$('roomLabel').textContent='방 입장 전';$('inviteBtn').disabled=true;$('chatInput').disabled=true;$('sendChatBtn').disabled=true;
    $('createBtn').disabled=false;$('joinBtn').disabled=false;
    displayLobby('서버와 연결이 끊겼어요. 다시 방을 만들거나 입장해 주세요.');renderParty();
  };
}
function displayLobby(message=''){playing=false;modalOpen=true;$('modalBox').replaceChildren();
  const invite=(new URLSearchParams(location.search).get('room')||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,5);
  const invited=invite.length===5;
  const img=document.createElement('img');img.src='/mushroom.png';img.className='modal-image';img.alt='주황버섯';
  const kicker=document.createElement('div');kicker.className='section-kicker';kicker.textContent='MULTIPLAYER CO-OP · 2–8 PLAYERS';
  const h=document.createElement('h1');h.className='pixel-heading';h.textContent='버섯숲의 전설';
  const d=document.createElement('p');d.className='modal-sub';d.textContent='친구들과 주황버섯을 사냥하는 협동 RPG';
  const label=document.createElement('label');label.className='lobby-label';label.htmlFor='nameInput';label.textContent='모험가 이름';
  const name=document.createElement('input');name.id='nameInput';name.className='lobby-input';name.maxLength=14;name.placeholder='예: 용감한버섯';name.value=localStorage.getItem('mushroom-coop-name')||'';
  const create=document.createElement('button');create.id='createBtn';create.className='primary-button';create.textContent=invited?'🎮 친구 방에서 바로 시작':'🌲 새 방 만들기';create.onclick=()=>joinGame(invited?'join':'create');
  const row=document.createElement('div');row.className='join-row';
  const code=document.createElement('input');code.id='roomInput';code.className='lobby-input';code.maxLength=8;code.placeholder='초대 코드';code.value=invite;
  const join=document.createElement('button');join.id='joinBtn';join.className='secondary-button';join.textContent='방 입장';join.onclick=()=>joinGame('join');row.append(code,join);
  const err=document.createElement('p');err.id='lobbyError';err.className='lobby-error';err.textContent=message;
  const hint=document.createElement('div');hint.className='lobby-hint';hint.textContent='최대 8명 · 같은 방의 몬스터와 퀘스트가 공유됩니다. 방의 마지막 플레이어가 나가면 진행 상황은 초기화됩니다.';
  $('modalBox').append(img,kicker,h,d,label,name,create,row);
  if(invited){
    const other=document.createElement('button');other.className='secondary-button';other.textContent='🌲 새 방 만들기';
    other.style.marginTop='10px';other.style.width='100%';other.onclick=()=>joinGame('create');
    $('modalBox').append(other);
  }
  $('modalBox').append(err,hint);
  $('modalScreen').classList.remove('hide');
}
function showDialog(title,text,shop=false){modalOpen=true;clearKeys();
  const box=$('modalBox');box.replaceChildren();
  const icon=document.createElement('div');icon.style.fontSize='43px';icon.textContent=shop?'🧺':'🌸';
  const h=document.createElement('h2');h.className='pixel-heading';h.textContent=title;
  const p=document.createElement('p');p.className='modal-sub';p.textContent=text;
  const row=document.createElement('div');row.className='modal-menu';
  if(shop){const buy=document.createElement('button');buy.className='primary-button';buy.textContent='🧪 물약 구입 (15G)';buy.onclick=()=>{send({type:'buy'});hideDialog()};row.appendChild(buy)}
  const close=document.createElement('button');close.className=shop?'secondary-button':'primary-button';close.textContent='모험 계속하기';close.onclick=hideDialog;row.appendChild(close);
  box.append(icon,h,p,row);$('modalScreen').classList.remove('hide');
}
function hideDialog(){modalOpen=false;$('modalScreen').classList.add('hide')}
function handleJoined(data){myId=data.id;roomCode=data.room;playing=true;
  $('roomLabel').textContent='🏠 방 코드: '+roomCode;$('inviteBtn').disabled=false;
  $('chatInput').disabled=false;$('sendChatBtn').disabled=false;
  $('chatLog').replaceChildren();(data.chat||[]).forEach(renderChat);
  $('chatInput').value='';hideDialog();showToast('🌿 방에 입장했어요! 친구를 초대하고 함께 모험하세요.',3200);
  const url=new URL(location.href);url.searchParams.set('room',roomCode);history.replaceState({},'',url);
}
function onMessage(ev){let data;try{data=JSON.parse(ev.data)}catch(e){return}
  switch(data.type){
    case 'hello':setStatus(true,'서버 연결됨');break;
    case 'joined':handleJoined(data);break;
    case 'state':{
      state=data;
      if(!myId)return;
      $('playerCount').textContent=`${state.players.length} / 8명`;
      renderStats();renderParty();break;
    }
    case 'chat':renderChat(data);break;
    case 'notice':showToast(data.message);break;
    case 'dialog':showDialog(data.title,data.text,!!data.shop);break;
    case 'hit':{
      spawnFloater('-'+data.value,data.x,data.y,'#ffdd8b');spawnParticles(data.x,data.y,'#ff8b4f');
      if(data.source===myId)sound(360,.08,'square',.045);break;
    }
    case 'damage':spawnFloater('-'+data.value,data.x,data.y,'#ff8c8c');if(data.id===myId){flash=7;sound(180,.15,'sawtooth',.06)}break;
    case 'heal':spawnFloater('+'+data.value+' HP',data.x,data.y,'#b6ffc0');if(data.id===myId)sound(800,.13,'triangle');break;
    case 'event':showToast(data.message,3100);if(data.x!=null)spawnParticles(data.x,data.y,'#f6cc7b');break;
    case 'error':setLobbyError(data.message);showToast(data.message);$('createBtn').disabled=false;$('joinBtn').disabled=false;break;
  }
}
function renderChat(m){const log=$('chatLog');const div=document.createElement('div');
  if(m.type==='chat'){div.className='chat-line';const b=document.createElement('b');b.textContent=m.name+': ';div.append(b,document.createTextNode(m.text));}
  else{div.className='chat-system';div.textContent=m.message||''}
  const scrolled=log.scrollHeight-log.scrollTop-log.clientHeight<40;
  log.append(div);while(log.children.length>60)log.firstChild.remove();if(scrolled)log.scrollTop=log.scrollHeight;
}
function renderParty(){const party=$('partyList');party.replaceChildren();$('partyHeading').textContent=`${state.players.length}/8`;
  for(const p of state.players){
    const row=document.createElement('div');row.className='party-member';
    const icon=document.createElement('div');icon.className='party-icon';icon.textContent=p.id===myId?'🗡️':'🛡️';
    const meta=document.createElement('div');meta.className='party-meta';
    const name=document.createElement('div');name.className='party-name';name.textContent=p.name+(p.host?' 👑':'')+(p.id===myId?' (나)':'');
    const stats=document.createElement('div');stats.className='party-detail';stats.textContent=`Lv.${p.level} · HP ${p.hp}/${p.maxHp}`;
    const hp=document.createElement('div');hp.className='party-hp';const fill=document.createElement('div');fill.style.width=Math.max(0,p.hp/p.maxHp*100)+'%';hp.append(fill);meta.append(name,stats,hp);row.append(icon,meta);party.append(row);
  }
}
function renderStats(){const p=me();if(!p)return;
  $('heroName').firstChild.textContent=p.name+' ';
  $('hpLabel').textContent=p.hp+' / '+p.maxHp;$('hpFill').style.width=p.hp/p.maxHp*100+'%';
  $('xpLabel').textContent=p.xp+' / '+xpNeed(p.level);$('xpFill').style.width=p.xp/xpNeed(p.level)*100+'%';
  $('levelBadge').textContent='Lv. '+p.level;$('goldLabel').textContent=p.gold;
  $('potionCount').textContent='×'+p.potions;$('bagPotionCount').textContent=p.potions;$('inventoryCount').textContent=p.potions+'/4';
  const q=state.quest;
  $('questTitle').textContent=q===0?'숲의 작은 소동':q===2?'거대 주황버섯의 등장':'버섯숲의 영웅';
  $('questDescription').textContent=q===0?(state.kills>=5?'토벌 성공! 한 명이 숲지기 루나에게 돌아가 보상을 받으세요.':'모든 플레이어가 힘을 합쳐 주황버섯 5마리를 처치하세요.'):
    q===2?'숲 동쪽의 거대 주황버섯에게 힘을 합쳐 도전하세요.':'보스를 쓰러뜨렸어요! 친구들과 자유롭게 탐험하세요.';
  $('questGoal').textContent=q===0?'팀 버섯 처치':q===2?'협동 보스 처치':'팀 퀘스트 완료';
  $('questCounter').textContent=q===0?Math.min(5,state.kills)+' / 5':q===2?'0 / 1':'CLEAR';
  $('questProgress').style.width=(q===0?Math.min(100,state.kills*20):q===2?0:100)+'%';
  $('questRewards').textContent=q===0?'🟡 70G · ✨ 60EXP · 🧪 물약 2개 (전원)':q===2?'🏆 90G · ✨ 120EXP (전원)':'🏆 숲의 영웅';
  $('bonusSlot').textContent=q===3?'🏆':'＋';
  $('zoneName').textContent=p.x<15?'🏡 초록 마을':p.x>31?'🍄 깊은 버섯숲':'🌲 바람결 숲';
}
function clearKeys(){for(const k in keys)keys[k]=false}
function requestMove(dir){if(!playing||modalOpen)return;send({type:'move',dir});}
function attack(){if(!playing||modalOpen)return;send({type:'attack'})}
function interact(){if(!playing||modalOpen)return;send({type:'interact'})}
function potion(){if(!playing||modalOpen)return;send({type:'potion'})}
function getCamera(){const p=me()||{x:7,y:14};return {x:clamp(p.x-VW/2,0,W-VW),y:clamp(p.y-VH/2,0,H-VH)}}
function spawnFloater(text,x,y,color){popups.push({text,x,y,color,age:0})}
function spawnParticles(x,y,color){for(let i=0;i<9;i++)particles.push({x:x+.5,y:y+.4,vx:(Math.random()-.5)*4.7,vy:(Math.random()-.5)*5,life:.45,color})}
function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h))}
function tileDraw(x,y,tx,ty){const type=tiles[ty][tx],r=rand(tx,ty,1);
  if(type===2){rect(x,y,32,32,rand(tx,ty,8)>.6?'#3b7781':'#39727b');rect(x+5,y+11,9,2,'#6eacaf');rect(x+20,y+22,6,2,'#67a2a7');return}
  if(type===1){rect(x,y,32,32,r>.4?'#8b845a':'#948b5e');if(r>.36){rect(x+4,y+4,12,4,'#a19965');rect(x+23,y+25,6,3,'#776f4b')}if(rand(tx,ty,45)>.7)rect(x+17,y+8,3,2,'#b6a276');return}
  rect(x,y,32,32,colors.grass[Math.floor(r*4)]);if(r>.65){rect(x+7,y+8,4,3,'#62915a');rect(x+10,y+5,3,3,'#416e42');rect(x+25,y+24,4,2,'#67945c')}else if(r<.22){rect(x+18,y+9,4,2,'#35633d');rect(x+20,y+7,2,6,'#386842')}
}
function drawTree(sx,sy,t){rect(sx+12,sy+9,9,27,'#483c2b');rect(sx+14,sy+11,5,24,'#695239');rect(sx+2,sy+12,29,14,'#224b37');rect(sx+5,sy+4,25,20,'#285d3a');rect(sx+8,sy-5,19,25,t.variant>.5?'#2c6c42':'#326d43');rect(sx+9,sy-3,6,9,'#397f4d');rect(sx+18,sy+3,6,6,'#428354');rect(sx+6,sy+18,6,5,'#1b4335');rect(sx+26,sy+15,4,6,'#234b35');rect(sx+11,sy-7,13,4,'#478354')}
function drawDecor(x,y,t){if(t.type==='flower'){rect(x+13,y+11,2,9,'#2f6d3d');rect(x+9,y+9,4,4,'#f2c0a2');rect(x+15,y+9,4,4,'#f2c0a2');rect(x+12,y+6,5,4,'#ebc2a9');rect(x+12,y+11,5,5,'#f9dda6')}else if(t.type==='tuft'){rect(x+9,y+13,2,5,'#2c6338');rect(x+14,y+9,2,9,'#9bbb6a');rect(x+19,y+12,2,6,'#367440')}else{rect(x+10,y+15,5,3,'#c4ac7d');rect(x+22,y+9,4,2,'#c3b58b')}}
function heroColor(p){let hash=0;for(let i=0;i<p.name.length;i++)hash=(hash*31+p.name.charCodeAt(i))>>>0;return palette[hash%palette.length]}
function drawHero(x,y,p,now){const active=p.id===myId,hop=active&&Object.values(keys).some(Boolean)?Math.sin(now/120)*1.3:Math.sin(now/300+p.x)*.4;
  y+=hop;const tint=heroColor(p);
  if(p.respawnAt){ctx.globalAlpha=.45}
  rect(x+6,y+25,21,5,'#18352588');rect(x+10,y+21,6,8,'#324c66');rect(x+18,y+21,6,8,'#2a455e');rect(x+8,y+26,9,4,'#493526');rect(x+17,y+26,9,4,'#493526');
  rect(x+8,y+13,18,12,tint);rect(x+11,y+15,13,8,'#93a8a4');rect(x+5,y+14,5,11,'#e8b587');rect(x+24,y+14,5,11,'#e8b587');
  rect(x+8,y+2,18,14,'#f4c69a');rect(x+8,y+3,18,6,'#664733');rect(x+5,y+6,22,5,'#785537');rect(x+9,y+1,15,5,'#755239');
  rect(x+12,y+10,3,3,'#293b37');rect(x+20,y+10,3,3,'#293b37');rect(x+16,y+14,4,2,'#cd8876');
  rect(x+25,y+19,3,9,'#8a9dac');rect(x+25,y+16,4,11,'#e7e0be');
  if(Date.now()<p.attackUntil){const fx=p.facing==='left'?-9:p.facing==='up'?4:25,fy=p.facing==='up'?-12:p.facing==='down'?27:8;rect(x+fx,y+fy,5,24,'#f5eed3');rect(x+fx-3,y+fy+15,11,4,'#e2a969')}
  ctx.globalAlpha=1;
  ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillStyle=active?'#ffe59a':'#f7ffe8';ctx.fillText((p.host?'♛ ':'')+p.name,x+16,y-12);
  if(active){ctx.strokeStyle='#f4cf7d';ctx.lineWidth=2;ctx.strokeRect(Math.round(x+2),Math.round(y-2),29,33)}
}
function drawMushroom(sx,sy,e,now){const boss=e.boss,sz=boss?78:38,by=sy+(boss?-31:-8)+Math.sin(now/360+(e.x*2))*2;
  if(e.lastDamaged>Date.now()-130)ctx.globalAlpha=.6;
  rect(sx+16,sy+18,boss?43:25,boss?8:5,'#132a1b70');
  if(sprite.complete&&sprite.naturalWidth)ctx.drawImage(sprite,Math.round(sx+(32-sz)/2),Math.round(by+(boss?-10:0)),sz,sz);
  else{rect(sx+4,by+8,30,16,'#ed7e29');rect(sx+10,by+2,18,8,'#f6a63b');rect(sx+11,by+12,6,5,'#f9ead1');rect(sx+12,by+23,13,11,'#f7cba0')}
  ctx.globalAlpha=1;
  if(boss){rect(sx-28,sy-48,86,8,'#183222');rect(sx-27,sy-47,84*e.hp/e.maxHp,6,'#ef8b55');ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillStyle='#ffe4b5';ctx.fillText('👑 거대 주황버섯',sx+16,sy-51)}
  else if(e.hp<e.maxHp){rect(sx+2,sy-13,28,5,'#233624');rect(sx+3,sy-12,26*e.hp/e.maxHp,3,'#f19864')}
}
function drawNPC(x,y,n){rect(x+5,y+25,23,6,'#15331f77');const c=n.type==='luna'?'#ad7d9e':'#b7a16d';rect(x+7,y+14,19,14,c);rect(x+10,y+24,6,6,'#55483c');rect(x+19,y+24,6,6,'#55483c');rect(x+8,y+3,18,15,'#f4cdb2');rect(x+7,y+1,20,7,n.type==='luna'?'#73566e':'#5b4b34');rect(x+5,y+5,5,17,n.type==='luna'?'#916b86':'#755a3a');rect(x+24,y+4,5,13,n.type==='luna'?'#916b86':'#755a3a');rect(x+12,y+11,3,3,'#453d38');rect(x+20,y+11,3,3,'#453d38');if(n.type==='luna'){rect(x+14,y-3,6,5,'#ecc3dc');rect(x+17,y-4,3,5,'#f7df98')}else{rect(x+10,y-3,17,7,'#b09b65');rect(x+6,y+2,25,4,'#d7bb80')}ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillStyle='#ffffe8';ctx.fillText(n.name,x+16,y-13);if(me()&&dist(n,me())<3){rect(x+22,y-28,17,16,'#f6dfa2');ctx.font='bold 11px sans-serif';ctx.fillStyle='#352c1d';ctx.fillText('E',x+30,y-16)}}
function drawMap(now){const c=getCamera(),ox=-c.x*TW,oy=-c.y*TW;
  ctx.clearRect(0,0,896,576);ctx.save();if(flash>0){ctx.translate((Math.random()-.5)*flash,(Math.random()-.5)*flash);flash=Math.max(0,flash-.65)}
  const minx=Math.floor(c.x),maxx=Math.min(W,Math.ceil(c.x+VW)+1),miny=Math.floor(c.y),maxy=Math.min(H,Math.ceil(c.y+VH)+1);
  for(let y=miny;y<maxy;y++)for(let x=minx;x<maxx;x++)tileDraw(ox+x*TW,oy+y*TW,x,y);
  for(const d of decor)if(d.x>=minx&&d.x<maxx&&d.y>=miny&&d.y<maxy)drawDecor(ox+d.x*TW,oy+d.y*TW,d);
  const hx=ox+3*TW,hy=oy+9*TW;
  if(hx>-110&&hx<950&&hy>-120&&hy<610){rect(hx+6,hy+34,105,70,'#736343');rect(hx+12,hy+40,91,60,'#b9a16f');rect(hx,hy+28,115,22,'#714b39');rect(hx+14,hy+10,87,21,'#a05d43');rect(hx+32,hy-2,50,15,'#a96844');rect(hx+49,hy+64,25,36,'#534330');rect(hx+60,hy+70,4,6,'#e8cc8b');rect(hx+19,hy+60,16,15,'#cde2bd');rect(hx+89,hy+59,13,15,'#cde2bd');ctx.fillStyle='#f0ddae';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillText('모험가의 집',hx+59,hy-10)}
  const all=[];for(const t of trees)if(t.x>=minx-2&&t.x<maxx+2&&t.y>=miny-2&&t.y<maxy+2)all.push({z:t.y-.1,type:'tree',data:t});
  for(const n of npcs)all.push({z:n.y+.2,type:'npc',data:n});
  for(const e of state.enemies)if(e.alive)all.push({z:e.y+.3,type:'enemy',data:e});
  for(const p of state.players)all.push({z:p.y+.5,type:'hero',data:p});
  all.sort((a,b)=>a.z-b.z);
  for(const a of all){const t=a.data;
    if(a.type==='tree')drawTree(ox+t.x*TW,oy+t.y*TW,t);
    else if(a.type==='npc')drawNPC(ox+t.x*TW,oy+t.y*TW,t);
    else if(a.type==='enemy')drawMushroom(ox+t.x*TW,oy+t.y*TW,t,now);
    else drawHero(ox+t.x*TW,oy+t.y*TW,t,now)
  }
  for(const p of particles)rect(ox+p.x*TW,oy+p.y*TW,4,4,p.color);
  for(const p of popups){ctx.textAlign='center';ctx.font='bold 15px sans-serif';ctx.fillStyle='#13251d';ctx.fillText(p.text,ox+(p.x+.5)*TW+1,oy+p.y*TW-p.age*35+1);ctx.fillStyle=p.color;ctx.fillText(p.text,ox+(p.x+.5)*TW,oy+p.y*TW-p.age*35)}
  ctx.restore();const vign=ctx.createRadialGradient(448,280,130,448,280,590);vign.addColorStop(0,'#0000');vign.addColorStop(1,'#0e241c88');ctx.fillStyle=vign;ctx.fillRect(0,0,896,576);
}
function drawMini(){const sx=92/W,sy=64/H;mctx.fillStyle='#233e2e';mctx.fillRect(0,0,92,64);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){mctx.fillStyle=tiles[y][x]===1?'#a29365':tiles[y][x]===2?'#4c8490':'#47784a';mctx.fillRect(x*sx,y*sy,Math.ceil(sx),Math.ceil(sy))}
  for(const t of trees){mctx.fillStyle='#193c28';mctx.fillRect(t.x*sx,t.y*sy,2,2)}
  for(const e of state.enemies)if(e.alive){mctx.fillStyle=e.boss?'#fff0a2':'#ff9a55';mctx.fillRect(e.x*sx-1,e.y*sy-1,e.boss?4:2,e.boss?4:2)}
  for(const n of npcs){mctx.fillStyle='#e0b9d8';mctx.fillRect(n.x*sx-1,n.y*sy-1,3,3)}
  for(const p of state.players){mctx.fillStyle=p.id===myId?'#fff':'#c0efff';mctx.fillRect(p.x*sx-1,p.y*sy-1,3,3)}
}
function loop(now){const dt=Math.min(.06,(now-lastTime)/1000||.016);lastTime=now;
  if(playing&&!modalOpen&&now-lastStep>=120){for(const dir of ['up','down','left','right'])if(keys[dir]){requestMove(dir);lastStep=now;break}}
  for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=dt*4}particles=particles.filter(p=>p.life>0);
  for(const p of popups)p.age+=dt;popups=popups.filter(p=>p.age<.9);
  drawMap(now);if(now-lastMini>120){drawMini();lastMini=now}
  requestAnimationFrame(loop);
}
function isTyping(){return ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)}
document.addEventListener('keydown',e=>{
  const k=e.key.toLowerCase();if(isTyping()){
    if(k==='escape')document.activeElement.blur();return;
  }
  if(directions[k]||[' ','e','q','escape'].includes(k))e.preventDefault();
  if(directions[k]){keys[directions[k]]=true;if(!e.repeat)requestMove(directions[k]);return}
  if(e.repeat)return;
  if(k===' ')attack();if(k==='e')interact();if(k==='q')potion();
  if(k==='escape'&&modalOpen&&playing){hideDialog()}
  else if(k==='escape'&&playing){showDialog('🍃 잠시 쉬어가기','온라인 게임은 다른 모험가가 계속 진행합니다. 준비되면 돌아오세요.')}
});
document.addEventListener('keyup',e=>{const dir=directions[e.key.toLowerCase()];if(dir)keys[dir]=false});
window.addEventListener('blur',clearKeys);
for(const btn of document.querySelectorAll('[data-dir]')){
  const dir=btn.dataset.dir;btn.addEventListener('pointerdown',e=>{e.preventDefault();btn.setPointerCapture(e.pointerId);keys[dir]=true;btn.classList.add('pressed');requestMove(dir)});
  const up=()=>{keys[dir]=false;btn.classList.remove('pressed')};btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);btn.addEventListener('lostpointercapture',up)
}
$('attackBtn').onclick=attack;$('interactBtn').onclick=interact;$('potionBtn').onclick=potion;
$('bagPotion').onclick=potion;$('touchAttack').onclick=attack;$('touchTalk').onclick=interact;$('touchHeal').onclick=potion;
$('bagSword').onclick=()=>showToast('🗡️ 공격력 '+(me()?.power||20));
$('bagBonus').onclick=()=>showToast(state.quest===3?'🏆 버섯숲의 영웅들!':'함께 보스를 물리치면 훈장을 얻어요.');
$('audioBtn').onclick=()=>{audioEnabled=!audioEnabled;$('audioBtn').textContent=audioEnabled?'♫ 사운드 ON':'♫ 사운드 OFF';if(audioEnabled)sound(600)};
$('resetBtn').onclick=()=>{if(!confirm('방에서 나와 로비로 이동할까요?'))return;if(socket){socket.close()}else displayLobby()};
$('inviteBtn').onclick=async()=>{if(!roomCode)return;const url=new URL(location.href);url.searchParams.set('room',roomCode);
  try{await navigator.clipboard.writeText(url.href);showToast('🔗 초대 링크를 복사했어요!')}catch(e){prompt('친구에게 이 주소를 보내세요:',url.href)}
};
$('chatForm').onsubmit=e=>{e.preventDefault();const input=$('chatInput');const text=input.value.trim();if(!text)return;if(send({type:'chat',text})){input.value='';input.focus()}};
$('createBtn').onclick=()=>joinGame('create');$('joinBtn').onclick=()=>joinGame('join');
$('modalScreen').addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  if(e.target.id==='nameInput'){$('createBtn').click()}
  if(e.target.id==='roomInput'){$('joinBtn').click()}
});
canvas.addEventListener('pointerdown',e=>{const p=me();if(!p||!playing||modalOpen)return;
  const bounds=canvas.getBoundingClientRect(),c=getCamera();
  const x=(e.clientX-bounds.left)/bounds.width*VW+c.x,y=(e.clientY-bounds.top)/bounds.height*VH+c.y;
  const npc=npcs.find(n=>dist(n,{x,y})<1.4);if(npc&&dist(p,npc)<2.3){interact();return}
  const enemy=state.enemies.find(m=>m.alive&&dist(m,{x,y})<1.4&&dist(m,p)<2.1);
  if(enemy){const dx=enemy.x-p.x,dy=enemy.y-p.y;requestMove(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');attack();return}
  const dx=x-p.x,dy=y-p.y;requestMove(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up')
});
displayLobby();
requestAnimationFrame(loop);
setStatus(false,'접속 대기 중');
