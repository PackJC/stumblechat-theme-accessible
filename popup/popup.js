const DEFAULTS = { enabled: true, fontScale: 100, highContrast: false, reduceMotion: false };

const els = {
  enabled: document.getElementById("enabled"),
  fontScale: document.getElementById("fontScale"),
  highContrast: document.getElementById("highContrast"),
  reduceMotion: document.getElementById("reduceMotion"),
  status: document.getElementById("status"),
};

function render(s) {
  els.enabled.checked = !!s.enabled;
  els.fontScale.value = String(s.fontScale);
  els.highContrast.checked = !!s.highContrast;
  els.reduceMotion.checked = !!s.reduceMotion;
  const off = !s.enabled;
  els.fontScale.disabled = off;
  els.highContrast.disabled = off;
  els.reduceMotion.disabled = off;
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
    fontScale: Number(els.fontScale.value),
    highContrast: els.highContrast.checked,
    reduceMotion: els.reduceMotion.checked,
  };
  chrome.storage.sync.set(s, () => {
    render(s);
    flash("Saved");
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => render({ ...DEFAULTS, ...stored }));
for (const key of ["enabled", "fontScale", "highContrast", "reduceMotion"]) {
  els[key].addEventListener("change", save);
}
