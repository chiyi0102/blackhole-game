/* ================= DriftWall（原生 JS 实现，React Bits 移植版）=================
   开始页背景：多列照片墙竖直漂移 + 3D 透视倾斜 + 鼠标视差 + hover 抬升。
   无 React 依赖，纯 DOM + CSS3D。用法：DriftWall.init('#driftWall', {items, ...}) */
(function(global){
  'use strict';
  const DEFAULT_ITEMS = [
    'assets/menu/m1.jpg','assets/menu/m2.jpg','assets/menu/m3.jpg','assets/menu/m4.jpg',
    'assets/menu/m5.png','assets/menu/m6.png','assets/menu/m7.png','assets/menu/m8.png',
    'assets/menu/m9.jpg','assets/menu/m10.jpg','assets/menu/m11.jpg','assets/menu/m12.jpg',
    'assets/menu/m13.jpg','assets/menu/m14.jpg'
  ];
  const reduced = () => typeof window!=='undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const columnFactor = (index, variance) => {
    const pseudo = ((index * 0.6180339887 + 0.35) % 1) * 2 - 1;
    return 1 + variance * pseudo;
  };

  function init(selector, opts){
    const container = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if(!container) return null;
    opts = opts || {};
    const items      = opts.items || DEFAULT_ITEMS;
    const columns    = opts.columns || 5;
    const tileW      = opts.tileWidth || 200;
    const tileH      = opts.tileHeight || 132;
    const gap        = opts.gap || 18;
    const tilt       = opts.tilt || 16;
    const turn       = opts.turn || -14;
    const roll       = opts.roll || 0;
    const perspective= opts.perspective || 1200;
    const depth      = opts.depth || 120;
    const speed      = opts.speed || 42;
    const direction  = opts.direction || 'up';
    const variance   = opts.variance || 0.45;
    const parallax   = opts.parallax || 0.6;
    const lift       = opts.lift || 64;
    const dim        = opts.dim || 0.55;
    const overlayColor = opts.overlayColor || '#060010';
    const fade       = opts.fade || 0.6;

    container.classList.add('dw');
    container.style.setProperty('--dw-tile-w', tileW+'px');
    container.style.setProperty('--dw-tile-h', tileH+'px');
    container.style.setProperty('--dw-gap', gap+'px');
    container.style.setProperty('--dw-perspective', perspective+'px');
    container.style.setProperty('--dw-lift', lift+'px');
    container.style.setProperty('--dw-dim', dim);
    container.style.setProperty('--dw-overlay', overlayColor);
    container.style.setProperty('--dw-edge', Math.max(0, (1-fade)*100)+'%');
    container.style.position = 'absolute';
    container.style.inset = '0';
    container.style.overflow = 'hidden';
    container.style.perspective = perspective+'px';
    container.style.perspectiveOrigin = '50% 50%';
    if(!reduced()){
      container.style.webkitMaskImage =
        'radial-gradient(ellipse 78% 82% at 50% 46%, #000 var(--dw-edge), transparent 100%),'+
        'linear-gradient(to top, #000 var(--dw-edge), transparent 100%)';
      container.style.webkitMaskComposite = 'source-in';
      container.style.maskImage =
        'radial-gradient(ellipse 78% 82% at 50% 46%, #000 var(--dw-edge), transparent 100%),'+
        'linear-gradient(to top, #000 var(--dw-edge), transparent 100%)';
      container.style.maskComposite = 'intersect';
    }

    const plane = document.createElement('div');
    plane.className = 'dw-plane';
    plane.style.position = 'absolute';
    plane.style.top = '50%';
    plane.style.left = '50%';
    plane.style.display = 'flex';
    plane.style.flexDirection = 'row';
    plane.style.transformStyle = 'preserve-3d';
    plane.style.cursor = 'pointer';
    plane.style.transformOrigin = '50% 50%';
    plane.style.willChange = 'transform';
    container.appendChild(plane);

    // 每列图片分配（轮流放入）
    const colItems = Array.from({length: columns}, () => []);
    items.forEach((it, i) => colItems[i % columns].push(it));
    colItems.forEach((col, c) => { if(!col.length) colItems[c] = items.slice(0,1); });

    const containerH = container.clientHeight || 600;
    const unit = tileH + gap;
    const colMeta = colItems.map(col => {
      const copyHeight = Math.max(unit, col.length * unit);
      const copies = Math.max(2, Math.ceil((containerH * 1.6) / copyHeight) + 1);
      return { copyHeight, copies };
    });

    const dirSign = direction === 'up' ? 1 : -1;
    const baseVel = colItems.map((_, c) => {
      const altSign = c % 2 === 0 ? 1 : -1;
      return speed * columnFactor(c, variance) * dirSign * altSign;
    });

    const offsets = colMeta.map((meta, c) => meta.copyHeight * ((c * 0.37) % 1));
    const velocities = colItems.map(() => 0);
    const trackEls = [];
    const hoveredCol = { v: -1 };
    const wallHovered = { v: false };
    const pointer = { x:0, y:0 }, pointerDamped = { x:0, y:0 };

    // 构建轨道
    colItems.forEach((col, c) => {
      const meta = colMeta[c];
      const colEl = document.createElement('div');
      colEl.className = 'dw-col';
      colEl.style.position = 'relative';
      colEl.style.width = (tileW + gap) + 'px';
      colEl.style.transformStyle = 'preserve-3d';
      const track = document.createElement('div');
      track.className = 'dw-track';
      track.style.display = 'flex';
      track.style.flexDirection = 'column';
      track.style.willChange = 'transform';
      track.style.transformStyle = 'preserve-3d';
      for(let ci = 0; ci < meta.copies; ci++){
        col.forEach((src, ii) => {
          const tile = document.createElement('div');
          tile.className = 'dw-tile';
          tile.dataset.col = c;
          tile.dataset.id = c+'-'+ci+'-'+ii;
          tile.style.position = 'relative';
          tile.style.width = '100%';
          tile.style.height = (tileH + gap) + 'px';
          tile.style.flex = '0 0 auto';
          tile.style.transformStyle = 'preserve-3d';
          tile.tabIndex = 0;
          tile.setAttribute('role','button');
          const inner = document.createElement('div');
          inner.className = 'dw-inner';
          inner.style.position = 'absolute';
          inner.style.inset = (gap/2)+'px';
          inner.style.borderRadius = '14px';
          inner.style.overflow = 'hidden';
          inner.style.background = '#0b0b12';
          // v=99.1：transform/opacity/压暗层交给 CSS 类控制（内联样式会覆盖 .is-active hover 规则，
          // 导致"鼠标移上去照片不立起来"）——见 index.html 的 .dw-inner 规则
          inner.style.pointerEvents = 'none';
          inner.style.transition = 'transform 0.42s cubic-bezier(0.22,1,0.36,1), opacity 0.42s cubic-bezier(0.22,1,0.36,1), box-shadow 0.42s cubic-bezier(0.22,1,0.36,1)';
          const img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'eager';
          img.decoding = 'async';
          img.draggable = false;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          img.style.display = 'block';
          img.style.userSelect = 'none';
          img.style.transition = 'filter 0.42s cubic-bezier(0.22,1,0.36,1)';
          const ovl = document.createElement('div');
          ovl.style.position = 'absolute';
          ovl.style.inset = '0';
          ovl.style.background = overlayColor;
          // v=99.1：压暗层透明度交给 CSS 类控制（见 index.html .dw-inner > div:last-child）
          ovl.style.pointerEvents = 'none';
          ovl.style.transition = 'opacity 0.42s cubic-bezier(0.22,1,0.36,1)';
          inner.appendChild(img);
          inner.appendChild(ovl);
          tile.appendChild(inner);
          // hover 事件
          tile.addEventListener('pointerenter', () => {
            hoveredCol.v = c;
            tile.classList.add('is-active');
          });
          tile.addEventListener('pointerleave', () => {
            tile.classList.remove('is-active');
            hoveredCol.v = -1;
          });
          track.appendChild(tile);
        });
      }
      colEl.appendChild(track);
      plane.appendChild(colEl);
      trackEls[c] = track;
    });

    const applyPlane = (px, py) => {
      plane.style.transform =
        'translate(-50%, -50%) scale(1.18) ' +
        'rotateX(' + (tilt + py) + 'deg) rotateY(' + (turn + px) + 'deg) rotateZ(' + roll + 'deg) ' +
        'translateZ(' + (-depth) + 'px)';
    };
    applyPlane(0, 0);

    let raf = null, lastTs = null, reducedNow = reduced();
    const animate = (ts) => {
      if(lastTs === null) lastTs = ts;
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;
      // 视差（跟随指针）
      const maxTilt = parallax * 8;
      const damp = 1 - Math.exp(-dt / 0.12);
      pointerDamped.x += ((pointer.x * maxTilt) - pointerDamped.x) * damp;
      pointerDamped.y += ((-pointer.y * maxTilt) - pointerDamped.y) * damp;
      applyPlane(pointerDamped.x, pointerDamped.y);
      if(!reducedNow){
        for(let c = 0; c < trackEls.length; c++){
          const meta = colMeta[c];
          if(!meta || !trackEls[c]) continue;
          const paused = wallHovered.v && opts.pauseOnHover;
          const factor = (paused || hoveredCol.v === c) ? 0 : 1;
          const target = baseVel[c] * factor;
          const ease = 1 - Math.exp(-dt / (target === 0 ? 0.16 : 0.28));
          velocities[c] += (target - velocities[c]) * ease;
          let next = (offsets[c] || 0) + velocities[c] * dt;
          next = ((next % meta.copyHeight) + meta.copyHeight) % meta.copyHeight;
          offsets[c] = next;
          trackEls[c].style.transform = 'translate3d(0, ' + (-next) + 'px, 0)';
        }
      } else {
        for(let c = 0; c < trackEls.length; c++){
          const el = trackEls[c], meta = colMeta[c];
          if(el && meta) el.style.transform = 'translate3d(0, ' + (-(offsets[c]||0)) + 'px, 0)';
        }
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    // 指针视差
    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      if(!rect) return;
      if(parallax > 0 && !reducedNow){
        pointer.x = (e.clientX - rect.left) / rect.width - 0.5;
        pointer.y = (e.clientY - rect.top) / rect.height - 0.5;
      }
    };
    const onEnter = () => { wallHovered.v = true; };
    const onLeave = () => { wallHovered.v = false; pointer.x = 0; pointer.y = 0; };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerenter', onEnter);
    container.addEventListener('pointerleave', onLeave);

    // reduced-motion 监听
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onReduced = (e) => { reducedNow = e.matches; };
    if(mq.addEventListener) mq.addEventListener('change', onReduced);

    return {
      destroy(){
        if(raf) cancelAnimationFrame(raf);
        raf = null;
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerenter', onEnter);
        container.removeEventListener('pointerleave', onLeave);
        if(mq.removeEventListener) mq.removeEventListener('change', onReduced);
        container.innerHTML = '';
        container.classList.remove('dw');
      }
    };
  }

  global.DriftWall = { init };
})(window);
