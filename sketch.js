const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const DESIGN_ROOT_PX = 16;

function fitDesignToWindow() {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  document.documentElement.style.fontSize = `${DESIGN_ROOT_PX * scale}px`;
}

fitDesignToWindow();
window.addEventListener("resize", fitDesignToWindow);
const pushStart = document.getElementById("pushStart");
if (pushStart) {
  pushStart.addEventListener("click", (event) => {
    event.stopPropagation();
    window.ScarletAudio?.primeForScene1?.();
    window.ScarletAudio?.playSfx?.("click.mp3");
    window.sceneWipeNavigate("./scene1.html");
  }, { once: true });
}
