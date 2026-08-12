'use strict';
/* ================= 地图选择手风琴画廊（v=100）
   React Bits AccordionGallery → 原生 JS + CSS 移植（参考 react-bits-to-vanilla.md 经验）：
   - 无 React / 无 GSAP：flex-grow + CSS transition 实现展开动画
   - ⚠️ 关键规则：所有会随状态变化的样式（transform/opacity/filter）默认值一律放 CSS 类，
     JS 只切换 .is-active 类，绝不内联 —— 内联样式优先级最高会锁死 hover/active 切换
   - hover 展开 + click 选择 + 键盘左右方向键导航 + 触摸 tap 展开
   - 选中回调 onSelect(themeKey) */
(function(global){
  function init(el, opts){
    opts = opts || {};
    const items = opts.items || [];
    const onSelect = opts.onSelect || function(){};
    const accent = opts.accentColor || '#ffd76a';
    const overlay = opts.overlayColor || '#060010';
    const textCol = opts.textColor || '#ffffff';
    const gap = opts.gap || 10;
    const radius = opts.radius || 16;
    const height = opts.height || 420;
    const expandRatio = Math.min(Math.max(opts.expandRatio || 0.52, 0.2), 0.9);
    const grow = items.length > 1 ? (expandRatio * (items.length - 1)) / (1 - expandRatio) : 1;
    const vertical = opts.orientation === 'vertical';
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    el.classList.add('ag');
    if(vertical) el.classList.add('ag--v');
    el.style.setProperty('--ag-gap', gap + 'px');
    el.style.setProperty('--ag-radius', radius + 'px');
    el.style.setProperty('--ag-accent', accent);
    el.style.setProperty('--ag-overlay', overlay);
    el.style.setProperty('--ag-text', textCol);
    el.style.setProperty('--ag-grow', grow.toFixed(3));
    el.style.height = (vertical ? Math.round(height * 1.4) : height) + 'px';

    let active = Math.min(Math.max(opts.defaultIndex || 0, 0), items.length - 1);
    const panels = [];
    const mediaEls = [];

    items.forEach((item, i) => {
      const panel = document.createElement('div');
      panel.className = 'ag-panel';
      panel.setAttribute('role', 'listitem');
      panel.tabIndex = 0;
      panel.setAttribute('aria-label', item.label || '');
      const frame = document.createElement('div');
      frame.className = 'ag-frame';
      const media = document.createElement('div');
      media.className = 'ag-media';
      const img = document.createElement('img');
      img.src = item.image;
      img.alt = item.alt || item.label || '';
      img.draggable = false;
      img.loading = 'eager';        // headless 截图必须 eager，lazy 不加载
      media.appendChild(img);
      frame.appendChild(media);
      const ovl = document.createElement('div');
      ovl.className = 'ag-ovl';
      frame.appendChild(ovl);
      panel.appendChild(frame);
      const cap = document.createElement('div');
      cap.className = 'ag-cap';
      const bar = document.createElement('span');
      bar.className = 'ag-bar';
      const text = document.createElement('span');
      text.className = 'ag-text';
      text.textContent = item.label || '';
      cap.appendChild(bar);
      cap.appendChild(text);
      panel.appendChild(cap);
      el.appendChild(panel);
      panels.push(panel);
      mediaEls.push(media);

      panel.addEventListener('pointerenter', () => setActive(i));
      panel.addEventListener('click', e => {
        if (i !== active) { e.preventDefault(); setActive(i); return; }
        // 点已展开的面板 = 确认选择
        onSelect(item.key, item);
      });
      panel.addEventListener('focus', () => setActive(i));
      panel.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setActive((i + 1) % items.length); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setActive((i - 1 + items.length) % items.length); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item.key, item); }
      });
    });

    function setActive(i){
      if (i === active) return;
      active = i;
      apply();
    }
    function apply(){
      panels.forEach((p, i) => {
        const on = i === active;
        p.classList.toggle('is-active', on);
        p.setAttribute('aria-current', on ? 'true' : 'false');
        const drift = Math.max(-1.5, Math.min(1.5, active - i));
        if (mediaEls[i] && !reduced) mediaEls[i].style.setProperty('--ag-drift', (drift * 8) + 'px');
        else if (mediaEls[i]) mediaEls[i].style.setProperty('--ag-drift', '0px');
      });
    }
    apply();

    // 清理（返回菜单时销毁）
    return {
      destroy(){
        el.innerHTML = '';
        el.classList.remove('ag', 'ag--v');
      }
    };
  }
  global.AccordionGallery = { init };
})(window);
