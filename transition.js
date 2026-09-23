(() => {
  'use strict';

  // Scene documents inside the persistent shell do not navigate themselves.
  // They ask the parent to run the full-screen transition and swap the iframe.
  if (window.parent && window.parent !== window && window.parent.ScarletShell) {
    document.documentElement.classList.remove('scene-wipe-pending');
    try {
      sessionStorage.removeItem('entanglement:wipe-open');
      sessionStorage.removeItem('entanglement:wipe-config');
    } catch (_) {}
    window.sceneWipeNavigate = (url) => window.parent.ScarletShell.navigate(url);
    window.sceneWipeBusy = () => window.parent.ScarletShell.isBusy();
    return;
  }

  const STORAGE_KEY = 'entanglement:wipe-open';
  const CONFIG_KEY = 'entanglement:wipe-config';
  const sceneFrame = document.getElementById('sceneFrame');
  const shellMode = !!sceneFrame;
  let busy = false;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    try {
      const u = new Uint32Array(1);
      crypto.getRandomValues(u);
      return u[0] || 1;
    } catch (_) {
      return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0 || 1;
    }
  }

  function shuffle(array, rnd) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildConfig(seed = randomSeed()) {
    const rnd = mulberry32(seed);
    const count = 34;
    const raw = [];
    for (let i = 0; i < count; i++) {
      let weight;
      const r = rnd();
      if (i % 8 === 0 || r < 0.10) weight = 4.3 + rnd() * 4.6;
      else if (i % 6 === 0 || r < 0.28) weight = 0.35 + rnd() * 0.65;
      else weight = 1.25 + rnd() * 2.65;
      raw.push(weight);
    }

    const total = raw.reduce((a, b) => a + b, 0);
    const widths = raw.map(v => (v / total) * 100);
    const closeOrder = shuffle([...Array(count).keys()], rnd);
    const openOrder = shuffle([...Array(count).keys()], rnd);
    const closeRank = Array(count);
    const openRank = Array(count);
    closeOrder.forEach((idx, rank) => { closeRank[idx] = rank; });
    openOrder.forEach((idx, rank) => { openRank[idx] = rank; });

    const bars = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = widths[i];
      let dir = rnd() < 0.5 ? -1 : 1;
      if (i > 0 && dir === bars[i - 1].dir && rnd() < 0.58) dir *= -1;
      const cRank = closeRank[i];
      const oRank = openRank[i];
      const closeWave = Math.floor(cRank / 4);
      const openWave = Math.floor(oRank / 4);
      const closeDelay = closeWave * (72 + rnd() * 14) + (cRank % 4) * (10 + rnd() * 14) + rnd() * 24;
      const openDelay = openWave * (74 + rnd() * 15) + (oRank % 4) * (9 + rnd() * 15) + rnd() * 26;
      const closeDur = 390 + rnd() * 210 + (w > 5 ? 55 : 0);
      const openDur = 405 + rnd() * 220 + (w > 5 ? 45 : 0);
      bars.push({ x, w, dir, closeDelay, closeDur, openDelay, openDur });
      x += w;
    }
    return { seed, bars };
  }

  function offscreenTransform(bar) {
    if (bar.dir < 0) return `translate3d(${-bar.x - bar.w - 16}vw,0,0)`;
    return `translate3d(${116 - bar.x}vw,0,0)`;
  }

  function makeOverlay(config, closed) {
    const overlay = document.createElement('div');
    overlay.className = 'scene-wipe is-blocking';
    overlay.setAttribute('aria-hidden', 'true');
    config.bars.forEach((b, i) => {
      const bar = document.createElement('div');
      bar.className = 'scene-wipe__bar';
      bar.dataset.index = String(i);
      bar.style.left = `${b.x}vw`;
      bar.style.width = `calc(${b.w}vw + 2px)`;
      bar.style.transform = closed ? 'translate3d(0,0,0)' : offscreenTransform(b);
      overlay.appendChild(bar);
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function animateCloseBar(el, bar) {
    const overshoot = bar.dir < 0 ? '0.7vw' : '-0.7vw';
    return el.animate([
      { transform: el.style.transform, offset: 0 },
      { transform: `translate3d(${overshoot},0,0)`, offset: 0.90 },
      { transform: 'translate3d(0,0,0)', offset: 1 }
    ], {
      duration: bar.closeDur,
      delay: bar.closeDelay,
      easing: 'cubic-bezier(.16,.82,.20,1)',
      fill: 'forwards'
    }).finished.catch(() => {});
  }

  function animateOpenBar(el, bar) {
    const target = offscreenTransform(bar);
    const kick = bar.dir < 0 ? '-0.85vw' : '0.85vw';
    return el.animate([
      { transform: 'translate3d(0,0,0)', offset: 0 },
      { transform: `translate3d(${kick},0,0)`, offset: 0.09 },
      { transform: target, offset: 1 }
    ], {
      duration: bar.openDur,
      delay: bar.openDelay,
      easing: 'cubic-bezier(.34,.02,.18,1)',
      fill: 'forwards'
    }).finished.catch(() => {});
  }

  async function shellNavigate(url) {
    if (busy || !sceneFrame) return;
    busy = true;
    const config = buildConfig();
    const overlay = makeOverlay(config, false);
    const els = [...overlay.children];
    await Promise.all(els.map((el, i) => animateCloseBar(el, config.bars[i])));
    await new Promise(r => setTimeout(r, 170));

    const target = new URL(url, location.href);
    const pageName = target.pathname.split('/').pop() || 'cover.html';

    await new Promise(resolve => {
      const done = () => {
        sceneFrame.removeEventListener('load', done);
        resolve();
      };
      sceneFrame.addEventListener('load', done, { once: true });
      sceneFrame.src = target.href;
    });

    window.ScarletAudio?.notifyScene?.(pageName);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(r => setTimeout(r, 150));
    await Promise.all(els.map((el, i) => animateOpenBar(el, config.bars[i])));
    overlay.remove();
    busy = false;
  }

  // Standalone fallback keeps the old full-document navigation behaviour.
  function saveConfig(config) {
    try { sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch (_) {}
  }
  function loadConfig() {
    try {
      const raw = sessionStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.bars) || !parsed.bars.length) return null;
      return parsed;
    } catch (_) { return null; }
  }

  async function standaloneNavigate(url) {
    if (busy) return;
    busy = true;
    const config = buildConfig();
    saveConfig(config);
    const overlay = makeOverlay(config, false);
    const els = [...overlay.children];
    await Promise.all(els.map((el, i) => animateCloseBar(el, config.bars[i])));
    await new Promise(r => setTimeout(r, 170));
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
    window.location.href = url;
  }

  async function playOpeningIfNeeded() {
    if (shellMode) return;
    let shouldOpen = false;
    try {
      shouldOpen = sessionStorage.getItem(STORAGE_KEY) === '1';
      if (shouldOpen) sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    if (!shouldOpen) {
      document.documentElement.classList.remove('scene-wipe-pending');
      return;
    }
    busy = true;
    const config = loadConfig() || buildConfig(0xE17A6E);
    const overlay = makeOverlay(config, true);
    const els = [...overlay.children];
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.classList.remove('scene-wipe-pending');
    await new Promise(r => setTimeout(r, 150));
    await Promise.all(els.map((el, i) => animateOpenBar(el, config.bars[i])));
    overlay.remove();
    try { sessionStorage.removeItem(CONFIG_KEY); } catch (_) {}
    busy = false;
  }

  const navigate = shellMode ? shellNavigate : standaloneNavigate;
  window.sceneWipeNavigate = navigate;
  window.sceneWipeBusy = () => busy;

  if (shellMode) {
    window.ScarletShell = {
      navigate,
      isBusy: () => busy,
      frame: sceneFrame
    };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', playOpeningIfNeeded, { once: true });
  } else {
    playOpeningIfNeeded();
  }
})();
