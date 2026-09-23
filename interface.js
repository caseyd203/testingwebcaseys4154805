(() => {
  'use strict';

  const root = document.createElement('div');
  root.className = 'scarlet-interface';
  root.id = 'scarletInterface';
  root.innerHTML = `
    <div id="scarletInterfaceOverlay" class="scarlet-interface-overlay" aria-hidden="true"></div>

    <button id="scarletCaptureBtn" class="scarlet-interface-btn scarlet-capture-btn" type="button" aria-label="Capture image"></button>
    <button id="scarletMusicBtn" class="scarlet-interface-btn scarlet-music-btn" type="button" aria-label="Music and sound settings"></button>
    <button id="scarletInfoBtn" class="scarlet-interface-btn scarlet-info-btn" type="button" aria-label="Information"></button>

    <section id="scarletCaptureModal" class="scarlet-capture-modal" aria-hidden="true">
      <div class="scarlet-capture-box"></div>
      <img id="scarletCapturePreview" class="scarlet-capture-preview" alt="Screenshot preview" />
      <div class="scarlet-capture-title">DOWNLOAD THE IMAGE</div>
      <button id="scarletCaptureYes" class="scarlet-capture-choice scarlet-capture-yes" type="button">&gt; YES</button>
      <button id="scarletCaptureNo" class="scarlet-capture-choice scarlet-capture-no" type="button">&gt; NO</button>
    </section>

    <section id="scarletMusicPanel" class="scarlet-music-panel" aria-hidden="true">
      <div class="scarlet-music-label music">MUSIC</div>
      <div class="scarlet-music-label sfx">SFX</div>
      <div id="scarletMusicSlider" class="scarlet-volume-shell music" role="slider" aria-label="Music volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="82" tabindex="0">
        <div class="scarlet-volume-fill"></div>
        <div class="scarlet-volume-frame"></div>
      </div>
      <div id="scarletSfxSlider" class="scarlet-volume-shell sfx" role="slider" aria-label="Sound effect volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="82" tabindex="0">
        <div class="scarlet-volume-fill"></div>
        <div class="scarlet-volume-frame"></div>
      </div>
    </section>

    <section id="scarletInfoModal" class="scarlet-info-modal" aria-hidden="true">
      <div class="scarlet-info-box"></div>
      <div class="scarlet-info-copy">
        <p>Scarlet Wishes is an interactive experience inspired by the East Asian legend of the Red Thread of Fate, where two destined people are connected by an invisible red thread.</p>
        <p>In this project, however, fate is placed in your own hands. You are allowed to shape the person you wish to love - their personality, their affection, and the way they treat you.</p>
        <p>But the more we try to shape love into exactly what we want, the more our wishes can become expectations, and our expectations can become restraints.</p>
        <p>Through the metaphor of the red thread, Scarlet Wishes explores how love can become restrained by the expectations we place upon it. It suggests that love is not about finding someone who perfectly matches what we imagine, but about two imperfect people choosing to grow, change, and build a relationship together.</p>
      </div>
    </section>
  `;
  document.body.appendChild(root);

  const overlay = root.querySelector('#scarletInterfaceOverlay');
  const captureBtn = root.querySelector('#scarletCaptureBtn');
  const musicBtn = root.querySelector('#scarletMusicBtn');
  const infoBtn = root.querySelector('#scarletInfoBtn');
  const captureModal = root.querySelector('#scarletCaptureModal');
  const capturePreview = root.querySelector('#scarletCapturePreview');
  const captureYes = root.querySelector('#scarletCaptureYes');
  const captureNo = root.querySelector('#scarletCaptureNo');
  const musicPanel = root.querySelector('#scarletMusicPanel');
  const infoModal = root.querySelector('#scarletInfoModal');
  const musicSlider = root.querySelector('#scarletMusicSlider');
  const sfxSlider = root.querySelector('#scarletSfxSlider');

  let captureOpen = false;
  let infoOpen = false;
  let musicOpen = false;
  let captureDataUrl = '';
  let html2canvasPromise = null;

  function syncOverlay() {
    const visible = captureOpen || infoOpen;
    overlay.classList.toggle('is-visible', visible);
    overlay.setAttribute('aria-hidden', String(!visible));
  }

  function setCaptureOpen(v) {
    captureOpen = !!v;
    captureModal.classList.toggle('is-visible', captureOpen);
    captureModal.setAttribute('aria-hidden', String(!captureOpen));
    syncOverlay();
  }

  function setInfoOpen(v) {
    infoOpen = !!v;
    infoModal.classList.toggle('is-visible', infoOpen);
    infoModal.setAttribute('aria-hidden', String(!infoOpen));
    syncOverlay();
  }

  function setMusicOpen(v) {
    musicOpen = !!v;
    musicPanel.classList.toggle('is-visible', musicOpen);
    musicPanel.setAttribute('aria-hidden', String(!musicOpen));
  }

  function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (html2canvasPromise) return html2canvasPromise;

    html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      script.async = true;
      script.onload = () => window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas failed to initialise'));
      script.onerror = () => reject(new Error('Could not load html2canvas'));
      document.head.appendChild(script);
    });
    return html2canvasPromise;
  }

  function findDesignStage() {
    return document.querySelector(
      '#coverStage, #scene1Stage, #scene2Stage, #app, #scene4Stage, #scene5Stage, #endingStage, .scene-stage, .design-stage'
    );
  }

  async function captureCurrentDesign() {
    const h2c = await loadHtml2Canvas();
    const stage = findDesignStage();
    if (!stage) throw new Error('Design stage not found');

    try { await document.fonts?.ready; } catch (_) {}
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const rect = stage.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Design stage has no visible size');

    /*
      IMPORTANT: capture the scene element itself, not the browser viewport and
      not a manually-cropped page screenshot. The project scales the 1920×1080
      stage by changing the root font-size, so rect.width/height are the exact
      on-screen dimensions of the whole design canvas. html2canvas can render
      that complete element directly; scaling by 1920 / rect.width restores the
      original 1920×1080 design resolution without any crop-coordinate mismatch.
    */
    const captureScale = DESIGN_W / rect.width;
    const sceneCanvas = await h2c(stage, {
      backgroundColor: '#000000',
      useCORS: true,
      allowTaint: true,
      logging: false,
      scale: captureScale,
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        const clonedStage = clonedDoc.querySelector(
          '#coverStage, #scene1Stage, #scene2Stage, #app, #scene4Stage, #scene5Stage, #endingStage, .scene-stage, .design-stage'
        );
        if (clonedStage) {
          clonedStage.style.left = '0';
          clonedStage.style.top = '0';
          clonedStage.style.transform = 'none';
          clonedStage.style.margin = '0';
        }
      }
    });

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = DESIGN_W;
    finalCanvas.height = DESIGN_H;
    const ctx = finalCanvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Always draw the COMPLETE rendered stage into the complete 1920×1080 output.
    ctx.drawImage(sceneCanvas, 0, 0, sceneCanvas.width, sceneCanvas.height, 0, 0, DESIGN_W, DESIGN_H);

    // The fixed three-button interface is outside the scene stage. Capture that
    // complete 1920×1080 interface layer using the same design-space scale and
    // composite it over the scene. Capture/info modals are still closed here.
    const interfaceRoot = document.getElementById('scarletInterface');
    if (interfaceRoot) {
      const iRect = interfaceRoot.getBoundingClientRect();
      const interfaceScale = iRect.width > 0 ? DESIGN_W / iRect.width : captureScale;
      const interfaceCanvas = await h2c(interfaceRoot, {
        backgroundColor: null,
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: interfaceScale,
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          const clonedInterface = clonedDoc.getElementById('scarletInterface');
          if (clonedInterface) {
            clonedInterface.style.left = '0';
            clonedInterface.style.top = '0';
            clonedInterface.style.transform = 'none';
            clonedInterface.style.margin = '0';
          }
        }
      });
      ctx.drawImage(interfaceCanvas, 0, 0, interfaceCanvas.width, interfaceCanvas.height, 0, 0, DESIGN_W, DESIGN_H);
    }

    return finalCanvas.toDataURL('image/png');
  }

  function downloadDataUrl(dataUrl) {
    if (!dataUrl) return;
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `scarlet-wishes-${stamp}.png`;
    a.href = dataUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  captureBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (captureOpen) return;

    // Take the image at the same moment as the shutter sound starts. Only after
    // that sound finishes does the preview UI fade in.
    const soundDone = window.ScarletAudio
      ? ScarletAudio.playSfxUntilEnd('screenshot.mp3', { safetyMs: 6000 })
      : Promise.resolve();

    try {
      const [dataUrl] = await Promise.all([captureCurrentDesign(), soundDone]);
      captureDataUrl = dataUrl;
      capturePreview.src = dataUrl;
      if (infoOpen) setInfoOpen(false);
      setCaptureOpen(true);
    } catch (error) {
      console.error('[Scarlet Interface] Screenshot failed:', error);
      await soundDone.catch(() => {});
    }
  });

  captureYes.addEventListener('click', (event) => {
    event.stopPropagation();
    window.ScarletAudio?.playSfx('screenshot.mp3');
    downloadDataUrl(captureDataUrl);
  });

  captureNo.addEventListener('click', (event) => {
    event.stopPropagation();
    window.ScarletAudio?.playSfx('click.mp3');
    setCaptureOpen(false);
  });

  musicBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    window.ScarletAudio?.playSfx('click.mp3');
    setMusicOpen(!musicOpen);
  });

  infoBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    window.ScarletAudio?.playSfx('click.mp3');
    const next = !infoOpen;
    if (next && captureOpen) setCaptureOpen(false);
    setInfoOpen(next);
  });

  function setupVolumeSlider(el, initial, onChange) {
    const fill = el.querySelector('.scarlet-volume-fill');
    let dragging = false;
    let value = Math.max(0, Math.min(1, initial));

    function render() {
      // The requested active drag range is left 129 → 301 inside boxmusic:
      // 172px of usable fill length.
      const px = 172 * value;
      fill.style.width = `${px / 16}rem`;
      el.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    }

    function setFromPointer(event) {
      const rect = el.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      // 5px inner offset on the supplied frame image.
      value = Math.max(0, Math.min(1, (localX - 5 * (rect.width / 181)) / (172 * (rect.width / 181))));
      render();
      onChange(value);
    }

    el.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      dragging = true;
      el.setPointerCapture?.(event.pointerId);
      setFromPointer(event);
    });
    el.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      setFromPointer(event);
    });
    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      try { el.releasePointerCapture?.(event.pointerId); } catch (_) {}
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      value = Math.max(0, Math.min(1, value + (event.key === 'ArrowRight' ? 0.05 : -0.05)));
      render();
      onChange(value);
    });

    render();
  }

  const audio = window.ScarletAudio;
  setupVolumeSlider(
    musicSlider,
    audio?.getMusicVolume?.() ?? 141 / 172,
    value => audio?.setMusicVolume(value)
  );
  setupVolumeSlider(
    sfxSlider,
    audio?.getSfxVolume?.() ?? 141 / 172,
    value => audio?.setSfxVolume(value)
  );

  // Clicking the dark overlay itself intentionally does not close anything;
  // the supplied interaction uses the three interface buttons / YES / NO only.

  window.ScarletInterface = {
    root,
    setCaptureOpen,
    setInfoOpen,
    setMusicOpen,
    captureCurrentDesign
  };
})();
