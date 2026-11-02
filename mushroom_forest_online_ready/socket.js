'use strict';
// Tiny RFC6455 text WebSocket layer, no npm packages required.
// Handles masking, partial TCP frames, ping/pong and close, with strict frame size limits.
const crypto=require('node:crypto');
const MAGIC='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME=16*1024;
function sendFrame(socket,opcode,data=Buffer.alloc(0)){
  if(socket.destroyed||!socket.writable)return;
  if(!Buffer.isBuffer(data))data=Buffer.from(data);
  const n=data.length;
  const head=n<126?Buffer.from([0x80|opcode,n]):Buffer.from([0x80|opcode,126,n>>8,n&255]);
  socket.write(Buffer.concat([head,data]));
}
function accept(request,socket,head,onConnection){
  const key=request.headers['sec-websocket-key'];
  if(request.headers.upgrade?.toLowerCase()!=='websocket'||request.headers['sec-websocket-version']!=='13'||typeof key!=='string'||!(/^[A-Za-z0-9+/]{22}==$/.test(key))){socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');return}
  const check=Buffer.from(key,'base64');
  if(check.length!==16){socket.destroy();return}
  const acceptKey=crypto.createHash('sha1').update(key+MAGIC).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acceptKey+'\r\n\r\n');
  let buffer=Buffer.alloc(0),closed=false;
  const connection={
    send(data){if(!closed)sendFrame(socket,1,JSON.stringify(data))},
    close(){if(!closed){sendFrame(socket,8);socket.end();die()}},
    get closed(){return closed},
    onMessage:null,onClose:null
  };
  const die=()=>{if(closed)return;closed=true;connection.onClose?.()};
  socket.on('close',die);socket.on('error',die);
  function receive(chunk){
    if(closed)return;
    if(buffer.length+chunk.length>MAX_FRAME*2){connection.close();return}
    buffer=Buffer.concat([buffer,chunk]);
    while(buffer.length>=2){
      const first=buffer[0],second=buffer[1],opcode=first&15,fin=!!(first&0x80),masked=!!(second&0x80);
      let length=second&127,offset=2;
      if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4}
      else if(length===127){connection.close();return}
      if(!masked||!fin||length>MAX_FRAME||![1,8,9,10].includes(opcode)){connection.close();return}
      if(buffer.length<offset+4+length)return;
      const mask=buffer.subarray(offset,offset+4),payload=Buffer.from(buffer.subarray(offset+4,offset+4+length));
      buffer=buffer.subarray(offset+4+length);
      for(let i=0;i<length;i++)payload[i]^=mask[i&3];
      if(opcode===8){connection.close();return}
      if(opcode===9){if(length<=125)sendFrame(socket,10,payload);continue}
      if(opcode===10)continue;
      if(payload.includes(0)){connection.close();return}
      try{const message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));connection.onMessage?.(message)}
      catch(e){connection.send({type:'error',message:'잘못된 요청 형식입니다.'})}
    }
  }
  socket.on('data',receive);
  onConnection(connection,request);
  if(head?.length)receive(head);
}
module.exports={accept};
