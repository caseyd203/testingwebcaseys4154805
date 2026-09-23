import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

const container = document.getElementById('app');
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;
const AUDIO = window.ScarletAudio;
function fitDesignToWindow(){
  const scale=Math.min(window.innerWidth/DESIGN_WIDTH,window.innerHeight/DESIGN_HEIGHT);
  document.documentElement.style.fontSize=`${DESIGN_ROOT_PX*scale}px`;
}
fitDesignToWindow();

document.documentElement.style.width = '100%';
document.documentElement.style.height = '100%';
document.body.style.margin = '0';
document.body.style.width = '100%';
document.body.style.height = '100%';
document.body.style.overflow = 'hidden';
document.body.style.background = '#000';

const holdButton = document.getElementById('holdHitZone');
const holdLabel = document.getElementById('holdLabel');
const hint = document.getElementById('hint');
const ringProgress = document.getElementById('ringProgress');
const resetButton = document.getElementById('resetButton');
const loading = document.getElementById('loading');

const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.FogExp2(0x040002, 0.032);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.02, 12.4);

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
renderer.domElement.classList.add('webgl');
renderer.domElement.style.position = 'absolute';
renderer.domElement.style.inset = '0';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
renderer.domElement.style.display = 'block';
renderer.domElement.style.imageRendering = 'pixelated';
container.appendChild(renderer.domElement);

const PIXEL_SCALE = 2;
function resizeRenderer() {
  fitDesignToWindow();
  const rect=container.getBoundingClientRect();
  const w=Math.max(1,rect.width), h=Math.max(1,rect.height);
  renderer.setSize(Math.max(1,Math.floor(w/PIXEL_SCALE)),Math.max(1,Math.floor(h/PIXEL_SCALE)),false);
  renderer.domElement.style.width='100%';
  renderer.domElement.style.height='100%';
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
resizeRenderer();

scene.add(new THREE.AmbientLight(0x3e0910, 0.18));
const key = new THREE.DirectionalLight(0xff3c58, 0.16);
key.position.set(3, 4, 5);
scene.add(key);

const sceneRoot=new THREE.Group();
scene.add(sceneRoot);
const heartGroup = new THREE.Group();
sceneRoot.add(heartGroup);
const threadGroup = new THREE.Group();
sceneRoot.add(threadGroup);
const customThreadGroup=new THREE.Group();
sceneRoot.add(customThreadGroup);
const customNodeGroup=new THREE.Group();
sceneRoot.add(customNodeGroup);

const THREAD_COUNT = 380;
const POINTS_PER_THREAD = 144;
const THREAD_LINE_WIDTH = 3.8;
const HOLD_DURATION = 2.4;
const RELEASE_SPEED = 0.84;
const THREAD_COLOR = new THREE.Color(0xff0000);
const THREAD_COLOR_BRIGHT = new THREE.Color(0xff0000);
const PIXEL_GRID = 0.0105;
const SURFACE_SAMPLES = 1450;
const HEART_OCCLUSION_START = 0.12;

let heartRoot = null;
let heartReady = false;
let progress = 0;
let holding = false;
let completed = false;
let lastTime = performance.now();

let surfaceCloud = [];
let heartBox = null;
let heartSize = new THREE.Vector3(2, 4, 2);
let vesselClusters = [];
let threads = [];

let pointer = new THREE.Vector2(0, 0);
let pointerInside = false;
let hoverTargetLocal = new THREE.Vector3(999, 999, 999);
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

let dragActive = false;
let lastDragX = 0;
let lastDragY = 0;
let orbitYaw = 0;
let orbitPitch = 0;
let orbitPitchTarget = 0;
let orbitVelocityX = 0;
let orbitVelocityY = 0;

const circumference = 2 * Math.PI * 53;
ringProgress.style.strokeDasharray = `${circumference}`;
ringProgress.style.strokeDashoffset = `${circumference}`;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function smoothstep01(v) { v = clamp01(v); return v * v * (3 - 2 * v); }
function easeInOutCubic(v) {
  v = clamp01(v);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}
function quantize(n) { return Math.round(n / PIXEL_GRID) * PIXEL_GRID; }
function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

function meanAngle(list) {
  if (!list.length) return 0;
  let cx = 0, cz = 0;
  for (const a of list) {
    cx += Math.cos(a);
    cz += Math.sin(a);
  }
  return Math.atan2(cz / list.length, cx / list.length);
}

function computeVesselClusters(points, k = 4) {
  const top = points.filter(p => p.yNorm > 0.58);
  if (top.length < k) return [];

  const sorted = [...top].sort((a, b) => a.pos.x - b.pos.x || a.pos.z - b.pos.z);
  let centers = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((sorted.length - 1) * ((i + 0.5) / k));
    centers.push({ x: sorted[idx].pos.x, z: sorted[idx].pos.z });
  }

  for (let iter = 0; iter < 10; iter++) {
    const groups = Array.from({ length: k }, () => []);
    for (const p of top) {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < k; i++) {
        const dx = p.pos.x - centers[i].x;
        const dz = p.pos.z - centers[i].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = i; }
      }
      groups[bestI].push(p);
    }
    centers = centers.map((c, i) => {
      const g = groups[i];
      if (!g.length) return c;
      let x = 0, z = 0;
      for (const p of g) { x += p.pos.x; z += p.pos.z; }
      return { x: x / g.length, z: z / g.length };
    });
  }

  let clusters = centers.map((c, i) => ({ id: i, x: c.x, z: c.z, angle: Math.atan2(c.z, c.x), radius: 0.22, yMin: 0.58, yMax: 1 }));

  for (const p of points) {
    p.vesselId = -1;
    if (p.yNorm <= 0.46) continue;
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const dx = p.pos.x - clusters[i].x;
      const dz = p.pos.z - clusters[i].z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0 && bestD < 0.72) p.vesselId = bestI;
  }

  clusters = clusters.map((cluster, i) => {
    const g = points.filter(p => p.vesselId === i);
    if (!g.length) return cluster;
    const angle = meanAngle(g.map(p => p.angle));
    const r = Math.sqrt(g.reduce((acc, p) => {
      const dx = p.pos.x - cluster.x;
      const dz = p.pos.z - cluster.z;
      return acc + dx * dx + dz * dz;
    }, 0) / g.length);
    return {
      ...cluster,
      angle,
      radius: THREE.MathUtils.clamp(r, 0.15, 0.40),
      yMin: Math.max(0.46, Math.min(...g.map(p => p.yNorm))),
      yMax: Math.min(1.0, Math.max(...g.map(p => p.yNorm)))
    };
  }).sort((a, b) => a.x - b.x);

  // reassign ids after sorting and update points
  const remap = new Map();
  clusters.forEach((c, idx) => {
    remap.set(c.id, idx);
    c.id = idx;
  });
  for (const p of points) {
    if (p.vesselId >= 0) p.vesselId = remap.get(p.vesselId);
  }
  return clusters;
}

function centerAndScale(root, targetHeight = 4.25) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  root.position.sub(center);
  root.scale.setScalar(targetHeight / Math.max(size.y, 0.001));
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  box2.getCenter(center);
  root.position.sub(center);
  root.updateMatrixWorld(true);
}

function findLargestMesh(root) {
  let best = null;
  let bestCount = -1;
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const count = obj.geometry.attributes.position.count;
    if (count > bestCount) {
      bestCount = count;
      best = obj;
    }
  });
  return best;
}

function sampleSurfaceData(mesh, count = SURFACE_SAMPLES) {
  mesh.updateMatrixWorld(true);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const out = [];
  heartBox = new THREE.Box3();

  for (let i = 0; i < count; i++) {
    sampler.sample(p, n);
    const wp = p.clone().applyMatrix4(mesh.matrixWorld);
    const wn = n.clone().applyMatrix3(normalMatrix).normalize();
    heartGroup.worldToLocal(wp);
    wn.normalize();
    out.push({
      pos: wp.clone(),
      normal: wn.clone(),
      angle: Math.atan2(wp.z, wp.x),
      yNorm: 0,
      neighbors: []
    });
    heartBox.expandByPoint(wp);
  }

  heartBox.getSize(heartSize);
  const minY = heartBox.min.y;
  const maxY = heartBox.max.y;
  const height = Math.max(0.001, maxY - minY);

  out.forEach(entry => {
    const yn = (entry.pos.y - minY) / height;
    entry.yNorm = yn * 2 - 1;
  });

  return out;
}

function nearestSurfaceEntry(point) {
  if (!surfaceCloud.length) return null;
  let best = surfaceCloud[0];
  let bestD2 = Infinity;
  for (let i = 0; i < surfaceCloud.length; i++) {
    const entry = surfaceCloud[i];
    const d2 = entry.pos.distanceToSquared(point);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = entry;
    }
  }
  return { entry: best, distance: Math.sqrt(bestD2) };
}

function pushPointOutsideHeart(point, margin = 0.34) {
  if (!heartBox || !surfaceCloud.length) return point;
  const guardBox = heartBox.clone().expandByScalar(margin * 0.55);
  if (!guardBox.containsPoint(point)) return point;

  const info = nearestSurfaceEntry(point);
  if (!info) return point;
  const outward = point.clone().sub(info.entry.pos);
  if (outward.lengthSq() < 1e-6 || outward.dot(info.entry.normal) < 0) {
    outward.copy(info.entry.normal);
  } else {
    outward.normalize();
  }

  return info.entry.pos.clone().addScaledVector(outward, margin + Math.random() * 0.14);
}

function keepCurveOutsideHeart(points, margin = 0.34) {
  if (!heartBox || !surfaceCloud.length) return points;
  for (let i = 0; i < points.length; i++) {
    points[i] = pushPointOutsideHeart(points[i].clone(), margin);
  }
  return points;
}

// Build the same kind of local surface graph used by the older cocoon web.
// Strands then wander from neighboring sample to neighboring sample while
// preferring tangential, coherent motion across the anatomical heart surface.
function buildSurfaceNeighbors(points, k = 9, maxDist = 0.72) {
  const maxD2 = maxDist * maxDist;

  for (let i = 0; i < points.length; i++) {
    const a = points[i].pos;
    const nearby = [];

    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const d2 = a.distanceToSquared(points[j].pos);
      if (d2 <= maxD2) nearby.push({ index: j, d2 });
    }

    nearby.sort((m, n) => m.d2 - n.d2);
    points[i].neighbors = nearby.slice(0, k).map(v => v.index);

    // Sparse parts of the model still need enough choices.
    if (points[i].neighbors.length < 4) {
      const all = [];
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        all.push({ index: j, d2: a.distanceToSquared(points[j].pos) });
      }
      all.sort((m, n) => m.d2 - n.d2);
      points[i].neighbors = all.slice(0, k).map(v => v.index);
    }
  }
}

function generateCocoonSurfacePath(pointCount, seed) {
  if (!surfaceCloud.length) return randomFloatPath(pointCount, seed);

  const topPool = surfaceCloud
    .map((p, i) => ({ i, y: p.yNorm }))
    .sort((a, b) => b.y - a.y)
    .slice(0, 90)
    .map(v => v.i);

  let current = (Math.random() < 0.18 && topPool.length)
    ? topPool[Math.floor(Math.random() * topPool.length)]
    : Math.floor(Math.random() * surfaceCloud.length);

  let previousDirection = new THREE.Vector3(1, 0, 0);
  const used = new Set([current]);
  const controls = [];
  const steps = 20 + Math.floor(Math.random() * 15);
  const baseOutward = 0.02 + Math.random() * 0.02;

  for (let s = 0; s < steps; s++) {
    const here = surfaceCloud[current];
    const u = s / Math.max(1, steps - 1);
    const herePoint = here.pos.clone().addScaledVector(
      here.normal,
      baseOutward + Math.sin(u * Math.PI * 3 + seed) * 0.005
    );
    controls.push(herePoint);

    const candidates = here.neighbors.filter(index => !used.has(index));
    const pool = candidates.length ? candidates : here.neighbors;
    if (!pool.length) break;

    let best = pool[0];
    let bestScore = -1e9;
    for (const index of pool) {
      const next = surfaceCloud[index];
      const delta = next.pos.clone().sub(here.pos);
      const distance = delta.length();
      if (distance < 1e-5) continue;

      const direction = delta.clone().normalize();
      const tangentBias = 1 - Math.abs(direction.dot(here.normal));
      const coherence = direction.dot(previousDirection);
      const randomness = Math.random() * 0.38;
      const topPenalty = Math.max(0, next.yNorm - 0.94) * 0.7;
      const score = tangentBias * 1.3 + coherence * 0.45 - distance * 0.17 + randomness - topPenalty;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }

    const nextPoint = surfaceCloud[best];
    previousDirection.copy(nextPoint.pos).sub(here.pos).normalize();
    current = best;
    used.add(current);
  }

  if (controls.length < 4) return generateDiagonalWrapPath(pointCount, seed);

  const curve = new THREE.CatmullRomCurve3(controls, false, 'catmullrom', 0.6);
  return curve.getPoints(pointCount - 1);
}

function pickSurfacePoint(thetaTarget, yTarget, prevPos = null, angleWeight = 0.9, yWeight = 1.2, filterFn = null) {
  let best = null;
  let bestScore = Infinity;
  for (let j = 0; j < surfaceCloud.length; j++) {
    const entry = surfaceCloud[j];
    if (filterFn && !filterFn(entry)) continue;
    const a = angleDiff(thetaTarget, entry.angle);
    const y = Math.abs(yTarget - entry.yNorm);
    let continuity = 0;
    if (prevPos) continuity = prevPos.distanceToSquared(entry.pos) * 0.05;
    const score = a * angleWeight + y * yWeight + continuity + Math.random() * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  if (!best && filterFn) return pickSurfacePoint(thetaTarget, yTarget, prevPos, angleWeight, yWeight, null);
  return best;
}

function offsetSurfacePoint(entry, u = 0, phase = 0) {
  const offset = 0.02 + Math.sin(u * Math.PI * 2 + phase) * 0.006 + Math.random() * 0.008;
  return entry.pos.clone().addScaledVector(entry.normal, offset);
}

function buildSurfaceCurve(pointCount, anchorCount, mapper, tension = 0.58) {
  const anchors = [];
  const phase = Math.random() * Math.PI * 2;
  let prev = null;

  for (let i = 0; i < anchorCount; i++) {
    const u = i / (anchorCount - 1);
    const spec = mapper(u, phase) || {};
    const best = pickSurfacePoint(
      spec.theta || 0,
      THREE.MathUtils.clamp(spec.y || 0, -0.98, 0.98),
      prev,
      spec.angleWeight ?? 1,
      spec.yWeight ?? 1,
      spec.filterFn ?? null
    );

    const p = offsetSurfacePoint(best, u, phase);
    const tangentPush = (spec.push ?? 0.0) * (0.5 - Math.abs(u - 0.5));
    if (tangentPush !== 0) {
      const tangent = new THREE.Vector3(-best.pos.z, 0, best.pos.x).normalize();
      p.addScaledVector(tangent, tangentPush);
    }
    anchors.push(p);
    prev = best.pos;
  }

  return new THREE.CatmullRomCurve3(anchors, false, 'catmullrom', tension).getPoints(pointCount - 1);
}

function randomFloatPath(pointCount, seed) {
  const center = new THREE.Vector3(
    (Math.random() - 0.5) * 14.5,
    (Math.random() - 0.5) * 8.8,
    (Math.random() - 0.5) * 7.6
  );

  const controls = [];
  const controlCount = 10 + Math.floor(Math.random() * 6);
  const drift = new THREE.Vector3(
    (Math.random() - 0.5) * 13.5,
    (Math.random() - 0.5) * 8.0,
    (Math.random() - 0.5) * 6.6
  );

  for (let i = 0; i < controlCount; i++) {
    const u = i / (controlCount - 1);
    const swirl = new THREE.Vector3(
      Math.sin(u * Math.PI * 2.2 + seed * 0.13) * (1.35 + Math.random() * 1.25),
      Math.cos(u * Math.PI * 1.9 + seed * 0.21) * (1.15 + Math.random() * 1.1),
      Math.sin(u * Math.PI * 2.7 + seed * 0.07) * (1.05 + Math.random() * 1.0)
    );
    controls.push(
      center.clone()
        .addScaledVector(drift, u - 0.5)
        .add(swirl)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.45,
          (Math.random() - 0.5) * 1.45,
          (Math.random() - 0.5) * 1.35
        ))
    );
  }

  const curve = new THREE.CatmullRomCurve3(controls, false, 'catmullrom', 0.72);
  return keepCurveOutsideHeart(curve.getPoints(pointCount - 1), 0.38);
}

function generateLatitudinalWrapPath(pointCount, seed) {
  const baseY = THREE.MathUtils.lerp(-0.82, 0.62, Math.random());
  const yDrift = 0.018 + Math.random() * 0.08;
  const loops = 1.35 + Math.random() * 2.2;
  const phase = Math.random() * Math.PI * 2;
  const direction = Math.random() < 0.5 ? -1 : 1;
  const anchorCount = 12 + Math.floor(Math.random() * 5);

  return buildSurfaceCurve(pointCount, anchorCount, (u) => ({
    theta: phase + direction * u * loops * Math.PI * 2,
    y: baseY + Math.sin(u * Math.PI * 2 + phase * 0.45) * yDrift,
    angleWeight: 0.8,
    yWeight: 1.1,
    push: 0.016 + Math.sin(u * Math.PI * 4 + phase) * 0.006
  }), 0.72);
}

function generateMeridianWrapPath(pointCount, seed) {
  const thetaBase = Math.random() * Math.PI * 2;
  const thetaSwing = 0.14 + Math.random() * 0.32;
  const phase = Math.random() * Math.PI * 2;
  const fromTop = Math.random() < 0.5;
  const anchorCount = 13 + Math.floor(Math.random() * 4);

  return buildSurfaceCurve(pointCount, anchorCount, (u) => {
    const v = fromTop ? u : 1 - u;
    return {
      theta: thetaBase + Math.sin(u * Math.PI * (1.4 + (seed % 5) * 0.12) + phase) * thetaSwing,
      y: THREE.MathUtils.lerp(0.96, -0.98, v) + Math.sin(u * Math.PI * 2.8 + phase) * 0.055,
      angleWeight: 1.15,
      yWeight: 0.62,
      push: Math.sin(u * Math.PI * 2 + phase) * 0.01
    };
  }, 0.68);
}

function generateDiagonalWrapPath(pointCount, seed) {
  const phase = Math.random() * Math.PI * 2;
  const direction = Math.random() < 0.5 ? -1 : 1;
  const thetaStart = Math.random() * Math.PI * 2;
  const thetaTravel = direction * (Math.PI * (1.35 + Math.random() * 1.9));
  const yStart = THREE.MathUtils.lerp(0.68, -0.82, Math.random());
  const yEnd = THREE.MathUtils.clamp(yStart + (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.7), -0.95, 0.95);
  const anchorCount = 12 + Math.floor(Math.random() * 4);

  return buildSurfaceCurve(pointCount, anchorCount, (u) => ({
    theta: thetaStart + thetaTravel * u + Math.sin(u * Math.PI * 2.2 + phase) * 0.18,
    y: THREE.MathUtils.lerp(yStart, yEnd, u) + Math.sin(u * Math.PI * 2.6 + phase) * 0.045,
    angleWeight: 0.9,
    yWeight: 0.84,
    push: 0.012 * Math.cos(u * Math.PI * 3 + phase)
  }), 0.74);
}

function generateVesselLoopPath(pointCount, seed) {
  if (!vesselClusters.length) return generateLatitudinalWrapPath(pointCount, seed);
  const cluster = vesselClusters[Math.floor(Math.random() * vesselClusters.length)];
  const phase = Math.random() * Math.PI * 2;
  const loops = 1.5 + Math.random() * 2.2;
  const yCenter = THREE.MathUtils.clamp(cluster.yMin + 0.10 + Math.random() * Math.max(0.10, cluster.yMax - cluster.yMin - 0.08), 0.52, 0.98);
  const ySpan = 0.05 + Math.random() * 0.05;
  const angleSpan = 0.24 + cluster.radius * 0.95;
  const anchorCount = 14 + Math.floor(Math.random() * 5);

  return buildSurfaceCurve(pointCount, anchorCount, (u) => ({
    theta: cluster.angle + Math.sin(u * Math.PI * 2 * loops + phase) * angleSpan,
    y: yCenter + Math.sin(u * Math.PI * 2 + phase * 0.6) * ySpan,
    angleWeight: 1.7,
    yWeight: 0.86,
    push: 0.009 + Math.sin(u * Math.PI * 4 + phase) * 0.003,
    filterFn: (entry) => entry.vesselId === cluster.id
  }), 0.84);
}

function generateVesselClimbPath(pointCount, seed) {
  if (!vesselClusters.length) return generateMeridianWrapPath(pointCount, seed);
  const cluster = vesselClusters[Math.floor(Math.random() * vesselClusters.length)];
  const phase = Math.random() * Math.PI * 2;
  const thetaSwing = 0.10 + cluster.radius * 0.65;
  const anchorCount = 14 + Math.floor(Math.random() * 5);
  const fromY = THREE.MathUtils.lerp(0.16, 0.42, Math.random());
  const toY = THREE.MathUtils.clamp(cluster.yMax, 0.78, 1);

  return buildSurfaceCurve(pointCount, anchorCount, (u) => ({
    theta: cluster.angle + Math.sin(u * Math.PI * (1.6 + Math.random() * 0.8) + phase) * thetaSwing,
    y: THREE.MathUtils.lerp(fromY, toY, u) + Math.sin(u * Math.PI * 3 + phase) * 0.03,
    angleWeight: 1.5,
    yWeight: 0.60,
    push: Math.sin(u * Math.PI * 2 + phase) * 0.006,
    filterFn: (entry) => (u < 0.55)
      ? (entry.yNorm < 0.74 && angleDiff(entry.angle, cluster.angle) < 0.55)
      : (entry.vesselId === cluster.id)
  }), 0.80);
}

function generateSurfaceWrapPath(pointCount, seed) {
  return generateCocoonSurfacePath(pointCount, seed);
}

function createThreads() {
  threads.forEach(t => {
    threadGroup.remove(t.line);
    t.line.geometry.dispose();
    t.line.material.dispose();
  });
  threads = [];

  for (let i = 0; i < THREAD_COUNT; i++) {
    const seed = Math.random() * 1000;
    const floatPoints = randomFloatPath(POINTS_PER_THREAD, seed);
    const wrapPoints = generateSurfaceWrapPath(POINTS_PER_THREAD, seed);

    const positions = new Float32Array(POINTS_PER_THREAD * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineBasicMaterial({
      color: THREAD_COLOR,
      transparent: true,
      opacity: 0.26 + Math.random() * 0.18,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    });

    const line = new THREE.Line(geom, mat);
    line.frustumCulled = false;
    line.renderOrder = 2;
    threadGroup.add(line);

    threads.push({
      line,
      positions,
      floatPoints,
      wrapPoints,
      phase: Math.random() * Math.PI * 2,
      seed,
      delay: Math.random() * 0.42,
      wobble: 0.16 + Math.random() * 0.14,
      driftX: 0.62 + Math.random() * 0.68,
      driftY: 0.38 + Math.random() * 0.46,
      driftZ: 0.34 + Math.random() * 0.42,
      baseOpacity: mat.opacity
    });
  }
}

function updateHoverTarget() {
  raycaster.setFromCamera(pointer, camera);
  const worldPoint = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, worldPoint);
  hoverTargetLocal.copy(worldPoint);
  threadGroup.worldToLocal(hoverTargetLocal);
}

function updateThreads(time) {
  const seconds = time * 0.001;
  const p = progress;
  updateHoverTarget();

  threads.forEach((t, ti) => {
    const local = smoothstep01((p - t.delay) / Math.max(0.001, 1 - t.delay));
    const gather = easeInOutCubic(local);
    const pos = t.positions;

    const lineDrift = new THREE.Vector3(
      Math.sin(seconds * 0.38 + t.phase * 1.1) * t.driftX * (1 - gather),
      Math.cos(seconds * 0.31 + t.phase * 0.9) * t.driftY * (1 - gather),
      Math.sin(seconds * 0.27 + t.phase * 1.4) * t.driftZ * (1 - gather)
    );

    for (let i = 0; i < POINTS_PER_THREAD; i++) {
      const u = i / (POINTS_PER_THREAD - 1);
      const f = t.floatPoints[i];
      const w = t.wrapPoints[i];

      const floatAmp = (1 - gather) * t.wobble;
      const fx = Math.sin(seconds * 0.65 + t.phase + u * 7.0 + ti * 0.05) * floatAmp;
      const fy = Math.cos(seconds * 0.56 + t.phase * 1.2 + u * 6.0) * floatAmp * 0.88;
      const fz = Math.sin(seconds * 0.48 + t.phase * 0.8 + u * 4.7) * floatAmp * 0.8;

      const wrapAmp = 0.006 + gather * 0.008;
      const wx = Math.sin(seconds * 0.88 + t.phase + u * 8.0) * wrapAmp;
      const wy = Math.cos(seconds * 0.74 + t.phase * 1.1 + u * 6.8) * wrapAmp * 0.65;
      const wz = Math.sin(seconds * 0.67 + t.phase * 0.7 + u * 5.4) * wrapAmp * 0.72;

      let x = THREE.MathUtils.lerp(f.x + lineDrift.x + fx, w.x + wx, gather);
      let y = THREE.MathUtils.lerp(f.y + lineDrift.y + fy, w.y + wy, gather);
      let z = THREE.MathUtils.lerp(f.z + lineDrift.z + fz, w.z + wz, gather);

      if (pointerInside) {
        const dx = x - hoverTargetLocal.x;
        const dy = y - hoverTargetLocal.y;
        const dz = z - hoverTargetLocal.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const radius = THREE.MathUtils.lerp(0.95, 0.42, gather);
        if (d2 < radius * radius) {
          const d = Math.sqrt(Math.max(d2, 0.0001));
          const push = (1 - d / radius) * THREE.MathUtils.lerp(0.6, 0.16, gather);
          x += (dx / d) * push;
          y += (dy / d) * push;
          z += (dz / d) * push * 0.45;
        }
      }

      const k = i * 3;
      const qMix = 0.78 + gather * 0.16;
      pos[k] = THREE.MathUtils.lerp(x, quantize(x), qMix);
      pos[k + 1] = THREE.MathUtils.lerp(y, quantize(y), qMix);
      pos[k + 2] = THREE.MathUtils.lerp(z, quantize(z), qMix);
    }

    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = t.baseOpacity * (0.98 + gather * 0.34) * (0.96 + Math.sin(seconds * 0.9 + t.phase) * 0.06);
  });
}

function updateHeart(time) {
  const seconds = time * 0.001;
  const beat = Math.pow(Math.max(0, Math.sin(seconds * 2.1)), 9) * 0.014;
  const gatherPulse = progress * 0.006;
  const s = 1 + beat + gatherPulse;
  heartGroup.scale.setScalar(s);
  threadGroup.scale.setScalar(s);
  customThreadGroup.scale.setScalar(s);
  customNodeGroup.scale.setScalar(s);

  orbitYaw += orbitVelocityX;
  orbitPitchTarget += orbitVelocityY;
  orbitVelocityX *= 0.92;
  orbitVelocityY *= 0.92;
  orbitPitchTarget = THREE.MathUtils.clamp(orbitPitchTarget, -0.55, 0.55);
  orbitPitch = THREE.MathUtils.lerp(orbitPitch, orbitPitchTarget, 0.12);

  const idleYaw = Math.sin(seconds * 0.12) * 0.06;
  const idlePitch = Math.sin(seconds * 0.09) * 0.02;
  threadGroup.rotation.y = orbitYaw + idleYaw;
  threadGroup.rotation.x = orbitPitch + idlePitch;
  heartGroup.rotation.copy(threadGroup.rotation);
  customThreadGroup.rotation.copy(threadGroup.rotation);
  customNodeGroup.rotation.copy(threadGroup.rotation);
}

function updateProgressUI(){ syncGatherUI(); }

function setHolding(v) {
  if (!heartReady || completed || scenePhase!=='gather') return;
  const wasHolding = holding;
  if (wasHolding === v) return;
  holding = v;
  if(v) {
    AUDIO?.playGatherForward(progress);
    beginHoldVisuals();
  } else {
    AUDIO?.playGatherReverse(progress);
    beginReleaseVisuals();
  }
  updateProgressUI();
}

holdButton.addEventListener('pointerdown', e => {
  e.preventDefault();
  holdButton.setPointerCapture?.(e.pointerId);
  setHolding(true);
});
holdButton.addEventListener('pointerup', e => {
  e.preventDefault();
  setHolding(false);
});
holdButton.addEventListener('pointercancel', () => setHolding(false));
holdButton.addEventListener('lostpointercapture', () => setHolding(false));
holdButton.addEventListener('contextmenu', e => e.preventDefault());

resetButton.addEventListener('click', () => {
  AUDIO?.stopGather();
  completed = false;
  holding = false;
  progress = 0;
  orbitYaw = 0;
  orbitPitch = 0;
  orbitPitchTarget = 0;
  orbitVelocityX = 0;
  orbitVelocityY = 0;
  holdButton.classList.remove('is-holding', 'is-complete');
  if (heartReady) createThreads();
  updateProgressUI();
});

window.addEventListener('pointermove', e => {
  const rect=container.getBoundingClientRect();
  pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-(((e.clientY-rect.top)/rect.height)*2-1);
  pointerInside = true;

  if(draggedCustomNode>=0){
    dragCustomNode(e);
    return;
  }
  if(scenePhase==='custom'){
    hoveredCustomNode=pickCustomNode(e.clientX,e.clientY);
    renderer.domElement.style.cursor=hoveredCustomNode>=0?'grab':'crosshair';
  }else{
    hoveredCustomNode=-1;
  }

  if (dragActive) {
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    orbitVelocityX = dx * 0.0028;
    orbitVelocityY = dy * 0.0018;
  }
});
window.addEventListener('mouseout', e => { if (!e.relatedTarget) {pointerInside = false; hoveredCustomNode=-1;} });
window.addEventListener('blur', () => { pointerInside = false; dragActive = false; hoveredCustomNode=-1; draggedCustomNode=-1; setHolding(false); });

renderer.domElement.addEventListener('pointerdown', e => {
  if(scenePhase==='custom'){
    const node=pickCustomNode(e.clientX,e.clientY);
    if(node>=0){
      e.preventDefault();
      beginCustomNodeDrag(node,e);
      return;
    }
  }
  if (e.target === holdButton || holdButton.contains(e.target)) return;
  dragActive = true;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
  renderer.domElement.setPointerCapture?.(e.pointerId);
});
renderer.domElement.addEventListener('pointerup', e => {
  if(draggedCustomNode>=0){endCustomNodeDrag(e);return;}
  dragActive = false;
  renderer.domElement.releasePointerCapture?.(e.pointerId);
});
renderer.domElement.addEventListener('pointercancel', e => { if(draggedCustomNode>=0)endCustomNodeDrag(e); dragActive = false; });

async function loadHeart() {
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('./assets/heart/scene.gltf');
    heartRoot = gltf.scene;
    heartGroup.add(heartRoot);
    centerAndScale(heartRoot, 4.25);
    heartRoot.updateMatrixWorld(true);

    const mainMesh = findLargestMesh(heartRoot);
    if (!mainMesh) throw new Error('Heart mesh not found');

    heartRoot.traverse(obj => {
      if (!obj.isMesh) return;
      obj.material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        transparent: false,
        toneMapped: false
      });
      obj.renderOrder = 1;
    });

    surfaceCloud = sampleSurfaceData(mainMesh, SURFACE_SAMPLES);
    buildSurfaceNeighbors(surfaceCloud, 9, 0.72);
    vesselClusters = [];

    // Keep the heart as a depth-only occluder from the beginning so the
    // floating strands already avoid / wrap around the heart silhouette.
    heartRoot.visible = true;

    createThreads();
    heartReady = true;
    loading.classList.add('hidden');
    updateProgressUI();
  } catch (err) {
    console.error(err);
    loading.textContent = 'FAILED TO LOAD HEART — RUN WITH LIVE SERVER';
  }
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (heartReady && !completed) {
    if (holding) {
      progress = clamp01(progress + dt / HOLD_DURATION);
      if (progress >= 1) {
        progress = 1;
        completed = true;
        holding = false;
        holdButton.classList.remove('is-holding');
        onGatherCompleted();
      }
    } else {
      progress = Math.max(0, progress - dt * RELEASE_SPEED);
    }
    updateProgressUI();
  }

  if (heartReady) {
    if (heartRoot) heartRoot.visible = true;
    updateThreads(now);
    updateHeart(now);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  resizeRenderer();
});


// ============================================================================
// SCENE 3 FLOW / CUSTOM COCOON UI
// ============================================================================
let scenePhase='gather';
let currentHeldFrame=0;
let reversingHeld=false;
let holdCycleIndex=0;
let holdCycleTimer=null;
let heldFrameTimer=null;
let heldVisualToken=0;

const gatherUI=document.getElementById('gatherUI');
const holdTextUI=document.getElementById('holdText');
const gatherIdleText=document.getElementById('gatherIdleText');
const gatherHoldingText=document.getElementById('gatherHoldingText');
const gatherCompleteText=document.getElementById('gatherCompleteText');
const holdFrameEls=[1,2,3,4,5].map(i=>document.querySelector(`.hold${i}`));
const heldFrameEls=[1,2,3,4,5,6,7,8].map(i=>document.querySelector(`.held${i}`));

const bgScene3=document.getElementById('bgScene3');
const customUI=document.getElementById('customUI');
const customBottomPrompt=document.getElementById('customBottomPrompt');
const expectationInput=document.getElementById('expectationInput');
const typingPlaceholder=document.getElementById('typingPlaceholder');
const weaveAction=document.getElementById('weaveAction');
const characterListEl=document.getElementById('characterList');
const characterViewport=document.getElementById('characterViewport');
const characterScrollTrack=document.getElementById('characterScrollTrack');
const characterScrollThumb=document.getElementById('characterScrollThumb');
const resetAction=document.getElementById('resetAction');
const varyAction=document.getElementById('varyAction');
const reweaveAction=document.getElementById('reweaveAction');
const inspectAction=document.getElementById('inspectAction');
const inspectLayer=document.getElementById('inspectLayer');
const heartbeatCanvas=document.getElementById('heartbeatCanvas');
const heartbeatCtx=heartbeatCanvas.getContext('2d');
const heartbeatField=document.getElementById('heartbeatField');

const confirmPhase=document.getElementById('confirmPhase');
const confirmDialogue=document.getElementById('confirmDialogue');
const confirmChoices=document.getElementById('confirmChoices');
const confirmYes=document.getElementById('confirmYes');
const confirmNo=document.getElementById('confirmNo');
const confirmContinue=document.getElementById('confirmContinue');

function showOnlyHoldFrame(index){
  holdFrameEls.forEach((el,i)=>el.classList.toggle('is-visible',i===index));
}
function showHeldFrame(index){
  heldFrameEls.forEach((el,i)=>el.classList.toggle('is-visible',i===index-1));
}
function cancelHeldVisualTimer(){
  heldVisualToken++;
  clearTimeout(heldFrameTimer);
  heldFrameTimer=null;
}
function stopForwardHeld(){cancelHeldVisualTimer();}
function stopReverseHeld(){cancelHeldVisualTimer();reversingHeld=false;}
function stopHoldCycle(){
  clearInterval(holdCycleTimer);
  holdCycleTimer=null;
  holdFrameEls.slice(0,4).forEach(el=>el.classList.remove('is-visible'));
}
function startHoldCycle(){
  stopHoldCycle();
  holdCycleIndex=0;
  showOnlyHoldFrame(0);
  // Always restart hold1 → hold2 → hold3 → hold4 exactly like the first hold.
  holdCycleTimer=setInterval(()=>{
    if(!holding||completed||scenePhase!=='gather')return;
    holdCycleIndex=(holdCycleIndex+1)%4;
    showOnlyHoldFrame(holdCycleIndex);
    // Preserve the current held frame above the cycling hold frames.
    showHeldFrame(currentHeldFrame);
  },82);
}
function startForwardHeld(){
  cancelHeldVisualTimer();
  reversingHeld=false;
  const token=heldVisualToken;
  const step=()=>{
    if(token!==heldVisualToken||!holding||completed||scenePhase!=='gather')return;
    currentHeldFrame=Math.min(8,currentHeldFrame+1);
    showHeldFrame(currentHeldFrame);
    syncGatherUI();
    if(currentHeldFrame<8){
      heldFrameTimer=setTimeout(step,200);
    }
  };
  // From fully idle, reproduce the original 0.3 s wait before held1.
  // If the user re-holds during a reverse, continue smoothly from that frame.
  heldFrameTimer=setTimeout(step,currentHeldFrame===0?300:200);
}
function beginHoldVisuals(){
  if(scenePhase!=='gather'||completed)return;
  cancelHeldVisualTimer();
  reversingHeld=false;
  startHoldCycle();
  showHeldFrame(currentHeldFrame);
  startForwardHeld();
  syncGatherUI();
}
function beginReleaseVisuals(){
  if(scenePhase!=='gather'||completed)return;
  cancelHeldVisualTimer();
  stopHoldCycle();
  if(currentHeldFrame<=0){
    currentHeldFrame=0;
    showHeldFrame(0);
    showOnlyHoldFrame(4);
    reversingHeld=false;
    syncGatherUI();
    return;
  }
  reversingHeld=true;
  const token=heldVisualToken;
  const stepBack=()=>{
    if(token!==heldVisualToken||holding||completed||scenePhase!=='gather')return;
    currentHeldFrame=Math.max(0,currentHeldFrame-1);
    showHeldFrame(currentHeldFrame);
    if(currentHeldFrame===0){
      reversingHeld=false;
      showOnlyHoldFrame(4);
      heldFrameTimer=null;
      syncGatherUI();
      return;
    }
    syncGatherUI();
    heldFrameTimer=setTimeout(stepBack,100);
  };
  heldFrameTimer=setTimeout(stepBack,100);
  syncGatherUI();
}
function onGatherCompleted(){
  AUDIO?.stopGather();
  currentHeldFrame=8;
  cancelHeldVisualTimer();
  reversingHeld=false;
  stopHoldCycle();
  showHeldFrame(8);
  syncGatherUI();
}
function syncGatherUI(){
  if(!gatherUI)return;
  if(completed){
    holdTextUI.style.opacity='0'; gatherIdleText.style.display='none'; gatherHoldingText.style.opacity='0'; gatherCompleteText.style.opacity=''; gatherCompleteText.style.display='block'; holdButton.style.pointerEvents='none'; showHeldFrame(8); return;
  }
  gatherCompleteText.style.display='none';
  if(holding){
    holdTextUI.style.opacity='0'; gatherIdleText.style.display='none'; gatherHoldingText.style.opacity='1'; holdButton.style.pointerEvents='auto';
  }else if(reversingHeld||currentHeldFrame>0){
    holdTextUI.style.opacity='0'; gatherIdleText.style.display='none'; gatherHoldingText.style.opacity='0';
  }else{
    holdTextUI.style.opacity='1'; gatherIdleText.style.display='block'; gatherHoldingText.style.opacity='0'; showOnlyHoldFrame(4); holdButton.style.pointerEvents='auto';
  }
}

// ---------- Stage 2 transform / controls ----------
const STAGE2_BASE_SCALE=.72;
const SCALE_LEVELS=[.64,.76,.88,1,1.13,1.27,1.43];
const SPEED_LEVELS=[.40,.60,.80,1,1.25,1.55,1.90];
const BG_LEVELS=[0,.16,.32,.48,.64,.82,1];
let scaleStep=4,speedStep=4,bgStep=7;
let stage2TransformMix=0;
let transitionStart=0;
let barsHidden=false;
let backgroundTransitionOpacity=0;

function speedFactor(){return SPEED_LEVELS[speedStep-1];}
function targetStageScale(){return STAGE2_BASE_SCALE*SCALE_LEVELS[scaleStep-1];}
function updateSceneTransform(now){
  if(scenePhase==='transition'){
    const u=Math.min(1,(now-transitionStart)/1400); const e=u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;
    stage2TransformMix=e; sceneRoot.scale.setScalar(THREE.MathUtils.lerp(1,targetStageScale(),e)); sceneRoot.position.y=THREE.MathUtils.lerp(0,.90,e);
  }else if(scenePhase!=='gather'){
    const s=targetStageScale(); sceneRoot.scale.setScalar(THREE.MathUtils.lerp(sceneRoot.scale.x,s,.09)); sceneRoot.position.y=THREE.MathUtils.lerp(sceneRoot.position.y,.90,.09);
  }
}

async function transitionToCustom(){
  if(scenePhase!=='gather'||!completed)return;
  scenePhase='transition'; holdButton.style.pointerEvents='none'; gatherUI.classList.add('is-hidden'); transitionStart=performance.now();
  await new Promise(r=>setTimeout(r,1450));
  backgroundTransitionOpacity=BG_LEVELS[bgStep-1]; bgScene3.style.opacity=String(backgroundTransitionOpacity);
  await new Promise(r=>setTimeout(r,950));
  scenePhase='custom'; customUI.classList.add('is-visible'); customUI.setAttribute('aria-hidden','false'); customBottomPrompt.classList.add('is-visible');
  AUDIO?.startLoopSfx('heartbeat.mp3','scene3-heartbeat');
  setTimeout(()=>customUI.style.opacity='1',20);
}

// ---------- Custom red pixel filaments growing from the gathered heart ----------
// Behaviour follows the older free-mode cocoon web: every filament starts on
// the heart, floats organically, ends in a live node, glows on hover, and the
// endpoint can be grabbed and dragged.
let customLabels=[];
let customLines=[];
let customLayoutSeed=Math.floor(Math.random()*1e9);
let customGrowthStart=performance.now();
let hoveredCustomNode=-1;
let draggedCustomNode=-1;
const customDragPlane=new THREE.Plane();
const customDragWorld=new THREE.Vector3();
const loveValues={words:0,time:0,service:0,touch:0,gifts:0};
const loveRows=[...document.querySelectorAll('.love-slider-row')];
function seeded(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hashLabel(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function organicNoise1(x,phase){return Math.sin(x+phase)*.58+Math.sin(x*.47+phase*1.7)*.27+Math.sin(x*.19-phase*.6)*.15;}
function disposeCustomLine(c){
  customThreadGroup.remove(c.line);
  customNodeGroup.remove(c.node);
  customNodeGroup.remove(c.glow);
  c.line.geometry.dispose(); c.line.material.dispose();
  c.node.geometry.dispose(); c.node.material.dispose();
  c.glow.geometry.dispose(); c.glow.material.dispose();
}
function clearCustomLines(){
  customLines.forEach(disposeCustomLine);
  customLines=[];
  hoveredCustomNode=-1;
  draggedCustomNode=-1;
}
function makeCustomNode(size,opacity){
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0]),3));
  const mat=new THREE.PointsMaterial({color:0xff0000,size,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:true,sizeAttenuation:true,toneMapped:false});
  const pts=new THREE.Points(geom,mat);pts.frustumCulled=false;pts.renderOrder=5;customNodeGroup.add(pts);return pts;
}
function makeCustomThread(label,li,j,seedBase){
  const rng=seeded(seedBase^hashLabel(label)^(li*7919)^(j*2371));
  const startIndex=Math.floor(rng()*surfaceCloud.length);
  const start=surfaceCloud[startIndex]?.pos?.clone()||new THREE.Vector3();
  const angle=rng()*Math.PI*2;
  const radius=2.7+rng()*2.9;
  const end=new THREE.Vector3(Math.cos(angle)*radius,(rng()-.45)*4.8,Math.sin(angle)*radius*.72);
  const positions=new Float32Array(84*3);
  const geom=new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geom.setDrawRange(0,2);
  const mat=new THREE.LineBasicMaterial({color:0xff0000,transparent:true,opacity:.80,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,toneMapped:false});
  const line=new THREE.Line(geom,mat);line.frustumCulled=false;line.renderOrder=3;customThreadGroup.add(line);
  const node=makeCustomNode(.095,.94);
  const glow=makeCustomNode(.22,.20);
  const c={
    line,node,glow,positions,start,end,label,labelIndex:li,lineIndex:j,
    phase:rng()*Math.PI*2,phase2:rng()*Math.PI*2,
    curlTurns:.7+rng()*2.2,
    curlAmp:.14+rng()*.48,
    bendAmp:.16+rng()*.68,
    waveAmp:.035+rng()*.22,
    waveFreq:1.6+rng()*4.2,
    spinSpeed:(.10+rng()*.48)*(rng()>.5?1:-1),
    floatPhase:rng()*Math.PI*2,floatPhase2:rng()*Math.PI*2,
    floatAmp:.18+rng()*.28,floatAmp2:.12+rng()*.24,
    floatSpeed:.16+rng()*.20,floatSpeed2:.14+rng()*.17,
    lateral:rng()*.48-.24,bendOffset:rng()*.32-.16,curlOffset:rng()*.20-.10,
    noiseSeed:rng()*1000,
    delay:j*.055,
    growthStart:performance.now(),
    hoverAmount:0,dragAmount:0,manualEnd:false
  };
  customLines.push(c);
  return c;
}
function appendCustomLabelThreads(label,li){
  // Exactly 3 new red pixel filaments grow for each WEAVE action.
  for(let j=0;j<3;j++) makeCustomThread(label,li,j,customLayoutSeed);
}
function buildCustomLayout(newSeed=true){
  if(!heartReady)return;
  if(newSeed)customLayoutSeed=Math.floor(Math.random()*1e9);
  clearCustomLines();
  customLabels.forEach((label,li)=>appendCustomLabelThreads(label,li));
  customGrowthStart=performance.now();
}
function removeCustomLabelThreads(label){
  const keep=[];
  customLines.forEach(c=>{
    if(c.label===label) disposeCustomLine(c);
    else keep.push(c);
  });
  customLines=keep;
  hoveredCustomNode=-1;
  draggedCustomNode=-1;
}
function reweaveSameLayout(){
  const now=performance.now();
  customGrowthStart=now;
  customLines.forEach(c=>{
    c.growthStart=now;
    c.line.geometry.setDrawRange(0,2);
    c.node.visible=false;c.glow.visible=false;
  });
}
function currentCustomEndpoint(c,sec,out=new THREE.Vector3()){
  out.copy(c.end);
  if(!c.manualEnd){
    out.x+=organicNoise1(sec*c.floatSpeed*1.12,c.floatPhase)*c.floatAmp*1.45;
    out.y+=organicNoise1(sec*c.floatSpeed2*1.04,c.floatPhase2+20)*c.floatAmp2*1.75;
    out.z+=organicNoise1(sec*c.floatSpeed*.96,c.floatPhase2+40)*c.floatAmp*1.18;
  }
  return out;
}
function customBasis(start,end){
  const dir=end.clone().sub(start);
  const len=Math.max(.001,dir.length());
  dir.divideScalar(len);
  let ref=Math.abs(dir.y)<.88?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
  const b1=new THREE.Vector3().crossVectors(dir,ref).normalize();
  const b2=new THREE.Vector3().crossVectors(dir,b1).normalize();
  return{dir,b1,b2,len};
}
function updateCustomLines(now){
  if(scenePhase==='gather'||scenePhase==='transition')return;
  const sec=now*.001;
  const loveWords=loveValues.words/99;
  const loveTime=loveValues.time/99;
  const loveService=loveValues.service/99;
  const loveTouch=loveValues.touch/99;
  const loveGifts=loveValues.gifts/99;

  customLines.forEach((c,ci)=>{
    const growth=Math.max(0,Math.min(1,(now-c.growthStart)/1500-c.delay));
    const eased=1-Math.pow(1-growth,3);
    const visibleCount=Math.max(2,Math.floor(83*eased));
    const hoverTarget=(ci===hoveredCustomNode||ci===draggedCustomNode)?1:0;
    const dragTarget=ci===draggedCustomNode?1:0;
    c.hoverAmount+=(hoverTarget-c.hoverAmount)*.18;
    c.dragAmount+=(dragTarget-c.dragAmount)*.20;

    const endTarget=currentCustomEndpoint(c,sec,new THREE.Vector3());
    const startTarget=c.start.clone();
    startTarget.x+=organicNoise1(sec*c.floatSpeed*.58,c.floatPhase2+70)*c.floatAmp2*.34;
    startTarget.y+=organicNoise1(sec*c.floatSpeed*.46,c.floatPhase+90)*c.floatAmp2*.28;
    startTarget.z+=organicNoise1(sec*c.floatSpeed*.52,c.floatPhase2+110)*c.floatAmp2*.24;

    const basis=customBasis(startTarget,endTarget);
    const {dir,b1,b2,len:pathLen}=basis;
    const samples=84;
    let tipX=startTarget.x,tipY=startTarget.y,tipZ=startTarget.z;

    for(let i=0;i<samples;i++){
      const u=i/(samples-1);
      const envelope=Math.sin(Math.PI*u);
      const baseT=Math.pow(u,.96);
      const out=startTarget.clone().lerp(endTarget,baseT);

      const touchNear=1+loveTouch*.92*(1-u);
      let swirlAmp=(c.curlAmp+c.curlOffset)*envelope*(1.0)*touchNear*(1.10-loveService*.28);
      let bendAmp=(c.bendAmp+c.bendOffset)*envelope*(.86+loveTime*.56+loveGifts*.28);
      let waveAmp=c.waveAmp*envelope*(.72+loveWords*.92+loveGifts*.30);
      const waveFreqLove=c.waveFreq+loveWords*2.8;
      const angle=c.phase+u*Math.PI*2*(c.curlTurns+loveTouch*.85)+sec*c.spinSpeed+Math.sin(sec*.42+c.phase2)*.18;

      out.addScaledVector(b1,
        Math.sin(angle)*swirlAmp*pathLen*.34 +
        Math.sin(u*Math.PI*1.2+c.phase2+sec*.24)*bendAmp*.18 +
        c.lateral*envelope +
        Math.sin(u*Math.PI*4+c.phase2)*loveGifts*envelope*pathLen*.055
      );
      out.addScaledVector(b2,
        Math.cos(angle)*swirlAmp*pathLen*.24 +
        Math.sin(u*Math.PI*2*waveFreqLove+sec*.85+c.phase)*waveAmp*pathLen*.22 +
        Math.cos(u*Math.PI*3+c.phase)*loveTime*envelope*pathLen*.035
      );

      if(loveService>0){
        const straight=startTarget.clone().lerp(endTarget,baseT);
        out.lerp(straight,loveService*.23*envelope);
      }

      // Match the older FREE-mode web: the whole filament floats and each
      // point undulates organically instead of sitting as a rigid curve.
      const wholeFloatX=organicNoise1(sec*c.floatSpeed*.62,c.floatPhase+300)*c.floatAmp*.36;
      const wholeFloatY=organicNoise1(sec*c.floatSpeed2*.54,c.floatPhase2+360)*c.floatAmp2*.54;
      const wholeFloatZ=organicNoise1(sec*c.floatSpeed*.58,c.floatPhase+420)*c.floatAmp*.42;
      out.x+=wholeFloatX;out.y+=wholeFloatY;out.z+=wholeFloatZ;

      const along=u*4.3;
      const edgeWeight=.42+Math.sin(Math.PI*u)*.88;
      const nX=organicNoise1(sec*c.floatSpeed*1.38+along,c.noiseSeed+c.floatPhase);
      const nY=organicNoise1(sec*c.floatSpeed2*1.28+along*1.17,c.noiseSeed+c.floatPhase2+100);
      const nZ=organicNoise1(sec*c.floatSpeed*1.16+along*.91,c.noiseSeed+c.floatPhase2+200);
      out.x+=nX*c.floatAmp*.42*edgeWeight;
      out.y+=nY*c.floatAmp2*.52*edgeWeight;
      out.z+=nZ*c.floatAmp*.36*edgeWeight;

      const k=i*3;
      c.positions[k]=quantize(out.x);c.positions[k+1]=quantize(out.y);c.positions[k+2]=quantize(out.z);
      if(i===visibleCount-1){tipX=out.x;tipY=out.y;tipZ=out.z;}
    }

    c.line.geometry.attributes.position.needsUpdate=true;
    c.line.geometry.setDrawRange(0,visibleCount);
    c.line.material.color.setHex(0xff0000);
    c.line.material.opacity=.76+c.hoverAmount*.22+Math.sin(sec*1.1+c.phase)*.04;
    c.node.position.set(quantize(tipX),quantize(tipY),quantize(tipZ));
    c.glow.position.copy(c.node.position);
    c.node.visible=growth>.02;c.glow.visible=growth>.02;
    c.node.material.size=.095+c.hoverAmount*.075+c.dragAmount*.055;
    c.node.material.opacity=.92+c.hoverAmount*.08;
    c.node.material.color.setHex(c.hoverAmount>.08?0xff7777:0xff0000);
    c.glow.material.size=.22+c.hoverAmount*.16+c.dragAmount*.12;
    c.glow.material.opacity=.18+c.hoverAmount*.30+c.dragAmount*.16;
  });
}
function projectedCustomNodeScreen(index){
  const c=customLines[index];if(!c)return null;
  const world=c.node.getWorldPosition(new THREE.Vector3());
  world.project(camera);
  const rect=container.getBoundingClientRect();
  return{x:rect.left+(world.x*.5+.5)*rect.width,y:rect.top+(-world.y*.5+.5)*rect.height};
}
function pickCustomNode(clientX,clientY){
  if(scenePhase!=='custom'||!customLines.length)return -1;
  let best=-1,bestD=22;
  customLines.forEach((c,i)=>{
    if(!c.node.visible)return;
    const s=projectedCustomNodeScreen(i);if(!s)return;
    const d=Math.hypot(clientX-s.x,clientY-s.y);
    if(d<bestD){bestD=d;best=i;}
  });
  return best;
}
function beginCustomNodeDrag(index,e){
  if(index<0||!customLines[index])return false;
  draggedCustomNode=index;hoveredCustomNode=index;
  const world=customLines[index].node.getWorldPosition(new THREE.Vector3());
  const normal=camera.getWorldDirection(new THREE.Vector3()).normalize();
  customDragPlane.setFromNormalAndCoplanarPoint(normal,world);
  renderer.domElement.setPointerCapture?.(e.pointerId);
  renderer.domElement.style.cursor='grabbing';
  return true;
}
function dragCustomNode(e){
  if(draggedCustomNode<0)return;
  const rect=container.getBoundingClientRect();
  pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-(((e.clientY-rect.top)/rect.height)*2-1);
  raycaster.setFromCamera(pointer,camera);
  if(!raycaster.ray.intersectPlane(customDragPlane,customDragWorld))return;
  const local=customNodeGroup.worldToLocal(customDragWorld.clone());
  // generous free-mode bounds, matching the old free cocoon behaviour
  local.x=THREE.MathUtils.clamp(local.x,-7.0,7.0);
  local.y=THREE.MathUtils.clamp(local.y,-5.8,5.8);
  local.z=THREE.MathUtils.clamp(local.z,-4.8,4.8);
  customLines[draggedCustomNode].end.copy(local);
  customLines[draggedCustomNode].manualEnd=true;
}
function endCustomNodeDrag(e){
  if(draggedCustomNode<0)return;
  draggedCustomNode=-1;
  renderer.domElement.releasePointerCapture?.(e.pointerId);
  renderer.domElement.style.cursor=hoveredCustomNode>=0?'grab':'crosshair';
}

// ---------- Character list / scrollbar ----------
let characterScroll=0,thumbDragging=false,thumbDragStartY=0,thumbStartTop=0;
function renderCharacterList(){
  characterListEl.innerHTML='';
  customLabels.forEach((label,index)=>{const row=document.createElement('div');row.className='character-item';const tx=document.createElement('div');tx.className='character-text';tx.textContent=`> ${label}`;const del=document.createElement('button');del.className='character-delete';del.type='button';del.addEventListener('click',e=>{e.stopPropagation();removeCustomLabelThreads(label);customLabels.splice(index,1);renderCharacterList();if(inspectEnabled)rebuildInspectBoxes();});row.append(tx,del);characterListEl.appendChild(row);});
  updateCharacterScroll();
}
function maxCharacterScroll(){return Math.max(0,customLabels.length*42-121);}
function updateCharacterScroll(){const max=maxCharacterScroll();characterScroll=Math.max(0,Math.min(max,characterScroll));characterListEl.style.transform=`translateY(${-characterScroll/16}rem)`;const range=101;const top=max?range*(characterScroll/max):0;characterScrollThumb.style.top=`${top/16}rem`;}
characterViewport.addEventListener('wheel',e=>{e.preventDefault();characterScroll+=e.deltaY*.45;updateCharacterScroll();},{passive:false});
characterScrollThumb.addEventListener('pointerdown',e=>{thumbDragging=true;thumbDragStartY=e.clientY;thumbStartTop=parseFloat(getComputedStyle(characterScrollThumb).top)||0;characterScrollThumb.setPointerCapture?.(e.pointerId);});
window.addEventListener('pointermove',e=>{if(!thumbDragging)return;const scale=container.getBoundingClientRect().width/1920;const dy=(e.clientY-thumbDragStartY)/scale;const top=Math.max(0,Math.min(101,thumbStartTop/scale+dy));const max=maxCharacterScroll();characterScroll=max?max*(top/101):0;updateCharacterScroll();});
window.addEventListener('pointerup',()=>{thumbDragging=false;});

expectationInput.addEventListener('focus',()=>typingPlaceholder.style.display='none');
expectationInput.addEventListener('blur',()=>{if(!expectationInput.value)typingPlaceholder.style.display='block';});
function addExpectation(){const label=expectationInput.value.trim().replace(/\s+/g,' ').slice(0,64);if(!label)return;if(customLabels.some(x=>x.toLowerCase()===label.toLowerCase()))return;AUDIO?.playSfx('weave.mp3');customLabels.push(label);expectationInput.value='';typingPlaceholder.style.display='block';renderCharacterList();appendCustomLabelThreads(label,customLabels.length-1);characterScroll=maxCharacterScroll();updateCharacterScroll();if(inspectEnabled)rebuildInspectBoxes();}
weaveAction.addEventListener('click',addExpectation);expectationInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addExpectation();}});

// ---------- love sliders ----------
const pctEls={words:document.getElementById('lovePctWords'),time:document.getElementById('lovePctTime'),service:document.getElementById('lovePctService'),touch:document.getElementById('lovePctTouch'),gifts:document.getElementById('lovePctGifts')};
loveRows.forEach(row=>{const key=row.dataset.key,input=row.querySelector('input'),fill=row.querySelector('.love-fill');const sync=()=>{loveValues[key]=Number(input.value);fill.style.width=`${(239*(loveValues[key]/99))/16}rem`;pctEls[key].textContent=`${loveValues[key]}%`;};input.addEventListener('input',sync);sync();});

// ---------- 7-step bars ----------
function makeBars(containerId,type,rects,onSelect,defaultStep){const wrap=document.getElementById(containerId);wrap.innerHTML='';rects.forEach((r,i)=>{const b=document.createElement('div');b.className=`bar-piece ${type}`;b.style.left=`${r.left/16}rem`;b.style.top=`${r.top/16}rem`;b.style.width=`${r.width/16}rem`;b.style.height=`${r.height/16}rem`;if(type==='bg')b.style.background=`rgba(255,0,0,${[.10,.25,.40,.55,.70,.85,1][i]})`;b.addEventListener('click',()=>onSelect(i+1));wrap.appendChild(b);});onSelect(defaultStep);}
const scaleRects=[1663,1687,1711,1735,1759,1783,1807].map((left,i)=>({left,top:774-i*3,width:18,height:10+i*3}));
const speedHeights=[28,22,16,10,16,22,28];const speedRects=[1663,1687,1711,1735,1759,1783,1807].map((left,i)=>({left,top:797+(28-speedHeights[i]),width:18,height:speedHeights[i]}));
const bgRects=[1663,1687,1711,1735,1759,1783,1807].map(left=>({left,top:838,width:18,height:28}));
function refreshBarStates(){document.querySelectorAll('#scaleBars .bar-piece').forEach((b,i)=>b.classList.toggle('filled',i<scaleStep));document.querySelectorAll('#speedBars .bar-piece').forEach((b,i)=>b.classList.toggle('active',i===speedStep-1));document.querySelectorAll('#backgroundBars .bar-piece').forEach((b,i)=>b.classList.toggle('active',i===bgStep-1));if(scenePhase!=='transition'&&scenePhase!=='gather')bgScene3.style.opacity=String(BG_LEVELS[bgStep-1]);}
makeBars('scaleBars','scale',scaleRects,s=>{scaleStep=s;refreshBarStates();},4);makeBars('speedBars','speed',speedRects,s=>{speedStep=s;refreshBarStates();},4);makeBars('backgroundBars','bg',bgRects,s=>{bgStep=s;refreshBarStates();},7);

function resetCustom(){customLabels=[];clearCustomLines();renderCharacterList();Object.keys(loveValues).forEach(k=>loveValues[k]=0);loveRows.forEach(row=>{row.querySelector('input').value='0';row.querySelector('input').dispatchEvent(new Event('input'));});scaleStep=4;speedStep=4;bgStep=7;refreshBarStates();if(inspectEnabled)rebuildInspectBoxes();}
resetAction.addEventListener('click',resetCustom);varyAction.addEventListener('click',()=>{if(customLabels.length)buildCustomLayout(true);});reweaveAction.addEventListener('click',()=>{if(customLabels.length)reweaveSameLayout();});

// ---------- Inspect tracking boxes orbiting around the actual heart ----------
let inspectEnabled=false,inspectBoxes=[];
const inspectLinks=document.getElementById('inspectLinks');
function inspectLabels(){const src=customLabels.length?customLabels:['HEART'];const out=[...src];while(out.length<10)out.push(src[Math.floor(Math.random()*src.length)]);return out;}
function clearInspect(){inspectBoxes.forEach(b=>b.el.remove());inspectBoxes=[];if(inspectLinks)inspectLinks.innerHTML='';}
function rebuildInspectLinks(){
  if(!inspectLinks)return;
  inspectLinks.innerHTML='';
  for(let i=0;i<inspectBoxes.length;i++){
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    inspectLinks.appendChild(line);
    inspectBoxes[i].link=line;
  }
}
function rebuildInspectBoxes(){
  clearInspect();
  inspectLabels().forEach((label,i)=>{
    const el=document.createElement('div');el.className='inspect-box';
    const tag=document.createElement('div');tag.className='inspect-label';tag.textContent=label;
    const id=document.createElement('div');id.className='inspect-id';id.textContent=String(i+1).padStart(2,'0');
    el.append(tag,id);inspectLayer.append(el);
    inspectBoxes.push({el,angle:Math.random()*Math.PI*2,radius:120+Math.random()*260,speed:(.15+Math.random()*.28)*(Math.random()<.5?-1:1),w:80+Math.random()*140,h:48+Math.random()*100,phase:Math.random()*Math.PI*2,x:0,y:0,link:null});
  });
  rebuildInspectLinks();
}
function projectedHeartCenter(){const v=new THREE.Vector3();heartGroup.getWorldPosition(v);v.project(camera);return{x:(v.x*.5+.5)*1920,y:(-.5*v.y+.5)*1080};}
function updateInspect(dt,now){
  if(!inspectEnabled)return;
  const c=projectedHeartCenter();
  inspectBoxes.forEach((b,i)=>{
    b.angle+=b.speed*dt;
    const pulse=1+Math.sin(now*.001*.9+b.phase)*.12;
    const x=c.x+Math.cos(b.angle)*b.radius*pulse-b.w*.5;
    const y=c.y+Math.sin(b.angle)*b.radius*.55*pulse-b.h*.5;
    b.x=x;b.y=y;
    const wRem=`${b.w/16}rem`,hRem=`${b.h/16}rem`,transform=`translate(${x/16}rem,${y/16}rem)`;
    b.el.style.width=wRem;b.el.style.height=hRem;b.el.style.transform=transform;
  });
  inspectBoxes.forEach((b,i)=>{
    if(!b.link||!inspectBoxes.length)return;
    const next=inspectBoxes[(i+1)%inspectBoxes.length];
    b.link.setAttribute('x1',String(b.x+b.w*.5));
    b.link.setAttribute('y1',String(b.y+b.h*.5));
    b.link.setAttribute('x2',String(next.x+next.w*.5));
    b.link.setAttribute('y2',String(next.y+next.h*.5));
  });
}
inspectAction.addEventListener('click',()=>{inspectEnabled=!inspectEnabled;inspectLayer.classList.toggle('active',inspectEnabled);inspectLayer.setAttribute('aria-hidden',String(!inspectEnabled));inspectAction.classList.toggle('is-active',inspectEnabled);inspectAction.setAttribute('aria-pressed',String(inspectEnabled));if(inspectEnabled)rebuildInspectBoxes();else clearInspect();});

// ---------- mini floating red thread field ----------
// Continuous anti-aliased red filaments. Cursor proximity still expands the
// vertical spread, but the field is intentionally sparse enough to read each strand.
let heartbeatPointer={x:158,y:54,inside:false};
heartbeatField.addEventListener('pointermove',e=>{const r=heartbeatField.getBoundingClientRect();heartbeatPointer.x=(e.clientX-r.left)/r.width*316;heartbeatPointer.y=(e.clientY-r.top)/r.height*108;heartbeatPointer.inside=true;});
heartbeatField.addEventListener('pointerleave',()=>heartbeatPointer.inside=false);
const heartbeatStrands=[];
(function buildHeartbeatStrands(){
  const rng=seeded(918273);
  // Fewer strands than before so they do not merge into one blurred block.
  const groups=4, per=3;
  for(let g=0;g<groups;g++){
    const groupPhase=(g/groups)*Math.PI*2;
    const band=(g-(groups-1)/2)/((groups-1)/2||1);
    const groupOffset=band*(.060+rng()*.042);
    const carrierFreq=.72+rng()*.36,carrierSpeed=.72+rng()*.30;
    const braidFreq=1.45+rng()*.85,braidSpeed=.78+rng()*.34;
    const driftFreq=.15+rng()*.20,driftSpeed=.10+rng()*.13;
    const envelopeFreq=.17+rng()*.18,envelopeSpeed=.07+rng()*.08;
    const groupAmp=7+rng()*5;
    for(let i=0;i<per;i++){
      const q=per===1?0:i/(per-1),local=q-.5;
      heartbeatStrands.push({groupPhase,groupOffset,localOffset:local*(5+rng()*5),internalPhase:rng()*Math.PI*2,carrierFreq,carrierSpeed,braidFreq,braidSpeed,driftFreq,driftSpeed,envelopeFreq,envelopeSpeed,groupAmp,microFreq:3+rng()*3,microSpeed:.16+rng()*.24,microAmp:.15+rng()*.45,alpha:.58+rng()*.22});
    }
  }
})();
function heartbeatExpansion(){
  const d=Math.abs(heartbeatPointer.y-54);
  const near=heartbeatPointer.inside?1-Math.min(1,d/(108*.48)):0;
  const p=near*near*(3-2*near);
  return{p,amplitude:1.08+p*2.15,spread:1.12+p*1.55,detail:.70+p*.70,fan:1.10+p*1.38};
}
function heartbeatY(nx,s,exp,now){
  const cx=nx*Math.PI*2,center=54;
  const carrier=Math.sin(cx*s.carrierFreq-now*.001*s.carrierSpeed+s.groupPhase);
  const braid=Math.sin(cx*s.braidFreq-now*.001*s.braidSpeed+s.internalPhase);
  const drift=Math.sin(cx*s.driftFreq-now*.001*s.driftSpeed+s.internalPhase*.7);
  const env=.48+.52*(Math.sin(cx*s.envelopeFreq-now*.001*s.envelopeSpeed+s.groupPhase*.65)*.5+.5);
  const micro=Math.sin(cx*s.microFreq-now*.001*s.microSpeed+s.internalPhase)*s.microAmp*exp.detail;
  return center+108*s.groupOffset*exp.fan+carrier*s.groupAmp*exp.amplitude*env+s.localOffset*exp.spread+(braid*(3.2+5.2*exp.p)+drift*(2.0+1.4*exp.p))*(.22+Math.abs(s.localOffset)*.025)+micro;
}
function drawHeartbeatPreview(now){
  const exp=heartbeatExpansion();
  heartbeatCtx.setTransform(1,0,0,1,0,0);
  heartbeatCtx.clearRect(0,0,316,108);
  heartbeatCtx.imageSmoothingEnabled=true;
  heartbeatCtx.lineCap='round';
  heartbeatCtx.lineJoin='round';
  heartbeatStrands.forEach((s,index)=>{
    heartbeatCtx.beginPath();
    for(let x=-4;x<=320;x+=2){
      const y=heartbeatY(x/316,s,exp,now);
      if(x===-4)heartbeatCtx.moveTo(x,y);else heartbeatCtx.lineTo(x,y);
    }
    heartbeatCtx.strokeStyle=`rgba(255,0,0,${Math.min(.96,s.alpha+exp.p*.08)})`;
    heartbeatCtx.lineWidth=index%3===0?1.35:1.05;
    heartbeatCtx.stroke();
  });
}

// ---------- Hide / show bars + confirmation ----------
function setBarsVisible(v){barsHidden=!v;customUI.classList.toggle('is-hidden-bars',!v);if(inspectEnabled)inspectLayer.classList.toggle('active',v);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function enterConfirmation(){
  if(scenePhase!=='custom')return;
  scenePhase='confirm-transition';

  // Clear any inline opacity/visibility left by the very first transition into
  // the custom stage. Otherwise that inline opacity can override the base
  // .custom-ui opacity:0 state, making the first YES return appear instantly.
  customUI.style.opacity='';
  customUI.style.visibility='';
  customUI.classList.remove('is-visible');
  inspectLayer.classList.remove('active');
  customBottomPrompt.classList.remove('is-visible');

  await wait(650);
  confirmPhase.classList.add('is-visible');
  confirmPhase.setAttribute('aria-hidden','false');
  scenePhase='confirm';
  startConfirmQuestion();
}
function splitFive(text){const words=text.split(/\s+/);return{lead:words.slice(0,5).join(' '),rest:words.slice(5).join(' ')}}
let confirmTyping=false,confirmToken=0,confirmMode='question';
async function typeConfirm(text,after){
  // Start at typing onset and allow the Deities voice file to finish naturally.
  AUDIO?.playSfx('deitiesvoice.mp3');
  confirmTyping=true;
  confirmDialogue.textContent='';
  confirmChoices.classList.remove('is-visible');
  confirmContinue.classList.remove('is-visible');
  confirmContinue.style.display='none';
  confirmContinue.style.visibility='hidden';
  confirmContinue.style.opacity='0';
  confirmContinue.style.animation='none';
  const token=++confirmToken;
  const{lead}=splitFive(text);
  for(let i=1;i<=lead.length;i++){
    if(token!==confirmToken){return;}
    confirmDialogue.textContent=lead.slice(0,i);
    await wait(58);
  }
  if(token!==confirmToken){return;}
  confirmDialogue.textContent=text;
  confirmTyping=false;
  if(after)after();
}
function startConfirmQuestion(){confirmMode='question';typeConfirm("There... your wish has taken shape. Are you truly satisfied with the one you've created? Is there anything else you wish to add?",()=>confirmChoices.classList.add('is-visible'));}
function startConfirmNo(){
  confirmMode='ready';
  confirmChoices.classList.remove('is-visible');
  confirmContinue.classList.remove('is-visible');
  typeConfirm('Oh... I hear them already. Well, your lover is ready to meet you. May your love be everything you wished for.',()=>{
    // Explicitly initialise the final prompt every time. This avoids the first-play
    // race where it could remain hidden until a page reload.
    confirmContinue.style.display='block';
    confirmContinue.style.visibility='visible';
    confirmContinue.style.opacity='0.5';
    confirmContinue.style.animation='none';
    void confirmContinue.offsetWidth;
    confirmContinue.classList.add('is-visible');
    requestAnimationFrame(()=>{
      confirmContinue.style.animation='blinkHalf 1s steps(1,end) infinite';
    });
  });
}
confirmYes.addEventListener('click',async()=>{
  AUDIO?.playSfx('click.mp3');
  confirmPhase.classList.remove('is-visible');
  await wait(650);
  confirmPhase.setAttribute('aria-hidden','true');

  scenePhase='custom';
  barsHidden=false;
  customUI.classList.remove('is-hidden-bars');

  // Always establish a real hidden start frame before fading the custom UI
  // back in. This makes the first YES behave exactly like later YES clicks.
  customUI.classList.remove('is-visible');
  customUI.style.visibility='visible';
  customUI.style.opacity='0';
  customBottomPrompt.classList.remove('is-visible');
  void customUI.offsetWidth;

  requestAnimationFrame(()=>{
    customUI.classList.add('is-visible');
    customUI.style.opacity='1';
    customBottomPrompt.classList.add('is-visible');
  });

  setTimeout(()=>{
    customUI.style.opacity='';
    customUI.style.visibility='';
  },900);

  if(inspectEnabled)inspectLayer.classList.add('active');
});
confirmNo.addEventListener('click',()=>{AUDIO?.playSfx('click.mp3');startConfirmNo();});

window.addEventListener('keydown',e=>{
  if(e.repeat)return;
  if(document.activeElement===expectationInput)return;
  const k=e.key.toLowerCase();
  if(k==='c'&&scenePhase==='gather'&&completed){AUDIO?.playSfx('press.wav');transitionToCustom();return;}
  if(k==='h'&&scenePhase==='custom'){AUDIO?.playSfx('press.wav');setBarsVisible(barsHidden);return;}
  if(k==='s'&&scenePhase==='custom'){AUDIO?.playSfx('press.wav');enterConfirmation();return;}
  if(k==='c'&&scenePhase==='confirm'&&confirmMode==='ready'&&!confirmTyping&&confirmContinue.classList.contains('is-visible')){AUDIO?.playSfx('press.wav');AUDIO?.stopLoopSfx('scene3-heartbeat');window.sceneWipeNavigate('./scene4.html');}
});

// extra animation hooks for the original Three.js loop
const originalUpdateHeart=updateHeart;
updateHeart=function(time){
  originalUpdateHeart(time);
  if(scenePhase!=='gather'&&scenePhase!=='transition')orbitYaw+=.0036*speedFactor();
};
const originalAnimate=animate;
// animate already schedules itself; additional work is injected below through a parallel RAF.
let extraLast=performance.now();
function extraLoop(now){const dt=Math.min(.05,(now-extraLast)/1000);extraLast=now;updateSceneTransform(now);updateCustomLines(now);updateInspect(dt,now);drawHeartbeatPreview(now);requestAnimationFrame(extraLoop);}requestAnimationFrame(extraLoop);

renderCharacterList();syncGatherUI();
loadHeart();
requestAnimationFrame(animate);

