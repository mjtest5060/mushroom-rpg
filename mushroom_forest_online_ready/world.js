// Shared, deterministic world definition used by server and browser.
(function(root, factory) {
  const world = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = world;
  if (root) root.World = world;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const W=50, H=34;
  const rand=(x,y,s=0)=>{const n=Math.sin(x*127.1+y*311.7+s*97.83)*43758.5453;return n-Math.floor(n)};
  const isVillage=(x,y)=>Math.hypot(x-8,y-14)<7.2;
  const isBossClearing=(x,y)=>Math.hypot(x-37,y-14)<5.5;
  function generate(){
    const tiles=[], trees=[], decor=[];
    for(let y=0;y<H;y++){
      const row=[];
      for(let x=0;x<W;x++){
        const water=(y<3&&(x<8||x>41))||(y>29&&x>35)||(x<2&&y>24);
        const road=(Math.abs(y-14)<=1&&x>=7&&x<=39)||(Math.abs(x-8)<=1&&y>=10&&y<=18)||(isVillage(x,y)&&rand(x,y,8)<.56)||(isBossClearing(x,y)&&rand(x,y,8)<.28);
        const type=water?2:road?1:0;row.push(type);
        if(type===0&&rand(x,y,2)>.905)decor.push({x,y,type:rand(x,y,10)>.62?'flower':'tuft'});
        if(type===1&&rand(x,y,3)>.82)decor.push({x,y,type:'pebble'});
        if(type===0&&!isVillage(x,y)&&!isBossClearing(x,y)&&rand(x,y,9)>.76&&!(Math.abs(y-14)<3&&x>6&&x<44)&&x>2&&x<W-2&&y>2&&y<H-3)trees.push({x,y,variant:rand(x,y,23)});
      }
      tiles.push(row);
    }
    const blocked=new Set(trees.map(t=>t.x+','+t.y));
    const isWall=(x,y)=>!Number.isInteger(x)||!Number.isInteger(y)||x<1||x>=W-1||y<1||y>=H-1||tiles[y][x]===2||blocked.has(x+','+y)||npcs.some(n=>n.x===x&&n.y===y);
    return {tiles,trees,decor,isWall};
  }
  const npcs=[{x:10,y:12,name:'루나',type:'luna'},{x:5,y:17,name:'토비',type:'tobi'}];
  const enemySpawns=[{x:18,y:12},{x:21,y:17},{x:23,y:10},{x:27,y:14},{x:29,y:19},{x:34,y:9},{x:36,y:17},{x:40,y:14}];
  return {W,H,rand,npcs,enemySpawns,generate};
});
