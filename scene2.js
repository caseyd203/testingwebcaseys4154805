const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;

const panelPhase = document.getElementById("panelPhase");
const dialogueEl = document.getElementById("scene2Dialogue");
const continuePrompt = document.getElementById("scene2ContinuePrompt");
const agreementOverlay = document.getElementById("agreementOverlay");
const agreementPhase = document.getElementById("agreementPhase");
const letterFrame = document.getElementById("letterFrame");
const agreementContent = document.getElementById("agreementContent");
const agreementContinuePrompt = document.getElementById("agreementContinuePrompt");
const signatureCanvas = document.getElementById("signatureCanvas");
const sigCtx = signatureCanvas.getContext("2d", { alpha: true });

const introDialogues = [
  "Welcome... wandering heart. I suppose you already know this is where you'll meet the person you've wished for.",
  "Tell us what you wish for. We will weave those wishes into the person waiting at the other end of your thread.",
  "But before we begin... There is one promise you must make.",
  "Make sure you read the agreement carefully... and agree to what it asks of you."
];

const outroDialogues = [
  "Ho, ho, ho... You seem quite determined. Very well. A heart so certain deserves the love it has wished for.",
  "Your promise has been made. And now... it is time to weave."
];

let phase = "intro";
let currentDialogueIndex = 0;
let currentSet = introDialogues;
let isTyping = false;
let typingToken = 0;
const TYPE_SPEED = 66;

const LETTER_FRAME_SPEED = 60;
const AUDIO = window.ScarletAudio;

function startDeitiesVoice() {
  // Start at the exact typing onset, then let the file play to its natural end.
  AUDIO?.playSfx("deitiesvoice.mp3");
}
function stopDeitiesVoice() { /* intentionally do not cut deitiesvoice.mp3 */ }

const letterFrameUrls = Array.from({ length: 10 }, (_, index) => {
  const frameIndex = String(index).padStart(5, "0");
  return `./LETTER/LETTER_${frameIndex}.png`;
});

const letterFramesReady = Promise.all(
  letterFrameUrls.map(
    (url) =>
      new Promise((resolve) => {
        const preload = new Image();
        preload.onload = resolve;
        preload.onerror = resolve;
        preload.src = url;
      })
  )
);

/*
  BASE3 FRAMES
  One synchronized frame controller keeps exactly one image visible at a time.
  This removes the blank 30%→33% gap that existed in the old CSS animation.
*/
const base3Frames = [
  document.querySelector(".base3-1"),
  document.querySelector(".base3-2"),
  document.querySelector(".base3-3")
];

const base3Urls = [
  "./SCENE2/base3-1.png",
  "./SCENE2/base3-2.png",
  "./SCENE2/base3-3.png"
];

let base3Index = 0;
let base3Timer = null;

const base3Ready = Promise.all(
  base3Urls.map(
    (url) =>
      new Promise((resolve) => {
        const preload = new Image();
        preload.onload = resolve;
        preload.onerror = resolve;
        preload.src = url;
      })
  )
);

async function startBase3Cycle() {
  await base3Ready;

  base3Frames.forEach((frame, index) => {
    frame.classList.toggle("is-active", index === 0);
  });

  base3Timer = window.setInterval(() => {
    const nextIndex = (base3Index + 1) % base3Frames.length;

    // Activate next first, then remove previous in the same JS turn.
    // There is never an intentional empty frame.
    base3Frames[nextIndex].classList.add("is-active");
    base3Frames[base3Index].classList.remove("is-active");

    base3Index = nextIndex;
  }, 500);
}

const cloudMotion = [
  { selector: ".cloud1-a", startX: 1280, width: 705, direction: -1, speed: 25, flipped: false },
  { selector: ".cloud2-a", startX: 1077, width: 318, direction: -1, speed: 21, flipped: false },
  { selector: ".cloud3-b", startX: 1236, width: 341, direction: -1, speed: 18, flipped: true },

  { selector: ".cloud1-b", startX: -236, width: 705, direction: 1, speed: 23, flipped: true },
  { selector: ".cloud2-b", startX: 282, width: 318, direction: 1, speed: 20, flipped: true },
  { selector: ".cloud3-a", startX: 441, width: 341, direction: 1, speed: 17, flipped: false }
].map((cloud) => ({
  ...cloud,
  x: cloud.startX,
  element: document.querySelector(cloud.selector)
}));

let lastCloudFrameTime = null;

function applyCloudTransform(cloud) {
  const offsetPx = cloud.x - cloud.startX;
  const translateRem = offsetPx / DESIGN_ROOT_PX;
  const flip = cloud.flipped ? " scaleX(-1)" : "";
  cloud.element.style.transform =
    `translate3d(${translateRem}rem, 0, 0)${flip}`;
}

function animateClouds(now) {
  if (lastCloudFrameTime === null) {
    lastCloudFrameTime = now;
  }

  const dt = Math.min((now - lastCloudFrameTime) / 1000, 0.05);
  lastCloudFrameTime = now;

  for (const cloud of cloudMotion) {
    if (!cloud.element) continue;

    cloud.x += cloud.direction * cloud.speed * dt;

    // LEFT-moving clouds: once fully outside left, restart fully outside right.
    if (cloud.direction < 0 && cloud.x + cloud.width < 0) {
      cloud.x = DESIGN_WIDTH + 24;
    }

    // RIGHT-moving clouds: once fully outside right, restart fully outside left.
    if (cloud.direction > 0 && cloud.x > DESIGN_WIDTH) {
      cloud.x = -cloud.width - 24;
    }

    applyCloudTransform(cloud);
  }

  requestAnimationFrame(animateClouds);
}

function fitDesignToWindow() {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  document.documentElement.style.fontSize = `${DESIGN_ROOT_PX * scale}px`;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function splitAfterWords(text, count) {
  const words = text.trim().split(/\s+/);
  return {
    prefix: words.slice(0, count).join(" "),
    remainder: words.slice(count).join(" ")
  };
}

async function typeCurrentDialogue() {
  const text = currentSet[currentDialogueIndex];
  const myToken = ++typingToken;
  isTyping = true;
  startDeitiesVoice();
  dialogueEl.textContent = "";
  const { prefix, remainder } = splitAfterWords(text, 5);

  for (let i = 0; i < prefix.length; i++) {
    if (myToken !== typingToken) { stopDeitiesVoice(); return; }
    dialogueEl.textContent = prefix.slice(0, i + 1);
    await wait(TYPE_SPEED);
  }

  if (myToken !== typingToken) { stopDeitiesVoice(); return; }
  dialogueEl.textContent = remainder ? `${prefix} ${remainder}` : prefix;
  isTyping = false;
  stopDeitiesVoice();
}

async function playLetterSequence() {
  await letterFramesReady;
  const openSound = AUDIO?.playSfx("open.mp3");

  // Put the first frame in place before making the letter visible,
  // so there is no blank flash at the beginning.
  letterFrame.style.backgroundImage = `url("${letterFrameUrls[0]}")`;
  letterFrame.classList.add("is-visible");

  for (let i = 1; i < letterFrameUrls.length; i++) {
    await wait(LETTER_FRAME_SPEED);
    letterFrame.style.backgroundImage = `url("${letterFrameUrls[i]}")`;
  }

  // Keep LETTER_00009 visible continuously.
  letterFrame.style.backgroundImage = `url("${letterFrameUrls[letterFrameUrls.length - 1]}")`;
  AUDIO?.stopSfx(openSound);
}

async function beginAgreementSequence() {
  phase = "transitionToAgreement";
  continuePrompt.style.display = "none";
  panelPhase.classList.add("is-hidden");

  await wait(450);

  agreementOverlay.classList.add("is-visible");
  agreementOverlay.setAttribute("aria-hidden", "false");

  await wait(260);

  agreementPhase.classList.add("is-visible");
  agreementPhase.setAttribute("aria-hidden", "false");

  // Show the LETTER-phase continue prompt immediately with the letter.
  agreementContinuePrompt.classList.add("is-visible");

  await playLetterSequence();

  agreementContent.classList.add("is-visible");
  phase = "agreement";
}

async function returnFromAgreement() {
  phase = "transitionToOutro";

  /*
    Fade EVERYTHING in the LETTER phase together:
    letter image, agreement text, signatures, signature canvas,
    LETTER continue prompt, and black overlay all start fading at once.
  */
  agreementPhase.classList.remove("is-visible");
  agreementOverlay.classList.remove("is-visible");

  await wait(800);

  agreementPhase.setAttribute("aria-hidden", "true");
  agreementOverlay.setAttribute("aria-hidden", "true");

  // Reset inner states only after the shared fade has fully finished.
  agreementContinuePrompt.classList.remove("is-visible");
  agreementContent.classList.remove("is-visible");

  // Bring the dialogue panel/text back with the same smooth fade-in speed.
  panelPhase.classList.remove("is-hidden");
  continuePrompt.style.display = "block";

  currentSet = outroDialogues;
  currentDialogueIndex = 0;
  phase = "outro";
  typeCurrentDialogue();
}

function advancePanelDialogue() {
  if (isTyping) return;

  if (currentDialogueIndex < currentSet.length - 1) {
    currentDialogueIndex += 1;
    typeCurrentDialogue();
    return;
  }

  if (phase === "intro") {
    beginAgreementSequence();
    return;
  }

  if (phase === "outro") {
    phase = "ending";
    window.sceneWipeNavigate("./scene3.html");
  }
}

function handleKeydown(event) {
  if (event.repeat) return;
  if (event.key.toLowerCase() !== "c") return;

  if ((phase === "intro" || phase === "outro") && !isTyping) {
    AUDIO?.playSfx("press.wav");
    advancePanelDialogue();
  } else if (phase === "agreement") {
    AUDIO?.playSfx("press.wav");
    returnFromAgreement();
  }
}

function setupSignatureCanvas() {
  sigCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  sigCtx.fillStyle = "#FF0000";

  let drawing = false;
  let lastPoint = null;
  let writingStopTimer = null;

  function touchWritingSound() {
    AUDIO?.startLoopSfx("writing.mp3", "scene2-writing");
    clearTimeout(writingStopTimer);
    writingStopTimer = setTimeout(() => AUDIO?.stopLoopSfx("scene2-writing"), 125);
  }

  function getCanvasPoint(event) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function stampSquare(x, y) {
    const size = 4;
    sigCtx.fillRect(Math.round(x / size) * size, Math.round(y / size) * size, size, size);
  }

  function drawLineSquares(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(distance / 2));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampSquare(a.x + dx * t, a.y + dy * t);
    }
  }

  signatureCanvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    signatureCanvas.setPointerCapture(event.pointerId);
    lastPoint = getCanvasPoint(event);
    stampSquare(lastPoint.x, lastPoint.y);
    touchWritingSound();
  });

  signatureCanvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = getCanvasPoint(event);
    if (lastPoint) drawLineSquares(lastPoint, point);
    else stampSquare(point.x, point.y);
    lastPoint = point;
    touchWritingSound();
  });

  function stopDrawing() {
    drawing = false;
    lastPoint = null;
    clearTimeout(writingStopTimer);
    AUDIO?.stopLoopSfx("scene2-writing");
  }

  signatureCanvas.addEventListener("pointerup", stopDrawing);
  signatureCanvas.addEventListener("pointercancel", stopDrawing);
}

window.addEventListener("resize", fitDesignToWindow);
window.addEventListener("keydown", handleKeydown);

fitDesignToWindow();
setupSignatureCanvas();
startBase3Cycle();
requestAnimationFrame(animateClouds);
(async () => {
  try { await AUDIO?.tryStartMusic?.(); } catch (_) {}
  typeCurrentDialogue();
})();
