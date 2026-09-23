const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;
const AUDIO = window.ScarletAudio;

const introPhase = document.getElementById('introPhase');
const introTextEl = document.getElementById('introText');
const introContinue = document.getElementById('introContinue');
const tearPopup = document.getElementById('tearPopup');
const tearContinue = document.getElementById('tearContinue');

const introFull = "You couldn't hold me like you promised...\n\nIt's alright. You don't have to hold me anymore. I'll hold you.";

const popupLines = [
  'Why are you trying to escape?',
  'Why are you running from me?',
  'Did I do something wrong?',
  "Wasn't I what you wanted?",
  "Don't you love me anymore?",
  'You promised me forever.',
  'Stop trying to get away.',
  "I won't let you go."
];

let phase = 'typing';
let typingToken = 0;
let popupIndex = 0;
let popupTimer = null;
let tearActive = false;
let tearContinueReady = false;
let tearPopupTriggeredThisDrag = false;
let tearCanvasRenderer = null;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fitDesignToWindow() {
  const scale = Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT
  );
  document.documentElement.style.fontSize = `${DESIGN_ROOT_PX * scale}px`;
}
window.addEventListener('resize', fitDesignToWindow);
fitDesignToWindow();

async function typeLeadThenReveal() {
  const token = ++typingToken;
  AUDIO?.stopLoopSfx('scene5-typing');
  AUDIO?.startLoopSfx('typing.mp3','scene5-typing');
  introTextEl.textContent = '';

  // Type the entire message, including the second paragraph.
  for (let i = 1; i <= introFull.length; i++) {
    if (token !== typingToken) { AUDIO?.stopLoopSfx('scene5-typing'); return; }
    introTextEl.textContent = introFull.slice(0, i);
    await wait(48);
  }

  if (token !== typingToken) { AUDIO?.stopLoopSfx('scene5-typing'); return; }
  AUDIO?.stopLoopSfx('scene5-typing');

  // Wait one second after the final period of “you.” before showing the guide.
  await wait(1000);
  if (token !== typingToken) return;

  introContinue.classList.remove('hidden');
  phase = 'intro-ready';
}

async function beginTearPhase() {
  if (phase !== 'intro-ready') return;
  phase = 'tear-transition';
  introContinue.classList.add('hidden');
  introPhase.classList.add('is-leaving');
  await wait(560);
  introPhase.classList.add('hidden');

  tearActive = true;
  phase = 'tear';
  if (tearCanvasRenderer) tearCanvasRenderer.elt.style.display = 'block';

  // Start the ten-second guide timer from the exact moment the thread
  // animation phase begins. Make the prompt state explicit so it also
  // appears reliably on the very first play-through.
  window.setTimeout(() => {
    if (phase !== 'tear') return;
    tearContinueReady = true;
    tearContinue.classList.remove('hidden', 'is-leaving');
    tearContinue.classList.add('is-visible');
    tearContinue.style.display = 'block';
    tearContinue.style.visibility = 'visible';
  }, 10000);

  buildField(true);
}

function showTearPopup() {
  const text = popupLines[popupIndex % popupLines.length];
  popupIndex = (popupIndex + 1) % popupLines.length;

  if (popupTimer) clearTimeout(popupTimer);
  tearPopup.classList.remove('is-visible');
  void tearPopup.offsetWidth;
  tearPopup.textContent = text;
  tearPopup.classList.add('is-visible');

  popupTimer = setTimeout(() => {
    tearPopup.classList.remove('is-visible');
  }, 1450);
}

window.addEventListener('keydown', event => {
  if (event.repeat) return;
  if (event.key.toLowerCase() !== 'c') return;

  if (phase === 'intro-ready') {
    AUDIO?.playSfx('press.wav');
    beginTearPhase();
    return;
  }

  if (phase === 'tear' && tearContinueReady) {
    AUDIO?.playSfx('press.wav');
    phase = 'tear-leaving';
    tearContinueReady = false;
    tearContinue.classList.remove('is-visible');
    tearContinue.classList.add('is-leaving');

    // Let this guide fade out first, then wait a full second before Ending begins.
    setTimeout(() => {
      window.location.href = './ending.html';
    }, 1000);
  }
});

/* =========================================================
   TEAR / REGROW SYSTEM
   This section preserves the behaviour from the supplied
   pixel_chaotic_tear_regrow_v5_more_curved reference.
========================================================= */

let strands = [];
let pg;
let lastPointer;
let currentSeed = 91827;
let fieldBornAt = 0;

const DESKTOP_STRANDS = 190;
const MOBILE_STRANDS = 118;
const POINTS_PER_STRAND = 54;

const RESTORE = 0.010;
const DAMPING = 0.895;
const LINK_STIFFNESS = 0.125;
const BEND_STIFFNESS = 0.048;

const DRAG_RADIUS = 250;
const HOVER_RADIUS = 115;
const TEAR_RADIUS = 62;
const TEAR_MIN_SPEED = 0.12;
const SAG_RADIUS_POINTS = 10;

const REBUILD_DELAY = 1500;
const REBUILD_DURATION = 720;

const INTRO_DURATION = 3000;
const INTRO_STAGGER_END = 2350;

let drawScale = 0.34;

function setup() {
  pixelDensity(1);
  tearCanvasRenderer = createCanvas(windowWidth, windowHeight);
  tearCanvasRenderer.elt.style.display = 'none';
  noSmooth();
  createPixelLayer();
  lastPointer = createVector(mouseX, mouseY);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  createPixelLayer();
  if (tearActive) buildField(false);
}

function createPixelLayer() {
  drawScale = min(width, height) < 700 ? 0.46 : 0.34;
  pg = createGraphics(
    max(260, floor(width * drawScale)),
    max(220, floor(height * drawScale))
  );
  pg.pixelDensity(1);
  pg.noSmooth();
}

function easeOutCubic(t) {
  t = constrain(t, 0, 1);
  return 1 - pow(1 - t, 3);
}

function quadraticPoint(a, c, b, t) {
  const mt = 1 - t;
  return createVector(
    mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
    mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y
  );
}

function boundaryPoint(side, margin) {
  if (side === 0) return createVector(random(-margin, width + margin), -margin);
  if (side === 1) return createVector(width + margin, random(-margin, height + margin));
  if (side === 2) return createVector(random(-margin, width + margin), height + margin);
  return createVector(-margin, random(-margin, height + margin));
}

function chooseBoundaryPair() {
  const startSide = floor(random(4));
  let endSide;
  if (random() < 0.62) {
    endSide = (startSide + 2) % 4;
  } else {
    endSide = (startSide + (random() < 0.5 ? 1 : 3)) % 4;
  }
  return [startSide, endSide];
}

function makeGeometry() {
  const margin = max(width, height) * 0.095;
  const [startSide, endSide] = chooseBoundaryPair();
  const start = boundaryPoint(startSide, margin);
  const end = boundaryPoint(endSide, margin);

  const mid = p5.Vector.lerp(start, end, 0.5);
  const dir = p5.Vector.sub(end, start);
  const normal = createVector(-dir.y, dir.x);
  if (normal.magSq() > 0.001) normal.normalize();

  const perpendicularBend = random(-1, 1) * random(6, 36);
  const downwardSag = random(height * 0.14, height * 0.32);

  const control = mid.copy()
    .add(normal.mult(perpendicularBend))
    .add(createVector(random(-14, 14), downwardSag));

  const basePts = [];
  for (let i = 0; i < POINTS_PER_STRAND; i++) {
    const u = i / (POINTS_PER_STRAND - 1);
    basePts.push(quadraticPoint(start, control, end, u));
  }
  return basePts;
}

function createDynamicPoints(basePts) {
  return basePts.map((p, i) => ({
    base: p.copy(),
    pos: p.copy(),
    vel: createVector(0, 0),
    mass: random(0.92, 1.18),
    pinned: (i === 0 || i === basePts.length - 1) && random() < 0.88,
    driftSeed: random(1000)
  }));
}

function restLengths(points) {
  const rest = [];
  for (let i = 0; i < points.length - 1; i++) {
    rest.push(p5.Vector.dist(points[i].base, points[i + 1].base));
  }
  return rest;
}

function introDelay(index, total) {
  const firstCount = max(9, floor(total * 0.075));
  if (index < firstCount) return index * (850 / firstCount);
  const u = (index - firstCount) / max(1, total - firstCount - 1);
  return lerp(820, INTRO_STAGGER_END, pow(u, 0.68));
}

function makeStrand(index, total, introMode) {
  const basePts = makeGeometry();
  const points = createDynamicPoints(basePts);
  return {
    points,
    rest: restLengths(points),
    broken: new Array(points.length - 1).fill(false),
    alpha: random(95, 225),
    weight: random(0.60, 1.18),
    driftAmp: random(2.2, 8.0),
    revealMode: introMode ? 'intro' : 'normal',
    revealStart: introMode ? fieldBornAt + introDelay(index, total) : 0,
    revealDuration: introMode ? random(430, 690) : 0,
    needsRebuild: false,
    rebuildAt: -1
  };
}

function buildField(isIntro) {
  currentSeed += 7919;
  randomSeed(currentSeed);
  noiseSeed(currentSeed + 332);
  fieldBornAt = millis();
  const count = min(width, height) < 700 ? MOBILE_STRANDS : DESKTOP_STRANDS;
  strands = [];
  for (let i = 0; i < count; i++) strands.push(makeStrand(i, count, isIntro));
}

function rebuildStrand(strand, now) {
  const basePts = makeGeometry();
  const points = createDynamicPoints(basePts);
  strand.points = points;
  strand.rest = restLengths(points);
  strand.broken = new Array(points.length - 1).fill(false);
  strand.alpha = random(95, 225);
  strand.weight = random(0.60, 1.18);
  strand.driftAmp = random(2.2, 8.0);
  strand.revealMode = 'edgeRegrow';
  strand.revealStart = now;
  strand.revealDuration = random(360, 620);
  strand.needsRebuild = false;
  strand.rebuildAt = -1;
}

function draw() {
  background(0);
  if (!tearActive) return;

  const now = millis();
  const pointer = createVector(mouseX, mouseY);
  const delta = p5.Vector.sub(pointer, lastPointer);
  const speed = constrain(delta.mag(), 0, 100);
  lastPointer = pointer.copy();

  updatePhysics(pointer, delta, speed, now);
  processRebuilds(now);
  renderPixelThreads(now);

  noSmooth();
  drawingContext.imageSmoothingEnabled = false;
  image(pg, 0, 0, width, height);
}

function processRebuilds(now) {
  for (const strand of strands) {
    if (strand.needsRebuild && now >= strand.rebuildAt) rebuildStrand(strand, now);
  }
}

function updatePhysics(pointer, delta, speed, now) {
  const t = now * 0.001;

  for (const strand of strands) {
    const pts = strand.points;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const drift = createVector(
        (noise(p.driftSeed, t * 0.07) - 0.5) * strand.driftAmp,
        (noise(p.driftSeed + 100, t * 0.065) - 0.5) * strand.driftAmp
      );
      const target = p5.Vector.add(p.base, drift);

      if (!p.pinned) p.vel.add(p5.Vector.sub(target, p.pos).mult(RESTORE));

      if (!mouseIsPressed) {
        const d = p5.Vector.dist(pointer, p.pos);
        if (d < HOVER_RADIUS) {
          const fall = pow(1 - d / HOVER_RADIUS, 2);
          const away = p5.Vector.sub(p.pos, pointer);
          if (away.magSq() > 0.001) {
            away.setMag(0.14 * fall);
            p.vel.add(away);
          }
        }
      }

      if (mouseIsPressed) {
        const d = p5.Vector.dist(pointer, p.pos);
        if (d < DRAG_RADIUS) {
          const fall = pow(1 - d / DRAG_RADIUS, 1.28);
          if (!p.pinned) {
            p.vel.add(delta.copy().mult(0.24 + fall * 0.68));
            p.vel.add(p5.Vector.sub(pointer, p.pos).mult(0.011 * fall));
            p.vel.y += (0.75 + speed * 0.075) * fall;
          }
        }
      }
    }

    for (let i = 0; i < pts.length - 1; i++) {
      if (strand.broken[i]) continue;
      const a = pts[i];
      const b = pts[i + 1];
      const diff = p5.Vector.sub(b.pos, a.pos);
      const len = max(0.001, diff.mag());
      const stretch = len - strand.rest[i];
      const force = diff.copy().div(len).mult(stretch * LINK_STIFFNESS);
      if (!a.pinned) a.vel.add(force.copy().mult(1 / a.mass));
      if (!b.pinned) b.vel.sub(force.copy().mult(1 / b.mass));
    }

    for (let i = 1; i < pts.length - 1; i++) {
      const avg = p5.Vector.add(pts[i - 1].pos, pts[i + 1].pos).mult(0.5);
      const bend = p5.Vector.sub(avg, pts[i].pos).mult(BEND_STIFFNESS);
      if (!pts[i].pinned) pts[i].vel.add(bend);
    }

    if (mouseIsPressed && speed >= TEAR_MIN_SPEED) {
      for (let i = 0; i < pts.length - 1; i++) {
        if (strand.broken[i]) continue;
        const a = pts[i].pos;
        const b = pts[i + 1].pos;
        const d = segmentDistance(pointer.x, pointer.y, a.x, a.y, b.x, b.y);
        if (d < TEAR_RADIUS) tearSegment(strand, i, delta, speed, now);
      }
    }

    for (const p of pts) {
      if (!p.pinned) {
        p.vel.mult(DAMPING);
        p.pos.add(p.vel);
      } else {
        p.vel.mult(0.64);
      }
    }
  }
}

function tearSegment(strand, index, delta, speed, now) {
  strand.broken[index] = true;
  strand.needsRebuild = true;
  strand.rebuildAt = now + REBUILD_DELAY;

  if (!tearPopupTriggeredThisDrag) {
    tearPopupTriggeredThisDrag = true;
    showTearPopup();
  }

  const a = strand.points[index];
  const b = strand.points[index + 1];
  const tangent = p5.Vector.sub(b.pos, a.pos);
  const normal = createVector(-tangent.y, tangent.x);
  if (normal.magSq() > 0.001) normal.normalize();
  const snap = 5.2 + speed * 0.18;

  if (!a.pinned) {
    a.vel.add(normal.copy().mult(snap));
    a.vel.add(delta.copy().mult(0.29));
    a.vel.y += 1.5;
  }
  if (!b.pinned) {
    b.vel.sub(normal.copy().mult(snap));
    b.vel.add(delta.copy().mult(0.29));
    b.vel.y += 1.5;
  }

  for (let k = -SAG_RADIUS_POINTS; k <= SAG_RADIUS_POINTS; k++) {
    const idx = index + k;
    if (idx < 0 || idx >= strand.points.length) continue;
    const p = strand.points[idx];
    if (p.pinned) continue;
    const fall = pow(1 - abs(k) / (SAG_RADIUS_POINTS + 1), 1.18);
    p.vel.add(delta.copy().mult(0.10 * fall));
    p.vel.y += (2.8 + speed * 0.085) * fall;
  }
}

function introFraction(strand, now) {
  const age = now - strand.revealStart;
  if (strand.revealMode === 'normal') return 1;
  if (strand.revealMode === 'intro') {
    const p = easeOutCubic(age / strand.revealDuration);
    if (p >= 1) { strand.revealMode = 'normal'; return 1; }
    return p;
  }
  if (strand.revealMode === 'edgeRegrow') {
    const p = easeOutCubic(age / strand.revealDuration);
    if (p >= 1) { strand.revealMode = 'normal'; return 1; }
    return p;
  }
  return 1;
}

function renderPixelThreads(now) {
  pg.background(0);
  pg.noFill();
  pg.strokeCap(ROUND);
  pg.strokeJoin(ROUND);
  pg.drawingContext.imageSmoothingEnabled = false;

  const sx = pg.width / width;
  const sy = pg.height / height;

  for (const strand of strands) {
    const reveal = introFraction(strand, now);
    if (reveal <= 0) continue;
    drawNormalStrand(strand, reveal, sx, sy);
  }
}

function drawNormalStrand(strand, reveal, sx, sy) {
  const pts = strand.points;
  const maxPoint = max(2, floor(1 + reveal * (pts.length - 1)));
  let run = [];
  for (let i = 0; i < maxPoint; i++) {
    run.push(pts[i]);
    if (i < maxPoint - 1 && strand.broken[i]) {
      drawCurveRun(run, strand.alpha, strand.weight, sx, sy);
      run = [];
    }
  }
  drawCurveRun(run, strand.alpha, strand.weight, sx, sy);
}

function drawCurveRun(run, alpha, weight, sx, sy) {
  if (run.length < 2) return;
  pg.stroke(255, 8, 22, alpha);
  pg.strokeWeight(max(0.64, weight));
  pg.beginShape();
  const first = run[0].pos;
  pg.curveVertex(first.x * sx, first.y * sy);
  pg.curveVertex(first.x * sx, first.y * sy);
  for (const point of run) pg.curveVertex(point.pos.x * sx, point.pos.y * sy);
  const last = run[run.length - 1].pos;
  pg.curveVertex(last.x * sx, last.y * sy);
  pg.curveVertex(last.x * sx, last.y * sy);
  pg.endShape();
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return dist(px, py, ax, ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return dist(px, py, bx, by);
  const t = c1 / c2;
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  return dist(px, py, projX, projY);
}

function mousePressed() {
  if (!tearActive) return false;
  tearPopupTriggeredThisDrag = false;
  lastPointer = createVector(mouseX, mouseY);
  return false;
}

function mouseReleased() {
  tearPopupTriggeredThisDrag = false;
  return false;
}

(async () => {
  try { await AUDIO?.tryStartMusic?.(); } catch (_) {}
  typeLeadThenReveal();
})();
