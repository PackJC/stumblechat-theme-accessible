/* StumbleChat Accessible — content script
 *
 * 1. Applies the user's popup settings as classes/vars on <html>.
 * 2. Fixes things CSS alone cannot: keyboard access, ARIA landmarks/labels,
 *    pinch-zoom, live regions, and contrast of user-chosen chat colours.
 *
 * Runs at document_start; DOM work is deferred until <body> exists.
 */
(() => {
  "use strict";

  const ROOT = document.documentElement;
  // The one settings schema. popup/popup.js mirrors these keys; the feature
  // scripts read them through SCA11Y.settings / SCA11Y.onSettings.
  const DEFAULTS = {
    enabled: true,
    theme: "light", // "light" | "dark" | "auto" (follow the OS)
    fontScale: 100, // percent
    highContrast: false,
    reduceMotion: false,
    glass: true, // frosted-glass panels over a gradient (directory, login, settings, room)
    // Directory
    infiniteDirectory: true, // load the next directory page as you scroll instead of page buttons
    roomSort: "cams", // "cams" | "people" | "name" | "site"
    muteKeywords: "", // hide rooms whose name or topic contains one of these, comma separated
    // Room
    dragCameras: true, // drag broadcast tiles to rearrange them
    resetCameras: 0, // timestamp; the popup bumps it to reset the layout
    stageMode: "auto", // speaker stage: "auto" (phones) | "always" | "off"
    stageSize: 6, // tiles on the stage
    fillGrid: true, // size camera tiles to fill the video area
    // Chat
    chatAnnounce: "all", // screen-reader announcements: "all" | "mentions" | "off"
    mentionWords: "", // extra words that count as a mention, comma separated
    desktopAlerts: false, // opt-in desktop notifications for mentions and PMs
    chatScale: 100, // chat text size, percent of the page text size
    chatDensity: "comfortable", // "comfortable" | "compact"
    chatTimestamps: false, // always show message times
    collapseJoins: true, // fold runs of join/leave lines into one
  };
  let settings = { ...DEFAULTS };
  const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const settingsListeners = [];

  // Apply immediately so there is no flash of the dark site.
  ROOT.classList.add("sca11y", "sca11y-glass");

  // Bundled display face. Registered from script (not theme.css) so the URL
  // is right in both Chrome (chrome-extension://) and Firefox (moz-extension://).
  (function loadDisplayFont() {
    let url = null;
    try {
      url = chrome.runtime.getURL("fonts/Outfit.woff2");
    } catch (_) {
      return; // not running as an extension (fixture harness registers it itself)
    }
    const style = document.createElement("style");
    style.dataset.sca11y = "font";
    style.textContent = `@font-face{font-family:"SCA11y Outfit";font-style:normal;font-weight:600 800;font-display:swap;src:url("${url}") format("woff2")}`;
    (document.head || ROOT).appendChild(style);
  })();

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */
  function wantsDark() {
    if (settings.theme === "dark") return true;
    if (settings.theme === "auto") return !!(darkQuery && darkQuery.matches);
    return false;
  }
  function applySettings() {
    ROOT.classList.toggle("sca11y", !!settings.enabled);
    ROOT.classList.toggle("sca11y-dark", !!settings.enabled && wantsDark());
    ROOT.classList.toggle("sca11y-hc", !!settings.enabled && !!settings.highContrast);
    ROOT.classList.toggle("sca11y-reduce-motion", !!settings.enabled && !!settings.reduceMotion);
    ROOT.classList.toggle("sca11y-glass", !!settings.enabled && settings.glass !== false);
    const scale = Math.max(80, Math.min(200, Number(settings.fontScale) || 100)) / 100;
    ROOT.style.setProperty("--sc-scale", String(scale));
    // Re-evaluate colour fixes: the target ratio changes with high contrast.
    if (settings.enabled) scheduleContrastPass(true);
    else restoreAllColours();
    settingsLoaded = true;
    for (const fn of settingsListeners) {
      try {
        fn(settings);
      } catch (err) {
        console.warn("[StumbleChat Accessible]", err);
      }
    }
  }
  let settingsLoaded = false;

  // Older installs stored a boolean "sortByCams"; carry it into roomSort.
  function migrate(stored) {
    if (stored && stored.roomSort === undefined && stored.sortByCams === false) stored.roomSort = "site";
    return stored;
  }

  try {
    chrome.storage.sync.get({ ...DEFAULTS, sortByCams: true }, (stored) => {
      settings = { ...DEFAULTS, ...migrate(stored || {}) };
      applySettings();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
      applySettings();
      if (changes.resetCameras) resetCameraOrder();
      if (changes.dragCameras) applyCameraOrder();
      if (changes.roomSort) sortRoomCards();
    });
  } catch (_) {
    // Storage unavailable: the extension was reloaded under the page, or this
    // is the fixture harness, which passes overrides in a global. Apply after
    // the rest of this script has initialised.
    const overrides = (typeof globalThis.__SCA11Y_FIXTURE_SETTINGS__ === "object" && globalThis.__SCA11Y_FIXTURE_SETTINGS__) || {};
    settings = { ...DEFAULTS, ...overrides };
    Promise.resolve().then(applySettings);
  }
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener("change", () => {
      if (settings.theme === "auto") applySettings();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Colour maths (WCAG 2.x relative luminance / contrast ratio)         */
  /* ------------------------------------------------------------------ */
  function parseRGBA(str) {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(str || "");
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  function channel(c) {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function luminance([r, g, b]) {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function blend(fg, bg) {
    const a = fg[3];
    return [
      fg[0] * a + bg[0] * (1 - a),
      fg[1] * a + bg[1] * (1 - a),
      fg[2] * a + bg[2] * (1 - a),
      1,
    ];
  }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v, 1]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255), 1];
  }
  const toCSS = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

  /** Effective opaque background behind an element (walks up, alpha-blends). */
  function effectiveBackground(el) {
    let node = el;
    const layers = [];
    while (node && node.nodeType === 1) {
      const c = parseRGBA(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
      node = node.parentElement;
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg);
    return bg;
  }

  /**
   * Nudge `fg` toward black or white (whichever side `bg` is on) until it
   * meets `target`. Keeps hue so user identities stay recognisable.
   */
  function fitColour(fg, bg, target) {
    if (contrast(fg, bg) >= target) return fg;
    const lightBg = luminance(bg) > 0.18;
    const [h, s, l0] = rgbToHsl(fg);
    let l = l0;
    for (let i = 0; i < 60; i++) {
      l += lightBg ? -0.02 : 0.02;
      if (l <= 0) return [0, 0, 0, 1];
      if (l >= 1) return [255, 255, 255, 1];
      const c = hslToRgb([h, s, l]);
      if (contrast(c, bg) >= target) return c;
    }
    return lightBg ? [0, 0, 0, 1] : [255, 255, 255, 1];
  }

  /* ------------------------------------------------------------------ */
  /* Contrast pass over user-coloured chat content                       */
  /* ------------------------------------------------------------------ */
  const FIXED = new WeakMap(); // el -> original inline colour ("" if none)
  const COLOUR_TARGETS = [
    "#chat-content .message .message.common",   // message text (inline color)
    "#chat-content .message > .nickname",       // nickname (inline background)
    "#chat-content .content [style*='color']",
    "#chat-content .content font[color]",
    "#chat-content .message.system [style*='color']",
    ".privateMessages .nickname",
    "#userlist .nickname[style]",
    ".user-menu-name",
    ".video-menu-name",
  ].join(",");

  function targetRatio() {
    return settings.highContrast ? 7 : 4.5;
  }

  // Normalise any CSS colour string ("#f80", "red", "hsl(...)") to rgba.
  let probeCtx = null;
  function parseAnyColour(str) {
    if (!str) return null;
    const direct = parseRGBA(str);
    if (direct) return direct;
    try {
      if (!probeCtx) probeCtx = document.createElement("canvas").getContext("2d");
      probeCtx.fillStyle = "#000";
      probeCtx.fillStyle = str;
      const v = probeCtx.fillStyle; // "#rrggbb" or "rgba(...)"
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
      }
      return parseRGBA(v);
    } catch (_) {
      return null;
    }
  }

  function fixElement(el, force) {
    if (!FIXED.has(el)) FIXED.set(el, el.style.getPropertyValue("color") || "");
    else if (force) el.style.setProperty("color", FIXED.get(el));
    else return; // already handled, colours are stable

    // Prefer the colour the user chose (inline). The stylesheet forces the
    // computed colour to the theme text colour, so reading only computed
    // style would silently discard every custom colour.
    const inline = FIXED.get(el);
    let fg = inline ? parseAnyColour(inline) : null;
    const fromInline = !!fg;
    if (!fg) fg = parseRGBA(getComputedStyle(el).color);
    if (!fg) return;

    const bg = effectiveBackground(el);
    const target = targetRatio();
    let fitted;
    if (fromInline) {
      // Keep the user's hue, adjust lightness only as far as needed.
      fitted = fitColour(blend(fg, bg), bg, target);
    } else if (contrast(fg, bg) < target) {
      // Theme text on a user-chosen background: plain black or white, whichever reads better.
      fitted = contrast([0, 0, 0, 1], bg) >= contrast([255, 255, 255, 1], bg) ? [0, 0, 0, 1] : [255, 255, 255, 1];
    } else {
      return; // theme colour already passes; leave the stylesheet in charge
    }
    const changed = fitted[0] !== fg[0] || fitted[1] !== fg[1] || fitted[2] !== fg[2] || fg[3] < 1;
    if (fromInline || changed) el.style.setProperty("color", toCSS(fitted), "important");
  }

  function accentFromMessage(msg) {
    // The site stores the user's message colour as an inline background
    // ("#ff8800a3", which the browser reports back as rgba(...)). The
    // stylesheet flattens the background; keep the hue as a left accent bar.
    if (msg.dataset.sca11yAccent) return;
    const raw = msg.style.backgroundColor || msg.style.background;
    if (!raw) return;
    const c = parseAnyColour(raw);
    if (!c) return;
    const hex = "#" + [c[0], c[1], c[2]].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
    msg.dataset.sca11yAccent = "1";
    msg.style.setProperty("--sca11y-accent", hex);
    const content = msg.querySelector(":scope > .content");
    if (content) content.style.setProperty("--sca11y-accent", hex);
  }

  function restoreAllColours() {
    document.querySelectorAll(COLOUR_TARGETS).forEach((el) => {
      if (FIXED.has(el)) el.style.setProperty("color", FIXED.get(el));
    });
  }

  // setTimeout rather than requestAnimationFrame: rAF is paused in background
  // tabs, and chat rooms are often left open in one.
  let passQueued = false;
  let passForce = false;
  function scheduleContrastPass(force) {
    passForce = passForce || !!force;
    if (passQueued) return;
    passQueued = true;
    setTimeout(() => {
      passQueued = false;
      const force = passForce;
      passForce = false;
      if (!settings.enabled || !document.body) return;
      document.querySelectorAll("#chat-content > .message").forEach(accentFromMessage);
      document.querySelectorAll(COLOUR_TARGETS).forEach((el) => fixElement(el, force));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Structural / keyboard / ARIA fixes                                  */
  /* ------------------------------------------------------------------ */
  function setAttr(el, name, value) {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function makeKeyboardButton(el, role) {
    if (!el || el.dataset.sca11yBtn) return;
    el.dataset.sca11yBtn = "1";
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("role")) el.setAttribute("role", role || "button");
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard activation                                                 */
  /*                                                                     */
  /* The site reacts to pointer presses, not clicks. Nearly every room    */
  /* control (user rows, camera tiles, VERIFY, the dialog X, Set/Search   */
  /* buttons, settings switches, PM tabs, the topic) is handled by one    */
  /* window "pointerup" listener that inspects event.target, and Start    */
  /* Broadcast, Screen share, the media ▲ and Talk act on "pointerdown".  */
  /* Enter/Space only produce a click, so for keyboard users nothing      */
  /* happened. activate() replays the sequence a mouse sends.             */
  /* ------------------------------------------------------------------ */
  let synthesizing = 0; // >0 while we dispatch; camera drag ignores these
  function pointerEvent(type, el) {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(r.width / 2, 40));
    const y = Math.round(r.top + r.height / 2);
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: type === "pointermove" ? -1 : 0,
      buttons: type === "pointerdown" ? 1 : 0,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      view: window,
    });
  }
  function dispatchPointer(el, ...types) {
    synthesizing++;
    try {
      for (const t of types) el.dispatchEvent(pointerEvent(t, el));
    } finally {
      synthesizing--;
    }
  }
  /** Press and release `el` the way a mouse would; optionally click too. */
  function activate(el, click) {
    dispatchPointer(el, "pointerdown", "pointerup");
    if (click) el.click();
  }

  let menuInvoker = null; // element that opened the user/video context menu
  const NATIVE_BUTTON = "button, input[type='submit'], input[type='button'], input[type='reset']";

  document.addEventListener(
    "keydown",
    (e) => {
      if (!settings.enabled) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const inRoom = !!document.getElementById("room");

      // Talk: hold Space or Enter to talk, release to stop.
      if (el.id === "media-ptt") {
        e.preventDefault();
        if (!e.repeat) dispatchPointer(el, "pointerdown");
        return;
      }
      // Settings switches: the site reads pointerup on the .slider span,
      // while the checkbox shows the state. Keep them in step.
      if (el.matches("label.switch > input[type='checkbox']")) {
        const slider = el.parentElement.querySelector(".slider");
        if (slider) activate(slider);
        if (e.key === "Enter") {
          e.preventDefault();
          el.click();
        }
        return;
      }
      if (el.dataset.sca11yBtn) {
        if (el.tagName === "A" && el.hasAttribute("href") && e.key === "Enter") return;
        e.preventDefault();
        if (el.closest(".bar, #regularvideos > .js-video")) menuInvoker = el;
        // Tiles: the focusable part is the .video-wrapper, which is also the
        // exact target the site's camera menu listens for.
        activate(el, true);
        if (menuInvoker) focusOpenedMenu();
        return;
      }
      // Native buttons in the room: send the pointer sequence, and let the
      // browser's own click follow as it would for a mouse.
      if (inRoom && el.matches(NATIVE_BUTTON) && !el.closest("[data-sca11y-ui]")) {
        dispatchPointer(el, "pointerdown", "pointerup");
      }
    },
    true
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.target instanceof HTMLElement && e.target.id === "media-ptt" && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        dispatchPointer(e.target, "pointerup"); // any pointerup ends push-to-talk
      }
    },
    true
  );
  // Talking stops if focus leaves Talk while the key is held.
  document.addEventListener(
    "focusout",
    (e) => {
      if (e.target instanceof HTMLElement && e.target.id === "media-ptt" && /TALKING/i.test(e.target.textContent)) {
        dispatchPointer(e.target, "pointerup");
      }
    },
    true
  );
  // Back to top: the site scrolls on pointerup only, so Enter/Space (a click
  // with no pointer, detail 0) did nothing. Scroll, then put focus at the
  // top of the page: the button hides itself once the page is at the top.
  document.addEventListener(
    "click",
    (e) => {
      if (!settings.enabled || e.detail !== 0) return;
      if (!(e.target instanceof Element) || e.target.id !== "scrollup") return;
      const main = document.querySelector("body > .content");
      if (!main) return;
      main.scrollTo({ top: 0 });
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    },
    true
  );
  // Account menu (signed in): the site opens #accdrop on "pointerup" of
  // #accbtn, a <div> no keyboard could reach. Make it a button that says
  // whether the menu is open; Escape closes the menu and returns to it.
  function syncAccountMenu() {
    const btn = document.getElementById("accbtn");
    const menu = document.getElementById("accdrop");
    if (!btn || !menu) return;
    makeKeyboardButton(btn);
    setAttr(btn, "aria-controls", "accdrop");
    setAttr(btn, "aria-expanded", menu.classList.contains("show") ? "true" : "false");
    const name = btn.querySelector("span");
    if (name && name.textContent.trim()) setAttr(btn, "aria-label", "Account: " + name.textContent.trim());
  }
  document.addEventListener(
    "pointerup",
    (e) => {
      if (e.target instanceof Element && e.target.closest("#accbtn")) setTimeout(syncAccountMenu, 0);
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !settings.enabled) return;
      const menu = document.getElementById("accdrop");
      const btn = document.getElementById("accbtn");
      if (!menu || !btn || !menu.classList.contains("show")) return;
      if (!(e.target instanceof Node) || !(menu.contains(e.target) || btn.contains(e.target))) return;
      e.preventDefault();
      menu.classList.remove("show");
      syncAccountMenu();
      btn.focus();
    },
    true
  );
  // Per-camera volume: the site applies the slider on pointerup only.
  document.addEventListener(
    "change",
    (e) => {
      if (e.target instanceof HTMLElement && e.target.id === "video-volume" && !synthesizing) dispatchPointer(e.target, "pointerup");
    },
    true
  );

  /* Context menus and header dropdowns: arrow keys, Home/End, Escape.  */
  function visibleItems(container, sel) {
    return Array.from(container.querySelectorAll(sel)).filter((a) => {
      if (a.closest(".hidden")) return false;
      const r = a.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function openMenu() {
    return document.querySelector(".user-menu.user-menu-active, .video-menu.video-menu-active");
  }
  function closeMenus(returnFocus) {
    const menu = openMenu();
    if (menu) menu.classList.remove("user-menu-active", "video-menu-active");
    if (returnFocus && menuInvoker && menuInvoker.isConnected) menuInvoker.focus();
    menuInvoker = null;
  }
  function openDropdown() {
    return document.querySelector(".user-options-dropdown.sca11y-open");
  }
  function setDropdown(dd, open) {
    document.querySelectorAll(".user-options-dropdown.sca11y-open").forEach((d) => {
      if (d !== dd) {
        d.classList.remove("sca11y-open");
        const b = d.querySelector(".dropbtn");
        if (b) b.setAttribute("aria-expanded", "false");
      }
    });
    if (!dd) return;
    dd.classList.toggle("sca11y-open", open);
    const btn = dd.querySelector(".dropbtn");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function moveFocus(items, current, delta) {
    if (!items.length) return;
    let i = items.indexOf(current);
    if (delta === "first") i = 0;
    else if (delta === "last") i = items.length - 1;
    else i = i < 0 ? 0 : (i + delta + items.length) % items.length;
    items[i].focus();
  }

  document.addEventListener("keydown", (e) => {
    if (!settings.enabled) return;
    const el = document.activeElement;
    // Header dropdowns act as disclosure buttons.
    if (el && el.classList && el.classList.contains("dropbtn")) {
      const dd = el.closest(".user-options-dropdown");
      if (dd && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
        e.preventDefault();
        const open = e.key === "ArrowDown" ? true : !dd.classList.contains("sca11y-open");
        setDropdown(dd, open);
        if (open) moveFocus(visibleItems(dd, ".dropdown-content a, .dropdown-content input"), null, "first");
        return;
      }
    }
    const dd = el && el.closest && el.closest(".user-options-dropdown.sca11y-open .dropdown-content");
    if (dd) {
      const items = visibleItems(dd, "a, input");
      const btn = dd.parentElement.querySelector(".dropbtn");
      if (e.key === "ArrowDown") (e.preventDefault(), moveFocus(items, el, 1));
      else if (e.key === "ArrowUp") (e.preventDefault(), moveFocus(items, el, -1));
      else if (e.key === "Home") (e.preventDefault(), moveFocus(items, el, "first"));
      else if (e.key === "End") (e.preventDefault(), moveFocus(items, el, "last"));
      else if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.preventDefault();
        setDropdown(dd.parentElement, false);
        if (e.key === "Escape" && btn) btn.focus();
      }
      return;
    }
    const menu = openMenu();
    if (menu && menu.contains(el)) {
      const items = visibleItems(menu, "[role='menuitem'], input[type='range']");
      if (e.key === "ArrowDown") (e.preventDefault(), moveFocus(items, el, 1));
      else if (e.key === "ArrowUp") (e.preventDefault(), moveFocus(items, el, -1));
      else if (e.key === "Home") (e.preventDefault(), moveFocus(items, el, "first"));
      else if (e.key === "End") (e.preventDefault(), moveFocus(items, el, "last"));
      else if (e.key === "Tab") closeMenus(false);
    }
    if (e.key !== "Escape") return;
    if (menu) {
      e.preventDefault();
      closeMenus(true);
    } else if (openDropdown()) {
      setDropdown(null);
    } else if (ROOT.classList.contains("sca11y-users-open")) {
      setUsersDrawer(false);
    } else {
      // Dialogs that offer a close button close on Escape too.
      const exit = document.querySelector("#modal-back.visible #modal-exit.visible");
      if (exit) {
        e.preventDefault();
        activate(exit);
      }
    }
  });
  // Close a keyboard-opened dropdown when focus leaves it.
  document.addEventListener("focusout", (e) => {
    const dd = e.target instanceof Element && e.target.closest(".user-options-dropdown.sca11y-open");
    if (dd && !(e.relatedTarget instanceof Element && dd.contains(e.relatedTarget))) setDropdown(dd, false);
  });
  // When a context menu opens from the keyboard, move focus into it.
  function focusOpenedMenu() {
    const menu = openMenu();
    if (!menu || !menuInvoker || menu.contains(document.activeElement)) return;
    const first = visibleItems(menu, "[role='menuitem'], input[type='range']")[0];
    if (first) first.focus();
  }

  function fixViewport() {
    // WCAG 1.4.4 Resize Text / 1.4.10: the site ships user-scalable=0.
    // interactive-widget=resizes-content makes Chrome on Android shrink the
    // page when the on-screen keyboard opens, so the chat box stays visible.
    const meta = document.querySelector('meta[name="viewport"]');
    const content = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, interactive-widget=resizes-content";
    if (meta) {
      if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
    } else if (document.head) {
      const m = document.createElement("meta");
      m.name = "viewport";
      m.content = content;
      document.head.appendChild(m);
    }
  }

  function addSkipLink() {
    if (document.querySelector(".sca11y-skip")) return;
    // The page wrapper, not a chat bubble (those are ".content" too).
    const main = document.querySelector("body > .content, #room-content");
    if (!main) return;
    if (!main.id) main.id = "sca11y-main";
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    const a = document.createElement("a");
    a.className = "sca11y-skip";
    a.href = "#" + main.id;
    a.textContent = "Skip to main content";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      main.focus();
    });
    document.body.insertBefore(a, document.body.firstChild);
  }

  function fixLandmarks() {
    const nav = document.querySelector("nav.navbar");
    if (nav) setAttr(nav, "aria-label", "Primary");
    const content = document.querySelector("body > .content");
    if (content && !content.closest("main")) setAttr(content, "role", "main");
    const footer = document.querySelector(".footer");
    if (footer) setAttr(footer, "role", "contentinfo");
    syncAccountMenu();

    // Room page
    const roomContent = document.getElementById("room-content");
    if (roomContent) setAttr(roomContent, "role", "main");
    const userlist = document.getElementById("userlist");
    if (userlist) {
      setAttr(userlist, "role", "region");
      setAttr(userlist, "aria-label", "Users in room");
    }
    const list = document.querySelector("#userlist ul.list");
    if (list) setAttr(list, "role", "list");
    const chat = document.getElementById("chat");
    if (chat) {
      // Announcements are owned by scripts/chat-features.js, which reads
      // each new message once, cleanly, per the "Chat announcements" setting.
      setAttr(chat, "role", "log");
      setAttr(chat, "aria-label", "Chat messages");
    }
    const videos = document.getElementById("videos-content");
    if (videos) {
      setAttr(videos, "role", "region");
      setAttr(videos, "aria-label", "Broadcasts");
    }
    const taskbar = document.querySelector("sc-taskbar");
    if (taskbar) {
      setAttr(taskbar, "role", "toolbar");
      setAttr(taskbar, "aria-label", "Broadcast controls");
    }
    const header = document.querySelector("sc-videolist > .header:not(.roomdesc)");
    if (header) {
      setAttr(header, "role", "navigation");
      setAttr(header, "aria-label", "Room options");
    }
    const error = document.getElementById("error");
    if (error) {
      setAttr(error, "role", "alert"); // WCAG 4.1.3 Status Messages
    }
    const unread = document.querySelector(".unreadmessage");
    if (unread) {
      setAttr(unread, "role", "status");
      makeKeyboardButton(unread);
    }
  }

  function fixForms() {
    // Placeholder-only inputs get an accessible name (WCAG 1.3.1 / 4.1.2).
    document.querySelectorAll("input[placeholder], textarea[placeholder]").forEach((input) => {
      const hasLabel =
        (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) ||
        input.closest("label") ||
        input.hasAttribute("aria-label") ||
        input.hasAttribute("aria-labelledby");
      if (!hasLabel) input.setAttribute("aria-label", input.getAttribute("placeholder"));
    });
    // <label>DD</label><input id="day"> — associate orphan labels with the
    // next input in the same block.
    document.querySelectorAll("label:not([for])").forEach((label) => {
      if (label.querySelector("input, select, textarea")) return;
      const next = label.nextElementSibling;
      if (next && /^(INPUT|SELECT|TEXTAREA)$/.test(next.tagName) && next.id) label.htmlFor = next.id;
    });
    const textarea = document.getElementById("textarea");
    if (textarea) setAttr(textarea, "aria-label", "Type a message");
    // Ranges without names
    document.querySelectorAll('input[type="range"]:not([aria-label])').forEach((r) => {
      r.setAttribute("aria-label", "Volume");
    });
    // Register page: the "Confirm Password" label points at the wrong id.
    const confirm = document.getElementById("confirm");
    if (confirm) {
      const label = Array.from(document.querySelectorAll('label[for="password"]')).find((l) =>
        /confirm/i.test(l.textContent)
      );
      if (label) label.htmlFor = "confirm";
    }
    fixAutocomplete();
    fixSwitchNames();
  }

  // WCAG 1.3.5 Identify Input Purpose and 3.3.8 Accessible Authentication:
  // tell browsers and password managers what each account field is, so
  // they can fill it. The site ships autocomplete="on"/"off" throughout.
  const AUTOCOMPLETE = [
    ["form[name='Auth'] #username", "username"],
    ["form[name='Auth'] #password", "current-password"], // register overrides below
    ["form[name='Auth'] #user", "username"],
    ["form[name='Auth'] #email", "email"],
    ["form[name='Auth'] #day", "bday-day"],
    ["form[name='Auth'] #month", "bday-month"],
    ["form[name='Auth'] #year", "bday-year"],
    ["form[name='Auth'] #confirm", "new-password"],
    ["#currentpassword", "current-password"],
    ["#newpassword", "new-password"],
    ["#confirmpassword", "new-password"],
  ];
  function fixAutocomplete() {
    const register = !!document.getElementById("confirm");
    for (const [sel, value] of AUTOCOMPLETE) {
      document.querySelectorAll(sel).forEach((input) => setAttr(input, "autocomplete", value));
    }
    // On the register form the first password is a new one.
    if (register) {
      const pw = document.querySelector("form[name='Auth'] #password");
      if (pw) setAttr(pw, "autocomplete", "new-password");
    }
    document.querySelectorAll("form[name='Auth'] #day, form[name='Auth'] #month, form[name='Auth'] #year").forEach((i) => setAttr(i, "inputmode", "numeric"));
  }

  // Settings switches in dialogs: <label class="switch"><input><span class="slider" id="…">
  // followed by an <h2> that names it. Give the checkbox that name.
  function fixSwitchNames() {
    document.querySelectorAll("label.switch > input[type='checkbox']").forEach((input) => {
      if (input.hasAttribute("aria-label")) return;
      const row = input.closest(".optionside");
      const h = row && row.querySelector("h2");
      const name = h ? h.textContent.replace(/:\s*$/, "").trim() : "";
      if (name) {
        input.setAttribute("aria-label", name);
        input.setAttribute("role", "switch");
      }
    });
  }

  function fixDirectory() {
    document.querySelectorAll(".pagination div").forEach((p) => {
      makeKeyboardButton(p);
      const active = p.classList.contains("active");
      if (active) p.setAttribute("aria-current", "page");
      else p.removeAttribute("aria-current");
      const t = (p.textContent || "").trim();
      if (t === "»") setAttr(p, "aria-label", "Next page");
      else if (t === "«") setAttr(p, "aria-label", "Previous page");
      else if (/^\d+$/.test(t)) setAttr(p, "aria-label", "Page " + t);
    });
    const pagination = document.querySelector(".pagination");
    if (pagination) {
      setAttr(pagination, "role", "navigation");
      setAttr(pagination, "aria-label", "Pagination");
    }
    document.querySelectorAll(".slideshow").forEach((s) => {
      const room = s.getAttribute("slide-show") || "room";
      setAttr(s, "role", "group");
      setAttr(s, "aria-roledescription", "carousel");
      setAttr(s, "aria-label", room + " broadcast previews");
      // The prev/next arrows are hidden by the theme (they do nothing); keep
      // them out of the accessibility tree too.
      s.querySelectorAll(".prev, .next").forEach((a) => setAttr(a, "aria-hidden", "true"));
    });
    document.querySelectorAll(".room-wrap").forEach((card) => {
      setAttr(card, "role", "article");
      const name = card.querySelector(".roomname h3");
      const link = card.querySelector(".thumbnail a[href]");
      if (name && link && !link.getAttribute("aria-label")) {
        link.setAttribute("aria-label", "Join room " + name.textContent.trim());
      }
      const b = card.querySelector(".detailbadge.broadcast");
      const u = card.querySelector(".detailbadge.users");
      if (b) {
        const n = b.textContent.trim();
        setAttr(b, "aria-label", n + " on cam");
        setAttr(b, "title", n + " people broadcasting");
        // Green on-cam count while anyone is broadcasting
        const live = Number(n) > 0;
        if (card.classList.contains("sca11y-live") !== live) card.classList.toggle("sca11y-live", live);
      }
      if (u) { const n = u.textContent.trim(); setAttr(u, "aria-label", n + " in room"); setAttr(u, "title", n + " people in the room"); }
    });
    document.querySelectorAll("img[alt='Room Broadcast']").forEach((img) => {
      const card = img.closest(".room-wrap");
      const name = card && card.querySelector(".roomname h3");
      if (name) img.alt = "Broadcast preview from " + name.textContent.trim();
    });
    const scrollup = document.getElementById("scrollup");
    if (scrollup) setAttr(scrollup, "aria-label", "Scroll to top");
    fixBrand();
    fixPromotedSection();
    fixInfiniteDirectory();
    emit("directory");
  }
  // Ordering, search, favourites and hiding live in scripts/directory-tools.js.
  function sortRoomCards() {
    emit("directory");
  }

  // "Promoted rooms" ships with no rooms in it (the site keeps that block
  // commented out), so the panel is just a heading plus, when logged in, the
  // Promote button. Move the button under the "Public rooms" heading and hide
  // the empty panel. If promoted cards ever appear, the panel comes back.
  function fixPromotedSection() {
    document.querySelectorAll(".content > .wrapper").forEach((w) => {
      const h1 = w.querySelector(":scope > h1");
      if (!h1 || !/promoted/i.test(h1.textContent)) return;
      const btn = w.querySelector(":scope > .promotebtn");
      const next = w.nextElementSibling;
      if (btn && next && next.classList.contains("wrapper") && next.querySelector(":scope > h1") && !w.querySelector(".room-wrap")) {
        next.appendChild(btn);
      }
      const empty = Array.from(w.children).every((c) => c === h1);
      if (w.classList.contains("sca11y-empty-promoted") !== empty) w.classList.toggle("sca11y-empty-promoted", empty);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Directory: load the next page as you scroll                         */
  /*                                                                     */
  /* The site's directory.js fetches one page at a time (POST /lbstats   */
  /* with page=N -> {rooms, currentPage, totalPages}) and replaces the    */
  /* grid. This asks the same endpoint for the following pages and       */
  /* appends the cards with the site's own markup. A "Load more" button  */
  /* is the control (WCAG: infinite scroll needs a real control); it     */
  /* also fires by itself when scrolled into view.                       */
  /* ------------------------------------------------------------------ */
  // armed: automatic loading starts only after the visitor scrolls, so
  // opening the directory sends exactly the request the site sends itself.
  // cooldownUntil: set when the site answers "rate limited" (error 0).
  const dir = { next: 2, total: null, loading: false, seen: new Set(), armed: false, visible: false, cooldownUntil: 0 };
  let dirObserver = null;
  function armDirectory() {
    if (dir.armed) return;
    dir.armed = true;
    if (dir.visible) loadMoreRooms();
  }
  ["wheel", "touchmove"].forEach((t) => window.addEventListener(t, armDirectory, { passive: true, capture: true }));
  window.addEventListener(
    "keydown",
    (e) => {
      if (["PageDown", "ArrowDown", "End", " "].includes(e.key) && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) armDirectory();
    },
    true
  );
  document.addEventListener("scroll", () => armDirectory(), { passive: true, capture: true });

  function directoryPageFromDom() {
    const active = document.querySelector(".pagination div.active[page-id]");
    const n = active ? Number(active.getAttribute("page-id")) : 1;
    const total = document.querySelectorAll(".pagination div[page-id]").length
      ? Math.max(...Array.from(document.querySelectorAll(".pagination div[page-id]")).map((d) => Number(d.getAttribute("page-id")) || 0))
      : null;
    return { current: n || 1, total };
  }

  function roomCard(room) {
    // Same markup as the site's SpawnRoom(); the preview is filled in below.
    const el = document.createElement("div");
    el.className = "grid-item";
    el.innerHTML =
      '<div class="room-wrap"><div class="roomname"><h3></h3></div><div class="details"><div class="detailbadge broadcast"></div><div class="detailbadge users"></div></div><div class="thumbnail"><div class="slideshow"><a></a><a class="prev">&#10094;</a><a class="next">&#10095;</a></div></div><div class="description"><h4></h4></div></div>';
    const name = String(room.name || "");
    el.querySelector("h3").textContent = name;
    el.querySelector(".broadcast").textContent = String(room.broadcasting_count ?? 0);
    el.querySelector(".users").textContent = String(room.watching_count ?? 0);
    el.querySelector("h4").textContent = String(room.topic || "");
    el.querySelector(".slideshow").setAttribute("slide-show", name);
    const link = el.querySelector(".slideshow > a");
    link.href = "/room/" + encodeURIComponent(name);
    link.setAttribute("room-name", name);
    link.innerHTML = '<div class="slides" style="display: block;"><div alt="No Broadcasts" class="no-avatar"></div></div>';
    // Preview: the site shows the room's large avatar when it is a webp.
    fetch(location.origin + "/profile/" + encodeURIComponent(name.toLowerCase()) + "/cached/large_avatar.webp", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || blob.type !== "image/webp") return;
        const img = document.createElement("img");
        img.alt = "Room Broadcast";
        const url = URL.createObjectURL(blob);
        const release = () => URL.revokeObjectURL(url); // the decoded image stays; the blob is freed
        img.addEventListener("load", release, { once: true });
        img.addEventListener("error", release, { once: true });
        img.src = url;
        const slides = link.querySelector(".slides");
        slides.className = "slides fade";
        slides.replaceChildren(img);
        scheduleFixes(["directory"]);
      })
      .catch(() => {});
    return el;
  }

  function setMoreState(text, busy) {
    const btn = document.querySelector(".sca11y-more-btn");
    const status = document.querySelector(".sca11y-more-status");
    if (btn) {
      btn.textContent = text;
      btn.setAttribute("aria-busy", busy ? "true" : "false");
      btn.disabled = !!busy;
    }
    if (status) {
      const pages = dir.total ? "Page " + (dir.next - 1) + " of " + dir.total : "";
      if (status.textContent !== pages) status.textContent = pages;
    }
  }

  async function loadMoreRooms(fromButton) {
    if (dir.loading) return;
    if (dir.total && dir.next > dir.total) return;
    // Automatic loads wait out a rate limit; the button always tries.
    if (fromButton !== true && Date.now() < dir.cooldownUntil) return;
    const grid = document.querySelector(".publicrooms > .centered");
    if (!grid) return;
    dir.loading = true;
    setMoreState("Loading more rooms…", true);
    try {
      const res = await fetch(location.origin + "/lbstats", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "page=" + dir.next,
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      // The site signals problems inside a 200 response: error 0 means rate
      // limited, 22 means a server error (directory.js lines 87 and 91).
      if (data && data.error === 0) {
        dir.cooldownUntil = Date.now() + 60000;
        setMoreState("Too many requests. Try again in a minute", false);
        announce("StumbleChat is limiting requests. Try again in a minute.");
        return;
      }
      if (data.error || !Array.isArray(data.rooms)) throw new Error(data.error || "bad response");
      dir.total = Number(data.totalPages) || dir.total;
      let added = 0;
      for (const room of data.rooms) {
        const key = String(room.name || "").toLowerCase();
        if (!key || dir.seen.has(key)) continue;
        dir.seen.add(key);
        grid.appendChild(roomCard(room));
        added++;
      }
      dir.next = (Number(data.currentPage) || dir.next) + 1;
      const more = dir.total ? dir.next <= dir.total : added > 0;
      setMoreState(more ? "Load more rooms" : "That's every room", false);
      announce(added ? "Loaded " + added + " more rooms." + (more ? "" : " That's every room.") : "No more rooms.");
      if (!more) {
        const btn = document.querySelector(".sca11y-more-btn");
        if (btn) btn.disabled = true;
        if (dirObserver) dirObserver.disconnect();
      }
      scheduleFixes(["directory"]);
    } catch (err) {
      setMoreState("Couldn't load more rooms. Try again", false);
      announce("Couldn't load more rooms.");
    } finally {
      dir.loading = false;
    }
  }

  function fixInfiniteDirectory() {
    const wrap = document.querySelector(".publicrooms");
    const grid = document.querySelector(".publicrooms > .centered");
    const pagination = document.querySelector(".pagination");
    const on = settings.enabled && settings.infiniteDirectory !== false && !!wrap && !!grid && !!pagination;
    ROOT.classList.toggle("sca11y-infinite", on);
    if (!on) {
      const old = document.querySelector(".sca11y-more");
      if (old) old.remove();
      if (dirObserver) dirObserver.disconnect();
      return;
    }
    // Only one page in total: nothing to load.
    const page = directoryPageFromDom();
    if (page.total !== null && page.total <= 1) {
      ROOT.classList.remove("sca11y-infinite");
      return;
    }
    let more = wrap.querySelector(":scope > .sca11y-more");
    if (!more) {
      // The site's loadPage() wipes .publicrooms, so (re)start from the page it shows.
      dir.next = page.current + 1;
      dir.total = page.total;
      dir.loading = false;
      dir.seen = new Set(Array.from(grid.querySelectorAll(".roomname h3")).map((h) => h.textContent.trim().toLowerCase()));
      more = document.createElement("div");
      more.className = "sca11y-more";
      more.innerHTML = '<button type="button" class="sca11y-more-btn"></button><span class="sca11y-more-status" aria-live="polite"></span>';
      more.dataset.sca11yUi = "";
      more.querySelector("button").addEventListener("click", () => {
        dir.armed = true;
        loadMoreRooms(true);
      });
      wrap.appendChild(more);
      setMoreState(dir.total && dir.next > dir.total ? "That's every room" : "Load more rooms", false);
      if (dirObserver) dirObserver.disconnect();
      if ("IntersectionObserver" in window) {
        const scroller = document.querySelector("body > .content");
        dirObserver = new IntersectionObserver(
          (entries) => {
            dir.visible = entries.some((en) => en.isIntersecting);
            if (dir.visible && dir.armed) loadMoreRooms();
          },
          { root: scroller || null, rootMargin: "0px 0px 400px 0px" }
        );
        dirObserver.observe(more);
      }
    }
    if (!more.querySelector("button").dataset.sca11yBtn) makeKeyboardButton(more.querySelector("button"));
  }

  // The whole room card joins the room, not just the preview image. The
  // preview's own link stays the single keyboard stop; any other click on the
  // card is forwarded to it (modifier and middle clicks open a new tab, and a
  // click that ends a text selection in the topic does nothing).
  function cardJoin(e) {
    if (!settings.enabled) return;
    const card = e.target.closest(".room-wrap");
    if (!card || e.target.closest("a, button, input")) return;
    const link = card.querySelector(".thumbnail a[href]");
    if (!link) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.toString() && card.contains(sel.anchorNode)) return;
    if (e.type === "auxclick" && e.button !== 1) return;
    e.preventDefault();
    if (e.type === "auxclick" || e.ctrlKey || e.metaKey || e.shiftKey) window.open(link.href, "_blank", "noopener");
    else link.click();
  }
  document.addEventListener("click", cardJoin);
  document.addEventListener("auxclick", cardJoin);

  // The site paints its moai logo as the <body> background on the pages that
  // use home.css. Read that URL from the site's own stylesheet (so nothing is
  // bundled and the fixtures behave like the live site), hand it to the
  // stylesheet as --sc-logo-url for the page backdrop, and put a small copy
  // beside the "StumbleChat" brand.
  let logoUrl = null;
  function findSiteLogo() {
    if (logoUrl) return logoUrl;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch (_) {
        continue; // cross-origin sheet
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (!rule.style || !rule.selectorText) continue;
        if (!rule.selectorText.split(",").some((s) => s.trim() === "body")) continue;
        const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.backgroundImage || "");
        if (!m || /^data:/.test(m[1])) continue;
        try {
          logoUrl = new URL(m[1], sheet.href || location.href).href;
          return logoUrl;
        } catch (_) {}
      }
    }
    return null;
  }
  // The moai for backdrops and the join card. The room page's stylesheet
  // does not reference it, so fall back to the path home.css uses.
  function ensureLogoVar() {
    const url = findSiteLogo() || new URL("../styles/image/moai.png", location.href).href;
    const want = `url("${url}")`;
    if (ROOT.style.getPropertyValue("--sc-logo-url") !== want) ROOT.style.setProperty("--sc-logo-url", want);
  }
  function fixBrand() {
    const brand = document.querySelector(".navbar-brand");
    if (!brand) return;
    const url = findSiteLogo();
    if (!url) return;
    const want = `url("${url}")`;
    if (ROOT.style.getPropertyValue("--sc-logo-url") !== want) ROOT.style.setProperty("--sc-logo-url", want);
    if (!brand.querySelector(".sca11y-brand-logo")) {
      const img = document.createElement("img");
      img.className = "sca11y-brand-logo";
      img.src = url;
      img.alt = ""; // decorative: the brand text is the name
      img.setAttribute("aria-hidden", "true");
      brand.insertBefore(img, brand.firstChild);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Room: one fixer per region, so a chat message does not re-walk the   */
  /* user list and a speaking-level change does not re-walk anything.     */
  /* ------------------------------------------------------------------ */
  const talking = new Set(); // handles talking now; maintained by room-features.js

  /** Spoken status for a user-list row: cam, mic, guest, talking. */
  function userStatus(bar) {
    const parts = [];
    const status = bar.querySelector(".status");
    const shows = (sel) => {
      const el = status && status.querySelector(sel);
      return !!el && !el.classList.contains("hidden");
    };
    if (shows(".video_badge")) parts.push("on cam");
    else if (shows(".video_badge_hide")) parts.push("cam hidden");
    if (shows(".audio_badge")) parts.push("on mic");
    else if (shows(".audio_badge_hide")) parts.push("mic hidden");
    const username = bar.querySelector(".username");
    if (username && username.textContent.trim().toLowerCase() === "guest") parts.push("guest");
    if (talking.has(bar.getAttribute("user-id"))) parts.push("talking");
    return parts;
  }

  function fixUsers() {
    document.querySelectorAll("#userlist .bar").forEach((bar) => {
      makeKeyboardButton(bar);
      setAttr(bar, "aria-haspopup", "menu");
      const nick = bar.querySelector(".nickname");
      const role = bar.querySelector(".role");
      if (nick) {
        const bits = [nick.textContent.trim()];
        if (role && role.textContent.trim()) bits.push(role.textContent.trim());
        bits.push(...userStatus(bar));
        setAttr(bar, "aria-label", bits.join(", ") + ". Open user menu");
      }
    });
    document.querySelectorAll(".privateMessages > div > span").forEach((pm) => makeKeyboardButton(pm));
    document.querySelectorAll(".closepm").forEach((x) => {
      makeKeyboardButton(x);
      setAttr(x, "aria-label", "Close private message");
    });
    fixUsersDrawer();
  }

  function fixHeader() {
    // Header dropdowns: hover opens them for the mouse (site CSS); the
    // keyboard gets a disclosure button (see the keydown handler above).
    document.querySelectorAll(".user-options-dropdown").forEach((dd) => {
      const btn = dd.querySelector(".dropbtn");
      if (btn) {
        setAttr(btn, "aria-haspopup", "true");
        if (!btn.hasAttribute("aria-expanded")) btn.setAttribute("aria-expanded", "false");
        if (!btn.dataset.sca11yDd) {
          btn.dataset.sca11yDd = "1";
          dd.addEventListener("mouseenter", () => btn.setAttribute("aria-expanded", "true"));
          dd.addEventListener("mouseleave", () => {
            if (!dd.classList.contains("sca11y-open")) btn.setAttribute("aria-expanded", "false");
          });
        }
      }
      dd.querySelectorAll(".dropdown-content a:not([href])").forEach((a) => makeKeyboardButton(a, "menuitem"));
      const content = dd.querySelector(".dropdown-content");
      if (content) setAttr(content, "role", "menu");
    });
    const back = document.querySelector("a.directory");
    if (back) {
      setAttr(back, "aria-label", "Exit room and return to the directory");
      setAttr(back, "title", "Exit room");
    }
    // Icon-only buttons already carry <img alt>; make sure the button itself
    // has a name for browsers that ignore nested alt text.
    document.querySelectorAll("button > img[alt]:only-child").forEach((img) => {
      const btn = img.parentElement;
      if (!btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", img.alt);
    });
    fixTopicBar();
  }

  function fixMenus() {
    document.querySelectorAll(".user-menu, .video-menu").forEach((menu) => {
      setAttr(menu, "role", "menu");
      const name = menu.querySelector(".user-menu-name, .video-menu-name");
      if (name) {
        if (!name.id) name.id = menu.id + "-name";
        setAttr(menu, "aria-labelledby", name.id);
      }
      menu.querySelectorAll(".user-menu-link:not([href]), .video-menu-link:not([href])").forEach((a) => {
        if (a.querySelector("input")) return; // the volume row holds a slider, not an action
        makeKeyboardButton(a, "menuitem");
        // Moderation actions read as such (and are styled in red).
        if (/^(kick|ban|close)$/.test(a.getAttribute("data-action") || "")) a.classList.add("sca11y-destructive");
      });
      menu.querySelectorAll(".user-menu-item, .video-menu-item").forEach((i) => setAttr(i, "role", "none"));
      const volume = menu.querySelector("#video-volume");
      if (volume) setAttr(volume, "aria-label", "Volume for this camera");
      watchMenuIdle(menu);
    });
    focusOpenedMenu();
  }

  // The user and camera menus close by themselves 1 s after opening if you
  // have not moved into them, and 1 s after the pointer leaves them. They
  // stay while the pointer is over them or keyboard focus is inside.
  const MENU_IDLE_MS = 1000;
  const menuTimers = new WeakMap();
  function menuIsOpen(menu) {
    return menu.classList.contains("user-menu-active") || menu.classList.contains("video-menu-active");
  }
  function armMenu(menu) {
    clearTimeout(menuTimers.get(menu));
    menuTimers.set(
      menu,
      setTimeout(() => {
        if (!menuIsOpen(menu) || menu.matches(":hover") || menu.contains(document.activeElement)) return;
        menu.classList.remove("user-menu-active", "video-menu-active");
      }, MENU_IDLE_MS)
    );
  }
  function watchMenuIdle(menu) {
    if (!menu.dataset.sca11yIdle) {
      menu.dataset.sca11yIdle = "1";
      menu.addEventListener("pointerenter", () => clearTimeout(menuTimers.get(menu)));
      menu.addEventListener("pointerleave", () => {
        if (menuIsOpen(menu)) armMenu(menu);
      });
      menu.addEventListener("focusout", () => {
        setTimeout(() => {
          if (menuIsOpen(menu) && !menu.contains(document.activeElement)) armMenu(menu);
        }, 0);
      });
    }
    const open = menuIsOpen(menu);
    if (open && menu.dataset.sca11yWasOpen !== "1") armMenu(menu);
    if (!open) clearTimeout(menuTimers.get(menu));
    menu.dataset.sca11yWasOpen = open ? "1" : "0";
  }

  function fixTiles() {
    // Broadcast tiles: give them a name and keyboard reach (they open a menu,
    // and Alt+Arrow moves them when rearranging is on).
    // Each tile is a group; its picture (.video-wrapper) is the button that
    // opens the site's camera menu, and the quick actions sit beside it.
    document.querySelectorAll("#regularvideos > .js-video").forEach((v) => {
      const wrapper = v.querySelector(".video-wrapper");
      const nick = v.querySelector(".nickname");
      setAttr(v, "role", "group");
      if (v.getAttribute("tabindex") === "0" && v.dataset.sca11yBtn) {
        // Older builds made the whole tile the button.
        v.removeAttribute("tabindex");
        delete v.dataset.sca11yBtn;
        v.removeAttribute("aria-haspopup");
      }
      if (!wrapper || !nick) return;
      const name = nick.textContent.trim();
      setAttr(v, "aria-label", "Broadcast from " + name);
      makeKeyboardButton(wrapper);
      setAttr(wrapper, "aria-haspopup", "menu");
      const handle = tileId(v);
      const bits = [name];
      if (v.classList.contains("sca11y-audio-only")) bits.push("mic only");
      if (handle && talking.has(handle)) bits.push("talking");
      if (v.classList.contains("sca11y-muted")) bits.push("muted for you");
      if (v.classList.contains("sca11y-pinned")) bits.push("pinned");
      const hint = settings.dragCameras ? " Alt plus arrow keys moves this camera." : "";
      setAttr(wrapper, "aria-label", bits.join(", ") + ". Open camera menu." + hint);
    });
    initCameraDrag();
    applyCameraOrder();
  }

  function fixTaskbar() {
    fixOpenMic();
    fixUsersDrawer();
    const taskbar = document.querySelector("sc-taskbar");
    const ptt = document.getElementById("media-ptt");
    if (taskbar && ptt) {
      const isTalking = /TALKING/i.test(ptt.textContent);
      const openmic = document.querySelector("#media-openmic > input");
      const mic = !!(openmic && openmic.checked);
      taskbar.classList.toggle("sca11y-talking", isTalking && !mic);
      taskbar.classList.toggle("sca11y-openmic", mic);
      setAttr(ptt, "aria-label", mic ? "Talk. Open mic is on, everyone can hear you" : isTalking ? "Talking" : "Talk. Hold Space or Enter, or hold the button, to talk");
      setAttr(ptt, "aria-pressed", isTalking || mic ? "true" : "false");
    }
    const settingsBtn = document.getElementById("media-settings");
    if (settingsBtn) {
      setAttr(settingsBtn, "aria-label", "Camera and microphone settings");
      setAttr(settingsBtn, "title", "Camera and microphone settings");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialogs: plain-language titles for the join flow, focus that stays   */
  /* inside the dialog while it is open and returns afterwards.           */
  /* ------------------------------------------------------------------ */
  function roomNameFromPath() {
    const m = /\/room\/([^/?#]+)/i.exec(location.pathname);
    try {
      return m ? decodeURIComponent(m[1]) : "";
    } catch (_) {
      return m ? m[1] : "";
    }
  }
  // Keyed by what the site wrote. The site replaces title and body on every
  // Modal.Create, so this runs again whenever they change.
  function rewriteJoinDialogs(modal) {
    const titleP = modal.querySelector("#title > p");
    const body = modal.querySelector(":scope > span");
    if (!titleP || !body) return;
    const siteTitle = titleP.textContent.trim();
    if (modal.dataset.sca11yTitle === siteTitle) return; // our own text, already done
    const room = roomNameFromPath();
    let kind = "";
    let title = "";
    if (body.querySelector("#interact")) {
      kind = "join";
      title = room ? "Join " + room : "Join the room";
      const btn = body.querySelector("#interact");
      btn.textContent = "Join room";
      if (!body.querySelector(".sca11y-join-note")) {
        const note = document.createElement("p");
        note.className = "sca11y-join-note";
        note.textContent = "Joining turns on room sound. Your camera and microphone stay off until you choose Start Broadcast.";
        body.insertBefore(note, btn);
        const mark = document.createElement("div");
        mark.className = "sca11y-join-mark";
        mark.setAttribute("aria-hidden", "true");
        body.insertBefore(mark, note);
      }
    } else if (/^GATHERING PERMISSIONS/i.test(siteTitle)) {
      kind = "permissions";
      title = "Checking camera access";
      body.textContent = "Your browser may ask to use your camera and microphone. StumbleChat asks when a room opens so videos can play automatically on some devices. Nothing is sent until you start broadcasting.";
    } else if (/^MISSING PERMISSIONS/i.test(siteTitle)) {
      kind = "permissions";
      title = "Camera access is blocked";
    } else if (/^CONNECTING/i.test(siteTitle)) {
      kind = "connecting";
      title = room ? "Connecting to " + room + "…" : "Connecting…";
    } else if (/^ERROR/i.test(siteTitle)) {
      kind = "error";
      title = "Something went wrong";
    } else {
      modal.dataset.sca11yTitle = siteTitle;
      modal.removeAttribute("data-sca11y-kind");
      return;
    }
    titleP.textContent = title;
    modal.dataset.sca11yTitle = title;
    modal.dataset.sca11yKind = kind;
  }

  function fixModal() {
    const modal = document.getElementById("modal");
    if (!modal) return;
    setAttr(modal, "role", "dialog");
    setAttr(modal, "aria-modal", "true");
    const title = modal.querySelector("#title p, #title, h1");
    if (title) {
      if (!title.id) title.id = "sca11y-modal-title";
      setAttr(modal, "aria-labelledby", title.id);
    }
    if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
    const exit = document.getElementById("modal-exit");
    if (exit) setAttr(exit, "aria-label", "Close dialog");
    ensureLogoVar();
    if (settings.enabled) rewriteJoinDialogs(modal);
    watchModalFocus();
  }

  const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  function focusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
      if (el.closest("[inert], .hidden")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  /** While `root` is open, everything else under #room-content is inert. */
  function setInertOutside(root, on) {
    const room = document.getElementById("room-content");
    if (!room) return;
    for (const child of Array.from(room.children)) {
      if (child.contains(root) || child.classList.contains("sca11y-users-backdrop")) continue;
      if (on) {
        if (!child.hasAttribute("inert")) {
          child.setAttribute("inert", "");
          child.dataset.sca11yInert = "1";
        }
      } else if (child.dataset.sca11yInert) {
        child.removeAttribute("inert");
        delete child.dataset.sca11yInert;
      }
    }
  }
  // Tab and Shift+Tab wrap inside the open dialog or drawer.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !settings.enabled) return;
    const trap = document.querySelector("#modal-back.visible #modal") || (ROOT.classList.contains("sca11y-users-open") && document.querySelector("sc-userlist"));
    if (!trap) return;
    const items = focusables(trap);
    if (!items.length) {
      e.preventDefault();
      trap.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (!trap.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  let lastModalVisible = false;
  let focusBeforeModal = null;
  function watchModalFocus() {
    const back = document.getElementById("modal-back");
    const modal = document.getElementById("modal");
    if (!back || !modal) return;
    const visible = back.classList.contains("visible");
    if (visible && !lastModalVisible) {
      const active = document.activeElement;
      focusBeforeModal = active && active !== document.body && !modal.contains(active) ? active : null;
      setInertOutside(modal, true);
      const target = modal.querySelector("#interact") || modal.querySelector("input:not([type='hidden']), select, textarea, button:not(#modal-exit)") || modal;
      setTimeout(() => target.focus({ preventScroll: true }), 0);
    } else if (!visible && lastModalVisible) {
      setInertOutside(modal, false);
      const back = focusBeforeModal;
      focusBeforeModal = null;
      if (back && back.isConnected && !back.closest("[inert]")) back.focus({ preventScroll: true });
      else {
        const ta = document.getElementById("textarea");
        if (ta && !ta.disabled) ta.focus({ preventScroll: true });
      }
    }
    lastModalVisible = visible;
  }

  /* ------------------------------------------------------------------ */
  /* Rearrangeable broadcast tiles                                       */
  /*                                                                     */
  /* Tiles are #regularvideos > .js-video, keyed by their <video video-id>. */
  /* The site inserts new tiles at the front and re-lays-out on every     */
  /* change, so the chosen order is saved per room in localStorage and    */
  /* re-applied whenever the grid mutates. Drag with the pointer, or      */
  /* focus a tile and press Alt+Arrow.                                    */
  /* ------------------------------------------------------------------ */
  const TILE_SEL = "#regularvideos > .js-video";
  const seenAt = new Map(); // video-id -> first time we saw it (for reset)
  let suppressNextClick = false;

  // v2: keyed by person, not by video-id. The video-id is the connection
  // handle, which the server issues fresh on every visit, so an order saved
  // against it never survived a reload.
  function orderKey() {
    return "sca11y-camera-order-v2:" + location.pathname.toLowerCase();
  }
  function tileId(tile) {
    const v = tile.querySelector("video[video-id]");
    return v ? v.getAttribute("video-id") : null;
  }
  /** Stable key for the person on a tile: "u:<username>" for registered
   *  users, "n:<nick>" for guests (the site shows their username as "guest"). */
  function personKey(handle, tile) {
    if (!handle) return null;
    const bar = document.querySelector(`#userlist .bar[user-id="${CSS.escape(handle)}"]`);
    const username = bar && bar.querySelector(".username") ? bar.querySelector(".username").textContent.trim().toLowerCase() : "";
    if (username && username !== "guest") return "u:" + username;
    const nickEl = (bar && bar.querySelector(".nickname")) || (tile && tile.querySelector(".nickname"));
    const nick = nickEl ? nickEl.textContent.trim().toLowerCase() : "";
    return nick ? "n:" + nick : "h:" + handle;
  }
  function tileKey(tile) {
    return personKey(tileId(tile), tile);
  }
  function gridTiles(grid) {
    return Array.from(grid.querySelectorAll(":scope > .js-video"));
  }
  function loadOrder() {
    try {
      return JSON.parse(localStorage.getItem(orderKey()) || "[]");
    } catch (_) {
      return [];
    }
  }
  function saveOrder(grid) {
    try {
      localStorage.setItem(orderKey(), JSON.stringify(gridTiles(grid).map(tileKey).filter(Boolean)));
    } catch (_) {
      /* storage full or blocked */
    }
  }
  function reorder(grid, sorted) {
    const current = gridTiles(grid);
    if (sorted.every((t, i) => t === current[i])) return;
    sorted.forEach((t) => grid.appendChild(t));
  }
  let dragState = null; // set while a pointer drag is in progress
  function applyCameraOrder() {
    const grid = document.getElementById("regularvideos");
    if (!grid || dragState) return;
    const tiles = gridTiles(grid);
    tiles.forEach((t) => {
      const id = tileId(t);
      if (id && !seenAt.has(id)) seenAt.set(id, performance.now());
    });
    if (!settings.dragCameras) return;
    const saved = loadOrder();
    if (!saved.length) return;
    const rank = (t) => {
      const i = saved.indexOf(tileKey(t));
      return i < 0 ? saved.length : i;
    };
    reorder(grid, tiles.slice().sort((a, b) => rank(a) - rank(b)));
  }
  function resetCameraOrder() {
    const grid = document.getElementById("regularvideos");
    try {
      localStorage.removeItem(orderKey());
    } catch (_) {}
    if (!grid) return;
    // The site shows the newest broadcaster first; restore that.
    const tiles = gridTiles(grid).sort((a, b) => (seenAt.get(tileId(b)) || 0) - (seenAt.get(tileId(a)) || 0));
    reorder(grid, tiles);
    announce("Camera layout reset");
  }
  function moveTile(tile, delta) {
    const grid = tile.parentElement;
    const tiles = gridTiles(grid);
    const from = tiles.indexOf(tile);
    const to = Math.max(0, Math.min(tiles.length - 1, from + delta));
    if (from === to) return;
    tiles.splice(from, 1);
    tiles.splice(to, 0, tile);
    reorder(grid, tiles);
    saveOrder(grid);
    (tile.querySelector(".video-wrapper") || tile).focus({ preventScroll: true });
    announce("Camera moved to position " + (to + 1) + " of " + tiles.length);
  }

  let liveRegion = null;
  function announce(text) {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.className = "sca11y-sr-only";
      liveRegion.dataset.sca11yUi = "";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = "";
    setTimeout(() => (liveRegion.textContent = text), 30);
  }

  /** Which slot the pointer is over: {target, before} or null. Geometry only,
   *  so it works whatever the site's flex layout does. */
  function dropSlot(grid, dragged, x, y) {
    const tiles = gridTiles(grid).filter((t) => t !== dragged);
    if (!tiles.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const t of tiles) {
      const r = t.getBoundingClientRect();
      const cx = Math.max(r.left, Math.min(x, r.right));
      const cy = Math.max(r.top, Math.min(y, r.bottom));
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestDist) {
        bestDist = d;
        best = { t, r };
      }
    }
    const { t, r } = best;
    // If no other tile shares the target's row, the grid is a single column:
    // decide above/below by y. Otherwise decide left/right by x.
    const sharesRow = tiles.some((o) => {
      if (o === t) return false;
      const q = o.getBoundingClientRect();
      return Math.abs(q.top - r.top) < r.height / 2;
    });
    const stacked = !sharesRow && tiles.length > 1;
    const before = stacked ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
    return { target: t, before, stacked };
  }

  function clearDropMarks(grid) {
    grid.querySelectorAll(".sca11y-drop-before, .sca11y-drop-after, .sca11y-drop-above, .sca11y-drop-below").forEach((t) =>
      t.classList.remove("sca11y-drop-before", "sca11y-drop-after", "sca11y-drop-above", "sca11y-drop-below")
    );
  }

  // Touch: a plain tap must still open the site's video menu and a swipe must
  // still scroll, so on touch a drag only starts after a short press-and-hold.
  const DRAG_THRESHOLD = 8; // px of travel before a mouse drag begins
  const TOUCH_HOLD_MS = 280; // press-and-hold before a touch drag begins

  function initCameraDrag() {
    const grid = document.getElementById("regularvideos");
    if (!grid || grid.dataset.sca11yDrag) return;
    grid.dataset.sca11yDrag = "1";

    const updateDrag = (d, x, y) => {
      if (!d.travelled && Math.hypot(x - d.x, y - d.y) >= DRAG_THRESHOLD) d.travelled = true;
      d.ghost.style.transform = `translate(${x - d.offX}px, ${y - d.offY}px)`;
      const slot = dropSlot(grid, d.tile, x, y);
      clearDropMarks(grid);
      d.slot = slot;
      if (slot) {
        slot.target.classList.add(
          slot.stacked ? (slot.before ? "sca11y-drop-above" : "sca11y-drop-below") : slot.before ? "sca11y-drop-before" : "sca11y-drop-after"
        );
      }
    };

    const beginDrag = (d, x, y) => {
      d.moved = true;
      // Capture only once a drag is real. Capturing on pointerdown retargeted
      // the site's document-level pointerup to the tile, and the site only
      // opens its video menu when that event's target is the .video-wrapper,
      // so a plain click on a camera stopped doing anything.
      try {
        d.tile.setPointerCapture(d.id);
      } catch (_) {}
      d.tile.classList.add("sca11y-dragging");
      grid.classList.add("sca11y-drag-active");
      // Ghost that follows the pointer
      const r = d.tile.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "sca11y-ghost";
      ghost.dataset.sca11yUi = "";
      ghost.style.width = r.width + "px";
      ghost.style.height = r.height + "px";
      const nick = d.tile.querySelector(".nickname");
      ghost.textContent = nick ? nick.textContent.trim() : "";
      d.offX = x - r.left;
      d.offY = y - r.top;
      document.body.appendChild(ghost);
      d.ghost = ghost;
      updateDrag(d, x, y);
    };

    grid.addEventListener("pointerdown", (e) => {
      if (synthesizing || !settings.enabled || !settings.dragCameras || e.button !== 0 || dragState) return;
      const tile = e.target.closest(TILE_SEL);
      if (!tile) return;
      const touch = e.pointerType === "touch";
      const d = { tile, id: e.pointerId, touch, x: e.clientX, y: e.clientY, armed: !touch, moved: false, travelled: false, ghost: null, slot: null, hold: 0 };
      dragState = d;
      if (touch) {
        d.hold = setTimeout(() => {
          if (dragState !== d || d.moved) return;
          d.armed = true;
          if (navigator.vibrate) {
            try {
              navigator.vibrate(15);
            } catch (_) {}
          }
          beginDrag(d, d.x, d.y);
        }, TOUCH_HOLD_MS);
      }
    });

    document.addEventListener(
      "pointermove",
      (e) => {
        const d = dragState;
        if (!d || e.pointerId !== d.id) return;
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
          if (!d.armed) {
            // A touch that moves before the hold elapses is a scroll: let go.
            clearTimeout(d.hold);
            dragState = null;
            return;
          }
          beginDrag(d, e.clientX, e.clientY);
        } else {
          updateDrag(d, e.clientX, e.clientY);
        }
        e.preventDefault();
      },
      true
    );
    // While a touch drag is live, keep the browser from turning the finger's
    // movement into a scroll (which would pointercancel the drag).
    grid.addEventListener(
      "touchmove",
      (e) => {
        if (dragState && dragState.moved) e.preventDefault();
      },
      { passive: false }
    );
    grid.addEventListener("contextmenu", (e) => {
      if (dragState && dragState.touch) e.preventDefault(); // long-press menu
    });

    const finish = (e) => {
      const d = dragState;
      if (!d || (e.pointerId !== undefined && e.pointerId !== d.id)) return;
      clearTimeout(d.hold);
      dragState = null;
      if (!d.moved) return; // a plain click: the site's own pointerup opens its menu
      try {
        d.tile.releasePointerCapture(d.id);
      } catch (_) {}
      d.tile.classList.remove("sca11y-dragging");
      grid.classList.remove("sca11y-drag-active");
      clearDropMarks(grid);
      if (d.ghost) d.ghost.remove();
      if (!d.travelled) return; // press-and-hold released in place: treat as a tap
      e.stopPropagation(); // the site opens its video menu on document pointerup
      e.preventDefault();
      if (e.type === "pointerup" && d.slot && d.slot.target.parentElement === grid) {
        const ref = d.slot.before ? d.slot.target : d.slot.target.nextElementSibling;
        if (ref !== d.tile) grid.insertBefore(d.tile, ref);
        saveOrder(grid);
        const tiles = gridTiles(grid);
        announce("Camera moved to position " + (tiles.indexOf(d.tile) + 1) + " of " + tiles.length);
      }
      suppressNextClick = true;
      setTimeout(() => (suppressNextClick = false), 80);
    };
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", finish, true);
    window.addEventListener("blur", () => {
      if (dragState) finish({ type: "pointercancel", pointerId: dragState.id, stopPropagation() {}, preventDefault() {} });
    });
    document.addEventListener(
      "click",
      (e) => {
        if (suppressNextClick && e.target.closest("#regularvideos")) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true
    );

    // Keyboard: Alt+Arrow moves the focused tile
    grid.addEventListener("keydown", (e) => {
      if (!settings.dragCameras || !e.altKey) return;
      const tile = e.target.closest(TILE_SEL);
      if (!tile) return;
      let delta = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") delta = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") delta = 1;
      if (e.key === "Home") delta = -1000;
      if (e.key === "End") delta = 1000;
      if (!delta) return;
      e.preventDefault();
      moveTile(tile, delta);
    });
  }

  // Topic line. The site's down-arrow under the topic opened a dialog with
  // the full topic; theme.css hides the arrow and the topic itself now opens
  // that dialog by forwarding to the site's own handler. The room name is
  // added beside it for the phone layout, where the user list is a drawer.
  function fixTopicBar() {
    const bar = document.querySelector("sc-videolist > .header.roomdesc");
    const topic = bar && bar.querySelector(".topic");
    if (!topic) return;
    const text = topic.textContent.trim();
    if (topic.getAttribute("title") !== text) setAttr(topic, "title", text);
    makeKeyboardButton(topic);
    setAttr(topic, "aria-label", (text ? "Room topic: " + text + ". " : "") + "Show full topic");
    if (!topic.dataset.sca11yTopic) {
      topic.dataset.sca11yTopic = "1";
      topic.addEventListener("click", (e) => {
        if (!settings.enabled) return;
        const arrow = bar.querySelector(".resizetopic");
        if (!arrow) return;
        // The site opens the full topic on a pointerup whose target is the arrow.
        activate(arrow);
      });
    }
    let title = bar.querySelector(".sca11y-room-title");
    if (!title) {
      title = document.createElement("span");
      title.className = "sca11y-room-title";
      title.dataset.sca11yUi = "";
      bar.insertBefore(title, topic);
    }
    const name = document.querySelector("#userlist .room-name");
    const roomName = name ? name.textContent.trim() : "";
    if (title.textContent !== roomName) title.textContent = roomName;
  }

  /* ------------------------------------------------------------------ */
  /* Open-mic control and the phone-width user-list drawer               */
  /* ------------------------------------------------------------------ */
  // The site's open-mic control is a bare 30px checkbox on a green square,
  // easy to miss beside the big Talk button. theme.css stretches the (still
  // real) checkbox over a labelled pill; here it gets a name and a role.
  function fixOpenMic() {
    const wrap = document.getElementById("media-openmic");
    const input = wrap && wrap.querySelector("input[type='checkbox']");
    if (!input) return;
    setAttr(input, "role", "switch");
    setAttr(input, "aria-label", "Open mic: keep the microphone on instead of holding Talk");
    setAttr(wrap, "title", "Open mic: keep the microphone on instead of holding Talk");
  }

  // Below 652px the site squeezes the user list and the chat side by side
  // into the bottom 30% of the screen. theme.css turns the user list into a
  // slide-in drawer there; this adds the button that opens it (in the
  // taskbar, where it is big enough to tap) and a backdrop that closes it.
  function setUsersDrawer(open) {
    const wasOpen = ROOT.classList.contains("sca11y-users-open");
    ROOT.classList.toggle("sca11y-users-open", open);
    const btn = document.querySelector(".sca11y-users-btn");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    const drawer = document.querySelector("sc-userlist");
    // The drawer only exists as a drawer at phone widths; there, the rest of
    // the room is inert while it is open and Tab stays inside it.
    const isDrawer = drawer && getComputedStyle(drawer).position === "absolute";
    if (open) {
      if (isDrawer) setInertOutside(drawer, true);
      const list = document.getElementById("userlist");
      if (list) {
        if (!list.hasAttribute("tabindex")) list.setAttribute("tabindex", "-1");
        list.focus({ preventScroll: true });
      }
    } else if (wasOpen) {
      if (!document.querySelector("#modal-back.visible")) setInertOutside(drawer, false);
      if (btn && (!document.activeElement || document.activeElement === document.body || (drawer && drawer.contains(document.activeElement)))) btn.focus();
    }
  }
  function fixUsersDrawer() {
    const taskbar = document.querySelector("sc-taskbar");
    const roomContent = document.getElementById("room-content");
    const userlist = document.getElementById("userlist");
    if (!taskbar || !roomContent || !userlist) return;
    let btn = taskbar.querySelector(".sca11y-users-btn");
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sca11y-users-btn";
      btn.dataset.sca11yUi = "";
      btn.setAttribute("aria-controls", "userlist");
      btn.setAttribute("aria-expanded", ROOT.classList.contains("sca11y-users-open") ? "true" : "false");
      btn.innerHTML = '<span class="sca11y-users-icon" aria-hidden="true"></span><span class="sca11y-users-count"></span>';
      btn.addEventListener("click", () => setUsersDrawer(!ROOT.classList.contains("sca11y-users-open")));
      taskbar.insertBefore(btn, taskbar.firstChild);
    }
    if (!roomContent.querySelector(":scope > .sca11y-users-backdrop")) {
      const backdrop = document.createElement("div");
      backdrop.className = "sca11y-users-backdrop";
      backdrop.dataset.sca11yUi = "";
      backdrop.addEventListener("click", () => setUsersDrawer(false));
      roomContent.insertBefore(backdrop, roomContent.firstChild);
    }
    const count = document.getElementById("onlinecount");
    const n = count ? count.textContent.trim() : "";
    const label = btn.querySelector(".sca11y-users-count");
    if (label && label.textContent !== n) label.textContent = n;
    setAttr(btn, "aria-label", "Users in room" + (n ? " (" + n + ")" : ""));
  }

  /* ------------------------------------------------------------------ */
  /* Site-change detection                                               */
  /*                                                                     */
  /* The layout changes lean on the site's structure. If a StumbleChat   */
  /* update removes a piece they depend on, back off: html.sca11y-compat  */
  /* switches off the layout rules in theme.css (colours and a11y stay),  */
  /* the feature scripts stand down, and the popup says so.               */
  /* ------------------------------------------------------------------ */
  const ROOM_ANCHORS = ["#room-content", "sc-userlist", "#userlist", "sc-videolist", "#videos-content", "#regularvideos", "sc-taskbar", "sc-chat", "#chat", "#chat-content", "#textarea"];
  const DIRECTORY_ANCHORS = [".publicrooms", ".publicrooms > .centered"];
  let compat = false;
  // Keyed on each page's own structure: the settings page has a tab section
  // with id="room", so an #room check misread it as a chat room.
  function pageKind() {
    if (/^\/room\//i.test(location.pathname) || document.getElementById("room-content")) return "room";
    if (document.querySelector(".publicrooms") || location.pathname === "/") return "directory";
    return "other";
  }
  function checkCompat() {
    const kind = pageKind();
    const anchors = kind === "room" ? ROOM_ANCHORS : kind === "directory" ? DIRECTORY_ANCHORS : [];
    const missing = anchors.filter((sel) => !document.querySelector(sel));
    compat = missing.length > 0;
    ROOT.classList.toggle("sca11y-compat", compat);
    // info, not warn: a site change is not an extension error.
    if (compat) console.info("[StumbleChat Accessible] The page is missing " + missing.join(", ") + ". Layout changes are paused; colours and accessibility fixes stay on.");
    try {
      chrome.storage.local.set({ compatStatus: { kind, missing, at: Date.now(), path: location.pathname } });
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Orchestration: mutations are routed to the regions they touch.      */
  /* ------------------------------------------------------------------ */
  const REGIONS = [
    ["chat", "#chat, #chat-content, #chat-position, #input, .unreadmessage, #back"],
    ["users", "#userlist, sc-userlist"],
    ["menus", ".user-menu, .video-menu"],
    ["modal", "#modal-back"],
    ["taskbar", "sc-taskbar"],
    ["videos", "#videos-content"],
    ["header", "sc-videolist > .header"],
    ["directory", ".publicrooms, .content > .wrapper"],
  ];
  const CORE = {
    page: [fixViewport, addSkipLink, fixLandmarks, fixForms],
    chat: [fixLandmarks],
    users: [fixUsers],
    menus: [fixMenus],
    modal: [fixModal],
    taskbar: [fixTaskbar],
    videos: [fixTiles],
    header: [fixHeader],
    directory: [fixDirectory],
  };
  const subscribers = {}; // region -> [fn]
  function on(region, fn) {
    (subscribers[region] = subscribers[region] || []).push(fn);
    // A feature that subscribes after the first pass still gets one.
    if (document.body) scheduleFixes([region]);
  }
  function emit(region) {
    for (const fn of subscribers[region] || []) {
      try {
        fn(region);
      } catch (err) {
        console.warn("[StumbleChat Accessible]", region, err);
      }
    }
  }

  const dirty = new Set();
  let fixQueued = false;
  function scheduleFixes(regions) {
    if (regions) regions.forEach((r) => dirty.add(r));
    else Object.keys(CORE).concat("speaking").forEach((r) => dirty.add(r));
    if (fixQueued) return;
    fixQueued = true;
    setTimeout(runFixes);
  }
  function runFixes() {
    fixQueued = false;
    if (!document.body) return;
    const regions = Array.from(dirty);
    dirty.clear();
    for (const r of regions) {
      if (!compat || r === "page" || r === "chat" || r === "modal" || r === "menus") {
        for (const fn of CORE[r] || []) {
          try {
            fn();
          } catch (err) {
            console.warn("[StumbleChat Accessible]", r, err);
          }
        }
      }
      if (!compat) emit(r);
    }
    if (regions.includes("chat") || regions.includes("users") || regions.includes("modal") || regions.includes("menus")) scheduleContrastPass(false);
  }

  /** Our own nodes, and class changes that only add/remove sca11y-* classes, are not news. */
  function isOwn(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest("[data-sca11y-ui]"));
  }
  function onlyOwnClasses(m) {
    const strip = (v) =>
      String(v || "")
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("sca11y-"))
        .sort()
        .join(" ");
    return strip(m.oldValue) === strip(m.target.getAttribute("class"));
  }
  function regionOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !el.closest) return "page";
    for (const [name, sel] of REGIONS) if (el.closest(sel)) return name;
    return "page";
  }

  function start() {
    scheduleFixes();
    const observer = new MutationObserver((mutations) => {
      const regions = new Set();
      for (const m of mutations) {
        if (isOwn(m.target)) continue;
        if (m.type === "attributes") {
          if (m.attributeName === "volume") {
            regions.add("speaking");
            continue;
          }
          if (m.attributeName === "class" && onlyOwnClasses(m)) continue;
          if (m.attributeName === "style" && m.target.closest && m.target.closest("#chat-content")) continue; // our colour fixes
          regions.add(regionOf(m.target));
        } else if (m.type === "childList") {
          const added = Array.from(m.addedNodes).filter((n) => !isOwn(n) && !(n.nodeType === 1 && n.classList && [...n.classList].some((c) => c.startsWith("sca11y-"))));
          if (!added.length && !m.removedNodes.length) continue;
          if (!added.length && Array.from(m.removedNodes).every((n) => n.nodeType === 1 && n.dataset && "sca11yUi" in n.dataset)) continue;
          regions.add(regionOf(m.target));
        } else if (m.type === "characterData") {
          regions.add(regionOf(m.target));
        }
      }
      if (regions.size) scheduleFixes(regions);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["class", "style", "volume"],
    });
    // Anchors can arrive after DOMContentLoaded on slow connections.
    setTimeout(() => {
      checkCompat();
      scheduleFixes();
    }, 1500);
  }

  /* ------------------------------------------------------------------ */
  /* Shared API for the feature scripts (same isolated world, loaded      */
  /* after this file: room-features.js, chat-features.js,                 */
  /* directory-tools.js).                                                 */
  /* ------------------------------------------------------------------ */
  globalThis.SCA11Y = {
    ROOT,
    get settings() {
      return settings;
    },
    get compat() {
      return compat;
    },
    /** Called now (if settings are loaded) and after every change. */
    onSettings(fn) {
      settingsListeners.push(fn);
      if (settingsLoaded) {
        try {
          fn(settings);
        } catch (err) {
          console.warn("[StumbleChat Accessible]", err);
        }
      }
    },
    /** Subscribe to a region: page, chat, users, menus, modal, taskbar, videos, header, directory, speaking. */
    on,
    refresh: scheduleFixes,
    /** Change one setting; it reaches every open StumbleChat tab and the popup. */
    setSetting(key, value) {
      try {
        chrome.storage.sync.set({ [key]: value });
      } catch (_) {
        // Fixture harness: no extension storage.
        settings[key] = value;
        applySettings();
      }
    },
    setAttr,
    makeKeyboardButton,
    activate,
    dispatchPointer,
    announce,
    talking,
    tileId,
    personKey,
    setUsersDrawer,
    save(key, value) {
      try {
        chrome.storage.local.set({ [key]: value });
      } catch (_) {
        try {
          localStorage.setItem("sca11y:" + key, JSON.stringify(value));
        } catch (_) {}
      }
    },
    load(key, fallback, cb) {
      try {
        chrome.storage.local.get({ [key]: fallback }, (v) => cb(v[key]));
      } catch (_) {
        let v = fallback;
        try {
          const raw = localStorage.getItem("sca11y:" + key);
          if (raw !== null) v = JSON.parse(raw);
        } catch (_) {}
        cb(v);
      }
    },
    notify(title, body) {
      try {
        chrome.runtime.sendMessage({ type: "notify", title, body });
      } catch (_) {}
    },
  };

  fixViewport();
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
  // Stylesheets can finish after the first pass; re-measure once everything is in.
  if (document.readyState === "complete") setTimeout(() => scheduleContrastPass(true), 250);
  else window.addEventListener("load", () => setTimeout(() => scheduleContrastPass(true), 250), { once: true });
})();
