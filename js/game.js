'use strict';
/* ================= 素材加载 & 预渲染暗色版 ================= */
const IMGS = {};
const SHADES = {};
function loadImg(name, src){ return new Promise(res=>{ const i=new Image(); i.onload=()=>{IMGS[name]=i;res();}; i.src=src; }); }
function makeShades(img){
  const levs=[0.32,0.48,0.65,0.82];
  return levs.map(lv=>{
    const c=document.createElement('canvas');
    c.width=img.width; c.height=img.height;
    const cx=c.getContext('2d');
    cx.filter=`brightness(${lv})`;
    cx.drawImage(img,0,0);
    cx.filter='none';
    return c;
  });
}
Promise.all([
  loadImg('laugh','assets/p1_laugh.png'),
  loadImg('pout','assets/p2_pout.png'),
  loadImg('grin','assets/p3_grin.png'),
  loadImg('thumbs','assets/p4_thumbs.png'),
  loadImg('p1','assets/p1.png'),
  loadImg('p2','assets/p2.png'),
  loadImg('p3','assets/p3.png'),
  loadImg('p4','assets/p4.png'),
  loadImg('p5','assets/p5.jpg'),
  loadImg('p6','assets/p6.jpg'),
  loadImg('p7','assets/p7.jpg'),
  loadImg('p8','assets/p8.jpg'),
  loadImg('p9','assets/p9.jpg'),
  loadImg('p10','assets/p10.jpg'),
]).then(()=>{
  for(const k in IMGS) SHADES[k]=makeShades(IMGS[k]);
  uiInit();          // ui.js 提供的初始化（绑定菜单等）
});

/* ================= 全局状态 ================= */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const DPR = Math.min(window.devicePixelRatio||1, 2);
let W=0, H=0;

let objs=[];          // 可吞噬目标（建筑/树/行人）
let holes=[];         // 黑洞们
let cars=[];          // 汽车
let totalCount=0;     // 本局开局可吞噬物体总数（进度分母=数量，v=104 改回数量权重）
let player=null;
let mode='arena';     // 'single' | 'arena'
let curTheme='city';  // 当前地图主题（v=100 多地图）
let T=THEMES.city;    // 当前主题配置快捷引用（spawnAll/draw 时刷新）
let timeLeft=TIME_LIMIT;
let gameStartTs=0;       // 本局开始时间戳（单人结算显示用时，v=103）
let running=false, over=false, paused=false;
let mouse={x:0,y:0,active:false,on:false,target:null};
let keys={};
let cam={x:WORLD/2,y:WORLD/2,zoom:1, ang:-Math.PI/2, cos:0, sin:-1};
let lastT=0;

/* ================= 工具 ================= */
const clamp=(v,a,b)=>!(v>=a)?a:(v>b?b:v);   // NaN 安全（v>=a 为 false → 返回 a）
const rand=(a,b)=>a+Math.random()*(b-a);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function areaGrow(r, eatenR){ return Math.sqrt(r*r + eatenR*eatenR*0.16); }   // v=99.5 成长更慢（0.40→0.16）：先吃小的才能吃大建筑
function rr(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); ctx.fill();
}
/* 街区内部随机点（避开道路） */
function blockInner(gx, gy, margin){
  const x0=gx*STEP+ROAD/2+margin, y0=gy*STEP+ROAD/2+margin;
  const x1=(gx+1)*STEP-ROAD/2-margin, y1=(gy+1)*STEP-ROAD/2-margin;
  return { x:rand(x0,x1), y:rand(y0,y1) };
}
/* 街区边缘内侧（人行道/绿化带，道路旁）：沿随机一条边 */
function blockEdge(gx, gy, margin){
  const side=Math.floor(Math.random()*4);
  const x0=gx*STEP+ROAD/2+margin, x1=(gx+1)*STEP-ROAD/2-margin;
  const y0=gy*STEP+ROAD/2+margin, y1=(gy+1)*STEP-ROAD/2-margin;
  if(side===0) return {x:rand(x0,x1), y:y0};
  if(side===1) return {x:x1, y:rand(y0,y1)};
  if(side===2) return {x:rand(x0,x1), y:y1};
  return {x:x0, y:rand(y0,y1)};
}
function randomBlock(){ return { gx:Math.floor(Math.random()*5), gy:Math.floor(Math.random()*5) }; }

/* 城市装饰：栅栏 / 电线杆（预生成） */
const FENCES=[];
for(let i=0;i<16;i++){
  FENCES.push({x:rand(80,WORLD-160), y:rand(80,WORLD-160), len:rand(50,96), horiz:Math.random()<0.5});
}
const POLES=[];
for(let i=1;i<5;i++) for(let j=1;j<5;j++){
  if((i+j)%2===0) continue;
  POLES.push({x:i*STEP+ROAD/2+10, y:j*STEP+ROAD/2+10, r:j<4, d:i<4});
}

/* ================= 音效 ================= */
let actx=null;
function bloop(size){
  try{
    if(!actx) actx=new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume().catch(()=>{});   // iOS Safari 手势后解锁（v=104.5）
    const o=actx.createOscillator(), g=actx.createGain();
    o.type='sine'; o.frequency.setValueAtTime(160 - size*0.6, actx.currentTime);
    o.frequency.exponentialRampToValueAtTime(50, actx.currentTime+0.28);
    g.gain.setValueAtTime(0.28, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime+0.3);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime+0.32);
  }catch(e){}
}

/* ================= 生成：区域化城市布局 ================= */
function makeObj(style, x, y, extra){
  const def=SPAWNS[style];
  // 建筑高度随机层次（tower/stadium 保持原高，防止过高穿天）
  const hVar=(style==='house'||style==='apt'||style==='office'||style==='mall'||style==='shop'||style==='cafe')
    ? def.h*rand(0.9,1.3) : def.h;
  // 建筑外形（v=98：不同建筑不同 3D 形状 —— box 长方体 / cyl 圆筒 / cone 尖顶 / step 阶梯。
  // 圆筒/尖顶 = 高楼（tower），阶梯 = 体育馆/部分写字楼/商场/公寓 → 地图轮廓丰富）
  // v=100：主题建筑 —— 木屋/土坯房/瞭望塔=box，灯塔/金字塔=cone（尖顶），冰屋=cyl（圆顶）
  const shape = style==='tower' ? (Math.random()<0.55?'cyl':'cone')
             : style==='stadium' ? 'step'
             : style==='lighthouse' ? 'cone'
             : style==='pyramid' ? 'cone'
             : style==='church' ? 'cone'          // v=101 教堂：尖顶 + 十字架
             : style==='igloo' ? 'cyl'
             : (style==='office' && Math.random()<0.20) ? 'step'
             : (style==='mall' && Math.random()<0.35) ? 'step'
             : (style==='apt' && Math.random()<0.12) ? 'step'
             : 'box';
  const o={ style, x, y,
           r:def.r*rand(0.82,1.22), h:hVar, score:def.score,
           shape,
           var:Math.floor(Math.random()*3),   // 外观变体：不同色调/细节
           px:rand(0.12,0.45), poster:POSTERS[Math.floor(Math.random()*POSTERS.length)],
           tx:undefined, ty:undefined,
           eaten:false, eater:null, fade:1, inv:0, gone:false,
           spin:rand(0,Math.PI*2), wob:rand(0,Math.PI*2) };
  // v=98.14：所有物体（含设施/树）100% 都有一张海报（用户要求"所有物体上面都放上一张海报"）
  // 每个物体至多一张：设施 1 张、树 1 张、建筑 1 张（见 drawPosterLayer）
  if(extra) Object.assign(o, extra);
  return o;
}
/* 在一个街区里生成一栋建筑：网格排布（像真实街道两边的房子，均匀不重叠） */
function spawnBuildingIn(gx, gy, style){
  const x0=gx*STEP+ROAD/2+22, x1=(gx+1)*STEP-ROAD/2-22;
  const y0=gy*STEP+ROAD/2+22, y1=(gy+1)*STEP-ROAD/2-22;
  const areaW=x1-x0, areaH=y1-y0;          // ~328x328
  const cols=4, rows=(SPAWNS[style].r>42?2:3);   // 大建筑 2x3 格，小建筑 4x3 格（更密）
  const need=Math.max(36, SPAWNS[style].r*1.25);
  for(let k=0;k<80;k++){
    const c=Math.floor(Math.random()*cols), rw=Math.floor(Math.random()*rows);
    const px=x0+(areaW/cols)*c + rand(16, areaW/cols-16);
    const py=y0+(areaH/rows)*rw + rand(16, areaH/rows-16);
    // v=98.10 建筑占马路修复：中心 clamp 到街区内部（距边界 ≥ need*0.8），
    // 大建筑（mall r=64）边缘不再伸出内部区域踩到柏油马路
    const cl=need*0.8;
    let cx2=clamp(px, x0+cl, x1-cl), cy2=clamp(py, y0+cl, y1-cl);
    let ok=true;
    for(const o of objs){
      if(o.gone) continue;
      if(Math.abs(o.x-cx2)<need && Math.abs(o.y-cy2)<need){ ok=false; break; }
    }
    if(ok){
      objs.push(makeObj(style, cx2, cy2));
      // 商店/餐厅门口 → NPC 锚点
      if(style==='shop'||style==='cafe'){
        anchors.push({x:cx2+rand(-6,6), y:cy2 + SPAWNS[style].r*1.35, kind:style==='shop'?'shopdoor':'cafedoor'});
      }
      return;
    }
  }
  // 兜底：街区任意位置
  const p=blockInner(gx, gy, 34);
  objs.push(makeObj(style, p.x, p.y));
  if(style==='shop'||style==='cafe'){
    anchors.push({x:p.x+rand(-6,6), y:p.y + SPAWNS[style].r*1.35, kind:style==='shop'?'shopdoor':'cafedoor'});
  }
}
/* 生成一局完整地图（v=100：按当前主题 THEMES[curTheme] 生成） */
function spawnAll(){
  objs=[]; cars=[]; decos=[]; anchors=[];
  T=THEMES[curTheme];
  const dens = curTheme==='city' ? 1 : 1.5;   // v=101 非城市主题元素密度 ×1.5（用户要求元素更多）
  for(let gy=0; gy<5; gy++){
    for(let gx=0; gx<5; gx++){
      const zone=T.zoneMap[gy][gx];
      if(zone==='park'){
        // 公园/花草地：主题树（PARK_TREES 棵，从 parkBuild 抽取）
        const parkN=Math.round(T.parkTrees*dens);
        for(let i=0;i<parkN;i++){
          const p=blockInner(gx, gy, 40);
          const pick=T.parkBuild[Math.floor(Math.random()*T.parkBuild.length)];
          objs.push(makeObj(pick, p.x, p.y));
        }
      } else if(zone==='land'){
        // 地标区：3 栋主题地标（landBuild 抽取 [style, weight]）
        for(let i=0;i<3;i++){
          const pick=T.landBuild[Math.floor(Math.random()*T.landBuild.length)][0];
          spawnBuildingIn(gx, gy, pick);
        }
      } else {
        // 居民区（小物体 9~12 个）/ 商业区（大物体 7~9 个）→ 密集感（非城市 ×1.5）
        const list=T.zoneBuild[zone]||[['tree',1]];
        const n = zone==='com'
          ? Math.round((7+Math.floor(Math.random()*3))*dens)
          : Math.round((9+Math.floor(Math.random()*4))*dens);
        for(let i=0;i<n;i++){
          let pick=list[0][0];
          let r=Math.random(), acc=0;
          for(const [s,w] of list){ acc+=w; if(r<=acc){ pick=s; break; } }
          // v=100：主题植物/设施/动物（雪人/岩石/仙人掌/棕榈等）不走建筑网格，
          // 像树一样随机散布 + billboard 造型（box 灰盒子会盖住本体造型）
          if(PLANT_STYLES.includes(pick)||PROP_STYLES.includes(pick)||ANIMAL_STYLES.includes(pick)){
            const p=blockInner(gx, gy, 26);
            objs.push(makeObj(pick, p.x, p.y));
          } else {
            spawnBuildingIn(gx, gy, pick);
          }
        }
      }
    }
  }
  // 街区可吃植物（花丛/灌木/花坛）→ 进 objs 参与吞噬
  for(let gy=0; gy<5; gy++) for(let gx=0; gx<5; gx++){
    const zone=T.zoneMap[gy][gx];
    const w=T.decoWeight[zone];
    if(!w) continue;
    for(const kind of ['flower','bush','planter']){
      const expect=w[kind]||0;
      let n=Math.floor(expect);
      if(Math.random()<expect%1) n++;
      for(let i=0;i<n;i++){
        const p=blockInner(gx, gy, 26);
        objs.push(makeObj(kind, p.x, p.y));
      }
    }
  }
  // 街区装饰 + 道路设施（纯贴地/路口设施，不可吞噬）
  spawnDecos();
  // 可吞噬街道设施（路灯/垃圾桶/长椅/…按主题 STREET_WEIGHT）
  spawnProps();
  // 行人：70% 与场景锚点关联（商店门口/公交站/小摊/长椅旁/路边），30% 区域漫游
  const cells=[];
  for(let gy=0; gy<5; gy++) for(let gx=0; gx<5; gx++){
    cells.push({gx, gy, w:T.zonePedW[T.zoneMap[gy][gx]]});
  }
  const totalW=cells.reduce((s,c)=>s+c.w,0);
  for(let i=0;i<T.pedTotal;i++){
    let r=Math.random()*totalW, acc=0, cell=cells[0];
    for(const c of cells){ acc+=c.w; if(r<=acc){ cell=c; break; } }
    if(Math.random()<0.7 && anchors.length){
      // 锚点行人：站在门口/公交站/路边，或小范围走动
      const a=anchors[Math.floor(Math.random()*anchors.length)];
      const px=clamp(a.x+rand(-26,26), 40, WORLD-40);
      const py=clamp(a.y+rand(-6,16), 40, WORLD-40);
      const stand = Math.random()<0.65;
      objs.push(makeObj('ped', px, py, stand
        ? {role:'stand', anchor:a.kind}
        : {role:'walk', anchor:a.kind}));
    } else {
      const p=blockInner(cell.gx, cell.gy, 12);
      objs.push(makeObj('ped', p.x, p.y, {role:'walk'}));
    }
  }
  // 主题动物（v=100：森林鹿 / 海岛螃蟹 / 沙漠骆驼 / 雪地驯鹿 —— 和行人一样漫游）
  for(const anim of T.animals){
    for(let i=0;i<14;i++){   // v=101 动物更多
      const p=blockInner(Math.floor(Math.random()*5), Math.floor(Math.random()*5), 16);
      objs.push(makeObj(anim, p.x, p.y, {role:'walk'}));
    }
  }
  // 汽车（按主题数量/配色）
  for(let i=0;i<T.cars;i++) cars.push(makeCar());
  // v=101 边缘植物带：有边缘地面色的主题（森林/沙漠/雪地）沿世界边界撒一圈主题植物，
  // 让"边缘全是森林/沙子/雪"更真实（城市/海岛边缘是海不撒）
  if(T.edge){
    const edgePlants = curTheme==='forest' ? ['tree','pine','maple','birch']
                     : curTheme==='desert' ? ['cactus','rock']
                     : ['snowpine','snowman'];
    const band=70;
    for(let i=0;i<110;i++){   // v=101 边缘植物更多
      const edge=Math.floor(Math.random()*4);
      let x,y;
      if(edge===0){ x=rand(-band,10); y=rand(0,WORLD); }
      else if(edge===1){ x=rand(WORLD-10,WORLD+band); y=rand(0,WORLD); }
      else if(edge===2){ x=rand(0,WORLD); y=rand(-band,10); }
      else { x=rand(0,WORLD); y=rand(WORLD-10,WORLD+band); }
      const pick=edgePlants[Math.floor(Math.random()*edgePlants.length)];
      objs.push(makeObj(pick, x, y));
    }
  }
  // 吞噬进度分母：开局物体总数（v=104 数量权重——分数权重下 1 分小东西
  // 只占 1544 总分的 20%，吃几十个进度才 1-2%，用户"吃了一堆才 1%2%"；
  // 数量权重吃一半地图 ≈ 50%，直观对应吞噬量）
  totalCount=objs.length+cars.length;
}

/* 当前吞噬进度（0~1）：已吞数量 / 开局总数（v=104 数量权重——
   之前分数权重：1 分小东西只占 1544 总分的 20%，吃几十个进度才 1-2%，
   用户"吃了一堆才 1%2%"，与吞噬量脱节；数量权重吃一半地图 ≈ 50%。
   剩余数用 !eaten 统计（gone 已被 filter 移出 objs，不再计入），
   分母固定为开局总数 → 进度单调递增不回退 */
function eatProgress(){
  let remain=0;
  for(const o of objs){ if(!o.eaten) remain++; }
  for(const c of cars){ if(!c.eaten) remain++; }
  return totalCount>0 ? Math.min(1, (totalCount-remain)/totalCount) : 1;
}

/* ================= 街区装饰系统 ================= */
let decos=[];
let anchors=[];

function spawnDecos(){
  decos=[]; anchors=[];
  T=T||THEMES[curTheme];
  const dens = curTheme==='city' ? 1 : 1.5;   // v=101 非城市主题装饰密度 ×1.5
  for(let gy=0; gy<5; gy++) for(let gx=0; gx<5; gx++){
    const zone=T.zoneMap[gy][gx];
    const w=T.decoWeight[zone];
    if(w){
      for(const kind in w){
        if(kind==='flower'||kind==='bush'||kind==='planter') continue;  // 植物已进 objs（可吞噬）
        const expect=w[kind];
        let n=Math.floor(expect*dens);
        if(Math.random()<expect%1) n++;
        for(let i=0;i<n;i++){
          const p=blockInner(gx, gy, 26);
          decos.push({x:p.x, y:p.y, kind, gx, gy, seed:rand(0,Math.PI*2)});
        }
      }
    }
    // 路边停车位（含静态车）
    const pk=T.parkingWeight[zone]||0;
    for(let i=0;i<pk;i++){
      const horiz=Math.random()<0.5;
      const side=Math.random()<0.5?1:-1;
      let x,y;
      if(horiz){
        x=gx*STEP+rand(ROAD/2+18, STEP-ROAD/2-18);
        y=(gy+(side>0?1:0))*STEP - side*ROAD/2 - side*14;
      } else {
        y=gy*STEP+rand(ROAD/2+18, STEP-ROAD/2-18);
        x=(gx+(side>0?1:0))*STEP - side*ROAD/2 - side*14;
      }
      x=clamp(x,30,WORLD-30); y=clamp(y,30,WORLD-30);
      decos.push({x, y, kind:'parking', horiz, gx, gy, seed:rand(0,1)});
    }
    // 红绿灯（路口，商业区/主干道密集；非城市主题不画）
    if(T.trafficLight && (zone==='com'||zone==='land'||gx===3||gy===1)){
      decos.push({x:gx*STEP+ROAD/2+16, y:gy*STEP+ROAD/2+16, kind:'trafficlight', gx, gy, seed:0});
    }
  }
  // 公交站（商业区示范街区 (3,1)）
  decos.push({x:3*STEP+STEP-ROAD/2-22, y:1*STEP+ROAD/2+44, kind:'busstop', gx:3, gy:1, seed:0});
  anchors.push({x:3*STEP+STEP-ROAD/2-22, y:1*STEP+ROAD/2+44, kind:'busstop'});
  // 道路井盖 / 排水口
  for(let i=0;i<34;i++){
    const horiz=Math.random()<0.5;
    const lane=Math.round(rand(1,4))*STEP;
    const along=rand(90,WORLD-90);
    decos.push({x:horiz?along:lane, y:horiz?lane:along, kind:Math.random()<0.6?'manhole':'drain', gx:-1, gy:-1, seed:rand(0,Math.PI*2)});
  }
  // 主干道护栏
  for(let i=0;i<26;i++){
    const horiz=Math.random()<0.5;
    let x,y;
    if(horiz){ x=rand(90,WORLD-90); y=MAIN_ROAD_Y+(Math.random()<0.5?-1:1)*(MAIN_W/2+10); }
    else { y=rand(90,WORLD-90); x=MAIN_ROAD_X+(Math.random()<0.5?-1:1)*(MAIN_W/2+10); }
    decos.push({x, y, kind:'guardrail', horiz, gx:-1, gy:-1, seed:0});
  }
}

/* 可吞噬街道设施（v=92）：路灯/垃圾桶/长椅/自行车/路标/围栏/小摊/邮箱/广告牌/消防栓。
   路边设施沿街区边缘人行道/绿化带生成（有序街道感），广场设施在街区内部空地。
   全部进 objs → 自动参与吞噬判定/成长/消失动画 */
function spawnProps(){
  T=T||THEMES[curTheme];
  const dens = curTheme==='city' ? 1 : 1.5;   // v=101 非城市主题设施密度 ×1.5
  const kinds=Object.keys(T.streetWeight.res);
  for(let gy=0; gy<5; gy++) for(let gx=0; gx<5; gx++){
    const zone=T.zoneMap[gy][gx];
    const w=T.streetWeight[zone];
    if(!w) continue;
    for(const kind of kinds){
      const expect=w[kind]||0;
      let n=Math.floor(expect*dens);
      if(Math.random()<expect%1) n++;
      for(let i=0;i<n;i++){
        const edgeKinds=['lamp','trash','sign','mail','hydrant','fence','pole'];
        const p=edgeKinds.includes(kind) ? blockEdge(gx,gy,10) : blockInner(gx,gy,24);
        objs.push(makeObj(kind, p.x, p.y));
        if(kind==='bench'||kind==='stall'){
          anchors.push({x:p.x, y:p.y+6, kind});   // 行人聚集点：长椅旁/小摊旁
        }
      }
    }
  }
}

/* LOD：远处自动简化，近处高细节 */
function decoLod(d, dCam){
  const small=['trashcan','hydrant','cone','mailbox','bike','manhole','drain','flower','bush','planter'];
  if(small.includes(d.kind) && dCam>820) return true;
  if((d.kind==='bench'||d.kind==='parking'||d.kind==='guardrail') && dCam>1250) return true;
  if((d.kind==='trafficlight'||d.kind==='busstop') && dCam>1700) return true;
  return false;
}

/* 贴地装饰（画在实体之前：停车位/井盖/排水口） */
function drawDecoGround(d){
  if(d.kind==='parking'){
    ctx.strokeStyle='rgba(255,255,255,0.65)'; ctx.lineWidth=2.5;
    if(d.horiz) ctx.strokeRect(d.x-11, d.y-5, 22, 10);
    else ctx.strokeRect(d.x-5, d.y-11, 10, 22);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.horiz?0:Math.PI/2);
    ctx.fillStyle=['#4a8ee8','#e05252','#e8e8e8','#7cc46a'][Math.floor(d.seed*4)%4];
    ctx.fillRect(-9, -4.5, 18, 9);
    ctx.fillStyle='rgba(255,255,255,0.4)';
    ctx.fillRect(-5, -3.5, 6, 7);
    ctx.restore();
  }
  else if(d.kind==='manhole'){
    ctx.fillStyle='#4a4f58';
    ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, 7); ctx.fill();
    ctx.strokeStyle='#3a3f48'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x-5, d.y); ctx.lineTo(d.x+5, d.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d.x, d.y-5); ctx.lineTo(d.x, d.y+5); ctx.stroke();
  }
  else if(d.kind==='drain'){
    ctx.fillStyle='#3a3f48';
    ctx.fillRect(d.x-8, d.y-2.5, 16, 5);
    ctx.fillStyle='#2e333a';
    for(let i=-6;i<=6;i+=4) ctx.fillRect(d.x+i, d.y-2.5, 2, 5);
  }
}

/* 立体装饰（参与 y-sort，与建筑正确遮挡） */
function drawDeco(d){
  const {x,y,kind,seed}=d;
  ctx.save();
  switch(kind){
    case 'trashcan': {
      ctx.fillStyle='rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(x, y+8, 8, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#6b7a55';
      ctx.beginPath(); ctx.arc(x, y-4, 7, Math.PI, 0); ctx.fill();
      ctx.fillRect(x-7, y-4, 14, 12);
      ctx.fillStyle='#7e8f66';
      ctx.fillRect(x-7, y-4, 14, 4);
      ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(x, y-4, 7, 0, Math.PI); ctx.stroke();
      break;
    }
    case 'hydrant': {
      ctx.fillStyle='rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(x, y+7, 6, 2.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#d94f4f';
      ctx.fillRect(x-4, y-10, 8, 17);
      ctx.beginPath(); ctx.arc(x, y-11, 5, Math.PI, 0); ctx.fill();
      ctx.fillRect(x-9, y-6, 18, 3);
      ctx.fillStyle='#f2f2f2';
      ctx.beginPath(); ctx.arc(x, y-11, 2, 0, 7); ctx.fill();
      break;
    }
    case 'bench': {
      ctx.fillStyle='rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(x, y+6, 14, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#8a5a34';
      ctx.fillRect(x-12, y-8, 24, 3);
      ctx.fillRect(x-12, y-13, 24, 2.5);
      ctx.fillStyle='#6e4426';
      ctx.fillRect(x-11, y-5, 2.5, 6);
      ctx.fillRect(x+8.5, y-5, 2.5, 6);
      break;
    }
    case 'mailbox': {
      ctx.fillStyle='rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(x, y+9, 5, 2, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#5a7ac8';
      ctx.fillRect(x-2, y-2, 4, 11);
      ctx.beginPath(); ctx.arc(x, y-2, 6, Math.PI, 0); ctx.fill();
      ctx.fillRect(x-6, y-5, 12, 6);
      ctx.fillStyle='#8aa4e0';
      ctx.fillRect(x-5, y-6, 10, 2.5);
      break;
    }
    case 'bike': {
      ctx.strokeStyle='#4a6a8a'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(x-7, y-3, 5, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x+7, y-3, 5, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x-7, y-3); ctx.lineTo(x, y-11); ctx.lineTo(x+7, y-3);
      ctx.moveTo(x, y-11); ctx.lineTo(x, y-4);
      ctx.stroke();
      ctx.fillStyle='#e8b64a';
      ctx.beginPath(); ctx.arc(x, y-11, 1.8, 0, 7); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(x, y+2, 13, 3.5, 0, 0, 7); ctx.fill();
      break;
    }
    case 'cone': {
      ctx.fillStyle='rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(x, y+7, 6, 2.5, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#e88a3a';
      ctx.beginPath(); ctx.moveTo(x-6, y-6); ctx.lineTo(x, y-16); ctx.lineTo(x+6, y-6); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#f2f2f2';
      ctx.fillRect(x-4.5, y-9, 9, 2.5);
      ctx.fillRect(x-4.5, y-12.5, 9, 2.5);
      break;
    }
    case 'trafficlight': {
      ctx.fillStyle='#3a3f4a';
      ctx.fillRect(x-2.5, y-44, 5, 44);
      ctx.fillRect(x-8, y-58, 16, 24);
      ctx.fillStyle='#ff5a5a';
      ctx.beginPath(); ctx.arc(x, y-50, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle='#ffd76a';
      ctx.beginPath(); ctx.arc(x, y-44, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle='#5ae05a';
      ctx.beginPath(); ctx.arc(x, y-38, 3.5, 0, 7); ctx.fill();
      ctx.fillStyle='rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(x, y+3, 8, 2.5, 0, 0, 7); ctx.fill();
      break;
    }
    case 'busstop': {
      ctx.fillStyle='rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(x, y+2, 22, 6, 0, 0, 7); ctx.fill();
      ctx.fillStyle='#4a6f9e';
      ctx.fillRect(x-18, y-16, 2, 16);
      ctx.fillRect(x+16, y-16, 2, 16);
      ctx.fillStyle='#6b92c8';
      ctx.beginPath(); ctx.moveTo(x-20, y-16); ctx.lineTo(x+18, y-16); ctx.lineTo(x+18, y-24); ctx.lineTo(x-20, y-24); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(200,225,250,0.4)';
      ctx.fillRect(x-17, y-16, 31, 11);
      ctx.fillStyle='#3a3f4a';
      ctx.fillRect(x-2, y-34, 4, 16);
      ctx.fillStyle='#2f6fce';
      ctx.fillRect(x-9, y-44, 18, 10);
      ctx.fillStyle='#fff';
      ctx.font='bold 7px sans-serif'; ctx.textAlign='center';
      ctx.fillText('BUS', x, y-37);
      break;
    }
    case 'guardrail': {
      ctx.strokeStyle='#cfd6e0'; ctx.lineWidth=3;
      if(d.horiz){
        ctx.beginPath(); ctx.moveTo(x-16, y); ctx.lineTo(x+16, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x-16, y-6); ctx.lineTo(x+16, y-6); ctx.stroke();
        ctx.fillStyle='#aab4c4';
        ctx.fillRect(x-18, y-8, 3, 10); ctx.fillRect(x+15, y-8, 3, 10);
      } else {
        ctx.beginPath(); ctx.moveTo(x, y-16); ctx.lineTo(x, y+16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x-6, y-16); ctx.lineTo(x-6, y+16); ctx.stroke();
        ctx.fillStyle='#aab4c4';
        ctx.fillRect(x-8, y-18, 10, 3); ctx.fillRect(x-8, y+15, 10, 3);
      }
      break;
    }
  }
  ctx.restore();
}

/* ================= 汽车 ================= */
function makeCar(){
  const cols=(T&&T.carColors)||['#e05252','#4a8ee8','#e8b84a','#7cc46a','#b07ae0','#e8e8e8','#3a3f4a'];
  const horiz=Math.random()<0.5;
  const lane=(1+Math.floor(Math.random()*4))*STEP;
  return { horiz, lane, along:rand(80,WORLD-80), dir:Math.random()<0.5?1:-1,
           speed:rand(58,88), color:cols[Math.floor(Math.random()*cols.length)],
           poster:POSTERS[Math.floor(Math.random()*POSTERS.length)],   // v=95 车身贴图
           r:13, eaten:false, eater:null, fade:1, spin:0, gone:false };
}
function carXY(c){ return c.horiz ? {x:c.along, y:c.lane} : {x:c.lane, y:c.along}; }
function updateCars(dt){
  for(const c of cars){
    if(c.gone) continue;
    if(c.eaten){
      c.fade-=dt*2.2; c.spin+=dt*6;
      if(c.eater && c.eater.alive){
        c.along+=(c.eater.x-c.along)*dt*8;
        c.lane+=(c.eater.y-c.lane)*dt*8;
      }
      if(c.fade<=0) c.gone=true;   // 本局不再重生
      continue;
    }
    c.along += c.dir*c.speed*dt;
    if(c.along<50 || c.along>WORLD-50){ c.dir=-c.dir; c.along=clamp(c.along,50,WORLD-50); }
    const cross=(c.dir>0?Math.floor(c.along/STEP)+1:Math.floor(c.along/STEP))*STEP;
    if(Math.abs(c.along-cross)<10){
      const r=Math.random();
      if(r>=0.45){
        const oldLane=c.lane;
        c.horiz=!c.horiz;
        c.lane=cross;
        c.along=oldLane;
        if(r>=0.72) c.dir=-c.dir;
      }
    }
  }
}

/* ================= 黑洞 ================= */
function makeHole(x,y,r,idx){
  return { x,y, r, idx, alive:true, eaten:0, kills:0, score:0,
           face: idx===0?'grin':['pout','grin','thumbs'][idx-1],
           wander:{x:rand(0,WORLD),y:rand(0,WORLD)} };
}
function spawnHoles(n){
  holes=[]; player=null;
  const c=WORLD/2;
  const spots=[[c-320,c-240],[c+300,c-220],[c-280,c+230],[c+300,c+250]];
  for(let i=0;i<n;i++){
    const h=makeHole(spots[i][0],spots[i][1], i===0?18:15, i);   // 起始更小
    holes.push(h);
    if(i===0) player=h;
  }
}
const speedFor = r => clamp(50, 150, 150*Math.pow(30/r, 0.32));
/* 视觉半径：判定半径继续长，绘制封顶 */
function visualR(h){ return Math.min(h.r, MAX_VISUAL_R); }

/* ================= 触屏检测 & 虚拟方向盘 ================= */
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints||0) > 0;
const joyEl=document.getElementById('joy');
const joyKnob=document.getElementById('joyKnob');
const JOY_R=75;
let joy={active:false, dx:0, dy:0};
let joyBase={x:0,y:0};
function joyMove(e){
  const t=e.touches[0];
  let dx=t.clientX-joyBase.x, dy=t.clientY-joyBase.y;
  const d=Math.hypot(dx,dy);
  if(d>JOY_R){ dx=dx/d*JOY_R; dy=dy/d*JOY_R; }
  joy.dx=dx/JOY_R; joy.dy=dy/JOY_R;
  joyKnob.style.transform=`translate(${dx}px, ${dy}px)`;
}
function joyReset(){
  joy.active=false; joy.dx=0; joy.dy=0;
  joyKnob.style.transform='translate(0,0)';
}
if(isTouch){
  joyEl.style.display='block';
  document.getElementById('hint').textContent='🕹 拖动左下角方向盘控制黑洞';
  joyEl.addEventListener('touchstart', e=>{ e.preventDefault(); e.stopPropagation();
    const r=joyEl.getBoundingClientRect();
    joyBase={x:r.left+r.width/2, y:r.top+r.height/2};
    joy.active=true; joyMove(e);
  }, {passive:false});
  joyEl.addEventListener('touchmove', e=>{ e.preventDefault(); e.stopPropagation(); if(joy.active) joyMove(e); }, {passive:false});
  joyEl.addEventListener('touchend', e=>{ e.preventDefault(); e.stopPropagation(); joyReset(); }, {passive:false});
  joyEl.addEventListener('touchcancel', e=>{ e.preventDefault(); joyReset(); }, {passive:false});
}

/* ================= 输入 ================= */
function setupInput(){
  addEventListener('resize', fit);
  addEventListener('keydown', e=>{
    if(e.key==='Escape'){ uiTogglePause(); return; }
    keys[e.key.toLowerCase()]=true;
  });
  addEventListener('keyup',   e=>{ keys[e.key.toLowerCase()]=false; });
  cv.addEventListener('pointermove', e=>{ mouse.x=e.clientX; mouse.y=e.clientY; mouse.on=true; if(mouse.active && !isTouch) mouse.target=unproj(mouse.x, mouse.y); });
  cv.addEventListener('pointerdown', e=>{ mouse.x=e.clientX; mouse.y=e.clientY; mouse.on=true; mouse.active=true; mouse.target=unproj(mouse.x, mouse.y); });
  cv.addEventListener('pointerup',   ()=>{ mouse.active=false; });
  cv.addEventListener('pointerleave',()=>{ mouse.active=false; mouse.on=false; });
  cv.addEventListener('touchstart', e=>{ e.preventDefault(); const t=e.touches[0]; mouse.x=t.clientX; mouse.y=t.clientY; mouse.active=true; mouse.target=unproj(mouse.x, mouse.y); }, {passive:false});
  cv.addEventListener('touchmove',  e=>{ e.preventDefault(); const t=e.touches[0]; mouse.x=t.clientX; mouse.y=t.clientY; mouse.active=true; mouse.target=unproj(mouse.x, mouse.y); }, {passive:false});
  cv.addEventListener('touchend',  ()=>{ mouse.active=false; });
}
function fit(){
  W=innerWidth; H=innerHeight;
  cv.width=W*DPR; cv.height=H*DPR;
  cv.style.width=W+'px'; cv.style.height=H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
function worldFromScreen(sx,sy){
  return { x: cam.x + (sx - W/2)/cam.zoom, y: cam.y + (sy - H/2)/cam.zoom };
}

/* ================= 更新 ================= */
function update(dt){
  const speed = speedFor(player.r)*1.05;
  let dx=0, dy=0, spdMul=1;
  // WASD = 平面四方向平移（基于相机水平朝向；黑洞无前后朝向，移动不旋转相机）
  let fw=0, rt=0;
  if(keys['w']||keys['arrowup'])    fw+=1;
  if(keys['s']||keys['arrowdown'])  fw-=1;
  if(keys['d']||keys['arrowright']) rt+=1;
  if(keys['a']||keys['arrowleft'])  rt-=1;
  if(fw||rt){
    const m=Math.hypot(fw,rt); fw/=m; rt/=m;
    // 屏幕前=(cam.cos,cam.sin)，屏幕右=(-cam.sin,cam.cos)：A=左(-rt) D=右(+rt)
    dx = cam.cos*fw - cam.sin*rt;
    dy = cam.sin*fw + cam.cos*rt;
  }
  else if(joy.active){
    // 摇杆 = 屏幕系 → 世界系：上推=镜头前方，右推=镜头右方
    dx = cam.cos*(-joy.dy) - cam.sin*joy.dx;
    dy = cam.sin*(-joy.dy) + cam.cos*joy.dx;
    spdMul=Math.min(1, Math.hypot(dx,dy));
  }
  else if(mouse.active){
    // 鼠标/触屏按住移动：目标点锁存（pointerdown/move 时更新），不随相机旋转漂移
    if(mouse.target){
      const d=Math.hypot(mouse.target.x-player.x, mouse.target.y-player.y);
      if(d>16){ dx=(mouse.target.x-player.x)/d; dy=(mouse.target.y-player.y)/d; spdMul=clamp(d/130, 0.3, 1); }
    }
  }
  if(dx||dy){ player.mdx=dx; player.mdy=dy; }   // 记录朝向（透视相机用）
  player.x=clamp(player.x+dx*speed*spdMul*dt, 12, WORLD-12);
  player.y=clamp(player.y+dy*speed*spdMul*dt, 12, WORLD-12);

  // AI 移动（竞技模式）
  if(mode==='arena'){
    const elapsed = TIME_LIMIT - timeLeft;
    for(const h of holes){
      if(h===player || !h.alive) continue;
      const sp=speedFor(h.r)*0.92;
      let tx=null, ty=null, flee=false;
      for(const o of holes){
        if(o===h || !o.alive) continue;
        const d=dist(h,o);
        if(o.r > h.r*1.5 && d < h.r*1.3 + o.r){
          const ang=Math.atan2(h.y-o.y, h.x-o.x);
          tx=h.x+Math.cos(ang)*600; ty=h.y+Math.sin(ang)*600; flee=true; break;
        }
      }
      if(!flee){
        let bd=1e18;
        for(const o of objs){
          if(o.eaten||o.gone) continue;
          if(h.r > o.r*1.02){
            const d=dist(h,o);
            if(d<bd){ bd=d; tx=o.x; ty=o.y; }
          }
        }
        for(const c of cars){
          if(c.eaten||c.gone) continue;
          const p=carXY(c);
          if(h.r > c.r*1.02){
            const d=Math.hypot(p.x-h.x,p.y-h.y);
            if(d<bd){ bd=d; tx=p.x; ty=p.y; }
          }
        }
        for(const o of holes){
          if(o===h || !o.alive) continue;
          if(o===player && elapsed < 15) continue;
          if(h.r > o.r*1.5){
            const d=dist(h,o);
            if(d<bd){ bd=d; tx=o.x; ty=o.y; }
          }
        }
        if(tx===null){ const d=dist(h, h.wander);
          if(d<180){ h.wander={x:rand(80,WORLD-80), y:rand(80,WORLD-80)}; }
          tx=h.wander.x; ty=h.wander.y;
        }
      }
      const ang=Math.atan2(ty-h.y, tx-h.x);
      h.x=clamp(h.x+Math.cos(ang)*sp*dt, 12, WORLD-12);
      h.y=clamp(h.y+Math.sin(ang)*sp*dt, 12, WORLD-12);
    }
  }

  // 吞噬物体（建筑/树/行人）
  for(const o of objs){
    if(o.eaten||o.gone||o.inv>0) continue;
    for(const h of holes){
      if(!h.alive) continue;
      if(h.r > o.r*1.03 && dist(h,o) < Math.max(h.r*0.62, h.r - o.r*0.45)){
        o.eaten=true; o.eater=h; o.fade=1;
        h.r=Math.min(950, areaGrow(h.r, o.r));
        h.eaten++; h.score+=o.score;
        if(h===player){ bloop(o.r); }
        break;
      }
    }
  }
  // 吞噬汽车
  for(const c of cars){
    if(c.eaten||c.gone) continue;
    const p=carXY(c);
    for(const h of holes){
      if(!h.alive) continue;
      if(h.r > c.r*1.05 && Math.hypot(p.x-h.x,p.y-h.y) < Math.max(h.r*0.6, h.r - c.r*0.4)){
        c.eaten=true; c.eater=h; c.fade=1;
        h.r=Math.min(950, areaGrow(h.r, c.r*0.9));
        h.eaten++; h.score+=CAR_SCORE;
        if(h===player){ bloop(c.r); }
        break;
      }
    }
  }
  // 黑洞互吞（竞技模式）
  if(mode==='arena'){
    for(let i=0;i<holes.length;i++){
      const a=holes[i]; if(!a.alive) continue;
      for(let j=0;j<holes.length;j++){
        const b=holes[j]; if(i===j || !b.alive) continue;
        if(b.r > a.r*1.5 && dist(a,b) < b.r - a.r*0.35){
          a.alive=false;
          b.r=Math.min(950, areaGrow(b.r, a.r*0.7));
          b.eaten++; b.kills++; b.score+=HOLE_SCORE;
          if(a===player){ gameOver('dead'); return; }
          bloop(a.r);
        }
      }
    }
  }

  // 物体动画 & 行人漫游（被吞后 fade 完即永久消失，不重生）
  for(const o of objs){
    if(o.gone) continue;
    if(o.eaten){
      o.fade-=dt*2.2;
      o.spin+=dt*6;
      if(o.eater && o.eater.alive){
        o.x+=(o.eater.x-o.x)*dt*8;
        o.y+=(o.eater.y-o.y)*dt*8;
      }
      if(o.fade<=0) o.gone=true;
    } else {
      o.inv=Math.max(0, o.inv-dt);
      if(o.style==='ped'||ANIMAL_STYLES.includes(o.style)){   // 行人/动物：站立或漫游
        const spd=ANIMAL_SPEED[o.style]||46;
        if(o.role==='stand'){
          o.wob+=dt*1.2;   // 站立轻微 idle 动作（保持正面）
        } else {
          o.wob+=dt*7;
          if(o.tx===undefined || dist(o,{x:o.tx,y:o.ty})<26){
            o.tx=clamp(o.x+rand(-240,240), 50, WORLD-50);
            o.ty=clamp(o.y+rand(-240,240), 50, WORLD-50);
          } else {
            const d=dist(o,{x:o.tx,y:o.ty});
            o.x+=((o.tx-o.x)/d)*spd*dt;
            o.y+=((o.ty-o.y)/d)*spd*dt;
          }
        }
      } else {
        o.wob+=dt*2;
      }
    }
  }
  // 清理已消失物体
  objs=objs.filter(o=>!o.gone);

  updateCars(dt);

  // 倒计时 & 胜负
  if(mode==='arena'){
    timeLeft-=dt;
    if(timeLeft<=0){ timeLeft=0; gameOver('time'); return; }
  } else {
    // 单人模式：吞噬进度达到阈值 → 判定完成（v=99，无需吞光每一件小物体）
    if(eatProgress() >= SINGLE_COMPLETION){
      gameOver('win'); return;
    }
  }
}

/* ================= 透视相机（行走视角） ================= */
let FOCAL = 545;             // 动态：小黑洞长焦（视野聚焦周围），大黑洞广角（看全图）
const HORIZON_K = 0.04;      // 地平线压到屏幕顶部 4%：几乎看不到天空，更俯视（v=96）
function camParams(){
  const vr=visualR(player);               // 相机参数按视觉尺寸（封顶后稳定，不无限拉远）
  const behind=100 + vr*0.55;
  // camH 按 FOCAL/behind 反算：黑洞恒定在屏幕 78% 高度（v=96 提高俯视角：
  // 相机更高 → 更俯视，高建筑对后方视野的遮挡减少，地图可视范围更大）
  const camH=Math.max(50, (0.78*H - H*HORIZON_K) * behind / FOCAL);
  return { behind, camH };
}
function updateCam(dt){
  // v=97 提高俯视角：FOCAL 基准 560→480（更广角）
  //  → camH 反算增大（相机更高、更俯视），建筑在屏幕上更小 → 实体高建筑对后方视野的遮挡明显减少
  //  → 黑洞中心仍恒定在 62% 屏高（公式自洽），WASD/鼠标控制逻辑不变
  FOCAL = 480 - 0.5*visualR(player);
  const spd=Math.hypot(player.mdx||0, player.mdy||0);
  // 只有鼠标/摇杆移动才让相机跟随转向；键盘 = 平面平移（黑洞无朝向），相机保持不动
  if(spd>0.01 && (mouse.active||joy.active)){
    const target=Math.atan2(player.mdy, player.mdx);
    let da=target-cam.ang;
    while(da>Math.PI) da-=2*Math.PI;
    while(da<-Math.PI) da+=2*Math.PI;
    const turn=3.2*(dt||0.016);        // 角速度恒定（时间无关），不随帧率卡顿/跳变
    cam.ang+=clamp(da, -turn, turn);
  }
  cam.cos=Math.cos(cam.ang); cam.sin=Math.sin(cam.ang);
  const cp=camParams();
  cam.behind=cp.behind; cam.camH=cp.camH; cam.horizon=H*HORIZON_K;
}
/* 世界坐标 (wx,wy) 高度 wz → 屏幕。返回 {x,y,s,depth} 或 null（相机后/太远） */
function proj(wx,wy,wz){
  const dx=wx-player.x, dy=wy-player.y;
  const rx=-dx*cam.sin + dy*cam.cos;     // 右分量 → 屏幕横向
  const ry=dx*cam.cos + dy*cam.sin;      // 前分量 → 深度（近大远小）
  const depth=ry+cam.behind;
  if(depth<14) return null;
  const s=FOCAL/depth;
  if(s<0.045) return null;
  return {x:W/2+rx*s, y:cam.horizon+(cam.camH-wz)*s, s, depth};
}
/* 近平面夹持投影：相机后的点夹到"屏幕底边下方"（切换点位于屏幕外，
   屏幕内永远平滑，不会有子格在屏幕底边附近弹跳/跳舞） */
function projOr(wx,wy,wz){
  const dx=wx-player.x, dy=wy-player.y;
  const rx=-dx*cam.sin + dy*cam.cos;
  const ry=dx*cam.cos + dy*cam.sin;
  const dB=cam.camH*FOCAL/Math.max(1, H-cam.horizon);   // 屏幕底边对应的深度
  const depth=Math.max(dB*0.72, ry+cam.behind);         // 夹持点更远：切换发生在屏幕外
  const s=FOCAL/depth;
  if(s<0.045) return null;
  return {x:W/2+rx*s, y:cam.horizon+(cam.camH-wz)*s, s, depth};
}
/* 屏幕 → 地面世界坐标（逆投影，用于鼠标控制） */
function unproj(sx, sy){
  const d=cam.camH*FOCAL/Math.max(6, sy-cam.horizon);   // 世界深度
  const rx=(sx-W/2)*d/FOCAL;                            // 世界右分量
  return { x:player.x + d*cam.cos - rx*cam.sin,
           y:player.y + d*cam.sin + rx*cam.cos };
}
function quadFill(a,b,c,d){
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
  ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath(); ctx.fill();
}
/* 道路带（vertical=false 横带 y∈[a,b]；true 竖带 x∈[a,b]）。
   先画稍宽的路缘层、再画路面层（同一多点路径采样）→ 路缘永远贴路面，不会翘起；
   交叉口横竖带同色重叠，衔接自然 */
/* 沿线段 (ax,ay)-(bx,by) 按"深度倒数均匀"采样（= 屏幕均匀采样）。
   透视下深度均匀≠屏幕均匀，近处（深度小）必须加密，否则近端折线扭曲（路面变形）。
   注意：采样坐标 tv 必须限制在 [0,1] 内，否则子格/路面多边形畸形延伸覆盖大片区域 */
function edgePts(ax, ay, bx, by, prj, N){
  const da=(ax-player.x)*cam.cos + (ay-player.y)*cam.sin + cam.behind;
  const db=(bx-player.x)*cam.cos + (by-player.y)*cam.sin + cam.behind;
  const clampD=0.72*cam.camH*FOCAL/Math.max(1, H-cam.horizon);
  const d0=Math.max(da,db), d1=Math.min(da,db);
  const dd=Math.abs(db-da);
  const pts=[];
  // 两端深度几乎相同（边近似垂直视线，如朝北时横路的两端）→ 均匀采样即可（屏幕均匀）
  if(dd < Math.max(0.5, d0*0.03)){
    for(let i=0;i<=N;i++){
      const t=i/N;
      const p=prj(ax+(bx-ax)*t, ay+(by-ay)*t, 0);
      if(p) pts.push(p);
    }
    return pts;
  }
  if(d0 <= clampD){
    // 整条边都在夹持区（屏幕外）：只画两端点即可
    const p1=prj(ax,ay,0), p2=prj(bx,by,0);
    if(p1) pts.push(p1); if(p2) pts.push(p2);
    return pts;
  }
  const dEnd=Math.max(clampD, d1);
  for(let i=0;i<=N;i++){
    const t=i/N;
    const d = 1/((1-t)/d0 + t/dEnd);
    const tv = clamp((d-da)/(db-da), 0, 1);   // 必须限制在线段内
    const p=prj(ax+(bx-ax)*tv, ay+(by-ay)*tv, 0);
    if(p) pts.push(p);
  }
  // 近端延伸：线段近端在夹持区外时补一个端点，多边形闭合到屏幕外（不缺失）
  if(d1 < clampD){
    const np = da<db ? prj(ax,ay,0) : prj(bx,by,0);
    if(np) pts.push(np);
  }
  return pts;
}
/* 道路带（vertical=false 横带 y∈[a,b]；true 竖带 x∈[a,b]）。
   沿长方向分段四边形：每段 4 角投影，折线逼近曲线。
   安全无自交（edgePts 多点路径在斜向角度会自交畸形 → 整片灰覆盖） */
function roadBand(a, b, vertical){
  const col=ctx.fillStyle;
  // 路缘层（v=95 强化：更宽更明显，几何位置不变）
  fillBand(a-3.5, b+3.5, vertical, 'rgba(207,202,187,0.65)');
  fillBand(a, b, vertical, col);
}
/* 道路带（vertical=false 横带 y∈[a,b]；true 竖带 x∈[a,b]）。
   世界直线投影仍是直线 → 4 角四边形即精确，道路在世界坐标中固定。
   近端角点在相机后/屏幕外时，沿世界方向直线外推到屏幕外——
   保证屏幕内边缘始终是真实投影直线（不用深度夹持，夹持点会偏离直线导致道路漂移） */
function fillBand(a, b, vertical, col){
  let A,B,C,D;
  if(vertical){
    A=proj(a,0,0); B=proj(b,0,0);
    C=proj(b,WORLD,0); D=proj(a,WORLD,0);
    // 近端（y=0 端）在相机后 → 沿道路方向直线外推到屏幕外（摄像机旋转不吞路）
    if(!A) A=(D?extrap(D,a,WORLD,0,-1):null)||projOr(a,0,0);
    if(!B) B=(C?extrap(C,b,WORLD,0,-1):null)||projOr(b,0,0);
    if(!C||C.y>H) C=extrap(B,b,0,0,1)||projOr(b,WORLD,0);
    if(!D||D.y>H) D=extrap(A,a,0,0,1)||projOr(a,WORLD,0);
  } else {
    A=proj(0,a,0); B=proj(0,b,0);
    C=proj(WORLD,b,0); D=proj(WORLD,a,0);
    // 近端（x=0 端）在相机后 → 沿道路方向直线外推到屏幕外（摄像机旋转不吞路）
    if(!A) A=(D?extrap(D,WORLD,a,-1,0):null)||projOr(0,a,0);
    if(!B) B=(C?extrap(C,WORLD,b,-1,0):null)||projOr(0,b,0);
    if(!C||C.y>H) C=extrap(B,0,b,1,0)||projOr(WORLD,b,0);
    if(!D||D.y>H) D=extrap(A,0,a,1,0)||projOr(WORLD,a,0);
  }
  if(!A||!B||!C||!D) return;
  ctx.fillStyle=col;
  ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y);
  ctx.lineTo(C.x,C.y); ctx.lineTo(D.x,D.y); ctx.closePath(); ctx.fill();
}
/* 直线外推：从可见点 pFar 沿世界方向 (dirx,diry)（指向道路近端）延伸到屏幕外 y=H+200。
   用远端的两个投影点确定屏幕方向（投影直线方向处处相同）→ 外推点精确落在真实直线上 */
function extrap(pFar, wx, wy, dirx, diry){
  if(!pFar) return null;
  const step=Math.max(50, WORLD*0.06);
  const q=proj(wx+dirx*step, wy+diry*step, 0);
  if(!q) return null;
  const dx=q.x-pFar.x, dy=q.y-pFar.y;
  if(Math.abs(dy)<1e-6) return {x:pFar.x+dx*60, y:pFar.y+dy*60, s:1, depth:1};
  const t=(H+200-pFar.y)/dy;
  return {x:pFar.x+dx*t, y:H+200, s:1, depth:1};
}
/* 横线（道路标线等）：直线投影仍是直线 → 分段画线不弯曲。
   深度倒数均匀 4 段（屏幕等距），每段线宽取段内近端 s → 透视近粗远细；
   外推端 s=1 作为保底线宽（至少 wpx 像素），斜向/旋转时黄线不再细到消失 */
function roadLine(y, x0, x1, color, wpx){
  const da=(x0-player.x)*cam.cos+(y-player.y)*cam.sin+cam.behind;
  const db=(x1-player.x)*cam.cos+(y-player.y)*cam.sin+cam.behind;
  if(da<14&&db<14) return;   // 整条线在相机后
  // 深度恒定（线平行视线方向，如正东/正西时的竖线）：世界均匀分段
  if(Math.abs(db-da)<0.01){
    for(let i=0;i<4;i++){
      const xA=x0+(x1-x0)*i/4, xB=x0+(x1-x0)*(i+1)/4;
      let a=proj(xA,y,0), b=proj(xB,y,0);
      if(!a&&!b) continue;
      if(!a) a=extrap(b,xB,y,xA<xB?-1:1,0)||projOr(xA,y,0);
      if(!b) b=extrap(a,xA,y,xA<xB?1:-1,0)||projOr(xB,y,0);
      if(!a||!b) continue;
      const w=Math.max(1, Math.min(wpx*Math.max(a.s,b.s), 24));
      ctx.strokeStyle=color; ctx.lineWidth=w;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    return;
  }
  for(let i=0;i<4;i++){
    const t0=i/4, t1=(i+1)/4;
    const d0=1/((1-t0)/da+t0/db), d1=1/((1-t1)/da+t1/db);
    if(d0<14&&d1<14) continue;
    const tx0=clamp((d0-da)/(db-da),0,1), tx1=clamp((d1-da)/(db-da),0,1);
    if(tx1-tx0<0.001) continue;
    const xA=x0+tx0*(x1-x0), xB=x0+tx1*(x1-x0);
    let a=proj(xA,y,0), b=proj(xB,y,0);
    if(!a&&!b) continue;
    if(!a) a=extrap(b,xB,y,xA<xB?-1:1,0)||projOr(xA,y,0);
    if(!b) b=extrap(a,xA,y,xA<xB?1:-1,0)||projOr(xB,y,0);
    if(!a||!b) continue;
    const w=Math.max(1, Math.min(wpx*Math.max(a.s,b.s), 24));
    ctx.strokeStyle=color;
    ctx.lineWidth=w;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
}
function vRoadLine(x, y0, y1, color, wpx){
  const da=(x-player.x)*cam.cos+(y0-player.y)*cam.sin+cam.behind;
  const db=(x-player.x)*cam.cos+(y1-player.y)*cam.sin+cam.behind;
  if(da<14&&db<14) return;
  // 深度恒定（线平行视线方向，如正东/正西时的横线）：世界均匀分段
  if(Math.abs(db-da)<0.01){
    for(let i=0;i<4;i++){
      const yA=y0+(y1-y0)*i/4, yB=y0+(y1-y0)*(i+1)/4;
      let a=proj(x,yA,0), b=proj(x,yB,0);
      if(!a&&!b) continue;
      if(!a) a=extrap(b,x,yB,0,yA<yB?-1:1)||projOr(x,yA,0);
      if(!b) b=extrap(a,x,yA,0,yA<yB?1:-1)||projOr(x,yB,0);
      if(!a||!b) continue;
      const w=Math.max(1, Math.min(wpx*Math.max(a.s,b.s), 24));
      ctx.strokeStyle=color; ctx.lineWidth=w;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    return;
  }
  for(let i=0;i<4;i++){
    const t0=i/4, t1=(i+1)/4;
    const d0=1/((1-t0)/da+t0/db), d1=1/((1-t1)/da+t1/db);
    if(d0<14&&d1<14) continue;
    const ty0=clamp((d0-da)/(db-da),0,1), ty1=clamp((d1-da)/(db-da),0,1);
    if(ty1-ty0<0.001) continue;
    const yA=y0+ty0*(y1-y0), yB=y0+ty1*(y1-y0);
    let a=proj(x,yA,0), b=proj(x,yB,0);
    if(!a&&!b) continue;
    if(!a) a=extrap(b,x,yB,0,yA<yB?-1:1)||projOr(x,yA,0);
    if(!b) b=extrap(a,x,yA,0,yA<yB?1:-1)||projOr(x,yB,0);
    if(!a||!b) continue;
    const w=Math.max(1, Math.min(wpx*Math.max(a.s,b.s), 24));
    ctx.strokeStyle=color;
    ctx.lineWidth=w;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
}

/* ================= 道路贴地细节（v=95）：人行道 + 斑马线 ================= */
/* 贴地矩形（世界坐标固定，4 角投影，透视下边缘仍是直线） */
function groundRect(cx, cy, hw, hh, col){
  const p0=proj(cx-hw,cy-hh,0), p1=proj(cx+hw,cy-hh,0),
        p2=proj(cx+hw,cy+hh,0), p3=proj(cx-hw,cy+hh,0);
  if(!p0||!p1||!p2||!p3) return;
  ctx.fillStyle=col;
  quadFill(p0,p1,p2,p3);
}
/* 人行道：道路两侧浅色带，按街区段避开路口（固定世界坐标，不碰道路几何） */
function drawSidewalks(){
  const col=T.sideCol||'rgba(238,231,216,0.8)';   // 人行道：颜色按主题（v=100）
  const vGaps=[[STEP,ROAD/2+20],[2*STEP,ROAD/2+20],[MAIN_ROAD_X,MAIN_W/2+24],[4*STEP,ROAD/2+20]];
  const hGaps=[[STEP,ROAD/2+20],[2*STEP,ROAD/2+20],[MAIN_ROAD_Y,MAIN_W/2+24],[4*STEP,ROAD/2+20]];
  // 横带两侧（y=c±(halfW+7)），x 分段避开竖带路口
  for(const c of [STEP,2*STEP,4*STEP,MAIN_ROAD_Y]){
    const halfW = c===MAIN_ROAD_Y ? MAIN_W/2 : ROAD/2;
    for(const side of [-1,1]){
      const cy2=c+side*(halfW+7);
      for(let s=0;s<5;s++){
        let xa=s*STEP+14, xb=(s+1)*STEP-14;
        for(const [vc,hw] of vGaps){
          const va=vc-hw, vb=vc+hw;
          if(xa<vb && xb>va){
            if(vb>=xb) xb=va; else xa=vb;
          }
        }
        if(xb-xa<30) continue;
        groundRect((xa+xb)/2, cy2, (xb-xa)/2, 5, col);
      }
    }
  }
  // 竖带两侧（x=c±(halfW+7)），y 分段避开横带路口
  for(const c of [STEP,2*STEP,4*STEP,MAIN_ROAD_X]){
    const halfW = c===MAIN_ROAD_X ? MAIN_W/2 : ROAD/2;
    for(const side of [-1,1]){
      const cx2=c+side*(halfW+7);
      for(let s=0;s<5;s++){
        let ya=s*STEP+14, yb=(s+1)*STEP-14;
        for(const [hc,hw] of hGaps){
          const va=hc-hw, vb=hc+hw;
          if(ya<vb && yb>va){
            if(vb>=yb) yb=va; else ya=vb;
          }
        }
        if(yb-ya<30) continue;
        groundRect(cx2, (ya+yb)/2, 5, (yb-ya)/2, col);
      }
    }
  }
}
/* 斑马线（人行横道）：16 个路口 × 4 方向 × 5 条白色条纹。
   每个条纹 = 贴地四边形（groundRect，固定世界坐标），路口中心不可见时整组跳过 */
function drawZebra(){
  const col='rgba(255,255,255,0.88)';
  const roads=[STEP,2*STEP,3*STEP,4*STEP];
  for(const ix of roads) for(const iy of roads){
    if(!proj(ix,iy,0)) continue;          // 远处路口整组跳过
    const wV = ix===MAIN_ROAD_X ? MAIN_W : ROAD;   // 被横跨的竖带宽度
    const wH = iy===MAIN_ROAD_Y ? MAIN_W : ROAD;   // 横带宽度
    // 北/南组：条纹横跨竖带（长边沿 x），位于横带边缘外
    for(const sgn of [-1,1]){
      const yc=iy+sgn*(wH/2+4);
      for(let k=0;k<5;k++) groundRect(ix, yc-24+k*12, wV/2, 4, col);
    }
    // 东/西组：条纹横跨横带（长边沿 y），位于竖带边缘外
    for(const sgn of [-1,1]){
      const xc=ix+sgn*(wV/2+4);
      for(let k=0;k<5;k++) groundRect(xc-24+k*12, iy, 4, wH/2, col);
    }
  }
}

/* ================= 绘制 ================= */
function draw(dt){
  ctx.fillStyle='#10141f';
  ctx.fillRect(0,0,W,H);
  if(!player) return;
  updateCam(dt);
  const HOR=cam.horizon;

  /* ---- 天空 + 远空（v=100 按主题取色；云朵只有城市/森林/海岛/雪地有） ---- */
  const sky=ctx.createLinearGradient(0,0,0,HOR+30);
  sky.addColorStop(0,T.sky[0]); sky.addColorStop(1,T.sky[1]);
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,HOR+30);
  ctx.fillStyle='#2b87c4'; ctx.fillRect(0,HOR-8,W,20);
  ctx.fillStyle='#3aa7d8'; ctx.fillRect(0,HOR-2,W,8);
  if(T.clouds){
    ctx.fillStyle='rgba(255,255,255,0.55)';
    const cloudOff=((cam.x*0.02)%280+280)%280;
    for(let i=0;i<3;i++){
      const cx=((i*300-cloudOff)%(W+320))-160, cy=HOR-90-i*26;
      ctx.beginPath(); ctx.ellipse(cx,cy,70,15,0,0,7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx-30,cy-9,40,11,0,0,7); ctx.fill();
    }
  }

  /* ---- 板子外底色（地平线以下）：城市/海岛=海洋渐变；森林/沙漠/雪地=主题地面 ----
     画满整个下半屏，街区板子画在上面；世界边缘外露出的部分就是这层颜色 */
  const edgeCols=T.edge;   // null = 海洋
  const sea=ctx.createLinearGradient(0,HOR,0,HOR+H*0.25);
  if(edgeCols){ sea.addColorStop(0,edgeCols[0]); sea.addColorStop(1,edgeCols[1]); }
  else { sea.addColorStop(0,T.sea[0]); sea.addColorStop(1,T.sea[1]); }
  ctx.fillStyle=sea; ctx.fillRect(0,HOR,W,H-HOR);

  /* ---- 海岛沙滩环：板子外圈一圈沙滩色（世界坐标贴地带，先于街区画） ---- */
  if(T.beach){
    const bw=70;
    ctx.fillStyle=T.beach;
    fillBand(-bw, 0, false, T.beach);
    fillBand(WORLD, WORLD+bw, false, T.beach);
    fillBand(-bw, 0, true, T.beach);
    fillBand(WORLD, WORLD+bw, true, T.beach);
  }

  /* ---- 地面：街区（4×4 子格四边形，安全无自交；颜色按主题） ---- */
  for(let gy=0;gy<5;gy++) for(let gx=0;gx<5;gx++){
    const col=T.zoneCol[T.zoneMap[gy][gx]];
    for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++){
      const x0=gx*STEP+sx*STEP/4, y0=gy*STEP+sy*STEP/4;
      const p0=projOr(x0,y0,0), p1=projOr(x0+STEP/4,y0,0),
            p2=projOr(x0+STEP/4,y0+STEP/4,0), p3=projOr(x0,y0+STEP/4,0);
      if(!p0||!p1||!p2||!p3) continue;
      ctx.fillStyle=col;
      quadFill(p0,p1,p2,p3);
    }
  }
  /* ---- 道路（颜色按主题） ---- */
  ctx.fillStyle=T.roadCol;
  for(let i=STEP;i<WORLD;i+=STEP){
    if(i===MAIN_ROAD_X||i===MAIN_ROAD_Y) continue;
    roadBand(i-ROAD/2, i+ROAD/2, false);
    roadBand(i-ROAD/2, i+ROAD/2, true);
  }
  ctx.fillStyle=T.roadMainCol;   // 主路
  roadBand(MAIN_ROAD_Y-MAIN_W/2, MAIN_ROAD_Y+MAIN_W/2, false);
  roadBand(MAIN_ROAD_X-MAIN_W/2, MAIN_ROAD_X+MAIN_W/2, true);
  /* 车道线（路面中央，多段折线；颜色按主题） */
  ctx.globalAlpha=0.8;
  for(let i=STEP;i<WORLD;i+=STEP){
    if(i===MAIN_ROAD_X||i===MAIN_ROAD_Y) continue;
    roadLine(i, 0, WORLD, T.roadLineCol, 2.5);
    vRoadLine(i, 0, WORLD, T.roadLineCol, 2.5);
  }
  roadLine(MAIN_ROAD_Y-14, 0, WORLD, T.roadLineCol, 3.5);
  roadLine(MAIN_ROAD_Y+14, 0, WORLD, T.roadLineCol, 3.5);
  vRoadLine(MAIN_ROAD_X-14, 0, WORLD, T.roadLineCol, 3.5);
  vRoadLine(MAIN_ROAD_X+14, 0, WORLD, T.roadLineCol, 3.5);
  ctx.globalAlpha=1;

  /* ---- 人行道 + 斑马线（道路表面贴地细节，固定世界坐标） ---- */
  drawSidewalks();
  drawZebra();

  /* ---- 贴地装饰（井盖/停车位/排球场地，画在实体前） ---- */
  for(const d of decos){
    if(d.kind!=='parking'&&d.kind!=='manhole'&&d.kind!=='drain'&&d.kind!=='volleyball') continue;
    drawDecoGround3D(d);
  }

  /* ---- 实体（深度排序：远→近，seq 保证同深度稳定不闪） ---- */
  let seq=0;
  const ents=[];
  for(const o of objs){
    if(o.eaten||o.gone) continue;
    // v=98：建筑中心在相机后时直接跳过（不绘制）——此前用 projOr 夹持兜底会把
    // 玩家背后的建筑画到屏幕底部，玩家移动时它们在屏幕底部滑动，看起来像"建筑跟着黑洞移动"。
    // 建筑属于地图世界（固定 o.x/o.y），中心不可见即本应在视野外，跳过才是正确遮挡。
    const p=proj(o.x,o.y,0); if(!p) continue;
    ents.push({d:p.depth, seq:seq++, fn:()=>drawObj3D(o,p)});
  }
  for(const d of decos){
    if(d.kind==='parking'||d.kind==='manhole'||d.kind==='drain') continue;
    const p=proj(d.x,d.y,0); if(!p) continue;
    ents.push({d:p.depth, seq:seq++, fn:()=>drawDeco3D(d,p)});
  }
  for(const c of cars){
    if(c.gone) continue;
    const q=carXY(c);
    const p=proj(q.x,q.y,0); if(!p) continue;
    ents.push({d:p.depth, seq:seq++, fn:()=>drawCar3D(c,p)});
  }
  for(const h of holes){
    if(!h.alive) continue;
    const p=proj(h.x,h.y,0); if(!p) continue;
    ents.push({d:p.depth, seq:seq++, fn:()=>drawHole3D(h,p)});
  }
  ents.sort((a,b)=>b.d-a.d || a.seq-b.seq);   // 深度大（远）先画 → 近处盖远处，遮挡正确
  for(const e of ents) e.fn();

  /* ---- 被吞噬动画 ---- */
  for(const o of objs){
    if(!(o.eaten&&o.fade>0)) continue;
    const p=proj(o.x,o.y,0); if(!p) continue;
    ctx.save();
    ctx.globalAlpha=Math.max(o.fade,0);
    ctx.translate(p.x,p.y); ctx.scale(p.s,p.s); ctx.rotate(o.spin);
    if(o.style==='ped'){
      const img=IMGS.laugh;
      if(img){ const s=o.r*2.4; const w=s, h=s*(img.height/img.width)*0.9; ctx.drawImage(img,-w/2,-h/2,w,h); }
    } else if(PLANT_STYLES.includes(o.style)){
      plantShape(o.style, o.r*1.8, 0, -o.r*0.5, o.poster);
    } else if(ANIMAL_STYLES.includes(o.style)){
      drawAnimalLocal(o);
    } else if(PROP_STYLES.includes(o.style)){
      propShape(o.style, o.r*1.6, o.poster);
    } else {
      const img=IMGS[o.poster];
      if(img){ const s=o.r*2.2; const w=s, h=s*(img.height/img.width)*0.9; ctx.drawImage(img,-w/2,-h/2,w,h); }
    }
    ctx.restore();
  }
  for(const c of cars){
    if(!(c.eaten&&c.fade>0)) continue;
    const p=proj(c.along,c.lane,0); if(!p) continue;
    ctx.save();
    ctx.globalAlpha=Math.max(c.fade,0);
    ctx.translate(p.x,p.y); ctx.rotate(c.spin);
    ctx.fillStyle=c.color;
    ctx.beginPath(); ctx.ellipse(0,0, 16*p.s, 16*p.s*0.42, 0,0,7); ctx.fill();
    ctx.restore();
  }

  /* ---- 海报（v=101：已并入各建筑自身绘制、随深度排序遮挡，此处不再有覆盖层） ---- */

  /* ---- 远处雾化（很淡，只罩地平线附近，不把地面洗灰） ---- */
  const fog=ctx.createLinearGradient(0,HOR,0,HOR+H*0.14);
  fog.addColorStop(0,'rgba(200,225,245,0.18)'); fog.addColorStop(1,'rgba(200,225,245,0)');
  ctx.fillStyle=fog; ctx.fillRect(0,HOR,W,H*0.14);

  /* ---- 鼠标瞄准环（指针在画面上就显示） ---- */
  if(mouse.on && !isTouch){
    ctx.strokeStyle='rgba(255,255,255,0.65)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 12, 0, 7); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.30)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 19, 0, 7); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 2.5, 0, 7); ctx.fill();
  }

  uiDrawHud();
}

/* ================= 3D 绘制辅助 ================= */
/* 单栋建筑海报（v=101：从"覆盖层"改为随建筑自身绘制 —— 海报与建筑一起参与
   深度排序，近处建筑整体（含海报）盖住远处建筑的海报 → 楼房轮廓清晰，
   远处海报不再"透视"叠在近处楼上。每物 1 张规则不变（建筑 1 张）。） */
function drawObjPoster(o){
  if(o.eaten||o.gone) return;
  if(o.style==='igloo') return;   // v=101 冰屋走 billboard 立式（自带海报）
  const img=IMGS[o.poster];
  if(!img) return;
  const w=o.r*2, H=Math.max(16, o.r*o.h), hw=w/2;
  const cs=[[o.x-hw,o.y-hw],[o.x+hw,o.y-hw],[o.x+hw,o.y+hw],[o.x-hw,o.y+hw]];
  const pb=cs.map(c=>proj(c[0],c[1],0));
  const pt=cs.map(c=>proj(c[0],c[1],H));
  if(!pb[0]||!pt[0]||!pt[1]||!pt[2]||!pt[3]) return;
  // —— 圆筒：朝向相机面的侧面海报 1 张（v=98.13 不再贴顶面）——
  if(o.shape==='cyl'){
    const R=o.r*0.95;
    const ax=o.x+Math.cos(-cam.ang)*R*0.9, ay=o.y+Math.sin(-cam.ang)*R*0.9;
    const pp=proj(ax,ay,H*0.55);
    if(pp){
      const s20=o.r*1.9*pp.s;
      let ph2=s20*(img.height/img.width);
      const maxH2=H*0.70*pp.s;
      if(ph2>maxH2) ph2=maxH2;
      const s2=ph2*(img.width/img.height);
      ctx.drawImage(img, pp.x-s2/2, pp.y-ph2/2, s2, ph2);
    }
    return;
  }
  // —— 尖顶：锥体主体侧面海报 1 张（用户评价最好的位置）——
  if(o.shape==='cone'){
    const pp=proj(o.x,o.y,H*0.5);
    if(pp){
      const s20=o.r*1.7*pp.s;
      let ph2=s20*(img.height/img.width);
      const maxH2=H*0.70*pp.s;
      if(ph2>maxH2) ph2=maxH2;
      const s2=ph2*(img.width/img.height);
      ctx.drawImage(img, pp.x-s2/2, pp.y-ph2/2, s2, ph2);
    }
    return;
  }
  // —— 长方体 / 阶梯：只 1 张（主视角墙面，v=98.14 所有物体统一一张海报）——
  // 4 个面按朝向相机程度排序（dot 越小越朝向相机），取最朝向的面贴 1 张
  let f0=null, best=1e9;
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
    const nx=cs[j][1]-cs[i][1], ny=cs[i][0]-cs[j][0];
    const vx=player.x-cx, vy=player.y-cy;
    const dot=(nx*vx+ny*vy)/Math.max(1,Math.hypot(nx,ny)*Math.hypot(vx,vy));
    if(dot<best){ best=dot; f0={i,j}; }
  }
  if(f0){
    const wA=cs[f0.i], wB=cs[f0.j];
    const fP=(u,v)=>proj(wA[0]+(wB[0]-wA[0])*u, wA[1]+(wB[1]-wA[1])*u, v*H);
    const pp=fP(o.px!==undefined?o.px:0.35, 0.35);
    if(pp){
      const pw0=w*0.75*pp.s;
      const ph0=pw0*(img.height/img.width);
      const maxH1=H*0.70*pp.s;
      const ph=Math.min(ph0,maxH1);
      const pw=ph*(img.width/img.height);
      ctx.drawImage(img, pp.x-pw/2, pp.y-ph/2, pw, ph);
    }
  }
}

/* billboard：在世界点 (px,py) 立式绘制（局部坐标：底部 0,0，向上 -y，单位=世界单位） */
function billboard(p, drawLocal){
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.s, p.s);
  drawLocal();
  ctx.restore();
}

/* 可吞噬街道设施类型（立式 billboard 绘制，见 propShape；定义在 data.js 的 PROP_STYLES） */

function drawObj3D(o,p){
  if(o.inv>0) ctx.save();
  if(o.inv>0) ctx.globalAlpha=0.5+0.5*Math.abs(Math.sin(performance.now()/1000*8));
  if(o.style==='ped') billboard(p, ()=>drawPersonLocal(o));
  else if(o.style==='igloo') billboard(p, ()=>drawIglooLocal(o));   // v=101 冰屋：billboard 立式圆顶
  else if(PLANT_STYLES.includes(o.style))
    billboard(p, ()=>plantLocal(o.style, o.r, o.poster));
  else if(ANIMAL_STYLES.includes(o.style))
    billboard(p, ()=>drawAnimalLocal(o));
  else if(PROP_STYLES.includes(o.style))
    billboard(p, ()=>propShape(o.style, o.r, o.poster));
  else drawBuilding3D(o,p);
  if(o.inv>0) ctx.restore();
}

/* ---- 冰屋（v=101）：billboard 立式半球 —— 任何视角都清晰可辨（原 cyl 圆顶在俯视下压扁） ---- */
function drawIglooLocal(o){
  const s=o.r;
  const img=IMGS[o.poster]||IMGS.laugh;
  ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(0, 2, s*0.8, s*0.2, 0,0,7); ctx.fill(); ctx.restore();
  // 半球主体（冰蓝白，圆顶 + 直壁）
  ctx.fillStyle='#e6f2f8';
  ctx.beginPath(); ctx.arc(0, -s*0.62, s*0.85, Math.PI, 0); ctx.fill();
  ctx.fillRect(-s*0.85, -s*0.62, s*1.7, s*0.62);
  // 冰砖弧线（横向）
  ctx.strokeStyle='rgba(70,110,150,0.6)'; ctx.lineWidth=Math.max(1,s*0.05);
  for(let i=0;i<3;i++){
    ctx.beginPath(); ctx.arc(0, -s*0.62, s*(0.85-i*0.24), Math.PI, 0); ctx.stroke();
  }
  // 冰砖竖线（弧顶以下）
  ctx.strokeStyle='rgba(70,110,150,0.45)';
  for(let i=-2;i<=2;i++){
    const dx=i*s*0.34;
    const r2=s*s*0.85*0.85-dx*dx;
    const topY = r2>0 ? -s*0.62-Math.sqrt(r2) : -s*0.62;
    ctx.beginPath(); ctx.moveTo(dx, topY); ctx.lineTo(dx, 0); ctx.stroke();
  }
  // 入口拱门（深色半圆 + 门框）
  ctx.fillStyle='#dcecf6';
  ctx.beginPath(); ctx.ellipse(0, -s*0.24, s*0.36, s*0.3, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle='#4a6a88';
  ctx.beginPath(); ctx.arc(0, -s*0.26, s*0.26, Math.PI, 0); ctx.fill();
  ctx.fillRect(-s*0.26, -s*0.26, s*0.52, s*0.26);
  ctx.fillStyle='#dcecf6';
  ctx.beginPath(); ctx.ellipse(0, -s*0.3, s*0.16, s*0.13, 0, 0, Math.PI); ctx.fill();
  // 顶部小雪球装饰
  ctx.fillStyle='#f4f8fc';
  ctx.beginPath(); ctx.arc(0, -s*1.44, s*0.14, 0, 7); ctx.fill();
  // 海报 1 张（贴圆顶正面，v=101 每物 1 张规则）
  if(img){
    const fw=s*0.72, fh=fw*(img.height/img.width);
    ctx.drawImage(img, -fw/2, -s*0.78-fh/2, fw, fh);
  }
}

/* 街道设施造型（局部坐标，底部 0,0 贴地；风格与装饰系统统一：卡通、简洁、亮色）。
   poster：贴图名（v=98：路灯/垃圾桶/长椅/自行车/路标/围栏/邮箱/消防栓/电线杆等
   也按 poster 贴搞怪人物图，尺寸按物体适配、正常距离明显可见） */
function propShape(kind, r, poster){
  const simg = poster ? IMGS[poster] : null;
  switch(kind){
    case 'lamp':   // 路灯：杆 + 弯灯头 + 暖光 + 杆身贴图
      ctx.fillStyle='#4a4f58'; ctx.fillRect(-1.5,-22,3,22);
      ctx.fillStyle='#3a3f4a'; ctx.beginPath(); ctx.arc(3,-22,4,0,7); ctx.fill();
      ctx.fillStyle='#ffe98a'; ctx.beginPath(); ctx.arc(3,-22,2.6,0,7); ctx.fill();
      if(simg){
        const sw2=10, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -20-sh2, sw2, sh2);   // 杆身挂图（比杆宽，广告牌感）
      }
      break;
    case 'trash':  // 垃圾桶 + 桶身贴脸
      ctx.fillStyle='#6b7a55'; ctx.beginPath(); ctx.arc(0,-10,6.5,Math.PI,0); ctx.fill();
      ctx.fillRect(-6.5,-6,13,8); ctx.fillStyle='#7e8f66'; ctx.fillRect(-6.5,-6,13,2.5);
      if(simg){
        const sw2=9, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -7-sh2, sw2, sh2);
      }
      break;
    case 'bench':  // 长椅 + 椅背贴脸
      ctx.fillStyle='#8a5a34'; ctx.fillRect(-12,-10,24,3); ctx.fillRect(-12,-15,24,2.5);
      ctx.fillStyle='#6e4426'; ctx.fillRect(-11,-7,2.5,7); ctx.fillRect(8.5,-7,2.5,7);
      if(simg){
        const sw2=9, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -15-sh2, sw2, sh2);   // 椅背上方
      }
      break;
    case 'bike':   // 自行车 + 车架挂小脸
      ctx.strokeStyle='#4a6a8a'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(-7,-5,5,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(7,-5,5,0,7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7,-5); ctx.lineTo(0,-13); ctx.lineTo(7,-5);
      ctx.moveTo(0,-13); ctx.lineTo(0,-6); ctx.stroke();
      ctx.fillStyle='#e8b64a'; ctx.beginPath(); ctx.arc(0,-13,1.8,0,7); ctx.fill();
      if(simg){
        const sw2=7, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -16-sh2, sw2, sh2);   // 车把上方
      }
      break;
    case 'sign':   // 路标：立柱 + 圆形限速牌 + 杆身贴图
      ctx.fillStyle='#4a4f58'; ctx.fillRect(-1.5,-19,3,19);
      ctx.fillStyle='#e05a4a'; ctx.beginPath(); ctx.arc(0,-22,8,0,7); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='bold 7px sans-serif'; ctx.textAlign='center';
      ctx.fillText('40',0,-19.5);
      if(simg){
        const sw2=7, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -16-sh2, sw2, sh2);
      }
      break;
    case 'fence':  // 围栏：横栏 + 立柱 + 偶发贴图
      ctx.strokeStyle='#cfd6e0'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(-15,-4); ctx.lineTo(15,-4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15,-10); ctx.lineTo(15,-10); ctx.stroke();
      ctx.fillStyle='#aab4c4';
      for(let i=-15;i<=15;i+=10) ctx.fillRect(i-1.5,-12,3,12);
      if(simg){
        const sw2=8, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -12-sh2, sw2, sh2);   // 中柱上方挂图
      }
      break;
    case 'stall':  // 小摊：遮阳棚 + 摊桌 + 腿（顶棚贴图）
      ctx.fillStyle='#d94f4f'; ctx.fillRect(-14,-18,28,4);
      ctx.fillStyle='#e8d9b8'; ctx.fillRect(-11,-12,22,7);
      ctx.fillStyle='#8a5a34'; ctx.fillRect(-10,-5,3,5); ctx.fillRect(7,-5,3,5);
      if(simg){
        const sw2=13, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -18-sh2, sw2, sh2);   // 挂在顶棚上沿
      }
      break;
    case 'mail':   // 邮箱 + 箱身贴脸
      ctx.fillStyle='#5a7ac8'; ctx.fillRect(-2,-2,4,11);
      ctx.beginPath(); ctx.arc(0,-2,6,Math.PI,0); ctx.fill(); ctx.fillRect(-6,-6,12,6);
      ctx.fillStyle='#8aa4e0'; ctx.fillRect(-5,-7,10,2.5);
      if(simg){
        const sw2=8, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -7-sh2, sw2, sh2);
      }
      break;
    case 'billboard':  // 广告牌：立柱 + 大牌（贴图代替文字）
      ctx.fillStyle='#4a4f58'; ctx.fillRect(-12,-20,3,20); ctx.fillRect(9,-20,3,20);
      ctx.fillStyle='#e8ecf4'; ctx.fillRect(-14,-30,28,12);
      ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=1.5;
      ctx.strokeRect(-14,-30,28,12);
      if(simg){
        const bw2=24, bh2=bw2*(simg.height/simg.width);
        ctx.drawImage(simg, -bw2/2, -29-bh2/2, bw2, bh2);   // 大牌内贴图
      } else {
        ctx.fillStyle='#5a7ac8'; ctx.fillRect(-12,-28,24,8);
        ctx.fillStyle='#fff'; ctx.font='bold 7px sans-serif'; ctx.textAlign='center';
        ctx.fillText('AD',0,-22.5);
      }
      break;
    case 'hydrant':  // 消防栓 + 栓身贴脸
      ctx.fillStyle='#d94f4f'; ctx.fillRect(-4,-14,8,15);
      ctx.beginPath(); ctx.arc(0,-15,5,Math.PI,0); ctx.fill();
      ctx.fillRect(-8,-8,16,3);
      ctx.fillStyle='#f2f2f2'; ctx.beginPath(); ctx.arc(0,-15,2,0,7); ctx.fill();
      if(simg){
        const sw2=7, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -13-sh2, sw2, sh2);
      }
      break;
    case 'pole':   // 电线杆（v=98）：细杆 + 横担 + 绝缘子 + 杆身竖条贴图
      ctx.fillStyle='#5a5148'; ctx.fillRect(-1.5,-30,3,30);
      ctx.fillStyle='#6e655c'; ctx.fillRect(-1.5,-32,3,2.5);   // 杆顶帽
      ctx.fillStyle='#7a7168'; ctx.fillRect(-9,-27,18,2);      // 横担
      ctx.fillStyle='#d8d4cc';                                  // 绝缘子
      ctx.beginPath(); ctx.arc(-8,-28,1.6,0,7); ctx.fill();
      ctx.beginPath(); ctx.arc(8,-28,1.6,0,7); ctx.fill();
      if(simg){
        const sw2=9, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -26-sh2, sw2, sh2);   // 杆身挂图（比杆宽，贴纸感）
      }
      break;
    /* ===== v=100 主题设施 ===== */
    case 'umbrella':  // 沙滩伞：红白条纹伞面 + 杆
      ctx.fillStyle='#b8864a'; ctx.fillRect(-1,-22,2,22);
      ctx.beginPath(); ctx.moveTo(-13,-22); ctx.quadraticCurveTo(0,-34, 13,-22); ctx.closePath(); ctx.fill();
      for(let i=-2;i<=2;i++){
        ctx.fillStyle=(i%2===0)?'#e05a4a':'#f8f4ea';
        ctx.beginPath();
        ctx.moveTo(0,-29);
        ctx.lineTo(i*6.5-3.25,-22); ctx.lineTo(i*6.5+3.25,-22);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle='#c84a3a'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-13,-22); ctx.quadraticCurveTo(0,-34, 13,-22); ctx.stroke();
      ctx.fillStyle='#e8c86a'; ctx.beginPath(); ctx.arc(0,-29,1.6,0,7); ctx.fill();
      if(simg){
        const sw2=7, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -24-sh2, sw2, sh2);
      }
      break;
    case 'sandcastle':  // 沙堡：双塔 + 城齿
      ctx.fillStyle='#e8cf9a';
      ctx.fillRect(-9,-4,18,4);
      ctx.fillRect(-12,-12,8,12); ctx.fillRect(4,-12,8,12);
      ctx.fillRect(-12,-16,3,4); ctx.fillRect(-7,-16,3,4);
      ctx.fillRect(4,-16,3,4); ctx.fillRect(9,-16,3,4);
      ctx.fillStyle='#d4b878'; ctx.fillRect(-5,-4,10,1.5);
      ctx.fillStyle='#a8844a';
      ctx.beginPath(); ctx.arc(-8,-6,2,0,7); ctx.fill();
      ctx.beginPath(); ctx.arc(8,-6,2,0,7); ctx.fill();
      if(simg){
        const sw2=8, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -13-sh2, sw2, sh2);
      }
      break;
    case 'tent':  // 帐篷：三角 + 门 + 顶旗
      ctx.fillStyle='#e8965a';
      ctx.beginPath(); ctx.moveTo(-15,-20); ctx.lineTo(0,-6); ctx.lineTo(15,-20); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#d8844a';
      ctx.beginPath(); ctx.moveTo(0,-6); ctx.lineTo(15,-20); ctx.lineTo(0,-2); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#8a5a34';
      ctx.beginPath(); ctx.moveTo(-3,-10); ctx.lineTo(3,-10); ctx.lineTo(0,-2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#b06a3a'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-15,-20); ctx.lineTo(0,-6); ctx.lineTo(15,-20); ctx.stroke();
      ctx.fillStyle='#3a3f4a'; ctx.fillRect(-0.5,-22,1,3);
      ctx.fillStyle='#e05a4a'; ctx.beginPath(); ctx.moveTo(0.5,-22); ctx.lineTo(6,-20.5); ctx.lineTo(0.5,-19); ctx.closePath(); ctx.fill();
      if(simg){
        const sw2=9, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -16-sh2, sw2, sh2);
      }
      break;
    case 'rock':  // 岩石：多边形石块（雪地=白色雪堆）
      ctx.fillStyle='#a8a294';
      ctx.beginPath(); ctx.moveTo(-14,-12); ctx.lineTo(-6,-22); ctx.lineTo(4,-24); ctx.lineTo(12,-16); ctx.lineTo(14,-4); ctx.lineTo(-10,-2); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#c4beb0';
      ctx.beginPath(); ctx.moveTo(-6,-22); ctx.lineTo(4,-24); ctx.lineTo(6,-16); ctx.lineTo(-4,-14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#8a8476'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(-14,-12); ctx.lineTo(-6,-22); ctx.lineTo(4,-24); ctx.lineTo(12,-16); ctx.lineTo(14,-4); ctx.lineTo(-10,-2); ctx.closePath(); ctx.stroke();
      if(simg){
        const sw2=8, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -20-sh2, sw2, sh2);
      }
      break;
    case 'surfboard':  // 冲浪板（v=101）：立式彩色冲浪板 + 尾鳍
      ctx.fillStyle='#e8646e';
      ctx.beginPath(); ctx.moveTo(-4,-28); ctx.quadraticCurveTo(-2,0, 4,-28); ctx.quadraticCurveTo(2,0, -4,-28); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#f0f4f8';
      ctx.beginPath(); ctx.moveTo(0,-22); ctx.quadraticCurveTo(1,-8, 2.5,-22); ctx.quadraticCurveTo(0.5,-8, 0,-22); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#c04838'; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(-4,-28); ctx.quadraticCurveTo(-2,0, 4,-28); ctx.stroke();
      if(simg){
        const sw2=7, sh2=sw2*(simg.height/simg.width);
        ctx.drawImage(simg, -sw2/2, -26-sh2, sw2, sh2);
      }
      break;
  }
}

/* ---- 行人：立式小人（v=92：身体更小，头部相对放大 → 脸保持清晰）。
   v=98.12：脸用 o.poster 随机图（不再所有人同一张 laugh）；
   去掉阴影叠层 → 小人身上只有一张干净的脸（用户反馈"一个身上贴几张脸太诡异"） ---- */
function drawPersonLocal(o){
  const img=IMGS[o.poster]||IMGS.laugh;
  if(!img) return;
  const s=o.r*1.35;                    // 整体更小（r 15→11）
  const ar=img.height/img.width;
  const walk=o.wob*1.5;
  const isStand=o.role==='stand';
  const swing=isStand?Math.sin(walk)*s*0.05:Math.sin(walk)*s*0.26;
  const bob=isStand?Math.sin(walk*0.7)*1:Math.abs(Math.sin(walk))*2.2;
  const bodyH=s*0.55, legH=s*0.45;     // 躯干腿更短（卡通 Q 版）
  const headW=s*1.45, headH=headW*ar;  // 头占比大 → 脸清楚（v=95 略放大 +13%）
  const footY=0, legY=footY-legH, bodyY=legY-bodyH;
  ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(0, 2, s*0.5, s*0.14, 0,0,7); ctx.fill(); ctx.restore();
  ctx.fillStyle='#4a5a78';
  ctx.fillRect(-s*0.2+swing, legY, s*0.15, legH);
  ctx.fillRect(s*0.05-swing, legY, s*0.15, legH);
  ctx.fillStyle='#333';
  ctx.fillRect(-s*0.22+swing, -s*0.1, s*0.19, s*0.1);
  ctx.fillRect(s*0.03-swing, -s*0.1, s*0.19, s*0.1);
  ctx.fillStyle='#5aa7e8';
  rr(-s*0.3, bodyY, s*0.6, bodyH, s*0.14);
  ctx.strokeStyle='#5aa7e8'; ctx.lineWidth=s*0.12; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(-s*0.28, bodyY+s*0.14);
  ctx.lineTo(-s*0.28-Math.sin(walk)*s*0.22, bodyY+bodyH*0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.28, bodyY+s*0.14);
  ctx.lineTo(s*0.28+Math.sin(walk)*s*0.22, bodyY+bodyH*0.7); ctx.stroke();
  ctx.lineCap='butt';
  const hy=bodyY-headH+bob;            // 头底贴住肩膀，头大身小
  ctx.drawImage(img, -headW/2, hy, headW, headH);   // 一张干净的脸（v=98.12 无阴影叠层）
}

/* ---- 动物（v=100）：billboard 立式，和行人一样漫游走动；身体上贴 1 张表情脸 ---- */
function drawAnimalLocal(o){
  const img=IMGS[o.poster]||IMGS.laugh;
  const s=o.r;
  const walk=o.wob*1.5;
  const bob=Math.abs(Math.sin(walk))*s*0.08;
  const swing=Math.sin(walk)*s*0.14;
  ctx.save(); ctx.globalAlpha=0.25; ctx.fillStyle='#000';
  ctx.beginPath(); ctx.ellipse(0, 2, s*0.55, s*0.14, 0,0,7); ctx.fill(); ctx.restore();
  if(o.style==='deer'){   // 小鹿：棕身 + 白尾 + 角
    ctx.fillStyle='#b06a3a';
    ctx.fillRect(-s*0.28+swing, -s*0.42, s*0.12, s*0.42);
    ctx.fillRect(s*0.16+swing, -s*0.42, s*0.12, s*0.42);
    ctx.fillRect(-s*0.2-swing*0.6, -s*0.8, s*0.1, s*0.38);
    ctx.fillRect(s*0.12+swing*0.6, -s*0.8, s*0.1, s*0.38);
    ctx.fillStyle='#c8784a';
    ctx.beginPath(); ctx.ellipse(0, -s*0.72+bob, s*0.44, s*0.3, 0, 0, 7); ctx.fill();
    ctx.fillStyle='#e8a86a';
    ctx.beginPath(); ctx.ellipse(0, -s*0.78+bob, s*0.3, s*0.16, 0, 0, 7); ctx.fill();
    ctx.fillStyle='#f4e0c8';
    ctx.beginPath(); ctx.ellipse(-s*0.38, -s*0.7+bob, s*0.09, s*0.14, 0, 0, 7); ctx.fill();  // 尾巴
    ctx.strokeStyle='#8a5a34'; ctx.lineWidth=s*0.05; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-s*0.1, -s*1.02+bob); ctx.lineTo(-s*0.22, -s*1.22+bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.1, -s*1.02+bob); ctx.lineTo(s*0.22, -s*1.22+bob); ctx.stroke();
    ctx.lineCap='butt';
    ctx.fillStyle='#8a5a34';
    ctx.beginPath(); ctx.arc(-s*0.22, -s*1.24+bob, s*0.04, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.22, -s*1.24+bob, s*0.04, 0, 7); ctx.fill();
    if(img){ const fw=s*0.66, fh=fw*(img.height/img.width); ctx.drawImage(img, -fw/2, -s*0.9-fh/2+bob, fw, fh); }
  }
  else if(o.style==='crab'){   // 螃蟹：红身 + 双钳 + 六脚（横着走）
    ctx.strokeStyle='#c04a3a'; ctx.lineWidth=s*0.07; ctx.lineCap='round';
    for(let i=-1;i<=1;i++){
      ctx.beginPath(); ctx.moveTo(-s*0.3, -s*0.12+i*s*0.13); ctx.lineTo(-s*0.6, -s*0.08+i*s*0.15+swing*0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s*0.3, -s*0.12+i*s*0.13); ctx.lineTo(s*0.6, -s*0.08+i*s*0.15+swing*0.4); ctx.stroke();
    }
    ctx.strokeStyle='#e05a4a'; ctx.lineWidth=s*0.12;
    ctx.beginPath(); ctx.moveTo(-s*0.34, -s*0.34+bob); ctx.quadraticCurveTo(-s*0.62, -s*0.42+bob, -s*0.52, -s*0.62+bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.34, -s*0.34+bob); ctx.quadraticCurveTo(s*0.62, -s*0.42+bob, s*0.52, -s*0.62+bob); ctx.stroke();
    ctx.lineCap='butt';
    ctx.fillStyle='#e86454';
    ctx.beginPath(); ctx.ellipse(0, -s*0.3+bob, s*0.4, s*0.26, 0, 0, 7); ctx.fill();
    ctx.strokeStyle='#c04838'; ctx.lineWidth=s*0.05;
    ctx.beginPath(); ctx.ellipse(0, -s*0.3+bob, s*0.4, s*0.26, 0, 0, 7); ctx.stroke();
    ctx.fillStyle='#3a3f4a';
    ctx.beginPath(); ctx.arc(-s*0.14, -s*0.44+bob, s*0.045, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(s*0.14, -s*0.44+bob, s*0.045, 0, 7); ctx.fill();
    if(img){ const fw=s*0.56, fh=fw*(img.height/img.width); ctx.drawImage(img, -fw/2, -s*0.36-fh/2+bob, fw, fh); }
  }
  else if(o.style==='camel'){   // 骆驼：驼峰 + 长脖子 + 小头
    ctx.fillStyle='#c8944a';
    ctx.fillRect(-s*0.3+swing, -s*0.36, s*0.14, s*0.36);
    ctx.fillRect(s*0.16+swing, -s*0.36, s*0.14, s*0.36);
    ctx.fillStyle='#d8a45a';
    ctx.beginPath(); ctx.ellipse(0, -s*0.62+bob, s*0.5, s*0.28, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-s*0.18, -s*0.86+bob, s*0.2, s*0.18, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s*0.18, -s*0.86+bob, s*0.2, s*0.18, 0, 0, 7); ctx.fill();
    ctx.fillStyle='#c8944a';
    ctx.beginPath(); ctx.moveTo(s*0.2, -s*0.7+bob); ctx.lineTo(s*0.3, -s*1.1+bob); ctx.lineTo(s*0.12, -s*1.1+bob); ctx.lineTo(s*0.08, -s*0.62+bob); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s*0.3, -s*1.2+bob, s*0.12, s*0.1, 0, 0, 7); ctx.fill();
    if(img){ const fw=s*0.52, fh=fw*(img.height/img.width); ctx.drawImage(img, -fw/2, -s*0.72-fh/2+bob, fw, fh); }
  }
  else {   // reindeer 驯鹿：棕身 + 大角 + 白胸
    ctx.fillStyle='#8a5a3a';
    ctx.fillRect(-s*0.28+swing, -s*0.4, s*0.12, s*0.4);
    ctx.fillRect(s*0.16+swing, -s*0.4, s*0.12, s*0.4);
    ctx.fillRect(-s*0.2-swing*0.6, -s*0.72, s*0.1, s*0.32);
    ctx.fillRect(s*0.12+swing*0.6, -s*0.72, s*0.1, s*0.32);
    ctx.fillStyle='#a86a44';
    ctx.beginPath(); ctx.ellipse(0, -s*0.66+bob, s*0.46, s*0.28, 0, 0, 7); ctx.fill();
    ctx.fillStyle='#f4e8dc';
    ctx.beginPath(); ctx.ellipse(0, -s*0.6+bob, s*0.22, s*0.16, 0, 0, 7); ctx.fill();
    ctx.fillStyle='#c8784a';
    ctx.beginPath(); ctx.moveTo(s*0.28, -s*0.8+bob); ctx.lineTo(s*0.38, -s*1.05+bob); ctx.lineTo(s*0.2, -s*1.02+bob); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#6e4a2a'; ctx.lineWidth=s*0.05; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(s*0.3, -s*1.02+bob); ctx.lineTo(s*0.16, -s*1.2+bob); ctx.lineTo(s*0.08, -s*1.08+bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s*0.3, -s*1.02+bob); ctx.lineTo(s*0.36, -s*1.2+bob); ctx.lineTo(s*0.42, -s*1.06+bob); ctx.stroke();
    ctx.lineCap='butt';
    if(img){ const fw=s*0.62, fh=fw*(img.height/img.width); ctx.drawImage(img, -fw/2, -s*0.82-fh/2+bob, fw, fh); }
  }
}

/* ---- 植物：立式（poster：v=98 树可贴人物图，搞怪元素） ---- */
function plantLocal(style, r, poster){
  plantShape(style, r*1.8, 0, -r*0.5, poster);
}
function plantShape(style, r, x, y, poster){
  if(style==='flower'){
    const cols=['#e8646e','#e8b64a','#c98ae8','#6ab7e8'];
    const c=cols[Math.abs(Math.floor((x*7+y*13)))%4];
    for(let i=-1;i<=1;i++){
      ctx.fillStyle='#5da65a';
      ctx.beginPath(); ctx.arc(x+i*r*0.5, y-r*0.15+Math.abs(i)*r*0.15, r*0.22, 0, 7); ctx.fill();
    }
    ctx.fillStyle=c;
    for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.arc(x+i*r*0.5, y-r*0.4+Math.abs(i)*r*0.15, r*0.16, 0, 7); ctx.fill(); }
  }
  else if(style==='bush'){
    ctx.fillStyle='#5da65a';
    ctx.beginPath(); ctx.arc(x-r*0.3, y-r*0.25, r*0.35, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.3, y-r*0.25, r*0.35, 0, 7); ctx.fill();
    ctx.fillStyle='#74c26c';
    ctx.beginPath(); ctx.arc(x, y-r*0.42, r*0.32, 0, 7); ctx.fill();
  }
  else if(style==='planter'){
    ctx.fillStyle='#a0927e';
    ctx.fillRect(x-r*0.5, y-r*0.3, r, r*0.5);
    ctx.fillStyle='#6cbf5e';
    ctx.beginPath(); ctx.arc(x-r*0.2, y-r*0.45, r*0.2, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.2, y-r*0.5, r*0.22, 0, 7); ctx.fill();
    ctx.fillStyle='#e8646e';
    ctx.beginPath(); ctx.arc(x-r*0.2, y-r*0.45, r*0.09, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.1, y-r*0.55, r*0.08, 0, 7); ctx.fill();
  }
  /* ===== v=100 主题植物 ===== */
  else if(style==='pine'||style==='snowpine'){   // 松树：两层三角 + 树干（snowpine 雪地版加雪顶）
    ctx.fillStyle='#8a6a44';
    ctx.fillRect(x-r*0.07, y, r*0.14, r*0.42);
    ctx.fillStyle='#3f8a5a';
    ctx.beginPath(); ctx.moveTo(x-r*0.72, y-r*0.1); ctx.lineTo(x, y-r*0.95); ctx.lineTo(x+r*0.72, y-r*0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#4a9a66';
    ctx.beginPath(); ctx.moveTo(x-r*0.55, y-r*0.42); ctx.lineTo(x, y-r*1.18); ctx.lineTo(x+r*0.55, y-r*0.42); ctx.closePath(); ctx.fill();
    if(style==='snowpine'){   // 雪顶（v=100）
      ctx.fillStyle='#f2f7fa';
      ctx.beginPath(); ctx.moveTo(x-r*0.5, y-r*0.42); ctx.lineTo(x, y-r*1.08); ctx.lineTo(x+r*0.5, y-r*0.42); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x-r*0.62, y-r*0.14); ctx.lineTo(x, y-r*0.8); ctx.lineTo(x+r*0.62, y-r*0.14); ctx.closePath(); ctx.fill();
    }
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.72, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.8-th/2, tw, th);
    }
  }
  else if(style==='palm'){   // 棕榈树：弯干 + 放射叶片 + 椰子
    ctx.fillStyle='#9a6a42';
    ctx.beginPath(); ctx.moveTo(x-r*0.09, y); ctx.quadraticCurveTo(x-r*0.1, y-r*0.5, x-r*0.02, y-r*0.62); ctx.lineTo(x+r*0.09, y-r*0.58); ctx.quadraticCurveTo(x+r*0.04, y-r*0.45, x+r*0.09, y); ctx.closePath(); ctx.fill();
    const cx=x, cy=y-r*0.66;
    for(const ang of [30, 90, 150, 210, 270, 330]){
      ctx.strokeStyle='#5eae62'; ctx.lineWidth=r*0.2; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx+Math.cos(ang*Math.PI/180)*r*0.45, cy+Math.sin(ang*Math.PI/180)*r*0.45,
                          cx+Math.cos(ang*Math.PI/180)*r*0.8, cy+Math.sin(ang*Math.PI/180)*r*0.8+r*0.12);
      ctx.stroke();
    }
    ctx.lineCap='butt';
    ctx.fillStyle='#4a9a50'; ctx.beginPath(); ctx.arc(cx, cy, r*0.16, 0, 7); ctx.fill();
    ctx.fillStyle='#8a5a34'; ctx.beginPath(); ctx.arc(cx-r*0.07, cy+r*0.14, r*0.1, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+r*0.07, cy+r*0.14, r*0.1, 0, 7); ctx.fill();
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.62, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.34-th/2, tw, th);
    }
  }
  else if(style==='cactus'){   // 仙人掌：主柱 + 手臂 + 刺
    ctx.fillStyle='#5aae62';
    ctx.fillRect(x-r*0.16, y-r*0.75, r*0.32, r*0.75);
    ctx.fillRect(x-r*0.52, y-r*0.6, r*0.22, r*0.34);
    ctx.fillRect(x+r*0.3, y-r*0.48, r*0.22, r*0.34);
    ctx.fillRect(x-r*0.52, y-r*0.6, r*0.22, r*0.1);
    ctx.fillRect(x+r*0.3, y-r*0.48, r*0.22, r*0.1);
    ctx.fillStyle='#e8f2e0';
    ctx.beginPath(); ctx.arc(x-r*0.05, y-r*0.68, r*0.04, 0, 7); ctx.fill();
    ctx.fillStyle='#3f8a48';
    for(let i=0;i<3;i++){ ctx.beginPath(); ctx.arc(x, y-r*0.1-i*r*0.22, r*0.035, 0, 7); ctx.fill(); }
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.5, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.42-th/2, tw, th);
    }
  }
  else if(style==='mushroom'){   // 蘑菇：红帽白点 + 白杆
    ctx.fillStyle='#f0ece2';
    ctx.fillRect(x-r*0.16, y-r*0.42, r*0.32, r*0.42);
    ctx.fillStyle='#e05a4a';
    ctx.beginPath(); ctx.moveTo(x-r*0.62, y-r*0.34); ctx.quadraticCurveTo(x, y-r*0.85, x+r*0.62, y-r*0.34); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#f8f4ea';
    ctx.beginPath(); ctx.arc(x-r*0.28, y-r*0.55, r*0.08, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.16, y-r*0.5, r*0.06, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y-r*0.42, r*0.07, 0, 7); ctx.fill();
  }
  else if(style==='stump'){   // 树桩：柱体 + 顶面年轮
    ctx.fillStyle='#9a6a42';
    ctx.fillRect(x-r*0.4, y-r*0.5, r*0.8, r*0.5);
    ctx.fillStyle='#c89a62';
    ctx.beginPath(); ctx.ellipse(x, y-r*0.5, r*0.42, r*0.14, 0, 0, 7); ctx.fill();
    ctx.strokeStyle='#a87a4a'; ctx.lineWidth=r*0.05;
    ctx.beginPath(); ctx.ellipse(x, y-r*0.5, r*0.22, r*0.07, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y-r*0.5, r*0.08, r*0.03, 0, 0, 7); ctx.stroke();
  }
  else if(style==='snowman'){   // 雪人：双球 + 帽 + 鼻 + 围巾
    ctx.fillStyle='#f4f8fa';
    ctx.beginPath(); ctx.ellipse(x, y-r*0.2, r*0.5, r*0.5, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x, y-r*0.85, r*0.34, r*0.34, 0, 0, 7); ctx.fill();
    ctx.strokeStyle='#c8d8e4'; ctx.lineWidth=r*0.05;
    ctx.beginPath(); ctx.ellipse(x, y-r*0.2, r*0.5, r*0.5, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y-r*0.85, r*0.34, r*0.34, 0, 0, 7); ctx.stroke();
    ctx.fillStyle='#3a3f4a';
    ctx.fillRect(x-r*0.3, y-r*1.3, r*0.6, r*0.16);
    ctx.fillRect(x-r*0.42, y-r*1.14, r*0.84, r*0.1);
    ctx.fillStyle='#3a3f4a';
    ctx.beginPath(); ctx.arc(x-r*0.12, y-r*0.92, r*0.045, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.12, y-r*0.92, r*0.045, 0, 7); ctx.fill();
    ctx.fillStyle='#f08a3a';
    ctx.beginPath(); ctx.moveTo(x, y-r*0.86); ctx.lineTo(x+r*0.3, y-r*0.9); ctx.lineTo(x, y-r*0.82); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#e05a4a'; ctx.lineWidth=r*0.08; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(x-r*0.32, y-r*0.68); ctx.lineTo(x+r*0.32, y-r*0.68); ctx.stroke();
    ctx.lineCap='butt';
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.5, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.98-th/2, tw, th);
    }
  }
  else if(style==='birch'){   // 白桦（v=101）：白树干 + 深色斑纹 + 小圆冠
    ctx.fillStyle='#e8e4da';
    ctx.fillRect(x-r*0.06, y, r*0.12, r*0.55);
    ctx.strokeStyle='#8a8478'; ctx.lineWidth=Math.max(1,r*0.035);
    ctx.beginPath(); ctx.moveTo(x-r*0.02, y-r*0.15); ctx.lineTo(x-r*0.02, y-r*0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+r*0.03, y-r*0.2); ctx.lineTo(x+r*0.03, y-r*0.48); ctx.stroke();
    ctx.fillStyle='#6fbd68';
    ctx.beginPath(); ctx.arc(x, y-r*0.7, r*0.5, 0, 7); ctx.fill();
    ctx.fillStyle='#8fd488';
    ctx.beginPath(); ctx.arc(x-r*0.18, y-r*0.85, r*0.3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.2, y-r*0.85, r*0.3, 0, 7); ctx.fill();
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.6, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.62-th/2, tw, th);
    }
  }
  else if(style==='maple'){   // 枫树（v=101）：橙色/红色树冠
    ctx.fillStyle='#8a6a44';
    ctx.fillRect(x-r*0.07, y, r*0.14, r*0.5);
    ctx.fillStyle='#e08a3a';
    ctx.beginPath(); ctx.arc(x, y-r*0.6, r*0.6, 0, 7); ctx.fill();
    ctx.fillStyle='#e8a04a';
    ctx.beginPath(); ctx.arc(x-r*0.35, y-r*0.85, r*0.42, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.35, y-r*0.85, r*0.42, 0, 7); ctx.fill();
    ctx.fillStyle='#f0b85a';
    ctx.beginPath(); ctx.arc(x, y-r*1.05, r*0.32, 0, 7); ctx.fill();
    if(poster && IMGS[poster]){
      const timg=IMGS[poster], tw=r*0.6, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.6-th/2, tw, th);
    }
  }
  else { // tree（加大：树干粗高 + 树冠三层更大，比行人高；v=98 树冠可贴人物图）
    ctx.fillStyle='#8a6a44';
    ctx.fillRect(x-r*0.06, y, r*0.12, r*0.5);
    ctx.fillStyle='#5da65a';
    ctx.beginPath(); ctx.arc(x, y-r*0.25, r*0.72, 0, 7); ctx.fill();
    ctx.fillStyle='#6fbd68';
    ctx.beginPath(); ctx.arc(x-r*0.4, y-r*0.55, r*0.55, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(x+r*0.4, y-r*0.55, r*0.55, 0, 7); ctx.fill();
    ctx.fillStyle='#8fd488';
    ctx.beginPath(); ctx.arc(x, y-r*0.8, r*0.42, 0, 7); ctx.fill();
    // 树冠贴人物图（搞怪：脸在树冠里）
    if(poster && IMGS[poster]){
      const timg=IMGS[poster];
      const tw=r*1.05, th=tw*(timg.height/timg.width);
      ctx.drawImage(timg, x-tw/2, y-r*0.62-th/2, tw, th);
    }
  }
}

/* ---- 建筑：3D 盒子（底面四边形 + 顶面 + 可见侧面） ---- */
/* 每类建筑 3 种色调变体（o.var 0-2），避免复制粘贴感 */
const WALL_VAR = {
  house:   ['#f0d9a6','#e8cf9e','#f5e6c0'],
  apt:     ['#e8c9a8','#dfc09a','#f0d4b4'],
  office:  ['#b8cfe8','#aac4de','#c4d8ec'],
  mall:    ['#f2cf7a','#e8c46e','#f8d98e'],
  shop:    ['#f5e6c8','#eeddb8','#faf0d8'],
  cafe:    ['#ead8c2','#e2ccb4','#f2e2cc'],
  tower:   ['#c9d4e8','#bcc8e0','#d4dcf0'],
  stadium: ['#b8e0d0','#aad4c4','#c6e8da'],
  /* v=100 主题建筑 */
  cabin:     ['#b8805a','#a8744e','#c48c64'],
  lighthouse:['#f4f0e8','#eae4d8','#faf6ee'],
  igloo:     ['#cfe4f0','#c0d8e8','#d8ecf4'],   // v=101 冰屋：冰蓝色（雪地纯白上需对比）
  pyramid:   ['#e8c878','#dcb868','#f0d488'],
  adobe:     ['#e8c890','#dcba80','#f0d4a0'],
  watchtower:['#c89060','#b88052','#d49c6c'],
  church:    ['#f4f0e8','#eae4d8','#faf6ee'],   // v=101 教堂：白墙（雪地/沙漠通用）
  unfinished:['#b8b4ac','#a8a49c','#c4c0b8'],   // v=101 烂尾楼：水泥灰
};
function darken(hex, k){
  const n=parseInt(hex.slice(1),16);
  return 'rgb('+Math.floor((n>>16)*k)+','+Math.floor(((n>>8)&255)*k)+','+Math.floor((n&255)*k)+')';
}
function styleWall(s, v){ return (WALL_VAR[s]||['#d8d2c6','#d8d2c6','#d8d2c6'])[(v||0)%3]; }
function styleWallDark(s, v){ return darken(styleWall(s,v), 0.72); }
function drawBuilding3D(o,p){
  // v=98：建筑形状多样化 —— 圆筒 / 尖顶 / 阶梯式走独立绘制，长方体走原逻辑
  // v=101：每栋建筑画完后立即画自己的海报（参与深度排序 → 近处楼盖住远处楼的海报）
  if(o.shape==='cyl'){ drawCylBuilding(o,p); drawObjPoster(o); return; }
  if(o.shape==='cone'){ drawConeBuilding(o,p); drawObjPoster(o); return; }
  if(o.shape==='step'){ drawStepBuilding(o,p); drawObjPoster(o); return; }
  const img=IMGS[o.poster];
  const w=o.r*2.0, H=Math.max(16, o.r*o.h);
  const hw=w/2;
  const cs=[[o.x-hw,o.y-hw],[o.x+hw,o.y-hw],[o.x+hw,o.y+hw],[o.x-hw,o.y+hw]];
  // 角点投影：相机后的角点用近平面夹持兜底 → 玩家在建筑内部/贴墙时整栋建筑仍完整绘制（实心）
  const prjF=pt=>proj(pt[0],pt[1],pt[2])||projOr(pt[0],pt[1],pt[2]);
  const pb=cs.map(c=>prjF([c[0],c[1],0]));
  const pt=cs.map(c=>prjF([c[0],c[1],H]));
  if(pb.some(x=>!x)||pt.some(x=>!x)) return;
  const col=styleWall(o.style, o.var), colD=styleWallDark(o.style, o.var);
  // v=96：移除"整屏涂内壁色"分支（原逻辑在玩家进入建筑底部时涂满全屏 → 看不到盒子轮廓，
  // 表现为"建筑消失/只剩一块色"）。俯视角度下相机高于多数建筑，
  // 正常双面渲染（侧面+顶面）即可让建筑始终是完整不透明实体：
  // 玩家在建筑下方/内部时仍能看到实体结构，黑洞（深度最浅、最后画）盖在其底部。
  // inside 仅用于：玩家在建筑内部时跳过 facade 贴墙细节（窗/门/海报/阳台）
  const inside=Math.abs(player.x-o.x)<hw*0.98 && Math.abs(player.y-o.y)<hw*0.98;
  // 侧面：全部绘制（双面渲染，无背面剔除）→ 从任何角度（含内部）都是不透明实体
  const faces=[];
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
    const d=prjF([cx,cy,H/2]); if(!d) continue;
    faces.push({depth:d.depth, dark:true, pts:[pb[i],pb[j],pt[j],pt[i]]});
  }
  const dTop=prjF([o.x,o.y,H]);
  if(dTop) faces.push({depth:dTop.depth, dark:false, pts:[pt[0],pt[1],pt[2],pt[3]]});
  faces.sort((a,b)=>b.depth-a.depth);
  for(const f of faces){
    ctx.beginPath();
    ctx.moveTo(f.pts[0].x,f.pts[0].y);
    for(let k=1;k<4;k++) ctx.lineTo(f.pts[k].x,f.pts[k].y);
    ctx.closePath();
    ctx.fillStyle=f.dark?colD:col;
    ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.14)'; ctx.lineWidth=1;   // 深色细描边：轮廓实而不闪
    ctx.stroke();
  }
  // 屋顶附属（卡通细节：烟囱/水箱/机房/天线，画在顶面之上）
  if(dTop){
    const ts=dTop.s;
    if(o.style==='house'){          // 烟囱
      ctx.fillStyle='#b06a4a';
      ctx.fillRect(dTop.x-7*ts, dTop.y-10*ts, 5*ts, 10*ts);
      ctx.fillStyle='#8a4a34';
      ctx.fillRect(dTop.x-8*ts, dTop.y-12.5*ts, 7*ts, 2.5*ts);
    } else if(o.style==='apt'){     // 屋顶水箱
      ctx.fillStyle='#c8c2b4';
      ctx.fillRect(dTop.x-10*ts, dTop.y-9*ts, 20*ts, 9*ts);
      ctx.fillStyle='#a8a294';
      ctx.fillRect(dTop.x-10*ts, dTop.y-11.5*ts, 20*ts, 2.5*ts);
    } else if(o.style==='office'||o.style==='mall'){   // 机房/天窗
      ctx.fillStyle='#9fb4c8';
      ctx.fillRect(dTop.x-9*ts, dTop.y-7*ts, 18*ts, 7*ts);
      ctx.fillStyle='rgba(185,222,250,0.85)';
      ctx.fillRect(dTop.x-6*ts, dTop.y-6*ts, 4*ts, 4*ts);
      ctx.fillRect(dTop.x+2*ts, dTop.y-6*ts, 4*ts, 4*ts);
    } else if(o.style==='tower'){   // 天线
      ctx.strokeStyle='#4a4f58'; ctx.lineWidth=Math.max(1,2*ts);
      ctx.beginPath(); ctx.moveTo(dTop.x, dTop.y); ctx.lineTo(dTop.x, dTop.y-18*ts); ctx.stroke();
      ctx.fillStyle='#e05a4a';
      ctx.beginPath(); ctx.arc(dTop.x, dTop.y-20*ts, 2.5*ts, 0, 7); ctx.fill();
    } else if(o.style==='cabin'){   // 木屋烟囱（v=100）
      ctx.fillStyle='#8a5a3a';
      ctx.fillRect(dTop.x-6*ts, dTop.y-12*ts, 5*ts, 12*ts);
      ctx.fillStyle='#6e4426';
      ctx.fillRect(dTop.x-7*ts, dTop.y-14*ts, 7*ts, 2.5*ts);
    } else if(o.style==='watchtower'){   // 瞭望塔：顶台围栏 + 小旗（v=100）
      ctx.fillStyle='#8a5a3a';
      ctx.fillRect(dTop.x-13*ts, dTop.y-3*ts, 26*ts, 3*ts);
      ctx.strokeStyle='#6e4426'; ctx.lineWidth=Math.max(1,1.5*ts);
      ctx.beginPath(); ctx.moveTo(dTop.x-13*ts, dTop.y-10*ts); ctx.lineTo(dTop.x-13*ts, dTop.y-3*ts); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dTop.x+13*ts, dTop.y-10*ts); ctx.lineTo(dTop.x+13*ts, dTop.y-3*ts); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dTop.x-13*ts, dTop.y-10*ts); ctx.lineTo(dTop.x+13*ts, dTop.y-10*ts); ctx.stroke();
      ctx.fillStyle='#e05a4a';
      ctx.beginPath(); ctx.moveTo(dTop.x, dTop.y-3*ts); ctx.lineTo(dTop.x+8*ts, dTop.y-6*ts); ctx.lineTo(dTop.x, dTop.y-9*ts); ctx.closePath(); ctx.fill();
    } else if(o.style==='adobe'){   // 土坯房：平顶女儿墙（v=100）
      ctx.fillStyle=colD;
      ctx.fillRect(dTop.x-12*ts, dTop.y-3*ts, 24*ts, 3*ts);
    } else if(o.style==='lighthouse'){   // 灯塔顶灯（v=100）
      ctx.fillStyle='#d8503a';
      ctx.fillRect(dTop.x-4*ts, dTop.y-6*ts, 8*ts, 6*ts);
      ctx.fillStyle='#ffe98a';
      ctx.beginPath(); ctx.arc(dTop.x, dTop.y-8*ts, 2.5*ts, 0, 7); ctx.fill();
    } else if(o.style==='unfinished'){   // 烂尾楼钢筋（v=101）：顶部竖立钢筋 + 横梁
      ctx.strokeStyle='#8a5a3a'; ctx.lineWidth=Math.max(1,1.8*ts);
      for(let i=-2;i<=2;i++){
        ctx.beginPath(); ctx.moveTo(dTop.x+i*5*ts, dTop.y); ctx.lineTo(dTop.x+i*5*ts, dTop.y-9*ts); ctx.stroke();
      }
      ctx.fillStyle='#7a6a5a';
      ctx.fillRect(dTop.x-13*ts, dTop.y-4*ts, 26*ts, 4*ts);
      ctx.fillStyle='#a8947a';
      ctx.fillRect(dTop.x-13*ts, dTop.y-4*ts, 26*ts, 1.5*ts);
    }
  }
  // 屋檐（v=99：屋顶四周外扩板 —— house/apt 有真实屋顶结构感）
  if((o.style==='house'||o.style==='apt') && dTop){
    const eE=w*0.07, eH=Math.max(3, H*0.05);
    const eCs=[[o.x-hw-eE,o.y-hw-eE],[o.x+hw+eE,o.y-hw-eE],[o.x+hw+eE,o.y+hw+eE],[o.x-hw-eE,o.y+hw+eE]];
    const epb=eCs.map(c=>proj(c[0],c[1],H-eH));
    const ept=eCs.map(c=>proj(c[0],c[1],H));
    if(epb.every(x=>x)&&ept.every(x=>x)){
      ctx.fillStyle=colD;
      quadFill(epb[0],epb[1],ept[1],ept[0]);
      quadFill(epb[1],epb[2],ept[2],ept[1]);
      quadFill(epb[2],epb[3],ept[3],ept[2]);
      quadFill(epb[3],epb[0],ept[0],ept[3]);
      ctx.fillStyle=col;
      quadFill(ept[0],ept[1],ept[2],ept[3]);
      ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(ept[0].x,ept[0].y);
      for(let ek=1;ek<4;ek++) ctx.lineTo(ept[ek].x,ept[ek].y);
      ctx.closePath(); ctx.stroke();
    }
  }
  // v=98.13：删除顶面海报（规则：大型建筑最多 2 张、贴主视角墙面+侧面、不贴顶部）
  // 海报统一由 drawPosterLayer 覆盖层绘制（正面 1 张 + 侧面 1 张，最顶层保证不被遮挡）
  // 侧面窗户（v=97：每个可见侧面也有窗 → 侧面/斜角看建筑不是光墙，窗户属于整个立面）
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const cx3=(cs[i][0]+cs[j][0])/2, cy3=(cs[i][1]+cs[j][1])/2;
    const nx3=cs[j][1]-cs[i][1], ny3=cs[i][0]-cs[j][0];
    const vx3=player.x-cx3, vy3=player.y-cy3;
    if(nx3*vx3+ny3*vy3<=0) continue;   // 背面
    drawFacadeSide(o, [pb[i],pb[j],pt[j],pt[i]], w, H, cs[i], cs[j]);
  }
  // 正面（最朝向相机的侧面）细节：窗格 + 门 + 海报（贴合墙面）——玩家在建筑内部时跳过（内壁纯实色）
  let front=null, best=1e9;
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
    const nx=cs[j][1]-cs[i][1], ny=cs[i][0]-cs[j][0];
    const vx=player.x-cx, vy=player.y-cy;
    const dot=(nx*vx+ny*vy)/Math.max(1,Math.hypot(nx,ny)*Math.hypot(vx,vy));
    if(dot<best){ best=dot; front={i,j,cx,cy}; }
  }
  if(front && !inside){
    const fPts=[pb[front.i],pb[front.j],pt[front.j],pt[front.i]];
    drawFacade(o, fPts, w, H, front, img, cs[front.i], cs[front.j]);
  }
  // 阳台（v=99：真正从建筑主体伸出的平台 + 栏杆 —— apt/office/mall 一楼）
  if((o.style==='apt'||o.style==='office'||o.style==='mall') && front && !inside){
    const fx2=(cs[front.i][0]+cs[front.j][0])/2, fy2=(cs[front.i][1]+cs[front.j][1])/2;
    const nxx=fx2-o.x, nyy=fy2-o.y;
    const nl2=Math.hypot(nxx,nyy)||1;
    const ux=nxx/nl2, uy=nyy/nl2;
    const ext=w*0.20;                // 伸出长度
    const balH=Math.max(7, H*0.13);  // 平台厚度
    const balY=Math.max(0, H*0.06);  // 平台离地高度
    const ax2=cs[front.i][0], ay2=cs[front.i][1];
    const bx2=cs[front.j][0], by2=cs[front.j][1];
    const axo=ax2+ux*ext, ayo=ay2+uy*ext, bxo=bx2+ux*ext, byo=by2+uy*ext;
    const p1=proj(ax2,ay2,balY), p2=proj(bx2,by2,balY);
    const p3=proj(axo,ayo,balY), p4=proj(bxo,byo,balY);
    const p1t=proj(ax2,ay2,balY+balH), p2t=proj(bx2,by2,balY+balH);
    const p3t=proj(axo,ayo,balY+balH), p4t=proj(bxo,byo,balY+balH);
    if(p1&&p2&&p3&&p4&&p1t&&p2t&&p3t&&p4t){
      // 平台前/侧立面（深色）
      ctx.fillStyle=colD;
      quadFill(p3,p4,p4t,p3t);
      quadFill(p1,p2,p2t,p1t);
      // 平台顶面（亮色）
      ctx.fillStyle=col;
      quadFill(p1t,p2t,p4t,p3t);
      // 栏杆（外缘竖条 + 顶部横杆）
      ctx.strokeStyle='rgba(55,58,80,0.95)';
      ctx.lineWidth=Math.max(1, w*0.012*p.s);
      for(let k2=0;k2<=3;k2++){
        const t3=k2/3;
        const lx=p3t.x+(p4t.x-p3t.x)*t3, ly=p3t.y+(p4t.y-p3t.y)*t3;
        const gx=p1t.x+(p2t.x-p1t.x)*t3, gy=p1t.y+(p2t.y-p1t.y)*t3;
        ctx.beginPath(); ctx.moveTo(gx,gy); ctx.lineTo(lx,ly); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(p3t.x,p3t.y); ctx.lineTo(p4t.x,p4t.y); ctx.stroke();
    }
  }
  // v=101：box 建筑海报随建筑绘制（参与深度排序遮挡）
  drawObjPoster(o);
}
/* ---- 圆筒形摩天大楼（v=98：圆柱体侧面分段 + 椭圆顶 —— 远处一眼看出不是长方体） ---- */
function drawCylBuilding(o, p){
  const img=IMGS[o.poster];
  const R=o.r*0.95, H=Math.max(16, o.r*o.h);
  const N=12;
  const col=styleWall(o.style, o.var), colD=styleWallDark(o.style, o.var);
  // 侧面分段（背面剔除，按法线亮度分档 → 圆筒立体感）
  for(let i=0;i<N;i++){
    const a0=i/N*Math.PI*2, a1=(i+1)/N*Math.PI*2;
    const x0=o.x+Math.cos(a0)*R, y0=o.y+Math.sin(a0)*R;
    const x1=o.x+Math.cos(a1)*R, y1=o.y+Math.sin(a1)*R;
    const mx=(x0+x1)/2, my=(y0+y1)/2;
    // 法线朝外 → 与视线夹角决定明暗
    const nx=Math.cos((a0+a1)/2), ny=Math.sin((a0+a1)/2);
    const vx=player.x-mx, vy=player.y-my;
    const dot=(nx*vx+ny*vy)/Math.max(1,Math.hypot(vx,vy));
    if(dot<=0) continue;   // 背面
    const p1=proj(x0,y0,0), p2=proj(x1,y1,0), p3=proj(x1,y1,H), p4=proj(x0,y0,H);
    if(!p1||!p2||!p3||!p4) continue;
    ctx.fillStyle = dot>0.55 ? col : dot>0.22 ? darken(col,0.86) : colD;
    quadFill(p1,p2,p3,p4);
  }
  // 顶面（透视椭圆）
  const tc=proj(o.x,o.y,H);
  const te=proj(o.x+R,o.y,H), tn=proj(o.x,o.y-R,H);
  if(tc&&te&&tn){
    if(o.style==='igloo'){   // 冰屋：冰蓝圆顶 + 冰砖缝线 + 入口拱门（v=100/101 冰蓝色与雪地区分）
      const erx=Math.max(1,te.x-tc.x), ery=Math.max(1,tc.y-tn.y);
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.ellipse(tc.x, tc.y, erx, ery*1.55, 0, 0, 7); ctx.fill();
      ctx.strokeStyle='rgba(70,100,140,0.55)'; ctx.lineWidth=1; ctx.stroke();
      ctx.strokeStyle='rgba(90,130,170,0.65)'; ctx.lineWidth=Math.max(1,1.2*tc.s);
      ctx.beginPath(); ctx.ellipse(tc.x, tc.y+ery*0.2, erx*0.55, ery*0.5, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(tc.x, tc.y+ery*0.7, erx*0.75, ery*0.45, 0, 0, 7); ctx.stroke();
      // 入口拱门（底部，朝玩家方向）
      const ep=proj(o.x, o.y, H);
      if(ep){
        ctx.fillStyle='#4a6a88';
        ctx.beginPath(); ctx.arc(ep.x, ep.y-ery*0.35, Math.max(1.5, erx*0.26), Math.PI, 0); ctx.fill();
        ctx.fillRect(ep.x-erx*0.26, ep.y-ery*0.35, erx*0.52, ery*0.35);
      }
    } else {
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.ellipse(tc.x, tc.y, Math.max(1,te.x-tc.x), Math.max(1,tc.y-tn.y), 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1; ctx.stroke();
      // v=98.13：删除圆筒顶面海报（规则：不贴顶部，海报统一由覆盖层画侧面 1 张）
      // 顶部天线/灯
      ctx.strokeStyle='#4a4f58'; ctx.lineWidth=Math.max(1,2*tc.s);
      ctx.beginPath(); ctx.moveTo(tc.x, tc.y); ctx.lineTo(tc.x, tc.y-14*tc.s); ctx.stroke();
      ctx.fillStyle='#e05a4a';
      ctx.beginPath(); ctx.arc(tc.x, tc.y-16*tc.s, 2.2*tc.s, 0, 7); ctx.fill();
    }
  }
  // 底部基座（深色圆环）
  const bc=proj(o.x,o.y,0);
  const be=proj(o.x+R*1.08,o.y,0), bn=proj(o.x,o.y-R*1.08,0);
  if(bc&&be&&bn){
    ctx.fillStyle=colD;
    ctx.beginPath();
    ctx.ellipse(bc.x, bc.y, Math.max(1,be.x-bc.x), Math.max(1,bc.y-bn.y), 0, 0, 7);
    ctx.fill();
  }
  // v=98.15：删除圆筒内部海报（海报统一由 drawPosterLayer 覆盖层画 1 张，
  // 避免与覆盖层叠加出现"一张物体两张海报"）
}
/* ---- 尖顶建筑（v=98：长方体主体 + 锥形屋顶 —— 法院/地标轮廓） ---- */
function drawConeBuilding(o, p){
  const img=IMGS[o.poster];
  const w=o.r*1.7, H=Math.max(16, o.r*o.h);
  const hw=w/2;
  const cs=[[o.x-hw,o.y-hw],[o.x+hw,o.y-hw],[o.x+hw,o.y+hw],[o.x-hw,o.y+hw]];
  const prjF=pt=>proj(pt[0],pt[1],pt[2])||projOr(pt[0],pt[1],pt[2]);
  const pb=cs.map(c=>prjF([c[0],c[1],0]));
  const pt=cs.map(c=>prjF([c[0],c[1],H]));
  if(pb.some(x=>!x)||pt.some(x=>!x)) return;
  const col=styleWall(o.style, o.var), colD=styleWallDark(o.style, o.var);
  // 主体侧面
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
    const nx=cs[j][1]-cs[i][1], ny=cs[i][0]-cs[j][0];
    const vx=player.x-cx, vy=player.y-cy;
    if(nx*vx+ny*vy<=0) continue;
    ctx.fillStyle=colD;
    quadFill(pb[i],pb[j],pt[j],pt[i]);
  }
  // 锥顶（4 个三角面，双面渲染）
  const spike=o.r*1.15;
  const tp=prjF([o.x,o.y,H+spike]);
  if(tp){
    for(let i=0;i<4;i++){
      const j=(i+1)%4;
      const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
      const nx=cs[j][1]-cs[i][1], ny=cs[i][0]-cs[j][0];
      const vx=player.x-cx, vy=player.y-cy;
      if(nx*vx+ny*vy<=0) continue;
      ctx.fillStyle=(i%2===0)?col:colD;
      ctx.beginPath();
      ctx.moveTo(pt[i].x,pt[i].y); ctx.lineTo(pt[j].x,pt[j].y); ctx.lineTo(tp.x,tp.y);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.16)'; ctx.lineWidth=1; ctx.stroke();
    }
    // 顶尖装饰（v=101：教堂 = 十字架，其余 = 金球）
    if(o.style==='church'){
      const cw=Math.max(1.5, 2.2*tp.s);
      ctx.strokeStyle='#e8d878'; ctx.lineWidth=Math.max(1.5, cw*0.9); ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(tp.x, tp.y-16*tp.s); ctx.lineTo(tp.x, tp.y+5*tp.s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tp.x-6*tp.s, tp.y-9*tp.s); ctx.lineTo(tp.x+6*tp.s, tp.y-9*tp.s); ctx.stroke();
      ctx.lineCap='butt';
    } else {
      ctx.fillStyle='#ffd76a';
      ctx.beginPath(); ctx.arc(tp.x, tp.y, Math.max(1.5,2.5*tp.s), 0, 7); ctx.fill();
    }
  }
  // v=98.15：删除尖顶内部海报（海报统一由 drawPosterLayer 覆盖层画 1 张）
}
/* ---- 阶梯式建筑（v=98：底部大、逐层收小 —— 轮廓有节奏） ---- */
function drawStepBuilding(o, p){
  const img=IMGS[o.poster];
  const w=o.r*1.9, H=Math.max(16, o.r*o.h);
  const steps=3;
  const col=styleWall(o.style, o.var), colD=styleWallDark(o.style, o.var);
  for(let s=0;s<steps;s++){
    const sw=w*(1-s*0.22), hw2=sw/2;
    const y0=H*s/steps, y1=H*(s+1)/steps;
    const cs=[[o.x-hw2,o.y-hw2],[o.x+hw2,o.y-hw2],[o.x+hw2,o.y+hw2],[o.x-hw2,o.y+hw2]];
    const prjF=pt=>proj(pt[0],pt[1],pt[2])||projOr(pt[0],pt[1],pt[2]);
    const pb=cs.map(c=>prjF([c[0],c[1],y0]));
    const pt=cs.map(c=>prjF([c[0],c[1],y1]));
    if(pb.some(x=>!x)||pt.some(x=>!x)) continue;
    // 侧面
    for(let i=0;i<4;i++){
      const j=(i+1)%4;
      const cx=(cs[i][0]+cs[j][0])/2, cy=(cs[i][1]+cs[j][1])/2;
      const nx=cs[j][1]-cs[i][1], ny=cs[i][0]-cs[j][0];
      const vx=player.x-cx, vy=player.y-cy;
      if(nx*vx+ny*vy<=0) continue;
      ctx.fillStyle=colD;
      quadFill(pb[i],pb[j],pt[j],pt[i]);
    }
    // 顶面（每层平台亮色，形成阶梯台面）
    ctx.fillStyle=col;
    quadFill(pt[0],pt[1],pt[2],pt[3]);
    // v=98.13：删除顶层平台海报（规则：不贴顶部，海报统一由覆盖层画主面+侧面）
    // 每层平台边缘线
    ctx.strokeStyle='rgba(0,0,0,0.15)'; ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(pt[0].x,pt[0].y);
    for(let k=1;k<4;k++) ctx.lineTo(pt[k].x,pt[k].y);
    ctx.closePath(); ctx.stroke();
  }
  // v=98.15：删除阶梯内部海报（海报统一由 drawPosterLayer 覆盖层画 1 张）
}
/* 墙面细节：窗格/门/风格招牌 + 一张贴合的海报 */
/* 建筑立面窗户布局（v=97：按类型差异化几何结构，不再统一小窗格）
   cols/rows 窗列行数，ww/wh 窗宽高（占墙面比例），x0/xw 列位置，y0/yw 行位置 */
function winLayout(style){
  switch(style){
    case 'house':  return {cols:2, rows:2, ww:0.22, wh:0.14, x0:0.24, xw:0.26, y0:0.12, yw:0.24};
    case 'apt':    return {cols:3, rows:3, ww:0.16, wh:0.10, x0:0.14, xw:0.24, y0:0.10, yw:0.18};
    case 'office': return {cols:4, rows:4, ww:0.12, wh:0.08, x0:0.11, xw:0.20, y0:0.08, yw:0.15};
    case 'shop':   return {cols:2, rows:2, ww:0.30, wh:0.15, x0:0.14, xw:0.36, y0:0.46, yw:0.24};
    case 'mall':   return {cols:2, rows:2, ww:0.32, wh:0.14, x0:0.13, xw:0.37, y0:0.46, yw:0.24};
    case 'cafe':   return {cols:2, rows:2, ww:0.26, wh:0.16, x0:0.17, xw:0.33, y0:0.12, yw:0.26};
    case 'tower':  return {cols:2, rows:6, ww:0.18, wh:0.07, x0:0.18, xw:0.21, y0:0.06, yw:0.12};
    case 'stadium':return {cols:4, rows:2, ww:0.16, wh:0.22, x0:0.11, xw:0.20, y0:0.18, yw:0.32};
    default:       return {cols:3, rows:3, ww:0.17, wh:0.11, x0:0.14, xw:0.24, y0:0.10, yw:0.18};
  }
}
/* 一扇窗的完整结构（局部像素坐标，LOD 控制细节量）：
   窗洞凹陷 → 洞顶阴影 → 玻璃 → 高光 → 深色窗框 → 分格 → 凸出窗台 */
function drawWindow(wx, wy, ww, wh, fw, lod){
  const fw2=Math.max(1,fw*0.008), fh2=Math.max(1,fw*0.008);
  // 1. 窗洞（深色凹入墙体，比窗大一圈）
  ctx.fillStyle='rgba(16,20,38,0.82)';
  ctx.fillRect(wx-fw2*1.5, wy-fh2*1.6, ww+fw2*3, wh+fh2*3.2);
  // 2. 洞顶阴影（凹陷感）
  ctx.fillStyle='rgba(0,0,0,0.32)';
  ctx.fillRect(wx-fw2*1.5, wy-fh2*1.6, ww+fw2*3, fh2*1.3);
  // 3. 玻璃（内嵌）
  ctx.fillStyle='rgba(176,214,248,0.92)';
  ctx.fillRect(wx, wy, ww, wh);
  if(lod>=2){
    // 4. 玻璃高光（左上斜条）
    ctx.fillStyle='rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.moveTo(wx+ww*0.06, wy+wh*0.58); ctx.lineTo(wx+ww*0.40, wy+wh*0.06);
    ctx.lineTo(wx+ww*0.55, wy+wh*0.06); ctx.lineTo(wx+ww*0.18, wy+wh*0.65);
    ctx.closePath(); ctx.fill();
    // 5. 窗框（深色粗框，结构件）
    ctx.strokeStyle='rgba(36,44,68,0.95)';
    ctx.lineWidth=Math.max(1, fw*0.006);
    ctx.strokeRect(wx, wy, ww, wh);
    // 6. 分格（大窗十字）
    if(ww>fw*0.13){
      ctx.beginPath();
      ctx.moveTo(wx+ww/2, wy); ctx.lineTo(wx+ww/2, wy+wh);
      ctx.moveTo(wx, wy+wh/2); ctx.lineTo(wx+ww, wy+wh/2);
      ctx.stroke();
    }
    // 7. 窗台（底部凸出条，真实外立面层次）
    ctx.fillStyle='rgba(255,255,255,0.55)';
    ctx.fillRect(wx-fw2, wy+wh, ww+fw2*2, Math.max(1.5, fw*0.014));
  }
}
function drawFacade(o, fPts, w, H, front, img, wA, wB){
  const style=o.style;
  // 墙面区域（用四边形包围盒 + 平均缩放，仅用于墙底与 LOD 判定）
  const cx=(fPts[0].x+fPts[2].x)/2, cy=(fPts[0].y+fPts[2].y)/2;
  const avgS=(fPts[0].s+fPts[2].s)/2;
  const fw=w*avgS, fh=H*avgS;
  const lod = avgS<0.12 ? 1 : avgS<0.28 ? 2 : 3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fPts[0].x,fPts[0].y);
  for(let k=1;k<4;k++) ctx.lineTo(fPts[k].x,fPts[k].y);
  ctx.closePath(); ctx.clip();
  // 正面底色：亮色实墙（clip 保护，只影响墙面）→ 正面亮、侧面深，立体感
  ctx.fillStyle=styleWall(o.style, o.var);
  ctx.fillRect(cx-fw/2, cy-fh/2, fw, fh);
  // v=98.7 世界锚定：立面底边两端世界坐标 wA/wB（cs[front.i], cs[front.j]）。
  // 所有立面元素（窗/楼板/门/招牌/海报）用 (u,v) 世界插值 + 真实投影定位 →
  // 建筑不动、窗户/门/海报就绝不会飘移（修复"窗户一会儿上一会儿下"）。
  // v=98.8：faceP 改严格 proj（去掉 projOr 夹持）——projOr 会把相机后/近平面内的点
  // 夹持到近平面（屏幕底边附近），鼠标旋转相机时大量元素进出近平面 → 远处海报
  // 突然闪到屏幕近处 + 画面闪烁。proj null 时元素跳过（原有 if(!p) 保护），贴脸时
  // 看不见的部分本就不需要绘制。
  // faceP(u,v)：u=沿立面水平比例 0~1，v=高度比例 0~1（相对 H）
  const faceP=(u,v)=>proj(wA.x+(wB.x-wA.x)*u, wA.y+(wB.y-wA.y)*u, v*H);
  // —— 窗户：真实结构层次（v=97），按类型差异化布局 ——
  const L = winLayout(style);
  for(let c=0;c<L.cols;c++) for(let r=0;r<L.rows;r++){
    const p=faceP(L.x0+c*L.xw, L.y0+r*L.yw);
    if(!p) continue;
    const ww=L.ww*w*p.s, wh=L.wh*H*p.s;
    if(ww<2.5||wh<2) continue;
    drawWindow(p.x-ww/2, p.y-wh/2, ww, wh, w*p.s, lod);
  }
  // 楼板结构带（深色，楼层分隔 → 幕墙结构感；世界锚定的沿立面横线）
  if(L.rows>=3 && lod>=2){
    ctx.strokeStyle='rgba(0,0,0,0.20)';
    ctx.lineWidth=Math.max(1.5, fh*0.030);
    for(let r=1;r<L.rows;r++){
      const p1=faceP(0, L.y0+r*L.yw-0.030), p2=faceP(1, L.y0+r*L.yw-0.030);
      if(p1&&p2){ ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke(); }
    }
  }
  // 踢脚线（墙面底部深色收边，世界锚定）
  {
    const p1=faceP(0,0.90), p2=faceP(1,0.90);
    if(p1&&p2){
      ctx.strokeStyle='rgba(0,0,0,0.12)';
      ctx.lineWidth=Math.max(2, fh*0.08);
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
    }
  }
  // 风格细节（招牌/遮阳棚等，世界锚定）
  if(style==='shop'||style==='mall'){
    const sA=faceP(0.05,0.36), sB=faceP(0.95,0.45);
    if(sA&&sB){
      ctx.fillStyle='rgba(224,89,74,0.85)';
      ctx.fillRect(sA.x, sA.y, sB.x-sA.x, sB.y-sA.y);
      ctx.fillStyle='#fff';
      ctx.font='bold '+Math.max(6,(sB.y-sA.y)*0.6)+'px "Microsoft YaHei"';
      ctx.textAlign='center';
      const sM=faceP(0.5,0.405);
      if(sM) ctx.fillText(style==='shop'?'SHOP':'MALL', sM.x, sM.y);
      // v=98.15：删除招牌内贴图（招牌用色块+文字，人物海报统一由覆盖层画 1 张）
    }
  }
  if(style==='cafe'){
    // 遮阳棚（窗口下方，世界锚定）
    const sA=faceP(0.10,0.56), sB=faceP(0.90,0.64);
    if(sA&&sB){
      ctx.fillStyle='rgba(106,74,138,0.85)';
      ctx.fillRect(sA.x, sA.y, sB.x-sA.x, sB.y-sA.y);
      ctx.fillStyle='#fff';
      ctx.font='bold '+Math.max(5,(sB.y-sA.y)*0.6)+'px "Microsoft YaHei"';
      ctx.textAlign='center';
      const sM=faceP(0.5,0.60);
      if(sM) ctx.fillText('CAFE', sM.x, sM.y);
    }
  }
  // 门（v=97：门洞 + 门框 + 门板 + 门缝 + 把手 + 台阶 —— 入口结构，世界锚定立面底部中央）
  const dC=faceP(0.5,0.70);
  if(dC){
    const dw=w*0.16*dC.s, dh=H*0.30*dC.s;
    const dx=dC.x-dw/2, dy=dC.y-dh/2;
    // 门洞（深色凹入）
    ctx.fillStyle='rgba(25,22,18,0.65)';
    ctx.fillRect(dx-dw*0.06, dy-dh*0.04, dw+dw*0.12, dh+dh*0.09);
    // 门板（木色，内嵌）
    ctx.fillStyle='rgba(148,112,72,0.96)';
    ctx.fillRect(dx+dw*0.03, dy, dw-dw*0.06, dh-dh*0.03);
    // 门框（两侧竖框 + 顶部横梁，浅色凸出）
    ctx.fillStyle='rgba(105,78,48,0.95)';
    ctx.fillRect(dx-dw*0.06, dy, dw*0.11, dh);
    ctx.fillRect(dx+dw-dw*0.05, dy, dw*0.11, dh);
    ctx.fillRect(dx-dw*0.06, dy-dh*0.04, dw+dw*0.12, dh*0.07);
    // 门缝（双开门中缝）
    ctx.fillStyle='rgba(0,0,0,0.3)';
    ctx.fillRect(dC.x-dw*0.03, dy+dh*0.04, dw*0.06, dh-dh*0.07);
    // 门把手
    ctx.fillStyle='#ffd76a';
    ctx.beginPath(); ctx.arc(dC.x+dw*0.34, dy+dh*0.42, Math.max(1.5,dw*0.07), 0, 7); ctx.fill();
    // 门口台阶（地面延伸条，世界锚定底部）
    const dS1=faceP(0.5-0.11,0.86), dS2=faceP(0.5+0.11,0.90);
    if(dS1&&dS2){
      ctx.fillStyle='rgba(150,138,120,0.85)';
      ctx.fillRect(dS1.x, dS1.y, dS2.x-dS1.x, dS2.y-dS1.y);
    }
  }
  // v=98.15：删除 drawFacade 内部海报（海报统一由 drawPosterLayer 覆盖层画 1 张，
  // 避免"一张物体两张海报"）
  ctx.restore();
}
/* 侧面窗户 + 侧面海报（v=98：每个可见侧面也有窗/图 → 从侧面/斜角看建筑不是光墙，
   不同方向移动都能看到搞怪图片） */
function drawFacadeSide(o, fPts, w, H, wA, wB){
  const cx=(fPts[0].x+fPts[2].x)/2, cy=(fPts[0].y+fPts[2].y)/2;
  const avgS=(fPts[0].s+fPts[2].s)/2;
  const fw=w*avgS, fh=H*avgS;
  if(avgS<0.13) return;   // 太远不画侧窗
  const L=winLayout(o.style);
  // 世界锚定（v=98.1；v=98.8 改严格 proj 消除 projOr 夹持闪烁：侧面窗/海报同样）
  const faceP=(u,v)=>proj(wA.x+(wB.x-wA.x)*u, wA.y+(wB.y-wA.y)*u, v*H);
  const sCols=Math.max(1, Math.min(L.cols, 2));          // 侧面简化：最多 2 列
  const sRows=Math.max(1, Math.min(Math.round(L.rows*0.7), 4));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fPts[0].x,fPts[0].y);
  for(let k=1;k<4;k++) ctx.lineTo(fPts[k].x,fPts[k].y);
  ctx.closePath(); ctx.clip();
  for(let c=0;c<sCols;c++) for(let r=0;r<sRows;r++){
    // 世界锚定（v=98.1）：侧面窗位置随立面世界坐标，不漂移
    const p=faceP((c+0.5)/sCols, 0.10+r*0.78/sRows);
    if(!p) continue;
    const ww=Math.max(2, w*0.17*p.s), wh=Math.max(2, H*0.06*p.s);
    // 侧面暗窗：窗洞 + 暗玻璃 + 细框（暗面用暗色玻璃，层次仍清晰）
    ctx.fillStyle='rgba(10,13,28,0.75)';
    ctx.fillRect(p.x-ww*0.2, p.y-wh*0.25, ww*1.4, wh*1.5);
    ctx.fillStyle='rgba(118,158,198,0.65)';
    ctx.fillRect(p.x-ww/2, p.y-wh/2, ww, wh);
    ctx.strokeStyle='rgba(28,34,54,0.9)';
    ctx.lineWidth=Math.max(1, fw*0.004);
    ctx.strokeRect(p.x-ww/2, p.y-wh/2, ww, wh);
  }
  // v=98.13：删除侧面海报（避免每个可见侧面都贴图 → 超过 2 张限制；
  // 侧面海报统一由 drawPosterLayer 覆盖层控制，每栋建筑最多 1 张侧面图）
  ctx.restore();
}

/* ---- 装饰：立式 billboard（简化造型） ---- */
function drawDeco3D(d,p){
  billboard(p, ()=>{
    const s=d.seed||0;
    switch(d.kind){
      case 'trashcan':
        ctx.fillStyle='#6b7a55'; ctx.beginPath(); ctx.arc(0,-10,7,0,7); ctx.fill();
        ctx.fillRect(-7,-6,14,8); ctx.fillStyle='#7e8f66'; ctx.fillRect(-7,-6,14,2);
        break;
      case 'hydrant':
        ctx.fillStyle='#d94f4f'; ctx.fillRect(-4,-14,8,15);
        ctx.beginPath(); ctx.arc(0,-15,5,Math.PI,0); ctx.fill();
        ctx.fillRect(-8,-8,16,3); break;
      case 'bench':
        ctx.fillStyle='#8a5a34'; ctx.fillRect(-12,-12,24,3); ctx.fillRect(-12,-17,24,2.5);
        ctx.fillStyle='#6e4426'; ctx.fillRect(-11,-9,2.5,9); ctx.fillRect(8.5,-9,2.5,9);
        break;
      case 'mailbox':
        ctx.fillStyle='#5a7ac8'; ctx.fillRect(-2,-2,4,11);
        ctx.beginPath(); ctx.arc(0,-2,6,Math.PI,0); ctx.fill(); ctx.fillRect(-6,-6,12,6);
        break;
      case 'bike':
        ctx.strokeStyle='#4a6a8a'; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(-7,-6,5,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(7,-6,5,0,7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-7,-6); ctx.lineTo(0,-14); ctx.lineTo(7,-6); ctx.moveTo(0,-14); ctx.lineTo(0,-7); ctx.stroke();
        break;
      case 'cone':
        ctx.fillStyle='#e88a3a'; ctx.beginPath(); ctx.moveTo(-6,-6); ctx.lineTo(0,-16); ctx.lineTo(6,-6); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#f2f2f2'; ctx.fillRect(-4.5,-9,9,2.5); ctx.fillRect(-4.5,-12.5,9,2.5);
        break;
      case 'trafficlight':
        ctx.fillStyle='#3a3f4a'; ctx.fillRect(-2.5,-40,5,40); ctx.fillRect(-8,-54,16,22);
        ctx.fillStyle='#ff5a5a'; ctx.beginPath(); ctx.arc(0,-47,3.5,0,7); ctx.fill();
        ctx.fillStyle='#ffd76a'; ctx.beginPath(); ctx.arc(0,-41,3.5,0,7); ctx.fill();
        ctx.fillStyle='#5ae05a'; ctx.beginPath(); ctx.arc(0,-35,3.5,0,7); ctx.fill();
        break;
      case 'busstop':
        ctx.fillStyle='#4a6f9e'; ctx.fillRect(-18,-16,2,16); ctx.fillRect(16,-16,2,16);
        ctx.fillStyle='#6b92c8'; ctx.fillRect(-20,-24,38,8);
        ctx.fillStyle='rgba(200,225,250,0.4)'; ctx.fillRect(-17,-16,31,10);
        ctx.fillStyle='#3a3f4a'; ctx.fillRect(-2,-30,4,12);
        ctx.fillStyle='#2f6fce'; ctx.fillRect(-9,-40,18,10);
        ctx.fillStyle='#fff'; ctx.font='bold 6px sans-serif'; ctx.textAlign='center';
        ctx.fillText('BUS',0,-33);
        break;
      case 'guardrail':
        ctx.strokeStyle='#cfd6e0'; ctx.lineWidth=3;
        if(d.horiz){ ctx.beginPath(); ctx.moveTo(-16,0); ctx.lineTo(16,0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-16,-6); ctx.lineTo(16,-6); ctx.stroke();
          ctx.fillStyle='#aab4c4'; ctx.fillRect(-18,-8,3,10); ctx.fillRect(15,-8,3,10); }
        else { ctx.beginPath(); ctx.moveTo(0,-16); ctx.lineTo(0,16); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-6,-16); ctx.lineTo(-6,16); ctx.stroke();
          ctx.fillStyle='#aab4c4'; ctx.fillRect(-8,-18,10,3); ctx.fillRect(-8,15,10,3); }
        break;
      case 'volleyball':   // 沙滩排球场（v=101）：网 + 两根柱子（沙地/白线在贴地层）
        ctx.fillStyle='#6a5a4a';
        ctx.fillRect(-18.8,-11,3.6,11); ctx.fillRect(15.2,-11,3.6,11);
        ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=1.3;
        ctx.beginPath(); ctx.moveTo(-17,-9); ctx.lineTo(17,-9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-17,-6.5); ctx.lineTo(17,-6.5); ctx.stroke();
        ctx.fillStyle='#e8e4d8';
        ctx.beginPath(); ctx.arc(0,-9,1.6,0,7); ctx.fill();   // 网顶小球
        break;
      default: break;
    }
  });
}

/* ---- 贴地装饰（井盖/停车位，透视投影到地面） ---- */
function drawDecoGround3D(d){
  if(d.kind==='manhole'){
    const p=proj(d.x,d.y,0); if(!p) return;
    ctx.fillStyle='#4a4f58';
    ctx.beginPath(); ctx.ellipse(p.x,p.y, 6*p.s, 6*p.s*0.42, 0,0,7); ctx.fill();
    ctx.strokeStyle='#3a3f48'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(p.x,p.y, 6*p.s, 6*p.s*0.42, 0,0,7); ctx.stroke();
  }
  else if(d.kind==='drain'){
    const p=proj(d.x,d.y,0); if(!p) return;
    ctx.fillStyle='#3a3f48';
    ctx.beginPath(); ctx.ellipse(p.x,p.y, 8*p.s, 3*p.s*0.42, 0,0,7); ctx.fill();
  }
  else if(d.kind==='parking'){
    const hw=11, hl=5;
    let p0,p1,p2,p3;
    if(d.horiz){ p0=proj(d.x-hw,d.y-hl,0); p1=proj(d.x+hw,d.y-hl,0); p2=proj(d.x+hw,d.y+hl,0); p3=proj(d.x-hw,d.y+hl,0); }
    else { p0=proj(d.x-hl,d.y-hw,0); p1=proj(d.x+hl,d.y-hw,0); p2=proj(d.x+hl,d.y+hw,0); p3=proj(d.x-hl,d.y+hw,0); }
    if(!p0||!p1||!p2||!p3) return;
    ctx.strokeStyle='rgba(255,255,255,0.65)'; ctx.lineWidth=Math.max(1,2.5*p0.s);
    ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.lineTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.lineTo(p3.x,p3.y); ctx.closePath(); ctx.stroke();
    // 静态车（地面贴片）
    const ccx=(p0.x+p2.x)/2, ccy=(p0.y+p2.y)/2, cs=p0.s;
    ctx.fillStyle=['#4a8ee8','#e05252','#e8e8e8','#7cc46a'][Math.floor(d.seed*4)%4];
    ctx.beginPath();
    ctx.ellipse(ccx, ccy, 10*cs, 10*cs*0.42, 0,0,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.ellipse(ccx, ccy, 5*cs, 5*cs*0.42, 0,0,7); ctx.fill();
  }
  else if(d.kind==='volleyball'){   // 沙滩排球场（v=101）：沙地 + 白边线 + 中线
    const hw=17, hl=30;
    groundRect(d.x, d.y, hw, hl, 'rgba(236,218,166,0.85)');
    const lw=1.3;
    groundRect(d.x, d.y-hl, hw, lw, 'rgba(255,255,255,0.75)');
    groundRect(d.x, d.y+hl, hw, lw, 'rgba(255,255,255,0.75)');
    groundRect(d.x-hw, d.y, lw, hl, 'rgba(255,255,255,0.75)');
    groundRect(d.x+hw, d.y, lw, hl, 'rgba(255,255,255,0.75)');
    groundRect(d.x, d.y, hw, lw, 'rgba(255,255,255,0.5)');
  }
}

/* ---- 汽车：地面贴片（透视） ---- */
/* ---- 汽车：立体小盒子（侧面 + 顶面 + 车窗 + 轮子） ---- */
function drawCar3D(c,p){
  const q=carXY(c);
  const ang=c.horiz?(c.dir>0?0:Math.PI):(c.dir>0?Math.PI/2:-Math.PI/2);
  const L=24, Wd=13, Hc=16;   // 长48 宽26 高16：明显的立体小车
  const ca=Math.cos(ang), sa=Math.sin(ang);
  const cxs=[[-L,-Wd],[L,-Wd],[L,Wd],[-L,Wd]].map(v=>[q.x+v[0]*ca-v[1]*sa, q.y+v[0]*sa+v[1]*ca]);
  const pb=cxs.map(v=>proj(v[0],v[1],0));
  const pt=cxs.map(v=>proj(v[0],v[1],Hc));
  if(pb.some(x=>!x)||pt.some(x=>!x)) return;
  const col=c.color;
  // 轮子（地面，先画，凸出车身）
  ctx.fillStyle='#26262e';
  const wheel=[[-L+7,-Wd-1.5],[L-7,-Wd-1.5],[-L+7,Wd+1.5],[L-7,Wd+1.5]];
  for(const [wx2,wy2] of wheel){
    const b=proj(q.x+wx2*ca-wy2*sa, q.y+wx2*sa+wy2*ca, 0);
    if(!b) continue;
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 5.5*p.s, 5.5*p.s*0.45, 0,0,7); ctx.fill();
  }
  // 侧面（车身两侧长边画小贴图，v=95）
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    const mx=(cxs[i][0]+cxs[j][0])/2, my=(cxs[i][1]+cxs[j][1])/2;
    const nx=cxs[j][1]-cxs[i][1], ny=cxs[i][0]-cxs[j][0];
    const vx=player.x-mx, vy=player.y-my;
    if(nx*vx+ny*vy<=0) continue;
    ctx.fillStyle=col;
    quadFill(pb[i],pb[j],pt[j],pt[i]);
    if(i===0||i===2){
      ctx.fillStyle='rgba(0,0,0,0.30)';
      quadFill(pb[i],pb[j],pt[j],pt[i]);
      // v=98.9：删除侧面贴图（侧面在俯视下被压扁看不见，海报统一贴车顶）
    }
  }
  // 顶面
  ctx.fillStyle=col;
  quadFill(pt[0],pt[1],pt[2],pt[3]);
  // 车顶玻璃（顶面缩 50% 深色块，从任何角度看都是车窗）
  const cxm=(pt[0].x+pt[2].x)/2, cym=(pt[0].y+pt[2].y)/2;
  ctx.fillStyle='rgba(18,28,48,0.82)';
  ctx.beginPath();
  for(let k=0;k<4;k++){
    const x=cxm+(pt[k].x-cxm)*0.5, y=cym+(pt[k].y-cym)*0.5;
    if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath(); ctx.fill();
  // 车顶贴图（v=98.9：海报统一贴车顶 —— 俯视主视角下车顶最显眼，侧面被压扁看不见）
  const cimg2=c.poster&&IMGS[c.poster];
  if(cimg2){
    const s2=Math.max(4, Math.abs(pt[1].x-pt[0].x))*0.62;   // 车长方向跨度 62%
    const sh2=s2*(cimg2.height/cimg2.width);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pt[0].x,pt[0].y); ctx.lineTo(pt[1].x,pt[1].y);
    ctx.lineTo(pt[2].x,pt[2].y); ctx.lineTo(pt[3].x,pt[3].y);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(cimg2, cxm-s2/2, cym-sh2/2, s2, sh2);
    ctx.restore();
  }
}

/* ---- 黑洞：地面深洞（透视椭圆） ---- */
function drawHole3D(h,p){
  const col=COLORS[h.idx];
  const vr=visualR(h);
  // 视觉尺寸封顶（v=96）：黑洞屏幕半径不超过 34% 屏高（直径 68%）
  // → 大黑洞依然明显巨大，但不会无限放大到占满屏幕，周围道路建筑始终可见
  const scale=Math.min(1, H*0.34/(vr*p.s*1.3));
  const rx=vr*p.s*1.6*scale, ry=vr*p.s*1.3*scale;   // 接近正圆的洞（透视下脚底的黑洞是圆的，不再是扁椭圆）
  const t=performance.now()/1000;
  // ===== 黑洞本体（v=98：纯程序化材质，不使用任何图片贴图）=====
  // 外圈暗晕（极淡，几乎不染路面，仅提示边界范围）
  let g=ctx.createRadialGradient(p.x,p.y,ry*0.9, p.x,p.y,ry*1.1);
  g.addColorStop(0,'rgba(15,12,35,0)');
  g.addColorStop(0.55,'rgba(15,12,35,0.13)');
  g.addColorStop(1,'rgba(15,12,35,0)');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx*1.1,ry*1.1,0,0,7); ctx.fill();
  // 洞体：中心纯黑 → 边缘深灰蓝渐变（边缘比中心浅 → 内凹深度感）
  g=ctx.createRadialGradient(p.x,p.y,0, p.x,p.y,ry);
  g.addColorStop(0,'#000000');
  g.addColorStop(0.70,'#000000');
  g.addColorStop(0.88,'#05060f');
  g.addColorStop(0.97,'#10131f');
  g.addColorStop(1,'#1c2038');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx,ry,0,0,7); ctx.fill();
  // 硬边缘轮廓（清晰边界：一眼判断黑洞实际半径）
  ctx.strokeStyle='rgba(5,6,14,0.95)';
  ctx.lineWidth=Math.max(1.5, ry*0.055);
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx*0.985,ry*0.985,0,0,7); ctx.stroke();
  // 边缘内侧微光（吸积盘感：暗紫，非常克制，非霓虹）
  g=ctx.createRadialGradient(p.x,p.y,ry*0.75, p.x,p.y,ry);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(0.8,'rgba(80,70,150,0.08)');
  g.addColorStop(1,'rgba(130,110,220,0.16)');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx,ry,0,0,7); ctx.fill();
  // 底部受光弧（立体感：洞缘一圈的受光处）
  ctx.strokeStyle='rgba(185,195,255,0.30)';
  ctx.lineWidth=Math.max(1,vr*p.s*0.045);
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx*0.93,ry*0.93,0,0.5,1.35); ctx.stroke();
  // 涡旋（程序化动画，收敛洞内，暗紫）
  for(let i=0;i<3;i++){
    ctx.strokeStyle='rgba(120,105,200,'+(0.30-i*0.08)+')';
    ctx.lineWidth=Math.max(1,vr*p.s*0.065);
    ctx.beginPath();
    ctx.ellipse(p.x,p.y, rx*(0.3+i*0.2), ry*(0.3+i*0.2), 0, t*(1.2+i*0.5)+i*2.1, t*(1.2+i*0.5)+i*2.1+2.0);
    ctx.stroke();
  }
  // 玩家颜色标识（极淡，仅区分阵营，不改变黑洞本体）
  g=ctx.createRadialGradient(p.x,p.y,ry*0.5, p.x,p.y,ry*0.95);
  g.addColorStop(0,'rgba(0,0,0,0)');
  g.addColorStop(1,col+'22');
  ctx.fillStyle=g;
  ctx.beginPath(); ctx.ellipse(p.x,p.y,rx*0.95,ry*0.95,0,0,7); ctx.fill();
  // 名字
  ctx.fillStyle='#fff'; ctx.font='bold 15px "Microsoft YaHei"';
  ctx.textAlign='center';
  ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=6;
  ctx.fillText(NAMES[h.idx]+' Lv.'+Math.max(1,Math.round(vr/50)), p.x, p.y-ry-14);
  ctx.shadowBlur=0;

  // 玩家移动方向指示（屏幕空间弧线 + 箭头，直接用实际移动方向）
  if(h===player){
    const mx=player.mdx||0, my=player.mdy||0;
    if(mx||my){
      const ang=Math.atan2(my,mx)-cam.ang;   // 世界角 → 屏幕角
      const R=ry*1.25;
      ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.lineWidth=4;
      ctx.beginPath(); ctx.ellipse(p.x,p.y,R,R,0,ang-0.5,ang+0.5); ctx.stroke();
      const bx=p.x+Math.cos(ang)*R, by=p.y+Math.sin(ang)*R;
      ctx.fillStyle='#fff';
      ctx.beginPath();
      ctx.moveTo(bx+Math.cos(ang)*16, by+Math.sin(ang)*16);
      ctx.lineTo(bx+Math.cos(ang-2.35)*6, by+Math.sin(ang-2.35)*6);
      ctx.lineTo(bx+Math.cos(ang+2.35)*6, by+Math.sin(ang+2.35)*6);
      ctx.closePath(); ctx.fill();
    }
  }
}

/* ================= 游戏控制 ================= */
function startGame(m, theme){
  mode=m;
  if(theme) curTheme=theme;
  T=THEMES[curTheme];
  objs=[]; holes=[]; cars=[];
  spawnAll();
  spawnHoles(mode==='arena'?4:1);
  timeLeft=TIME_LIMIT;
  gameStartTs=performance.now();
  running=true; over=false; paused=false;
  if(actx && actx.state==='suspended') actx.resume();
}
function gameOver(kind){
  if(over) return;
  over=true; running=false;
  uiShowResult(kind);   // ui.js 负责渲染结算
}
/* 当前玩家排名（按 score） */
function scoreRanking(){
  return [...holes].filter(h=>h.alive).sort((a,b)=>b.score-a.score);
}

/* ================= 主循环 ================= */
function start(){
  fit(); setupInput();
  // 手机 Safari 地址栏收展 / 旋转 / 安卓键盘弹起时重设画布（v=104.5）
  let rsT=0;
  window.addEventListener('resize', ()=>{
    clearTimeout(rsT);
    rsT=setTimeout(()=>{ fit(); }, 120);
  });
  cam.x=WORLD/2; cam.y=WORLD/2;
  function loop(ts){
    requestAnimationFrame(loop);
    if(!lastT) lastT=ts;
    const dt=Math.min((ts-lastT)/1000, 0.05);
    lastT=ts;
    if(running && !paused) update(dt);
    draw(dt);
  }
  requestAnimationFrame(loop);
}

/* ================= 地图鸟瞰预览（v=100）：正射俯视渲染整张地图，用于地图选择界面截图 ================= */
function drawOverview(){
  T=THEMES[curTheme];
  const pad=110;   // 边缘展示宽度（沙滩/林缘/沙地/雪原）
  const sc=Math.min(W/(WORLD+pad*2), H/(WORLD+pad*2));
  const ox=(W-(WORLD+pad*2)*sc)/2, oy=(H-(WORLD+pad*2)*sc)/2;
  const X=x=>ox+(x+pad)*sc, Y=y=>oy+(y+pad)*sc;
  const R=v=>v*sc;
  // 1. 背景（边缘色：海 / 森林 / 沙 / 雪）
  ctx.fillStyle=(T.edge?T.edge[0]:(T.sea[0]));
  ctx.fillRect(0,0,W,H);
  // 2. 沙滩环（海岛）
  if(T.beach){
    ctx.fillStyle=T.beach;
    ctx.fillRect(X(-pad),Y(-pad), (WORLD+pad*2)*sc, (WORLD+pad*2)*sc);
  }
  // 3. 街区色块
  for(let gy=0;gy<5;gy++) for(let gx=0;gx<5;gx++){
    ctx.fillStyle=T.zoneCol[T.zoneMap[gy][gx]];
    ctx.fillRect(X(gx*STEP), Y(gy*STEP), STEP*sc, STEP*sc);
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1;
    ctx.strokeRect(X(gx*STEP), Y(gy*STEP), STEP*sc, STEP*sc);
  }
  // 4. 道路（普通路灰条 + 主路深条）
  ctx.fillStyle=T.roadCol;
  for(let i=STEP;i<WORLD;i+=STEP){
    ctx.fillRect(X(i-ROAD/2), Y(0), ROAD*sc, WORLD*sc);
    ctx.fillRect(X(0), Y(i-ROAD/2), WORLD*sc, ROAD*sc);
  }
  ctx.fillStyle=T.roadMainCol;
  ctx.fillRect(X(MAIN_ROAD_X-MAIN_W/2), Y(0), MAIN_W*sc, WORLD*sc);
  ctx.fillRect(X(0), Y(MAIN_ROAD_Y-MAIN_W/2), WORLD*sc, MAIN_W*sc);
  // 5. 物体（按样式画小图形）
  for(const o of objs){
    if(o.gone) continue;
    const px=X(o.x), py=Y(o.y);
    let col='#666';
    if(BUILD_STYLES.includes(o.style)) col=styleWall(o.style, o.var);
    else if(PLANT_STYLES.includes(o.style)) col=o.style==='snowman'?'#eef4f8':(o.style==='pine'||o.style==='palm'||o.style==='cactus'?'#4a9a5a':'#5dae62');
    else if(ANIMAL_STYLES.includes(o.style)) col=o.style==='crab'?'#e86454':'#c8944a';
    else if(o.style==='ped') col='#f4f0e8';
    ctx.fillStyle=col;
    const rr2=BUILD_STYLES.includes(o.style)?R(o.r*0.9):R(o.r*0.7);
    ctx.beginPath(); ctx.arc(px, py, rr2, 0, 7); ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.35)'; ctx.lineWidth=1;
    ctx.stroke();
  }
  // 6. 汽车（小方块）
  for(const c of cars){
    const q=carXY(c);
    ctx.fillStyle=c.color;
    ctx.fillRect(X(q.x)-R(8), Y(q.y)-R(5), R(16), R(10));
  }
}
