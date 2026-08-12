'use strict';
/* ================= UI：主菜单 / 地图选择 / 暂停 / 结算 / HUD ================= */
let currentMode='arena';
let currentTheme='city';
let _accordion=null;

/* 初始化（素材加载完成后由 game.js 调用） */
function uiInit(){
  // 主菜单背景：DriftWall 照片墙（原生实现，React Bits 移植）
  const dwEl=document.getElementById('driftWall');
  if(dwEl && window.DriftWall){
    // 手机窄屏：列数/尺寸缩小（v=104.5，6 列 180px 在手机 375px 宽下整墙溢出裁切）
    const narrow=innerWidth<=640;
    window._driftWall=DriftWall.init(dwEl, {
      items: [
        'assets/menu/m1.jpg','assets/menu/m2.jpg','assets/menu/m3.jpg','assets/menu/m4.jpg',
        'assets/menu/m5.png','assets/menu/m6.png','assets/menu/m7.png','assets/menu/m8.png',
        'assets/menu/m9.jpg','assets/menu/m10.jpg','assets/menu/m11.jpg','assets/menu/m12.jpg',
        'assets/menu/m13.jpg','assets/menu/m14.jpg'
      ],
      columns: narrow?3:6, tileWidth: narrow?104:180, tileHeight: narrow?70:120,
      gap: narrow?9:14, tilt: narrow?10:14, turn: narrow?-8:-10,
      perspective: narrow?900:1300, depth: narrow?70:110, speed: narrow?30:42,
      direction: 'up', variance: narrow?0.3:0.45,
      parallax: 0.6, lift: narrow?36:64, fade: narrow?0.28:0.3, dim: 0.8, overlayColor: '#060010'
    });
  }
  // ===== 地图选择手风琴（v=100）：主菜单点模式 → 先选地图 → 再进游戏 =====
  const accEl=document.getElementById('mapAccordion');
  if(accEl && window.AccordionGallery){
    _accordion=AccordionGallery.init(accEl, {
      items: THEME_LIST.map(k=>({
        key: k,
        label: THEMES[k].emoji+' '+THEMES[k].name,
        image: 'assets/maps/'+k+'.jpg?v=102',   // v=102 换新插图(版本参数绕浏览器缓存)
        alt: THEMES[k].name+'地图'
      })),
      defaultIndex: 0,
      expandRatio: 0.52,
      height: 400,
      onSelect: (key)=>{
        currentTheme=key;
        hideAllOverlays();
        startGame(currentMode, key);
      }
    });
  }
  // 主菜单（v=103 两步式）：大按钮「开始游戏，遁入依门」→ 弹出模式选择 → 再选地图
  const bigStartBtn=document.getElementById('bigStartBtn');
  const modePick=document.getElementById('modePick');
  bigStartBtn.addEventListener('click', ()=>{
    bigStartBtn.classList.add('hidden');
    modePick.classList.remove('hidden');
  });
  document.querySelectorAll('.menuBtn[data-mode]').forEach(b=>{
    b.addEventListener('click', ()=>{
      currentMode=b.dataset.mode;
      document.getElementById('mapSelectSub').textContent =
        (currentMode==='single' ? '🕹 单人吞噬' : '⚔️ 黑洞竞技') + ' · 选择地图后开始';
      hideAllOverlays();
      document.getElementById('mapSelect').classList.remove('hidden');
    });
  });
  document.getElementById('mapBackBtn').addEventListener('click', ()=>{
    document.getElementById('mapSelect').classList.add('hidden');
    showMenu();
  });
  // 暂停
  document.getElementById('pauseBtn').addEventListener('click', uiTogglePause);
  document.getElementById('resumeBtn').addEventListener('click', uiTogglePause);
  document.getElementById('restartBtn').addEventListener('click', ()=>{
    hideAllOverlays();
    startGame(currentMode, currentTheme);
  });
  document.getElementById('exitMenuBtn').addEventListener('click', ()=>{
    paused=false; running=false;
    showMenu();
  });
  // 结算
  document.getElementById('againBtn').addEventListener('click', ()=>{
    hideAllOverlays();
    startGame(currentMode, currentTheme);
  });
  document.getElementById('resultMenuBtn').addEventListener('click', ()=>{
    running=false;
    showMenu();
  });

  // ===== 地图预览截图 / 自动开局模式（v=100）=====
  // ?map=森林&shot=1 → 鸟瞰渲染一帧（生成地图选择界面预览图）
  // ?map=森林&auto=1 → 隐藏菜单直接进对应地图（验证 / 分享直达）
  // 必须放在 start() 之前：shot 模式不启动主循环，否则 rAF 会覆盖鸟瞰画面
  const q=new URLSearchParams(location.search);
  const shotMode=q.get('shot')==='1';
  const autoMode=q.get('auto')==='1';
  if(shotMode || autoMode){
    fit();
    hideAllOverlays();
    const mk=q.get('map');
    const theme=THEME_LIST.find(k=>THEMES[k].name===mk || k===mk) || 'city';
    startGame('single', theme);
    if(shotMode){
      document.getElementById('hud').style.display='none';   // 隐藏 HUD/提示
      document.getElementById('hint').style.display='none';
      drawOverview();
      return;
    }
    // auto 模式：正常跑主循环（菜单已隐藏）
  }

  // 显示主菜单并启动主循环（auto 模式已隐藏菜单，只启动主循环）
  // 触屏设备（手机/平板）提示语改为方向盘，不显示鼠标（v=104.5）
  const hintEl=document.getElementById('hint');
  if(hintEl && (('ontouchstart' in window)||(navigator.maxTouchPoints||0)>0)){
    hintEl.innerHTML='🕹 手机方向盘 控制黑洞';
  }
  if(!autoMode) showMenu();
  start();
}

function hideAllOverlays(){
  ['menu','pause','result','mapSelect'].forEach(id=>document.getElementById(id).classList.add('hidden'));
}
function showMenu(){
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('mapSelect').classList.add('hidden');
  // 回到菜单第一步：只显示大按钮，收起模式选择
  document.getElementById('bigStartBtn').classList.remove('hidden');
  document.getElementById('modePick').classList.add('hidden');
}

/* ---- 暂停 ---- */
function uiTogglePause(){
  if(!running || over) return;
  paused=!paused;
  document.getElementById('pause').classList.toggle('hidden', !paused);
}

/* ---- 结算 ---- */
function uiShowResult(kind){
  hideAllOverlays();   // 防御：确保结算页不被地图选择/暂停等遮罩遮挡
  const ov=document.getElementById('result');
  const title=document.getElementById('resultTitle');
  const board=document.getElementById('resultBoard');
  const stats=document.getElementById('resultStats');
  ov.classList.remove('hidden');

  if(mode==='single'){
    // 单人模式：吞噬进度达到阈值即完成
    title.textContent='🎉 YOU WIN!';
    title.style.color='#ffd76a';
    board.innerHTML='<div class="winBig">🗑 地图吞噬完成！</div>';
    // v=103：黑洞大小 / 等级 / 用时 + 宗主金句
    const vr=visualR(player);
    const lv=Math.max(1,Math.round(vr/50));
    const sec=Math.max(0,(performance.now()-gameStartTs)/1000);
    const mm=Math.floor(sec/60), ss=Math.floor(sec%60);
    stats.innerHTML=
      `吞噬进度 <b>100%</b> · 吞噬 <b>${player.eaten}</b> 个目标 · 最终 SCORE <b>${player.score}</b><br>`+
      `黑洞大小 <b>${Math.round(vr)}</b> · 等级 <b>Lv.${lv}</b> · 用时 <b>${mm}:${String(ss).padStart(2,'0')}</b>`+
      `<div class="winBig" style="margin-top:12px;font-size:17px">哥们，宗主等你等得苦啊 😭</div>`;
  } else {
    // 竞技模式：按 Score 排行
    const list=scoreRanking();
    const rankIdx=list.findIndex(h=>h===player);
    const win=rankIdx===0;
    title.textContent=win ? '🏆 YOU WIN!' : '💀 GAME OVER';
    title.style.color=win ? '#ffd76a' : '#ff6a8a';
    const medals=['🥇','🥈','🥉','4️⃣','5️⃣'];
    board.innerHTML=list.map((h,i)=>{
      const you=h===player?' <span class="youTag">YOU</span>':'';
      return `<div class="row ${h===player?'you':''}">${medals[i]||'•'} ${NAMES[h.idx]}${you} <span class="sc">${h.score}</span></div>`;
    }).join('');
    const winner=NAMES[list[0].idx];
    // v=103：胜负金句（第一名注意力在线，其他人内鬼）
    stats.innerHTML=(win
      ? `<b>Winner: ${winner}（你）🎉</b>`
      : `<b>Winner: ${winner}</b>`) +
      `<div class="winBig" style="margin-top:12px;font-size:17px;${win?'':'color:#ff9d5c'}">`+
      `${win?'哥们，你的注意力机制很在线哦 ✨':'哥们，你是内鬼吧 🤨'}</div>`;
  }
  document.getElementById('againBtn').textContent = mode==='single' ? '🔄 再来一局' : '⚔ 再来一局';
}

/* ---- HUD（每帧由 game.js draw 调用） ---- */
function uiDrawHud(){
  document.getElementById('scoreVal').textContent=player.score;
  document.getElementById('sizeVal').textContent=Math.round(visualR(player));
  // 单人模式：吞噬进度（达到阈值后显示 100%）
  const progEl=document.getElementById('progVal');
  if(mode==='single'){
    const p=eatProgress();
    progEl.textContent=(p>=SINGLE_COMPLETION ? '100' : (p*100).toFixed(1))+'%';
  } else {
    progEl.textContent='—';
  }
  const tEl=document.getElementById('timerVal');
  if(mode==='arena'){ tEl.textContent=Math.max(0,Math.ceil(timeLeft)); }
  else { tEl.textContent='∞'; }

  const rankEl=document.getElementById('rank');
  if(mode==='arena'){
    const sorted=scoreRanking();
    const maxS=Math.max(...sorted.map(h=>h.score),1);
    rankEl.style.display='flex';
    rankEl.innerHTML=sorted.map(h=>{
      const you=h===player;
      return `<div class="rchip ${you?'you':''}"><span class="dot" style="background:${COLORS[h.idx]}"></span>`+
             `${you?'⭐ ':''}${NAMES[h.idx]} ${h.score}`+
             `<span class="bar"><i style="width:${Math.round(h.score/maxS*100)}%;background:${COLORS[h.idx]}"></i></span></div>`;
    }).join('');
  } else {
    rankEl.style.display='none';
  }
}
