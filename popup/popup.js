const DEFAULTS = { enabled: true, theme: "light", fontScale: 100, highContrast: false, reduceMotion: false, dragCameras: true };

const els = {
  enabled: document.getElementById("enabled"),
  theme: document.getElementById("theme"),
  fontScale: document.getElementById("fontScale"),
  highContrast: document.getElementById("highContrast"),
  reduceMotion: document.getElementById("reduceMotion"),
  dragCameras: document.getElementById("dragCameras"),
  resetCameras: document.getElementById("resetCameras"),
  status: document.getElementById("status"),
};

function render(s) {
  els.enabled.checked = !!s.enabled;
  els.theme.value = s.theme || "light";
  els.fontScale.value = String(s.fontScale);
  els.highContrast.checked = !!s.highContrast;
  els.reduceMotion.checked = !!s.reduceMotion;
  els.dragCameras.checked = s.dragCameras !== false;
  const off = !s.enabled;
  els.theme.disabled = off;
  els.fontScale.disabled = off;
  els.highContrast.disabled = off;
  els.reduceMotion.disabled = off;
  els.dragCameras.disabled = off;
  els.resetCameras.disabled = off;
}

let statusTimer = null;
function flash(msg) {
  els.status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (els.status.textContent = ""), 1500);
}

function save() {
  const s = {
    enabled: els.enabled.checked,
    theme: els.theme.value,
    fontScale: Number(els.fontScale.value),
    highContrast: els.highContrast.checked,
    reduceMotion: els.reduceMotion.checked,
    dragCameras: els.dragCameras.checked,
  };
  chrome.storage.sync.set(s, () => {
    render(s);
    flash("Saved");
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => render({ ...DEFAULTS, ...stored }));
for (const key of ["enabled", "theme", "fontScale", "highContrast", "reduceMotion", "dragCameras"]) {
  els[key].addEventListener("change", save);
}
els.resetCameras.addEventListener("click", () => {
  // The content script listens for this key changing and restores the site's order.
  chrome.storage.sync.set({ resetCameras: Date.now() }, () => flash("Camera layout reset in open rooms"));
});
