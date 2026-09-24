/* Settings popup. Every control carries data-key = the setting it edits
 * (the same keys as DEFAULTS in scripts/content.js). */
const DEFAULTS = {
  enabled: true,
  theme: "light",
  fontScale: 100,
  highContrast: false,
  reduceMotion: false,
  glass: true,
  infiniteDirectory: true,
  roomSort: "cams",
  muteKeywords: "",
  dragCameras: true,
  stageMode: "auto",
  stageSize: 6,
  fillGrid: true,
  chatAnnounce: "all",
  mentionWords: "",
  desktopAlerts: false,
  chatScale: 100,
  chatDensity: "comfortable",
  chatTimestamps: false,
  collapseJoins: true,
};

const controls = Array.from(document.querySelectorAll("[data-key]"));
const status = document.getElementById("status");
const reset = document.getElementById("resetCameras");

function read(el) {
  if (el.type === "checkbox") return el.checked;
  if ("number" in el.dataset) return Number(el.value);
  return el.value;
}
function write(el, value) {
  if (el.type === "checkbox") el.checked = !!value;
  else el.value = String(value);
}
function render(s) {
  for (const el of controls) write(el, s[el.dataset.key]);
  const off = !s.enabled;
  for (const el of controls) if (el.dataset.key !== "enabled") el.disabled = off;
  reset.disabled = off;
}

let statusTimer = null;
function flash(msg) {
  status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (status.textContent = ""), 1500);
}

function save(key, value) {
  chrome.storage.sync.set({ [key]: value }, () => flash("Saved"));
}

// Older installs stored a boolean "sortByCams"; carry it into roomSort.
chrome.storage.sync.get({ ...DEFAULTS, sortByCams: true }, (stored) => {
  const s = { ...DEFAULTS, ...stored };
  if (stored.roomSort === undefined && stored.sortByCams === false) s.roomSort = "site";
  render(s);
});

for (const el of controls) {
  const event = el.type === "text" ? "change" : "change";
  el.addEventListener(event, () => {
    const key = el.dataset.key;
    let value = read(el);
    if (key === "desktopAlerts" && value) {
      // Ask for the optional permission now, while the click counts as a user gesture.
      chrome.permissions.request({ permissions: ["notifications"] }, (granted) => {
        if (!granted) {
          el.checked = false;
          flash("Desktop alerts need permission to show notifications");
          save(key, false);
          return;
        }
        save(key, true);
      });
      return;
    }
    if (key === "enabled") {
      chrome.storage.sync.get(DEFAULTS, (s) => render({ ...DEFAULTS, ...s, enabled: value }));
    }
    save(key, value);
  });
}

reset.addEventListener("click", () => {
  // The content script listens for this key changing and restores the site's order.
  chrome.storage.sync.set({ resetCameras: Date.now() }, () => flash("Camera layout reset in open rooms"));
});

// If StumbleChat changed its page and layout changes were paused, say so.
chrome.storage.local.get({ compatStatus: null }, ({ compatStatus }) => {
  const box = document.getElementById("compat");
  if (!compatStatus || !compatStatus.missing || !compatStatus.missing.length) return;
  if (Date.now() - compatStatus.at > 3 * 24 * 3600 * 1000) return;
  box.hidden = false;
  box.textContent =
    "StumbleChat changed its " +
    (compatStatus.kind === "room" ? "room" : "directory") +
    " page, so layout changes are paused there. Colours and accessibility fixes still apply. An update to this extension will bring them back.";
});
