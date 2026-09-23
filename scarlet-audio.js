(() => {
  'use strict';

  // When a scene is running inside the persistent shell, use the single audio
  // engine owned by the top document. This keeps music alive across scene HTML
  // changes and avoids browser autoplay blocking on every new page.
  if (window.parent && window.parent !== window && window.parent.ScarletAudio) {
    window.ScarletAudio = window.parent.ScarletAudio;
    return;
  }

  const MUSIC_PATH = './MUSIC/music.mp3';
  const SFX_BASE = './SOUNDEFFECT/';
  const STORE = {
    musicVolume: 'scarlet:music-volume',
    sfxVolume: 'scarlet:sfx-volume',
    musicTime: 'scarlet:music-time',
    audioPrimed: 'scarlet:audio-primed'
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  let musicVolume = clamp01(parseFloat(localStorage.getItem(STORE.musicVolume) ?? '0.82'));
  let sfxVolume = clamp01(parseFloat(localStorage.getItem(STORE.sfxVolume) ?? '0.82'));

  let audioCtx = null;
  let musicMaster = null;
  let sfxMaster = null;
  const bufferCache = new Map();
  const reversedCache = new Map();
  const activeSfx = new Set();
  const loopedSfx = new Map();

  let musicSource = null;
  let musicBuffer = null;
  let musicStartedAt = 0;
  let musicStartOffset = 0;
  let musicStartingPromise = null;
  let musicWanted = false;

  let gatherToken = 0;
  let gatherHandle = null;
  let impulseBuffer = null;

  const PRELOAD_FILES = [
    'click.mp3', 'press.wav', 'typing.mp3', 'deitiesvoice.mp3', 'open.mp3',
    'writing.mp3', 'threadsgather.mp3', 'heartbeat.mp3', 'weave.mp3',
    'flappingwings.mp3', 'ready.mp3', 'alert.mp3', 'error.mp3',
    'screenshot.mp3', 'end.mp3', 'download.mp3'
  ];

  function ensureContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio API is unavailable in this browser.');
      audioCtx = new Ctx();

      musicMaster = audioCtx.createGain();
      musicMaster.gain.value = musicVolume;
      musicMaster.connect(audioCtx.destination);

      sfxMaster = audioCtx.createGain();
      sfxMaster.gain.value = sfxVolume;
      sfxMaster.connect(audioCtx.destination);
    }
    return audioCtx;
  }

  async function resumeContext() {
    const ctx = ensureContext();
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (_) {}
    }
    return ctx;
  }

  async function loadBuffer(path) {
    if (bufferCache.has(path)) return bufferCache.get(path);
    const promise = (async () => {
      const ctx = ensureContext();
      const response = await fetch(path, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not load ${path}`);
      const bytes = await response.arrayBuffer();
      return await ctx.decodeAudioData(bytes.slice(0));
    })();
    bufferCache.set(path, promise);
    return promise;
  }

  function warmAudioAssets() {
    // Decoding is allowed while AudioContext is suspended. Starting this on the
    // cover means Scene 1's very first typing sound is already ready.
    try { loadBuffer(MUSIC_PATH).catch(() => {}); } catch (_) {}
    PRELOAD_FILES.forEach(file => {
      try { loadBuffer(`${SFX_BASE}${file}`).catch(() => {}); } catch (_) {}
    });
  }

  function currentMusicTime() {
    if (!musicSource || !musicBuffer || !audioCtx) return Number(sessionStorage.getItem(STORE.musicTime) || 0) || 0;
    const elapsed = Math.max(0, audioCtx.currentTime - musicStartedAt);
    return (musicStartOffset + elapsed) % musicBuffer.duration;
  }

  function saveMusicTime() {
    try { sessionStorage.setItem(STORE.musicTime, String(currentMusicTime())); } catch (_) {}
  }

  async function tryStartMusic() {
    musicWanted = true;
    if (musicSource) return true;
    if (musicStartingPromise) return musicStartingPromise;

    musicStartingPromise = (async () => {
      try {
        const ctx = await resumeContext();
        const buffer = await loadBuffer(MUSIC_PATH);
        if (!musicWanted || musicSource) return !!musicSource;

        musicBuffer = buffer;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(musicMaster);

        let saved = Number(sessionStorage.getItem(STORE.musicTime) || 0);
        if (!Number.isFinite(saved) || saved < 0) saved = 0;
        const offset = buffer.duration > 0 ? saved % buffer.duration : 0;
        musicStartOffset = offset;
        musicStartedAt = ctx.currentTime;
        source.start(0, offset);
        musicSource = source;

        source.onended = () => {
          if (musicSource === source) musicSource = null;
        };
        return true;
      } catch (error) {
        console.warn('[ScarletAudio] music could not start:', error);
        return false;
      }
    })().finally(() => { musicStartingPromise = null; });

    return musicStartingPromise;
  }

  function stopMusic(reset = false) {
    musicWanted = false;
    if (musicSource) {
      saveMusicTime();
      try { musicSource.stop(); } catch (_) {}
      try { musicSource.disconnect(); } catch (_) {}
      musicSource = null;
    }
    if (reset) {
      try { sessionStorage.setItem(STORE.musicTime, '0'); } catch (_) {}
      musicStartOffset = 0;
    }
  }

  function setMusicVolume(v) {
    musicVolume = clamp01(v);
    localStorage.setItem(STORE.musicVolume, String(musicVolume));
    if (musicMaster && audioCtx) musicMaster.gain.setValueAtTime(musicVolume, audioCtx.currentTime);
  }

  function setSfxVolume(v) {
    sfxVolume = clamp01(v);
    localStorage.setItem(STORE.sfxVolume, String(sfxVolume));
    if (sfxMaster && audioCtx) sfxMaster.gain.setValueAtTime(sfxVolume, audioCtx.currentTime);
    if (gatherHandle?.gain && audioCtx) gatherHandle.gain.gain.setValueAtTime(sfxVolume, audioCtx.currentTime);
  }

  function createSfxHandle(file, options) {
    return {
      file,
      source: null,
      gain: null,
      stopped: false,
      ended: false,
      loop: !!options.loop,
      key: options.key || null,
      localVolume: clamp01(options.localVolume ?? 1),
      onEnded: typeof options.onEnded === 'function' ? options.onEnded : null,
      startPromise: null
    };
  }

  function cleanupSfx(handle) {
    if (!handle || handle.ended) return;
    handle.ended = true;
    activeSfx.delete(handle);
    if (handle.key && loopedSfx.get(handle.key) === handle) loopedSfx.delete(handle.key);
    try { handle.source?.disconnect(); } catch (_) {}
    try { handle.gain?.disconnect(); } catch (_) {}
    if (handle.onEnded) {
      const fn = handle.onEnded;
      handle.onEnded = null;
      try { fn(); } catch (_) {}
    }
  }

  function playSfx(file, options = {}) {
    const opts = {
      loop: false,
      localVolume: 1,
      key: null,
      onEnded: null,
      ...options
    };

    if (opts.key && loopedSfx.has(opts.key)) {
      const existing = loopedSfx.get(opts.key);
      if (existing && !existing.stopped && !existing.ended) return existing;
      loopedSfx.delete(opts.key);
    }

    const handle = createSfxHandle(file, opts);
    activeSfx.add(handle);
    if (opts.key) loopedSfx.set(opts.key, handle);

    handle.startPromise = (async () => {
      try {
        const ctx = await resumeContext();
        const buffer = await loadBuffer(`${SFX_BASE}${file}`);
        if (handle.stopped) { cleanupSfx(handle); return handle; }

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.loop = !!opts.loop;
        gain.gain.value = handle.localVolume;
        source.connect(gain);
        gain.connect(sfxMaster);
        handle.source = source;
        handle.gain = gain;

        source.onended = () => cleanupSfx(handle);
        source.start(0);
      } catch (error) {
        console.warn(`[ScarletAudio] SFX unavailable: ${file}`, error);
        cleanupSfx(handle);
      }
      return handle;
    })();

    return handle;
  }

  function stopSfx(target) {
    if (!target) return;
    const handle = typeof target === 'string' ? loopedSfx.get(target) : target;
    if (!handle) return;
    handle.stopped = true;
    try { handle.source?.stop(); } catch (_) {}
    cleanupSfx(handle);
  }

  function startLoopSfx(file, key, localVolume = 1) {
    const existing = loopedSfx.get(key);
    if (existing && !existing.stopped && !existing.ended) return existing;
    if (existing) stopSfx(existing);
    return playSfx(file, { loop: true, key, localVolume });
  }

  function stopLoopSfx(key) { stopSfx(loopedSfx.get(key)); }

  function stopAllSfx() {
    [...activeSfx].forEach(stopSfx);
    stopGather();
  }

  function playSfxUntilEnd(file, options = {}) {
    return new Promise(resolve => {
      let resolved = false;
      let timer = null;
      const done = () => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      playSfx(file, { ...options, loop: false, onEnded: done });
      timer = setTimeout(done, options.safetyMs || 30000);
    });
  }

  function reversedBufferFor(original, key) {
    if (reversedCache.has(key)) return reversedCache.get(key);
    const ctx = ensureContext();
    const reversed = ctx.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
    for (let ch = 0; ch < original.numberOfChannels; ch++) {
      const src = original.getChannelData(ch);
      const dst = reversed.getChannelData(ch);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    reversedCache.set(key, reversed);
    return reversed;
  }

  function getReverbImpulse(ctx) {
    if (impulseBuffer && impulseBuffer.sampleRate === ctx.sampleRate) return impulseBuffer;
    const seconds = 1.45;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    impulseBuffer = impulse;
    return impulse;
  }

  function stopGather() {
    gatherToken += 1;
    if (gatherHandle) {
      try { gatherHandle.source.stop(); } catch (_) {}
      try { gatherHandle.source.disconnect(); } catch (_) {}
      try { gatherHandle.gain.disconnect(); } catch (_) {}
      gatherHandle = null;
    }
  }

  async function playGatherAt(progress, reverse = false) {
    const token = ++gatherToken;
    if (gatherHandle) {
      try { gatherHandle.source.stop(); } catch (_) {}
      gatherHandle = null;
    }

    try {
      const ctx = await resumeContext();
      const path = `${SFX_BASE}threadsgather.mp3`;
      const original = await loadBuffer(path);
      if (token !== gatherToken) return;

      const p = clamp01(progress);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = sfxVolume;

      if (!reverse) {
        source.buffer = original;
        source.connect(gain);
        gain.connect(ctx.destination);
        const offset = Math.min(original.duration - 0.001, p * original.duration);
        source.start(0, Math.max(0, offset));
      } else {
        const reversed = reversedBufferFor(original, path);
        source.buffer = reversed;
        source.playbackRate.value = 2.016;
        const convolver = ctx.createConvolver();
        convolver.buffer = getReverbImpulse(ctx);
        const dry = ctx.createGain();
        const wet = ctx.createGain();
        dry.gain.value = 0.54;
        wet.gain.value = 0.82;
        source.connect(dry);
        source.connect(convolver);
        convolver.connect(wet);
        dry.connect(gain);
        wet.connect(gain);
        gain.connect(ctx.destination);
        const originalPosition = p * original.duration;
        const reverseOffset = Math.max(0, original.duration - originalPosition);
        const reverseDuration = Math.max(0.01, originalPosition);
        source.start(0, Math.min(reversed.duration - 0.001, reverseOffset), reverseDuration);
      }

      gatherHandle = { source, gain, reverse };
      source.onended = () => {
        if (gatherHandle?.source === source) gatherHandle = null;
      };
    } catch (error) {
      console.warn('[ScarletAudio] gather sound unavailable:', error);
    }
  }

  async function primeForScene1() {
    try { sessionStorage.setItem(STORE.audioPrimed, '1'); } catch (_) {}
    await resumeContext();
    // Keep the cover silent, but make every future sound legal and ready.
    warmAudioAssets();
    return true;
  }

  function notifyScene(page) {
    const name = String(page || '').split('/').pop().toLowerCase();
    // Scene-specific loops must never leak into the next scene. Scene 3's
    // heartbeat begins at the custom-thread phase and ends with Scene 3.
    if (name !== 'scene3.html') stopLoopSfx('scene3-heartbeat');
    if (name === 'cover.html' || name === 'index.html' || !name) {
      stopMusic(true);
      stopAllSfx();
      return;
    }
    // Scene 1 starts the soundtrack; once started it remains continuous through
    // all later scenes and their transitions because this owner document persists.
    if (name === 'scene1.html') tryStartMusic();
  }

  // Pre-decode while the user is still looking at the cover. No sound is emitted.
  warmAudioAssets();

  // Any real interaction can resume the one persistent AudioContext. The music
  // button is NOT special and never controls whether audio is allowed to start.
  const unlock = () => { resumeContext().catch(() => {}); };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('beforeunload', saveMusicTime);

  window.ScarletAudio = {
    MUSIC_PATH,
    SFX_BASE,
    playSfx,
    playSfxUntilEnd,
    stopSfx,
    startLoopSfx,
    stopLoopSfx,
    stopAllSfx,
    tryStartMusic,
    primeForScene1,
    stopMusic,
    saveMusicTime,
    setMusicVolume,
    setSfxVolume,
    getMusicVolume: () => musicVolume,
    getSfxVolume: () => sfxVolume,
    playGatherForward: (progress) => playGatherAt(progress, false),
    playGatherReverse: (progress) => playGatherAt(progress, true),
    stopGather,
    notifyScene,
    resumeContext,
    _debugState: () => ({
      contextState: audioCtx?.state || 'none',
      musicPlaying: !!musicSource,
      musicWanted,
      musicTime: currentMusicTime(),
      loopKeys: [...loopedSfx.keys()],
      activeSfx: activeSfx.size
    })
  };
})();
