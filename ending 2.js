const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;

const canvas = document.getElementById('pixelCanvas');
const ctx = canvas.getContext('2d', { alpha: true });
const copy = document.getElementById('copy');
const storyLayer = document.getElementById('storyLayer');
const endingContinue = document.getElementById('endingContinue');
const finalLayer = document.getElementById('finalLayer');
const startOver = document.getElementById('startOver');

const PIXEL = 4;
const SAMPLE_STEP = 4;
const PARTICLE_ALPHA = 0.96;

const OUT_DURATION = 1450;
const OUT_STAGGER = 260;
const IN_DELAY = 1300;
const IN_DURATION = 1650;
const IN_STAGGER = 300;
const HANDOFF_DURATION = 260;

const TEXTS = [
  {
    top: 234,
    left: 153,
    align: 'left',
    lines: [
      'Did you notice?',
      'It was never really them holding you back.',
      'Every thread wrapped around you',
      'was something you once asked for.'
    ]
  },
  {
    top: 484,
    left: 770,
    align: 'right',
    lines: [
      'You wanted love to become something perfect.',
      'And somewhere along the way,',
      'those expectations became the very thing that trapped you.'
    ]
  },
  {
    top: 705,
    left: 153,
    align: 'left',
    lines: [
      'You wanted love to become something perfect.',
      'And somewhere along the way,',
      'those expectations became the very thing that trapped you.'
    ]
  },
  {
    top: 374,
    left: 288,
    align: 'center',
    lines: [
      'Let love find itself.',
      'Love was never meant to be designed.',
      'Maybe love is simply two imperfect souls — choosing to grow toward each other.',
      'A thread should connect two people.',
      'Not tie them down.'
    ]
  }
];

let dpr = 1;
let width = 0;
let height = 0;
let index = 0;
let outgoing = [];
let incoming = [];
let animating = false;
let transitionStart = 0;
let incomingEndTime = 0;
let incomingDelayBase = 0;
let rafId = null;
let finishing = false;
let endingGuideShown = false;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smootherStep = t => {
  t = clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function fitDesignToWindow() {
  const scale = Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT
  );
  document.documentElement.style.fontSize = `${DESIGN_ROOT_PX * scale}px`;
}

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function setCopyState(stateIndex) {
  const item = TEXTS[stateIndex];
  copy.style.top = `${item.top / 16}rem`;
  copy.style.left = `${item.left / 16}rem`;
  copy.classList.toggle('align-right', item.align === 'right');
  copy.classList.toggle('align-center', item.align === 'center');
  copy.innerHTML = item.lines.map(line => `<span>${escapeHtml(line)}</span>`).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function randomGaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function getTextMaskPoints() {
  const rect = copy.getBoundingClientRect();
  const spans = [...copy.querySelectorAll('span')];

  // Use the actual rendered glyph bounds of every line, not the width of the
  // block-level <span>. A block span fills the width of the longest line,
  // which was why short lines previously produced the same rectangular target
  // as long lines. Range#getBoundingClientRect() gives us the true rendered
  // Alagard text width and aligned x-position for each individual line.
  const lineData = spans.map(span => {
    const range = document.createRange();
    range.selectNodeContents(span);
    const textRect = range.getBoundingClientRect();
    range.detach?.();

    const style = getComputedStyle(span);
    return {
      text: span.textContent || '',
      rect: textRect,
      fontSize: parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily
    };
  }).filter(line => line.text.length && line.rect.width > 0 && line.rect.height > 0);

  if (!lineData.length) return [];

  const bounds = lineData.reduce((acc, line) => ({
    left: Math.min(acc.left, line.rect.left),
    top: Math.min(acc.top, line.rect.top),
    right: Math.max(acc.right, line.rect.right),
    bottom: Math.max(acc.bottom, line.rect.bottom)
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

  const pad = 16;
  const originX = Math.floor(bounds.left - pad);
  const originY = Math.floor(bounds.top - pad);
  const maskW = Math.max(1, Math.ceil(bounds.right - bounds.left + pad * 2));
  const maskH = Math.max(1, Math.ceil(bounds.bottom - bounds.top + pad * 2));

  const mask = document.createElement('canvas');
  mask.width = maskW;
  mask.height = maskH;

  const mctx = mask.getContext('2d', { willReadFrequently: true });
  mctx.clearRect(0, 0, maskW, maskH);
  mctx.fillStyle = '#000';
  mctx.textAlign = 'left';
  mctx.textBaseline = 'top';
  mctx.fontKerning = 'normal';
  mctx.textRendering = 'geometricPrecision';

  lineData.forEach(line => {
    mctx.font = `${line.fontStyle} ${line.fontWeight} ${line.fontSize}px ${line.fontFamily}`;

    // Canvas and DOM use the same loaded Alagard file. The tiny scaleX
    // correction removes any browser text-metric rounding difference while
    // preserving the exact real line length from the DOM layout.
    const naturalWidth = Math.max(mctx.measureText(line.text).width, 0.001);
    const targetWidth = line.rect.width;
    const scaleX = targetWidth / naturalWidth;

    const x = line.rect.left - originX;
    const y = line.rect.top - originY;

    mctx.save();
    mctx.translate(x, y);
    mctx.scale(scaleX, 1);
    mctx.fillText(line.text, 0, 0);
    mctx.restore();
  });

  const data = mctx.getImageData(0, 0, maskW, maskH).data;
  const points = [];

  for (let y = 0; y < maskH; y += SAMPLE_STEP) {
    for (let x = 0; x < maskW; x += SAMPLE_STEP) {
      let maxAlpha = 0;
      const yMax = Math.min(y + SAMPLE_STEP, maskH);
      const xMax = Math.min(x + SAMPLE_STEP, maskW);

      for (let sy = y; sy < yMax; sy++) {
        for (let sx = x; sx < xMax; sx++) {
          const a = data[(sy * maskW + sx) * 4 + 3];
          if (a > maxAlpha) maxAlpha = a;
        }
      }

      if (maxAlpha > 70) {
        points.push({
          x: originX + x + PIXEL / 2,
          y: originY + y + PIXEL / 2
        });
      }
    }
  }

  return points;
}

function makeOutgoing(points) {
  const cx = width / 2;
  return points.map(p => {
    const normalizedX = (p.x - cx) / Math.max(width * 0.5, 1);
    const spread = clamp(randomGaussian(), -2.1, 2.1);
    const sideDrift = normalizedX * (55 + Math.random() * 105) + spread * 24;

    return {
      x0: p.x,
      y0: p.y,
      x1: p.x + sideDrift,
      y1: -55 - Math.random() * height * 0.28,
      delay: Math.random() * OUT_STAGGER,
      wobble: (Math.random() - 0.5) * 38,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.8 + Math.random() * 0.2
    };
  });
}

function makeIncoming(points) {
  const cx = width / 2;
  return points.map(p => {
    const normalizedX = (p.x - cx) / Math.max(width * 0.5, 1);
    const spread = clamp(randomGaussian(), -2.2, 2.2);

    return {
      x0: p.x + normalizedX * (70 + Math.random() * 105) + spread * 28,
      y0: height + 45 + Math.random() * height * 0.28,
      x1: p.x,
      y1: p.y,
      delay: Math.random() * IN_STAGGER,
      wobble: (Math.random() - 0.5) * 44,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.78 + Math.random() * 0.22
    };
  });
}

function drawParticle(x, y, alpha) {
  ctx.globalAlpha = alpha * PARTICLE_ALPHA;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(
    Math.round(x - PIXEL / 2),
    Math.round(y - PIXEL / 2),
    PIXEL,
    PIXEL
  );
}

function drawOutgoing(p, elapsed, masterAlpha = 1) {
  const local = clamp((elapsed - p.delay) / OUT_DURATION, 0, 1);
  if (local <= 0 || local >= 1) return local;

  const t = smootherStep(local);
  const arc = Math.sin(Math.PI * t);
  const x = lerp(p.x0, p.x1, t)
    + Math.sin(t * Math.PI * 1.8 + p.phase) * p.wobble * arc;
  const y = lerp(p.y0, p.y1, t);
  const fade = 1 - smootherStep(clamp((local - 0.56) / 0.44, 0, 1));
  drawParticle(x, y, p.alpha * fade * masterAlpha);
  return local;
}

function drawIncoming(p, elapsed, masterAlpha = 1) {
  const local = clamp((elapsed - incomingDelayBase - p.delay) / IN_DURATION, 0, 1);
  if (local <= 0) return local;

  const t = smootherStep(local);
  const arc = Math.sin(Math.PI * t);
  const x = lerp(p.x0, p.x1, t)
    + Math.sin((1 - t) * Math.PI * 1.7 + p.phase) * p.wobble * arc;
  const y = lerp(p.y0, p.y1, t);
  const fadeIn = smootherStep(clamp(local / 0.17, 0, 1));
  drawParticle(x, y, p.alpha * fadeIn * masterAlpha);
  return local;
}

function animateTransition(now) {
  const elapsed = now - transitionStart;
  ctx.clearRect(0, 0, width, height);

  const handoffT = clamp((elapsed - incomingEndTime) / HANDOFF_DURATION, 0, 1);
  const canvasAlpha = 1 - smootherStep(handoffT);
  const copyAlpha = smootherStep(handoffT);

  for (const p of outgoing) drawOutgoing(p, elapsed, canvasAlpha);
  for (const p of incoming) drawIncoming(p, elapsed, canvasAlpha);

  ctx.globalAlpha = 1;
  copy.style.opacity = String(copyAlpha);

  if (handoffT >= 1) {
    finishTransition();
    return;
  }

  rafId = requestAnimationFrame(animateTransition);
}

function finishTransition() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  outgoing = [];
  incoming = [];

  // The pixel target is sampled from this exact DOM text geometry, so when the
  // particles settle and the text takes over there is no size/position jump.
  copy.style.opacity = '1';
  animating = false;

  // The ending guide appears only after the FIRST text has fully assembled.
  if (!endingGuideShown && index === 0) {
    endingGuideShown = true;
    endingContinue.classList.add('is-visible');
  }
}

function startInitialArrival() {
  setCopyState(index);
  copy.style.opacity = '0';
  const targetPoints = getTextMaskPoints();
  outgoing = [];
  incoming = makeIncoming(targetPoints);
  incomingDelayBase = 0;
  incomingEndTime = incoming.reduce((max, p) => Math.max(max, p.delay), 0) + IN_DURATION;
  animating = true;
  transitionStart = performance.now();
  rafId = requestAnimationFrame(animateTransition);
}

function transitionToNextText() {
  if (animating || index >= TEXTS.length - 1) return;

  const outgoingPoints = getTextMaskPoints();
  outgoing = makeOutgoing(outgoingPoints);
  copy.style.opacity = '0';

  index += 1;
  setCopyState(index);
  const targetPoints = getTextMaskPoints();
  incoming = makeIncoming(targetPoints);

  incomingDelayBase = IN_DELAY;
  const maxIncomingDelay = incoming.reduce((max, p) => Math.max(max, p.delay), 0);
  incomingEndTime = IN_DELAY + maxIncomingDelay + IN_DURATION;

  animating = true;
  transitionStart = performance.now();
  rafId = requestAnimationFrame(animateTransition);
}

async function finishStory() {
  if (finishing || animating) return;
  finishing = true;
  storyLayer.classList.add('is-leaving');
  await new Promise(resolve => setTimeout(resolve, 1150));

  storyLayer.style.visibility = 'hidden';
  finalLayer.classList.add('is-visible');
  finalLayer.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => finalLayer.classList.add('show-image'));
  await new Promise(resolve => setTimeout(resolve, 1000));
  finalLayer.classList.add('show-start');
}

window.addEventListener('keydown', event => {
  if (event.repeat || event.key.toLowerCase() !== 'c') return;
  if (finishing || animating) return;

  if (index < TEXTS.length - 1) {
    transitionToNextText();
  } else {
    finishStory();
  }
});

startOver.addEventListener('click', () => {
  window.location.href = './index.html';
});

window.addEventListener('resize', () => {
  fitDesignToWindow();
  resizeCanvas();
  if (animating) {
    finishTransition();
    setCopyState(index);
  }
});

fitDesignToWindow();
resizeCanvas();

const startWhenReady = async () => {
  // Force the supplied Alagard file to be resolved before measuring any glyph.
  // This keeps particle targets and final text on exactly the same font metrics.
  if (document.fonts && document.fonts.load) {
    try {
      await document.fonts.load('500 36px Alagard');
      await document.fonts.ready;
    } catch (_) {}
  }
  startInitialArrival();
};

if (document.readyState === 'complete') {
  startWhenReady();
} else {
  window.addEventListener('load', startWhenReady, { once: true });
}
