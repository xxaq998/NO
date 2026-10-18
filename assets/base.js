/* ============ Logos · 共享交互（触摸 / 滚动 / 陀螺仪） ============ */

/* ---------- 页面作用域：不刷新换页时，旧页面的监听 / 定时器 / 动画循环全部作废 ---------- */
const RAW = {
  setTimeout: setTimeout.bind(window), setInterval: setInterval.bind(window),
  raf: requestAnimationFrame.bind(window),
  on: (t, ...a) => EventTarget.prototype.addEventListener.call(t, ...a)   // 不被回收的监听（音乐用）
};
const SCOPE = (() => {
  let gen = 0; const ls = [], obs = [];
  [window, document].forEach(t => {
    t.addEventListener = (type, fn, o) => { ls.push([t, type, fn, o]); RAW.on(t, type, fn, o); };
  });
  window.setTimeout = (fn, ms, ...a) => { const g = gen; return RAW.setTimeout(() => { if (g === gen) fn(...a); }, ms); };
  window.setInterval = (fn, ms, ...a) => { const g = gen; const id = RAW.setInterval(() => { if (g === gen) fn(...a); else clearInterval(id); }, ms); return id; };
  window.requestAnimationFrame = fn => { const g = gen; return RAW.raf(t => { if (g === gen) fn(t); }); };
  ['IntersectionObserver', 'MutationObserver', 'ResizeObserver'].forEach(k => {
    const O = window[k]; if (!O) return;
    window[k] = class extends O { constructor(...a) { super(...a); obs.push(this); } };
  });
  return {
    reset() {
      gen++;
      ls.splice(0).forEach(([t, type, fn, o]) => t.removeEventListener(type, fn, o));
      obs.splice(0).forEach(o => o.disconnect());
    }
  };
})();

const V = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const buzz = ms => navigator.vibrate && navigator.vibrate(ms);

  /* ---------- 陀螺仪：tilt.x / tilt.y ∈ [-1, 1]，已平滑 ---------- */
  const tilt = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  function onOrient(e) {
    if (e.gamma == null) return;
    tilt.on = true;
    tilt.tx = clamp(e.gamma / 30, -1, 1);
    tilt.ty = clamp((e.beta - 45) / 30, -1, 1);
  }
  let lastShake = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity; if (!a) return;
    const f = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z);
    if (f > 38 && Date.now() - lastShake > 1200) { lastShake = Date.now(); dispatchEvent(new Event('logos:shake')); }
  }
  function listenSensors() {
    addEventListener('deviceorientation', onOrient);
    addEventListener('devicemotion', onMotion);
  }
  let granted = false;                                   // iOS 授权过一次就不再弹提示（换页后直接重新监听）
  function sensors() {
    const needAsk = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!needAsk || granted) { listenSensors(); return; }
    if (localStorage.getItem('logos-gyro') === 'no') return;
    // iOS：必须在用户点击中申请
    const tip = document.createElement('div');
    tip.className = 'gyro-tip';
    tip.innerHTML = '<span>开启重力感应，体验更好</span><button>开启</button><button class="x">✕</button>';
    document.body.append(tip);
    setTimeout(() => tip.classList.add('show'), 2600);
    tip.querySelector('button').addEventListener('click', async () => {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission();
        if (r === 'granted') { granted = true; listenSensors(); toast('倾斜手机看看'); }
      } catch (e) {}
      tip.classList.remove('show');
    });
    tip.querySelector('.x').addEventListener('click', () => { tip.classList.remove('show'); localStorage.setItem('logos-gyro', 'no'); });
  }

  /* ---------- 星空：视差 / 触摸星座 / 拖尾 / 流星 ---------- */
  function sky(opts = {}) {
    const cv = document.createElement('canvas');
    cv.id = 'sky'; document.body.prepend(cv);
    const ctx = cv.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let W, H, stars = [], meteors = [], rings = [], dust = [], links = [];
    const density = opts.density || 1;

    function resize() {
      W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((W * H) / 5200 * density);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H, z: Math.random() * .9 + .1,
        r: Math.random() * 1.1 + .2, p: Math.random() * 6.28, s: Math.random() * .02 + .005, sx: 0, sy: 0
      }));
    }
    resize(); addEventListener('resize', resize);

    // 触摸：涟漪 + 连接附近星星
    addEventListener('pointerdown', e => {
      rings.push({ x: e.clientX, y: e.clientY, r: 0, a: .6 });
      const near = stars.map(s => ({ s, d: Math.hypot(s.sx - e.clientX, s.sy - e.clientY) }))
        .filter(o => o.d < 130).sort((a, b) => a.d - b.d).slice(0, 6);
      for (let i = 1; i < near.length; i++) links.push({ a: near[i - 1].s, b: near[i].s, life: 1 });
      near.forEach(o => { o.s.boost = 1; links.push({ a: { sx: e.clientX, sy: e.clientY, fixed: true }, b: o.s, life: .7 }); });
    }, { passive: true });
    addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && !e.buttons) return;
      for (let i = 0; i < 2; i++) dust.push({ x: e.clientX, y: e.clientY, vx: (Math.random() - .5) * 1.2, vy: (Math.random() - .5) * 1.2 - .3, life: 1, r: Math.random() * 1.6 + .4 });
    }, { passive: true });

    function frame() {
      ctx.clearRect(0, 0, W, H);
      const sy0 = scrollY;
      for (const s of stars) {
        s.p += s.s;
        let y = (s.y - sy0 * .06 * s.z) % H; if (y < 0) y += H;
        s.sx = s.x + tilt.x * 26 * s.z; s.sy = y + tilt.y * 26 * s.z;
        s.boost = (s.boost || 0) * .97;
        const a = .2 + Math.sin(s.p) * .22 + s.z * .4 + s.boost * .6;
        ctx.fillStyle = `rgba(150,222,255,${Math.min(1, a)})`;
        ctx.beginPath(); ctx.arc(s.sx, s.sy, s.r * (s.z + .3) * (1 + s.boost * 1.5), 0, 6.28); ctx.fill();
      }
      for (let i = links.length - 1; i >= 0; i--) {
        const l = links[i]; l.life -= .012;
        ctx.strokeStyle = `rgba(35,52,80,${Math.max(0, l.life) * .4})`; ctx.lineWidth = .6;
        ctx.beginPath(); ctx.moveTo(l.a.sx, l.a.sy); ctx.lineTo(l.b.sx, l.b.sy); ctx.stroke();
        if (l.life <= 0) links.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.r += (60 - r.r) * .06 + .4; r.a *= .95;
        ctx.strokeStyle = `rgba(150,222,255,${r.a})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.28); ctx.stroke();
        if (r.a < .02) rings.splice(i, 1);
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i]; d.x += d.vx; d.y += d.vy; d.life -= .02;
        ctx.fillStyle = `rgba(150,222,255,${Math.max(0, d.life)})`;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.28); ctx.fill();
        if (d.life <= 0) dust.splice(i, 1);
      }
      if (Math.random() < .005) meteors.push({ x: Math.random() * W * .6 + W * .4, y: Math.random() * H * .4, l: 1 });
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]; m.x -= 7; m.y += 4; m.l -= .02;
        const g = ctx.createLinearGradient(m.x, m.y, m.x + 90, m.y - 50);
        g.addColorStop(0, `rgba(150,222,255,${m.l})`); g.addColorStop(1, 'rgba(150,222,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + 90, m.y - 50); ctx.stroke();
        if (m.l <= 0) meteors.splice(i, 1);
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  /* ---------- 每帧：陀螺仪平滑 + [data-gyro] 视差 / [data-tilt] 倾斜 ---------- */
  function motionLoop() {
    let par = [], tl = [], k = 0;
    (function f() {
      if (k++ % 60 === 0) { par = $$('[data-gyro]'); tl = $$('[data-tilt]'); }
      tilt.x += (tilt.tx - tilt.x) * .08; tilt.y += (tilt.ty - tilt.y) * .08;
      for (const el of par) { const d = +el.dataset.gyro; el.style.translate = `${tilt.x * d}px ${tilt.y * d}px`; }
      for (const el of tl) {
        if (el._touching) continue;
        const m = +el.dataset.tilt || 10;
        el.style.transform = `perspective(900px) rotateY(${tilt.x * m}deg) rotateX(${-tilt.y * m}deg)`;
        el.style.setProperty('--gx', (50 + tilt.x * 50) + '%'); el.style.setProperty('--gy', (50 + tilt.y * 50) + '%');
      }
      requestAnimationFrame(f);
    })();
  }

  /* ---------- 顶栏 + 菜单 ---------- */
  // ✏️ 话术 / 冠名 / 板评 点开后跳转的文档链接（首页入口卡片和菜单共用，网页上不显示链接）
  const DOCS = {
    lines: 'https://www.kdocs.cn/l/cizChTagXBDk',
    naming: 'https://www.kdocs.cn/l/cgBbAsYfN5z7',
    reviews: 'https://www.kdocs.cn/l/cldx6QsDmR3c'
  };
  const LINKS = [
    ['index.html#about', '自述', 'About'], ['index.html#style', '风格', 'Style'], ['index.html#notice', '须知', 'Notice'],
    ['doc:lines', '话术', 'Lines'], ['doc:reviews', '板评', 'Reviews'], ['doc:naming', '冠名', 'Naming']
  ];
  function chrome(sub) {
    // ✏️ 下面 class="logo" 那行是左上角 logo 的名字（所有页面共用）
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="bar" id="bar"><a class="logo" href="index.html">Logos<sup>${sub || ''}</sup></a>
        <button class="burger" id="burger" aria-label="菜单"><i></i><i></i></button></div>
      <nav class="menu" id="menu">
        ${LINKS.map(([h, c, e], i) => `<a ${h.startsWith('doc:') ? `data-doc="${h.slice(4)}"` : `href="${h}"`}><span class="n">0${i + 1}</span><span class="c">${c}</span><span class="e">${e}</span></a>`).join('')}
        <p class="m-foot">单内单外两个人 · 结束之后单外查无此人</p>
      </nav>`);
    const toggle = force => { const o = document.body.classList.toggle('menu-open', force); document.body.classList.toggle('lock', o); buzz(8); };
    $('#burger').addEventListener('click', () => toggle());
    $$('#menu a').forEach(a => a.addEventListener('click', () => toggle(false)));
    let ly = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY, bar = $('#bar');
      bar.classList.toggle('hide', y > ly && y > 120 && !document.body.classList.contains('menu-open'));
      bar.classList.toggle('solid', y > 60);
      ly = y;
    }, { passive: true });
  }

  /* ---------- 页面转场 ---------- */
  function veil() {
    const v = document.createElement('div');
    v.className = 'veil';
    // ✏️ 换页动画中间显示的名字
    v.innerHTML = '<i></i><i></i><i></i><i></i><span class="mark">Logos</span>';
    document.body.append(v);
    requestAnimationFrame(() => setTimeout(() => v.classList.add('open'), 80));
    document.addEventListener('click', e => {
      const d = e.target.closest('[data-doc]');             // 文档入口：等动画放完再跳转
      if (d) { setTimeout(() => { location.href = DOCS[d.dataset.doc]; }, +(d.dataset.delay || 0)); return; }
      const a = e.target.closest('a[href]');
      if (!a || a.target) return;
      const url = new URL(a.href, location.href);
      if (url.pathname === location.pathname) {           // 同页锚点：平滑滚动
        if (url.hash) { e.preventDefault(); setTimeout(() => $(url.hash)?.scrollIntoView({ behavior: 'smooth' }), 350); }
        return;
      }
      e.preventDefault();
      const delay = +(a.dataset.delay || 0);
      setTimeout(() => {
        v.classList.remove('open'); v.classList.add('close');
        setTimeout(() => go(a.href), 900);
      }, delay);
    });
    addEventListener('pageshow', e => { if (e.persisted) { v.classList.remove('close'); v.classList.add('open'); } });
  }

  /* ---------- 不刷新换页：取回新页面，把内容换进来，音乐所在的页面从不关闭 ---------- */
  const KEEP = [];                                       // 换页时要留下的元素（音乐按钮）
  let curPath = location.pathname, busy = false;
  history.scrollRestoration = 'manual';
  async function go(href, push = true) {
    if (busy) return; busy = true;
    const url = new URL(href, location.href);
    let doc;
    try {
      const res = await fetch(url.href.split('#')[0]);
      if (!res.ok) throw 0;
      doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    } catch (e) { location.href = url.href; return; }   // 取不到（比如双击打开的本地文件）就普通跳转
    if (push) {
      history.replaceState({ ...history.state, y: scrollY }, '');   // 记住离开时的位置，返回时回到这里
      history.pushState({}, '', url.href);
    }
    // 1. 作废旧页面
    SCOPE.reset(); tEl = null;
    // 2. 换 <head> 里的页面样式、标题
    $$('head style').forEach(s => s.remove());
    $$('head style', doc).forEach(s => document.head.append(s));
    document.title = doc.title;
    // 3. 换 <body>；脚本先拿出来，等内容放好再执行
    const scripts = $$('script', doc.body).map(s => { s.remove(); return s; });
    document.documentElement.replaceChild(document.adoptNode(doc.body), document.body);
    curPath = location.pathname;
    scrollTo(0, 0);
    scripts.forEach(s => {
      if (s.src && /assets\/base\.js/.test(s.src)) return;    // 共享脚本已经在了
      const n = document.createElement('script');
      if (s.src) { n.src = s.getAttribute('src'); n.async = false; }
      else n.textContent = '{\n' + s.textContent + '\n}';  // 包一层块，重复进入同一页时变量名不冲突
      document.body.append(n);
    });
    KEEP.forEach(el => document.body.append(el));
    const y = !push && history.state && history.state.y;
    if (y) scrollTo(0, y);
    else if (url.hash) { const t = $(url.hash); t && t.scrollIntoView(); }
    busy = false;
  }
  RAW.on(window, 'popstate', () => {
    if (location.pathname !== curPath) go(location.href, false);
  });

  /* ---------- 文字拆分 ---------- */
  function splitChars(el, step = 40, base = 0) {
    const text = el.textContent; el.textContent = '';
    [...text].forEach((c, i) => {
      const s = document.createElement('span');
      s.className = 'ch'; s.textContent = c;
      s.style.transitionDelay = (base + i * step) + 'ms';
      el.append(s);
    });
  }

  /* ---------- 滚动显现 ---------- */
  let io;
  function observe(els) { els.forEach(el => io.observe(el)); }
  function reveal() {
    $$('[data-split]').forEach(el => splitChars(el, +el.dataset.split || 40));
    io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .2, rootMargin: '0px 0px -8% 0px' });
    observe($$('[data-reveal],[data-split],[data-io],.sec-head'));
  }

  /* ---------- 间奏：随滚动逐字点亮 ---------- */
  function interludes() {
    const list = $$('.interlude').map(sec => {
      const ws = [];
      $$('.vt', sec).forEach(p => {
        const nodes = [...p.childNodes]; p.textContent = '';
        nodes.forEach(n => {
          const red = n.nodeType === 1;
          [...n.textContent].forEach(c => {
            const s = document.createElement('span'); s.className = 'w' + (red ? ' red' : ''); s.textContent = c;
            p.append(s); ws.push(s);
          });
        });
      });
      return { sec, ws };
    });
    const u = () => list.forEach(({ sec, ws }) => {
      const r = sec.getBoundingClientRect();
      const p = clamp((-r.top + innerHeight * .3) / (r.height - innerHeight * .6), 0, 1);
      const n = Math.round(p * ws.length);
      ws.forEach((w, i) => w.classList.toggle('lit', i < n));
    });
    addEventListener('scroll', u, { passive: true }); u();
  }

  /* ---------- 乱码解码 ---------- */
  // ✏️ 文字乱码动画会用到的字，末尾可以换成自己的英文名大写
  const GLYPHS = '钓坏逗权锋心言理陷▓▒░/|_<>*#LOGOS';
  function scramble(el, to, dur = 900) {
    return new Promise(res => {
      const len = Math.max(el.textContent.length, to.length);
      const q = Array.from({ length: len }, (_, i) => ({ to: to[i] || '', start: Math.random() * dur * .4, end: dur * .4 + Math.random() * dur * .6 }));
      const t0 = performance.now();
      (function f(now) {
        const t = now - t0; let out = '', done = 0;
        for (const c of q) {
          if (t >= c.end) { out += c.to; done++; }
          else if (t >= c.start) out += `<span style="color:var(--blood-l)">${GLYPHS[Math.random() * GLYPHS.length | 0]}</span>`;
          else out += '<span style="opacity:.2">·</span>';
        }
        el.innerHTML = out;
        done === q.length ? (el.textContent = to, res()) : requestAnimationFrame(f);
      })(t0);
    });
  }

  /* ---------- 滚动进度 ---------- */
  function progress() {
    const p = document.createElement('div'); p.className = 'progress'; p.innerHTML = '<i></i>'; document.body.append(p);
    const i = p.firstChild;
    const u = () => { const h = document.documentElement.scrollHeight - innerHeight; i.style.transform = `scaleY(${h > 0 ? scrollY / h : 0})`; };
    addEventListener('scroll', u, { passive: true }); u();
  }

  /* ---------- toast ---------- */
  let tEl, tTimer;
  function toast(msg) {
    if (!tEl) { tEl = document.createElement('div'); tEl.className = 'toast'; document.body.append(tEl); }
    tEl.textContent = msg; tEl.classList.add('show');
    clearTimeout(tTimer); tTimer = setTimeout(() => tEl.classList.remove('show'), 2200);
  }

  /* ---------- 防复制 ---------- */
  function guard() {
    document.body.classList.add('no-copy');
    const w = document.createElement('div'); w.className = 'watermark'; document.body.append(w);
    ['contextmenu', 'copy', 'cut', 'dragstart'].forEach(ev => document.addEventListener(ev, e => {
      e.preventDefault(); toast('别偷我话术哦 · 每单都有记录');
    }));
  }

  /* ---------- 背景音乐：左下角唱片按钮，跨页面接着放 ---------- */
  // ✏️ 背景音乐：把音乐文件放在 html 同一个文件夹，src 写文件名
  const MUSIC = { src: 'brave.mp3', volume: .6 };   // ← 换歌改这里（路径相对于 html 文件）
  let musicOn = false;
  function music() {
    if (musicOn) return;                                 // 换页后再次 init：音乐已经在放，不重复创建
    musicOn = true;
    const a = new Audio(MUSIC.src);
    a.loop = true; a.preload = 'auto'; a.volume = 0;
    const btn = document.createElement('button');
    btn.className = 'music'; btn.setAttribute('aria-label', '背景音乐');
    btn.innerHTML = '<span class="disc"></span><span class="eq"><i></i><i></i><i></i></span>';
    document.body.append(btn); KEEP.push(btn);
    const t = +sessionStorage.getItem('logos-music-t');   // 刷新前播到哪了
    if (t) a.addEventListener('loadedmetadata', () => { a.currentTime = t % (a.duration || Infinity); }, { once: true });
    let fadeT;
    const fadeTo = (v, then) => {
      clearInterval(fadeT);
      fadeT = RAW.setInterval(() => {
        a.volume = clamp(a.volume + (v > a.volume ? .04 : -.06), 0, 1);
        if (Math.abs(a.volume - v) < .06) { a.volume = v; clearInterval(fadeT); then && then(); }
      }, 50);
    };
    const sync = () => btn.classList.toggle('on', !a.paused);
    a.addEventListener('play', sync); a.addEventListener('pause', sync);
    const play = () => a.play().then(() => fadeTo(MUSIC.volume)).catch(() => {});
    const stop = () => fadeTo(0, () => a.pause());
    btn.addEventListener('click', e => {
      e.stopPropagation(); buzz(8);
      if (a.paused) { localStorage.removeItem('logos-music'); play(); }
      else { localStorage.setItem('logos-music', 'off'); stop(); toast('音乐已关闭'); }
    });
    if (localStorage.getItem('logos-music') === 'off') return;   // 用户主动关过，就不再自动放
    // 浏览器不允许无交互自动播放：先试一次，不行就等第一次触摸 / 点击
    // 手机上只有"手指抬起 / 点击"才算数（按下、滑动都不算），所以监听 touchend / click，放成功了才撤掉
    const EVS = ['touchend', 'pointerup', 'click', 'keydown'];
    const first = e => {
      if (e.target.closest && e.target.closest('.music')) return;
      if (!a.paused || localStorage.getItem('logos-music') === 'off') { EVS.forEach(ev => removeEventListener(ev, first, true)); return; }
      a.play().then(() => { EVS.forEach(ev => removeEventListener(ev, first, true)); fadeTo(MUSIC.volume); }).catch(() => {});
    };
    a.play().then(() => fadeTo(MUSIC.volume)).catch(() => EVS.forEach(ev => RAW.on(window, ev, first, true)));
    // 微信 / QQ 内置浏览器：这个事件里允许直接自动播放
    const wx = () => window.WeixinJSBridge && WeixinJSBridge.invoke('getNetworkType', {}, () => play());
    window.WeixinJSBridge ? wx() : RAW.on(document, 'WeixinJSBridgeReady', wx);
    // 切到后台暂停，回来继续；刷新 / 关闭前记下进度
    let wasOn = false;
    RAW.on(document, 'visibilitychange', () => {
      if (document.hidden) { wasOn = !a.paused; a.pause(); } else if (wasOn) play();
    });
    RAW.on(window, 'pagehide', () => sessionStorage.setItem('logos-music-t', a.currentTime));
  }

  function init(opts = {}) {
    chrome(opts.sub); sky(opts.sky); veil(); reveal(); interludes(); progress(); sensors(); motionLoop(); music();
    document.body.insertAdjacentHTML('beforeend', '<div class="grain"></div>');
    if (opts.guard) guard();
  }

  return { init, $, $$, clamp, buzz, scramble, splitChars, observe, toast, tilt };
})();
