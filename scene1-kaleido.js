(() => {
  const canvas = document.getElementById('scene1KaleidoBg');
  const stage = document.getElementById('scene1Stage');
  if (!canvas || !stage) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const TAU = Math.PI * 2;

  let w = 0;
  let h = 0;
  let dpr = 1;
  let last = performance.now();
  let levelPhase = 0;
  let rotationPhase = 0;
  let mode = 0;
  let previousMode = 0;
  let transition = 1;

  // Mode 01 is exactly the background form from the previous version.
  // The other forms keep the same infinite-thread visual language but change
  // geometry when the player clicks, without touching any Scene 1 UI/actions.
  const FORMS = [
    { sides: 4, ratio: 1.0525, angleStep: 4.15, baseRadius: 1.65, baseAngle: -0.18, rotation:  0.78, alpha: 0.48 },
    { sides: 5, ratio: 1.0505, angleStep: 3.35, baseRadius: 1.60, baseAngle:  0.08, rotation: -0.64, alpha: 0.48 },
    { sides: 3, ratio: 1.0550, angleStep: 5.10, baseRadius: 1.70, baseAngle: -0.30, rotation:  0.70, alpha: 0.50 },
    { sides: 6, ratio: 1.0485, angleStep: 3.00, baseRadius: 1.58, baseAngle:  0.22, rotation: -0.58, alpha: 0.47 },
    { sides: 8, ratio: 1.0470, angleStep: 2.55, baseRadius: 1.55, baseAngle: -0.05, rotation:  0.52, alpha: 0.46 },
    { sides: 4, ratio: 1.0575, angleStep: 6.10, baseRadius: 1.72, baseAngle:  0.38, rotation: -0.82, alpha: 0.50 }
  ];

  const settings = {
    zoomLevelsPerSecond: 12.5,
    lineWidth: 1.05,
    red: 235,
    centerX: 0.5,
    centerY: 0.5
  };

  function resize() {
    const rect = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function polygonPoints(form, index, level, cx, cy, extraScale = 1, extraRot = 0) {
    const radius = form.baseRadius * Math.pow(form.ratio, level) * extraScale;
    const angle = form.baseAngle + index * (form.angleStep * Math.PI / 180) + rotationPhase * form.rotation + extraRot;
    const pts = [];

    for (let k = 0; k < form.sides; k++) {
      const a = angle + Math.PI * 0.25 + k * TAU / form.sides;
      pts.push({
        x: cx + Math.cos(a) * radius,
        y: cy + Math.sin(a) * radius
      });
    }
    return pts;
  }

  function drawEdge(a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawForm(formIndex, opacity, scaleMul = 1, rotOffset = 0) {
    const form = FORMS[formIndex];
    const cx = w * settings.centerX;
    const cy = h * settings.centerY;
    const farthestCorner = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(w - cx, cy),
      Math.hypot(cx, h - cy),
      Math.hypot(w - cx, h - cy)
    );

    const maxRadius = farthestCorner * 3.2;
    const minRadius = 0.55;
    const logRatio = Math.log(form.ratio);
    const minLevel = Math.floor(Math.log(minRadius / form.baseRadius) / logRatio - levelPhase) - 3;
    const maxLevel = Math.ceil(Math.log(maxRadius / form.baseRadius) / logRatio - levelPhase) + 3;

    ctx.save();
    ctx.strokeStyle = `rgba(${settings.red}, 7, 22, ${form.alpha * opacity})`;
    ctx.lineWidth = settings.lineWidth;
    ctx.globalCompositeOperation = 'source-over';

    for (let i = minLevel; i <= maxLevel; i++) {
      const pts = polygonPoints(form, i, i + levelPhase, cx, cy, scaleMul, rotOffset);
      for (let k = 0; k < pts.length; k++) drawEdge(pts[k], pts[(k + 1) % pts.length]);
    }
    ctx.restore();
  }

  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    if (transition < 1) {
      transition = Math.min(1, transition + 0.045);
      const e = transition * transition * (3 - 2 * transition);
      drawForm(previousMode, 1 - e, 1 - e * 0.04, -e * 0.08);
      drawForm(mode, e, 0.96 + e * 0.04, (1 - e) * 0.08);
    } else {
      drawForm(mode, 1);
    }
  }

  function animate(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    levelPhase += settings.zoomLevelsPerSecond * dt;
    rotationPhase += dt;
    if (levelPhase > 1000) levelPhase -= 1000;
    if (rotationPhase > 10000) rotationPhase -= 10000;
    render();
    requestAnimationFrame(animate);
  }

  function shouldIgnoreClick(target) {
    return !!target.closest('button, .scarlet-interface, a, input, textarea, select');
  }

  // Click anywhere in Scene 1 (except actual buttons/interface controls) to
  // alternate the background form. No other scene receives this listener.
  window.addEventListener('click', (event) => {
    if (shouldIgnoreClick(event.target)) return;
    previousMode = mode;
    mode = (mode + 1) % FORMS.length;
    transition = 0;
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(animate);
})();
