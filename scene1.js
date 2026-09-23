const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;

const dialogueText = document.getElementById("dialogueText");
const continuePrompt = document.getElementById("continuePrompt");
const choiceGroup = document.getElementById("choiceGroup");
const yesChoice = document.getElementById("yesChoice");
const noChoice = document.getElementById("noChoice");

const dialogues = [
  { text: "Have you ever heard of the Red Thread of Fate?", firstWords: 5, question: false },
  { text: "They say the Deities tie an invisible red thread between two souls meant to meet. It may stretch. It may tangle. But it always leads them back to each other.", firstWords: 5, question: false },
  { text: "But what if fate were placed in your hands? What if you could shape the person waiting at the other end - their heart, their personality, the way they love you?", firstWords: 5, question: false },
  { text: "Would you like to weave your own red thread of fate?", firstWords: 5, question: true }
];

let dialogueIndex = 0;
let isTyping = false;
let typingToken = 0;
const TYPE_SPEED = 70;
const AUDIO = window.ScarletAudio;

function startTypingSfx() {
  AUDIO?.stopLoopSfx("scene1-typing");
  AUDIO?.startLoopSfx("typing.mp3", "scene1-typing");
}
function stopTypingSfx() { AUDIO?.stopLoopSfx("scene1-typing"); }

function fitDesignToWindow() {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  document.documentElement.style.fontSize = `${DESIGN_ROOT_PX * scale}px`;
}

function splitAfterWords(text, count) {
  const words = text.trim().split(/\s+/);
  return {
    prefix: words.slice(0, count).join(" "),
    remainder: words.slice(count).join(" ")
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeDialogue(index) {
  const item = dialogues[index];
  const myToken = ++typingToken;
  isTyping = true;
  startTypingSfx();
  dialogueText.textContent = "";
  choiceGroup.classList.remove("is-visible");
  choiceGroup.setAttribute("aria-hidden", "true");
  dialogueText.classList.toggle("is-question", item.question);

  // Scene 1 guide stays visible throughout the entire scene.
  continuePrompt.style.display = "block";

  const { prefix, remainder } = splitAfterWords(item.text, item.firstWords);

  for (let i = 0; i < prefix.length; i++) {
    if (myToken !== typingToken) { stopTypingSfx(); return; }
    dialogueText.textContent = prefix.slice(0, i + 1);
    await wait(TYPE_SPEED);
  }

  if (myToken !== typingToken) { stopTypingSfx(); return; }
  dialogueText.textContent = remainder.length > 0 ? `${prefix} ${remainder}` : prefix;
  isTyping = false;
  stopTypingSfx();

  if (item.question) {
    choiceGroup.classList.add("is-visible");
    choiceGroup.setAttribute("aria-hidden", "false");
  }
}

function advanceDialogue() {
  if (isTyping) return;
  if (dialogueIndex >= dialogues.length - 1) return;
  dialogueIndex += 1;
  typeDialogue(dialogueIndex);
}

function handleKeydown(event) {
  if (event.repeat) return;
  if (event.key.toLowerCase() !== "c") return;
  if (isTyping || dialogueIndex >= dialogues.length - 1) return;
  AUDIO?.playSfx("press.wav");
  advanceDialogue();
}

yesChoice.addEventListener("click", () => {
  AUDIO?.playSfx("click.mp3");
  window.sceneWipeNavigate("./scene2.html");
});
noChoice.addEventListener("click", () => {
  AUDIO?.playSfx("click.mp3");
  if (window.parent !== window) window.parent.location.href = "./index.html";
  else window.location.href = "./index.html";
});

window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", fitDesignToWindow);
fitDesignToWindow();
(async () => {
  try { await AUDIO?.tryStartMusic?.(); } catch (_) {}
  typeDialogue(dialogueIndex);
})();
