const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;
const AUDIO = window.ScarletAudio;

// Begin the wing ambience as soon as Scene 4 itself loads. It loops for the
// entire scene and is stopped by the existing beforeunload handler on Scene 5.
AUDIO?.startLoopSfx("flappingwings.mp3", "scene4-flapping");

// VS Code Live Server can sometimes open the page through a LAN IP over plain HTTP.
// Camera APIs are only reliable in a secure context, while localhost is treated as secure.
// When this page is opened on the same machine through a non-secure Live Server URL,
// transparently switch to localhost so camera permission / MediaPipe can initialize normally.
(function normalizeLiveServerOrigin() {
  // The persistent index shell owns origin normalisation. Never redirect only
  // the iframe, because that would make it cross-origin with the audio shell.
  if (window.parent !== window) return;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const isPlainHttp = window.location.protocol === "http:";

  if (!window.isSecureContext && isPlainHttp && !localHosts.has(window.location.hostname)) {
    const guardKey = "scene4-localhost-redirect";

    if (!sessionStorage.getItem(guardKey)) {
      sessionStorage.setItem(guardKey, "1");
      const port = window.location.port ? `:${window.location.port}` : "";
      window.location.replace(
        `http://localhost${port}${window.location.pathname}${window.location.search}${window.location.hash}`
      );
    }
  }
})();

const stage = document.getElementById("scene4Stage");

const humanTrackWrapper = document.getElementById("humanTrackWrapper");
const humanFrame = document.getElementById("humanFrame");
const humanFrameCtx = humanFrame.getContext("2d", {
  alpha: true,
  desynchronized: true
});
humanFrameCtx.imageSmoothingEnabled = false;

const dialoguePhase = document.getElementById("dialoguePhase");
const belovedDialogue = document.getElementById("belovedDialogue");

// Prevent the full dialogue from flashing before the typing effect begins.
belovedDialogue.innerHTML = "";

const holdOverlay = document.getElementById("holdOverlay");
const guidePhase = document.getElementById("guidePhase");
const readyPrompt = guidePhase.querySelector(".ready-prompt");

const trackingPhase = document.getElementById("trackingPhase");
const webcam = document.getElementById("webcam");
const thermalCanvas = document.getElementById("thermalCanvas");
const thermalCtx = thermalCanvas.getContext("2d", { willReadFrequently: true });
let thermalLoopId = null;

const leftBigHand = document.getElementById("leftBigHand");
const rightBigHand = document.getElementById("rightBigHand");
const threadLayer = document.getElementById("threadLayer");

const dangerVignette = document.getElementById("dangerVignette");
const keepHoldingWarning = document.getElementById("keepHoldingWarning");
const failureMain = document.getElementById("failureMain");
const failureTexts = document.getElementById("failureTexts");
const blackout = document.getElementById("blackout");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

let phase = "intro";
let dialogueStep = 0;
let humanFrameIndex = 0;
let humanFrameRaf = null;
let humanFrameStartTime = 0;
let humanImages = [];

const DIALOGUE_TYPING_MS = 42;
const dialogueLines = [
  {
    lead: `Hi... I'm the one you`,
    fullHTML:
      `Hi... I'm the one you wished for. Everything you asked for,<br />everything you hoped I would be... I'm here now.`
  },
  {
    lead: `So... I guess it's time`,
    fullHTML:
      `So... I guess it's time for you to keep your promise. <span class="hold-me">Hold me.</span>`
  }
];

const dialogueTyping = {
  active: false,
  token: 0,
  fullHTML: ""
};

const HUMAN_FRAME_MS = 52;
const HUMAN_FRAMES = Array.from(
  { length: 39 },
  (_, i) => `./SCENE4/HUMAN_${String(i).padStart(5, "0")}.png`
);

const state = {
  running: false,
  locked: false,
  failed: false,
  cameraReady: false,
  stream: null,
  handsModel: null,
  loopBusy: false,

  stableSince: 0,
  missingSince: 0,

  calibration: {
    left: null,
    right: null
  },

  track: {
    left: {
      seen: false,
      x: 0.30,
      y: 0.62,
      insideGuide: true,
      lastSeen: 0
    },
    right: {
      seen: false,
      x: 0.70,
      y: 0.62,
      insideGuide: true,
      lastSeen: 0
    }
  },

  visual: {
    leftDx: 0,
    rightDx: 0,
    humanDx: 0
  }
};

function fitDesignToWindow() {
  const scale = Math.min(
    window.innerWidth / DESIGN_WIDTH,
    window.innerHeight / DESIGN_HEIGHT
  );

  document.documentElement.style.fontSize =
    `${DESIGN_ROOT_PX * scale}px`;
}

/* -------------------------------------------------
   HUMAN FRAME SEQUENCE
------------------------------------------------- */

async function preloadImages(urls) {
  const images = urls.map((url) => {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    return image;
  });

  await Promise.all(
    images.map(async (image) => {
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        } else if (!image.complete) {
          await new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          });
        }
      } catch (error) {
        // If decode() rejects for a cached image, wait for the ordinary load path.
        if (!image.complete) {
          await new Promise((resolve) => {
            image.onload = resolve;
            image.onerror = resolve;
          });
        }
      }
    })
  );

  return images;
}

function drawHumanFrame(index) {
  const image = humanImages[index];
  if (!image || !image.complete) return;

  humanFrameCtx.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  humanFrameCtx.drawImage(image, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
}

function startHumanFrames() {
  AUDIO?.startLoopSfx("flappingwings.mp3", "scene4-flapping");
  if (humanFrameRaf) {
    cancelAnimationFrame(humanFrameRaf);
    humanFrameRaf = null;
  }

  humanFrameIndex = 0;
  humanFrameStartTime = performance.now();
  drawHumanFrame(0);

  const tick = (now) => {
    const nextIndex = Math.floor(
      (now - humanFrameStartTime) / HUMAN_FRAME_MS
    ) % HUMAN_FRAMES.length;

    if (nextIndex !== humanFrameIndex) {
      humanFrameIndex = nextIndex;
      drawHumanFrame(humanFrameIndex);
    }

    humanFrameRaf = requestAnimationFrame(tick);
  };

  humanFrameRaf = requestAnimationFrame(tick);
}

async function startSceneIntro() {
  /*
    HUMAN frame animation begins immediately during the opening fade/scale.
    The opening transform still starts at 1620×911 / top 167 / left 150 /
    opacity 0 and grows smoothly to the full 1920×1080 composition.
  */
  // Decode the full PNG sequence before the animation begins. On Live Server this
  // prevents individual 1920×1080 PNGs from being decoded during playback, which
  // was the source of the visible blank gaps / stutter between HUMAN frames.
  humanImages = await preloadImages(HUMAN_FRAMES);

  humanFrameIndex = 0;
  drawHumanFrame(0);

  // Drive the sequence from requestAnimationFrame and elapsed time rather than
  // setInterval/background-image swaps. This keeps the frame loop continuous even
  // while MediaPipe and the camera are working.
  startHumanFrames();

  // Force the browser to commit the initial small/transparent state first.
  void humanFrame.offsetWidth;

  requestAnimationFrame(() => {
    humanFrame.classList.add("intro-expand");
  });

  // Smooth scale + fade duration.
  await wait(1800);

  // Only after reaching the full composition do we enable the bobbing motion.
  humanFrame.classList.add("is-running");

  // One second later, panel + text fade in as before.
  await wait(1000);

  dialoguePhase.classList.add("is-visible");
  startDialogueLine(0);
  phase = "dialogue";
}

function finishDialogueTyping() {
  if (!dialogueTyping.active) return false;

  dialogueTyping.token += 1;
  dialogueTyping.active = false;
  belovedDialogue.innerHTML = dialogueTyping.fullHTML;
  return true;
}

async function typeDialogueLeadThenReveal(lead, fullHTML) {
  const token = ++dialogueTyping.token;

  dialogueTyping.active = true;
  dialogueTyping.fullHTML = fullHTML;
  belovedDialogue.textContent = "";

  for (let i = 1; i <= lead.length; i++) {
    if (token !== dialogueTyping.token) return;

    belovedDialogue.textContent = lead.slice(0, i);
    await wait(DIALOGUE_TYPING_MS);
  }

  if (token !== dialogueTyping.token) return;

  belovedDialogue.innerHTML = fullHTML;
  dialogueTyping.active = false;
}

function startDialogueLine(index) {
  const line = dialogueLines[index];
  if (!line) return;

  typeDialogueLeadThenReveal(line.lead, line.fullHTML);
}

/* -------------------------------------------------
   DIALOGUE → GUIDE
------------------------------------------------- */

function restartReadyPromptBlink() {
  if (!readyPrompt) return;

  // Explicitly reset the prompt every time the guide opens. This prevents
  // the first visit from inheriting an invisible phase of the animation.
  readyPrompt.style.display = "block";
  readyPrompt.style.visibility = "visible";
  readyPrompt.style.opacity = "0.5";
  readyPrompt.style.animation = "none";
  void readyPrompt.offsetWidth;
  readyPrompt.style.animation = "readyBlink 1s steps(1, end) infinite";
}

async function enterGuidePhase() {
  if (phase !== "dialogue") return;

  phase = "transition-guide";

  dialoguePhase.classList.remove("is-visible");
  await wait(800);

  holdOverlay.classList.add("is-visible");
  await wait(420);

  restartReadyPromptBlink();
  guidePhase.classList.add("is-visible");
  guidePhase.setAttribute("aria-hidden", "false");

  await wait(800);
  phase = "guide";
}

function handleDialogueContinue() {
  if (phase !== "dialogue") return;

  // If the current line is still typing, complete it immediately.
  if (finishDialogueTyping()) return;

  if (dialogueStep === 0) {
    dialogueStep = 1;
    startDialogueLine(1);
    return;
  }

  enterGuidePhase();
}

/* -------------------------------------------------
   THERMAL / FALSE-COLOR CAMERA
------------------------------------------------- */

function thermalColor(value) {
  /*
    False-color palette based on the supplied reference:
    purple/blue → cyan → green → yellow → orange/red.
  */
  const stops = [
    [0.00, [45, 0, 110]],
    [0.14, [40, 0, 220]],
    [0.29, [0, 105, 255]],
    [0.43, [0, 245, 255]],
    [0.57, [0, 255, 70]],
    [0.70, [235, 255, 0]],
    [0.82, [255, 205, 0]],
    [0.91, [255, 75, 0]],
    [1.00, [255, 0, 0]]
  ];

  const t = clamp(value, 0, 1);

  for (let i = 0; i < stops.length - 1; i++) {
    const [aT, aC] = stops[i];
    const [bT, bC] = stops[i + 1];

    if (t >= aT && t <= bT) {
      const local = (t - aT) / (bT - aT);

      return [
        Math.round(lerp(aC[0], bC[0], local)),
        Math.round(lerp(aC[1], bC[1], local)),
        Math.round(lerp(aC[2], bC[2], local))
      ];
    }
  }

  return [255, 0, 0];
}

function renderThermalFrame() {
  if (
    !state.cameraReady ||
    state.failed ||
    webcam.readyState < 2
  ) {
    thermalLoopId = requestAnimationFrame(renderThermalFrame);
    return;
  }

  const w = thermalCanvas.width;
  const h = thermalCanvas.height;

  thermalCtx.imageSmoothingEnabled = false;

  // Mirror the source exactly like a selfie camera.
  thermalCtx.save();
  thermalCtx.clearRect(0, 0, w, h);
  thermalCtx.translate(w, 0);
  thermalCtx.scale(-1, 1);
  thermalCtx.drawImage(webcam, 0, 0, w, h);
  thermalCtx.restore();

  const image = thermalCtx.getImageData(0, 0, w, h);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let lum =
      (0.299 * r +
        0.587 * g +
        0.114 * b) /
      255;

    // More contrast and posterization gives the requested thermal/pixel look.
    lum = clamp((lum - 0.08) / 0.82, 0, 1);
    lum = Math.round(lum * 18) / 18;

    const [tr, tg, tb] = thermalColor(lum);

    data[i] = tr;
    data[i + 1] = tg;
    data[i + 2] = tb;
    data[i + 3] = 255;
  }

  thermalCtx.putImageData(image, 0, 0);

  thermalLoopId = requestAnimationFrame(renderThermalFrame);
}

function startThermalCamera() {
  if (thermalLoopId) {
    cancelAnimationFrame(thermalLoopId);
  }

  thermalLoopId = requestAnimationFrame(renderThermalFrame);
}

/* -------------------------------------------------
   CAMERA / MEDIAPIPE
------------------------------------------------- */

// Inner red stroke inside the 406×219 camera.
// Relative to camera:
// x = 23 ... 383
// y = 19 ... 200
const GUIDE_BOUNDS = {
  minX: 23 / 406,
  maxX: (23 + 360) / 406,
  minY: 19 / 219,
  maxY: (19 + 181) / 219
};

function handInfoFromLandmarks(landmarks) {
  const palmIds = [0, 5, 9, 13, 17];

  let palmX = 0;
  let palmY = 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of landmarks) {
    // Camera is visually mirrored, so mirror x for interaction too.
    const mirroredX = 1 - point.x;

    minX = Math.min(minX, mirroredX);
    maxX = Math.max(maxX, mirroredX);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  for (const id of palmIds) {
    palmX += 1 - landmarks[id].x;
    palmY += landmarks[id].y;
  }

  palmX /= palmIds.length;
  palmY /= palmIds.length;

  const insideGuide =
    minX >= GUIDE_BOUNDS.minX &&
    maxX <= GUIDE_BOUNDS.maxX &&
    minY >= GUIDE_BOUNDS.minY &&
    maxY <= GUIDE_BOUNDS.maxY;

  return {
    x: palmX,
    y: palmY,
    minX,
    maxX,
    minY,
    maxY,
    insideGuide
  };
}

function smoothTrack(slot, point) {
  const track = state.track[slot];

  track.x = lerp(track.x, point.x, 0.28);
  track.y = lerp(track.y, point.y, 0.28);
  track.insideGuide = point.insideGuide;
  track.seen = true;
  track.lastSeen = performance.now();
}

function onResults(results) {
  if (state.failed) return;

  const now = performance.now();

  state.track.left.seen = false;
  state.track.right.seen = false;

  const hands = (results.multiHandLandmarks || [])
    .map(handInfoFromLandmarks)
    .sort((a, b) => a.x - b.x);

  if (hands.length >= 2) {
    smoothTrack("left", hands[0]);
    smoothTrack("right", hands[hands.length - 1]);
  } else if (hands.length === 1) {
    const point = hands[0];

    if (state.locked) {
      const leftDistance = Math.hypot(
        point.x - state.track.left.x,
        point.y - state.track.left.y
      );

      const rightDistance = Math.hypot(
        point.x - state.track.right.x,
        point.y - state.track.right.y
      );

      smoothTrack(
        leftDistance <= rightDistance ? "left" : "right",
        point
      );
    } else {
      smoothTrack(point.x < 0.5 ? "left" : "right", point);
    }
  }

  updateTrackingState(hands.length, now);
}

function updateTrackingState(count, now) {
  if (!state.locked) {
    if (count >= 2) {
      if (!state.stableSince) {
        state.stableSince = now;
      }

      if (now - state.stableSince >= 650) {
        state.locked = true;

        state.calibration.left = {
          x: state.track.left.x,
          y: state.track.left.y
        };

        state.calibration.right = {
          x: state.track.right.x,
          y: state.track.right.y
        };

        state.missingSince = 0;
      }
    } else {
      state.stableSince = 0;
    }

    return;
  }

  const bothHandsSeen =
    state.track.left.seen &&
    state.track.right.seen;

  if (!bothHandsSeen) {
    if (!state.missingSince) {
      state.missingSince = now;
    }

    // Detection gets a very short grace period to avoid one-frame failures.
    setWarningState(true);

    if (now - state.missingSince >= 350) {
      triggerFailure();
    }

    return;
  }

  state.missingSince = 0;

  const guideViolation =
    !state.track.left.insideGuide ||
    !state.track.right.insideGuide;

  setWarningState(guideViolation);
}

function setWarningState(active) {
  if (state.failed) return;

  dangerVignette.classList.toggle("warning", active);
  keepHoldingWarning.classList.toggle("is-visible", active);
  if (active) AUDIO?.startLoopSfx("alert.mp3", "scene4-alert");
  else AUDIO?.stopLoopSfx("scene4-alert");
}

async function ensureMediaPipeHandsAvailable() {
  if (typeof Hands !== "undefined") return;

  // A Live Server load can occasionally race the remote dependency. Give the
  // synchronous script one brief chance to finish before reporting a failure.
  const started = performance.now();
  while (typeof Hands === "undefined" && performance.now() - started < 3000) {
    await wait(50);
  }

  if (typeof Hands === "undefined") {
    throw new Error("MediaPipe Hands could not load. Check your connection.");
  }
}

function waitForVideoMetadata(video) {
  if (video.readyState >= 1 && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Camera metadata timed out."));
    }, 8000);

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Camera video could not start."));
    };

    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function startCamera() {
  if (phase !== "guide" || state.running) return;

  phase = "camera-starting";
  state.running = true;

  try {
    await ensureMediaPipeHandsAvailable();

    if (!window.isSecureContext) {
      throw new Error(
        "Camera access requires a secure context. Open this Live Server page through localhost or 127.0.0.1."
      );
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API is unavailable in this browser context.");
    }

    // Must be called directly from the R key interaction.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    state.stream = stream;
    webcam.srcObject = stream;
    await waitForVideoMetadata(webcam);
    await webcam.play();

    const handsModel = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`
    });

    handsModel.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.55,
      minTrackingConfidence: 0.55
    });

    handsModel.onResults(onResults);

    // Force the MediaPipe WASM/model assets to finish loading before the tracking
    // phase is shown. This avoids the Live Server case where camera video appears
    // but hand detection never actually begins.
    if (typeof handsModel.initialize === "function") {
      await handsModel.initialize();
    }

    state.handsModel = handsModel;
    state.cameraReady = true;

    startThermalCamera();

    guidePhase.classList.remove("is-visible");
    guidePhase.setAttribute("aria-hidden", "true");

    // Once camera / hand tracking is ready, remove the 70% black overlay.
    holdOverlay.classList.remove("is-visible");

    trackingPhase.classList.add("is-visible");
    trackingPhase.setAttribute("aria-hidden", "false");

    leftBigHand.classList.add("is-visible");
    rightBigHand.classList.add("is-visible");
    threadLayer.classList.add("is-visible");

    phase = "tracking";
    processVideo();
  } catch (error) {
    console.error(error);

    state.running = false;
    phase = "guide";

    // Keep the guide visible so R can be pressed again.
    restartReadyPromptBlink();
    guidePhase.classList.add("is-visible");
    guidePhase.setAttribute("aria-hidden", "false");
  }
}

async function processVideo() {
  if (!state.running || state.failed) return;

  if (
    webcam.readyState >= 2 &&
    !state.loopBusy &&
    state.handsModel
  ) {
    state.loopBusy = true;

    try {
      await state.handsModel.send({ image: webcam });
    } catch (error) {
      console.error(error);
    } finally {
      state.loopBusy = false;
    }
  }

  requestAnimationFrame(processVideo);
}

/* -------------------------------------------------
   TRACKED VISUAL MOVEMENT
   Based on the earlier hand-hold web:
   hands move horizontally; human follows average horizontal movement.
------------------------------------------------- */

function updateTrackedVisuals() {
  let leftDx = 0;
  let rightDx = 0;

  if (
    state.locked &&
    state.calibration.left &&
    state.calibration.right
  ) {
    leftDx =
      (state.track.left.x - state.calibration.left.x) *
      DESIGN_WIDTH *
      1.18;

    rightDx =
      (state.track.right.x - state.calibration.right.x) *
      DESIGN_WIDTH *
      1.18;
  }

  leftDx = clamp(leftDx, -384, 384);
  rightDx = clamp(rightDx, -384, 384);

  const humanTarget =
    ((leftDx + rightDx) * 0.5) * 0.44;

  state.visual.leftDx = lerp(
    state.visual.leftDx,
    leftDx,
    0.16
  );

  state.visual.rightDx = lerp(
    state.visual.rightDx,
    rightDx,
    0.16
  );

  state.visual.humanDx = lerp(
    state.visual.humanDx,
    humanTarget,
    0.10
  );

  leftBigHand.style.transform =
    `translate3d(${state.visual.leftDx / 16}rem, 0, 0) scaleX(-1)`;

  rightBigHand.style.transform =
    `translate3d(${state.visual.rightDx / 16}rem, 0, 0)`;

  humanTrackWrapper.style.transform =
    `translate3d(${state.visual.humanDx / 16}rem, 0, 0)`;
}

/* -------------------------------------------------
   FAILURE
------------------------------------------------- */

function triggerFailure() {
  if (state.failed) return;

  state.failed = true;
  phase = "failed";

  AUDIO?.stopLoopSfx("scene4-alert");
  AUDIO?.playSfx("alert.mp3");

  keepHoldingWarning.classList.remove("is-visible");

  dangerVignette.classList.remove("warning");
  dangerVignette.classList.add("failure");

  failureMain.classList.add("is-visible");
  failureTexts.classList.add("is-visible");
  failureTexts.setAttribute("aria-hidden", "false");

  // Match error.mp3 to each of the eight alert-copy pop timings.
  [50, 120, 190, 260, 330, 400, 470, 540].forEach((delay) => {
    setTimeout(() => AUDIO?.playSfx("error.mp3"), delay);
  });

  stage.classList.add("fail-shake");

  // The last small alert finishes popping at about 1.12 s.
  // Then wait ~2 seconds before the screen collapses to black.
  setTimeout(() => {
    blackout.classList.add("is-visible");
    blackout.setAttribute("aria-hidden", "false");
  }, 3150);

  // As soon as the blackout has fully covered the screen, continue to scene 5.
  setTimeout(() => {
    stopCamera();
    window.location.href = "./scene5.html";
  }, 3820);
}

function stopCamera() {
  if (thermalLoopId) {
    cancelAnimationFrame(thermalLoopId);
    thermalLoopId = null;
  }

  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
}

/* -------------------------------------------------
   KEYBOARD
------------------------------------------------- */

function handleKeydown(event) {
  if (event.repeat) return;

  const key = event.key.toLowerCase();

  if (key === "c" && phase === "dialogue") {
    AUDIO?.playSfx("press.wav");
    handleDialogueContinue();
    return;
  }

  if (key === "r" && phase === "guide") {
    AUDIO?.playSfx("ready.mp3");
    startCamera();
  }
}

window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", fitDesignToWindow);
window.addEventListener("beforeunload", () => {
  AUDIO?.stopLoopSfx("scene4-flapping");
  AUDIO?.stopLoopSfx("scene4-alert");
  stopCamera();
  if (humanFrameRaf) {
    cancelAnimationFrame(humanFrameRaf);
    humanFrameRaf = null;
  }
});

fitDesignToWindow();
startSceneIntro();

/* -------------------------------------------------
   PIXEL THREADS
------------------------------------------------- */

new p5((p) => {
  const PIXEL_SCALE = 0.5;

  const HUMAN_ANCHOR = {
    x: 950,
    y: 374
  };

  const RIGHT_HAND_ANCHORS = [
    { x: 1229, y: 829 },
    { x: 1336, y: 689 },
    { x: 1393, y: 669 },
    { x: 1462, y: 693 },
    { x: 1521, y: 742 }
  ];

  const LEFT_HAND_ANCHORS = [
    { x: 670, y: 826 },
    { x: 566, y: 688 },
    { x: 513, y: 671 },
    { x: 450, y: 691 },
    { x: 390, y: 740 }
  ];

  const seeds = Array.from(
    { length: 80 },
    (_, i) => ({
      a: 17 + i * 23,
      b: 91 + i * 31,
      c: 201 + i * 17,
      d: 77 + i * 29
    })
  );

  let canvas;

  p.setup = () => {
    canvas = p.createCanvas(
      DESIGN_WIDTH * PIXEL_SCALE,
      DESIGN_HEIGHT * PIXEL_SCALE
    );

    canvas.parent("threadLayer");

    p.pixelDensity(1);
    p.noSmooth();
    p.noFill();
  };

  function stagePointFromElement(
    element,
    designX,
    designY
  ) {
    const stageRect = stage.getBoundingClientRect();
    const rect = element.getBoundingClientRect();

    const screenX =
      rect.left +
      (designX / DESIGN_WIDTH) * rect.width;

    const screenY =
      rect.top +
      (designY / DESIGN_HEIGHT) * rect.height;

    const designStageX =
      ((screenX - stageRect.left) / stageRect.width) *
      DESIGN_WIDTH;

    const designStageY =
      ((screenY - stageRect.top) / stageRect.height) *
      DESIGN_HEIGHT;

    return {
      x: designStageX * PIXEL_SCALE,
      y: designStageY * PIXEL_SCALE
    };
  }

  function drawFilament(
    start,
    end,
    seed,
    side,
    time,
    index
  ) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.hypot(dx, dy) || 1;

    const nx = -dy / distance;
    const ny = dx / distance;

    const slackBase = Math.min(
      distance * 0.21,
      75 * PIXEL_SCALE
    );

    const swayA =
      (p.noise(seed.a, time * 0.22) - 0.5) *
      26 *
      PIXEL_SCALE;

    const swayB =
      (p.noise(seed.b, time * 0.18) - 0.5) *
      32 *
      PIXEL_SCALE;

    const swayC =
      (p.noise(seed.c, time * 0.19) - 0.5) *
      22 *
      PIXEL_SCALE;

    const floating =
      p.sin(
        time * (1.08 + index * 0.045) + seed.d
      ) *
      8 *
      PIXEL_SCALE;

    const spread =
      (index - 1) *
      3.8 *
      PIXEL_SCALE;

    const sag =
      (20 + index * 2.1) *
      PIXEL_SCALE;

    const sx =
      start.x +
      spread * 0.18;

    const sy =
      start.y +
      ((index % 3) - 1) *
      2.8 *
      PIXEL_SCALE;

    const ex =
      end.x +
      spread * 0.55 +
      swayC * 0.18;

    const ey =
      end.y +
      (((index + 1) % 4) - 1.5) *
      3.8 *
      PIXEL_SCALE;

    const points = [];

    for (let t = 0; t <= 1.0001; t += 0.20) {
      const arch = Math.sin(t * Math.PI);

      const wave =
        Math.sin(
          time * (1.32 + index * 0.055) +
          t * 5.1 +
          seed.a
        ) *
        9 *
        PIXEL_SCALE;

      const x =
        p.lerp(sx, ex, t) +
        nx *
          (slackBase *
            arch *
            (side * 0.65 + 0.26)) +
        p.sin(
          seed.b +
          t * 6.2 +
          time * 0.42
        ) *
          6 *
          PIXEL_SCALE +
        swayA *
          (1 - Math.abs(0.5 - t) * 1.25) *
          0.22;

      const y =
        p.lerp(sy, ey, t) +
        ny * (slackBase * arch * 0.43) +
        arch * sag +
        wave * 0.28 +
        floating * arch +
        swayB * 0.11;

      points.push({ x, y });
    }

    p.stroke(255, 0, 0, 185);
    p.strokeWeight(index === 1 ? 1.45 : 1.05);

    p.beginShape();

    p.curveVertex(
      Math.round(points[0].x),
      Math.round(points[0].y)
    );

    for (const point of points) {
      p.curveVertex(
        Math.round(point.x),
        Math.round(point.y)
      );
    }

    const last = points[points.length - 1];

    p.curveVertex(
      Math.round(last.x),
      Math.round(last.y)
    );

    p.endShape();
  }

  function drawBundle(
    start,
    end,
    side,
    time,
    seedOffset
  ) {
    // 3 continuous filaments for every supplied hand anchor:
    // 5 anchors × 2 hands × 3 = 30 moving red threads.
    for (let i = 0; i < 3; i++) {
      drawFilament(
        start,
        end,
        seeds[seedOffset + i],
        side,
        time,
        i
      );
    }
  }

  p.draw = () => {
    p.clear();

    updateTrackedVisuals();

    if (
      !state.cameraReady ||
      state.failed && blackout.classList.contains("is-visible")
    ) {
      return;
    }

    const humanStart = stagePointFromElement(
      humanFrame,
      HUMAN_ANCHOR.x,
      HUMAN_ANCHOR.y
    );

    const time = p.millis() / 1000;

    RIGHT_HAND_ANCHORS.forEach(
      (anchor, index) => {
        const end = stagePointFromElement(
          rightBigHand,
          anchor.x,
          anchor.y
        );

        drawBundle(
          humanStart,
          end,
          1,
          time,
          index * 3
        );
      }
    );

    LEFT_HAND_ANCHORS.forEach(
      (anchor, index) => {
        const end = stagePointFromElement(
          leftBigHand,
          anchor.x,
          anchor.y
        );

        drawBundle(
          humanStart,
          end,
          -1,
          time,
          20 + index * 3
        );
      }
    );
  };
});
