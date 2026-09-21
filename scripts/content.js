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
  const DEFAULTS = {
    enabled: true,
    theme: "light", // "light" | "dark" | "auto" (follow the OS)
    fontScale: 100, // percent
    highContrast: false,
    reduceMotion: false,
    dragCameras: true, // drag broadcast tiles to rearrange them
    resetCameras: 0, // timestamp; the popup bumps it to reset the layout
  };
  let settings = { ...DEFAULTS };
  const darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  // Apply immediately so there is no flash of the dark site.
  ROOT.classList.add("sca11y");

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
    const scale = Math.max(80, Math.min(200, Number(settings.fontScale) || 100)) / 100;
    ROOT.style.setProperty("--sc-scale", String(scale));
    // Re-evaluate colour fixes: the target ratio changes with high contrast.
    if (settings.enabled) scheduleContrastPass(true);
    else restoreAllColours();
  }

  try {
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      settings = { ...DEFAULTS, ...(stored || {}) };
      applySettings();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
      applySettings();
      if (changes.resetCameras) resetCameraOrder();
      if (changes.dragCameras) applyCameraOrder();
    });
  } catch (_) {
    /* storage unavailable (e.g. extension reloaded) — keep defaults */
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

  // One delegated handler: Enter/Space activates anything we promoted.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.dataset.sca11yBtn) return;
      if (el.tagName === "A" && el.hasAttribute("href") && e.key === "Enter") return;
      e.preventDefault();
      el.click();
    },
    true
  );

  // Escape closes open context menus / dropdowns.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const menu = document.querySelector(".user-menu-active, .video-menu-active");
    if (menu) {
      menu.classList.remove("user-menu-active", "video-menu-active");
      const owner = document.querySelector(".bar.selected, .selected");
      if (owner instanceof HTMLElement) owner.focus();
    }
    if (document.activeElement && document.activeElement.closest(".dropdown-content")) {
      const btn = document.activeElement.closest(".user-options-dropdown")?.querySelector(".dropbtn");
      if (btn) btn.focus();
    }
  });

  function fixViewport() {
    // WCAG 1.4.4 Resize Text / 1.4.10: the site ships user-scalable=0.
    const meta = document.querySelector('meta[name="viewport"]');
    const content = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes";
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
    const main = document.querySelector(".content, #room-content");
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
    const content = document.querySelector(".content");
    if (content && !content.closest("main")) setAttr(content, "role", "main");
    const footer = document.querySelector(".footer");
    if (footer) setAttr(footer, "role", "contentinfo");

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
      setAttr(chat, "role", "log");
      setAttr(chat, "aria-label", "Chat messages");
      setAttr(chat, "aria-live", "polite");
      setAttr(chat, "aria-relevant", "additions");
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
      if (b) { const n = b.textContent.trim(); setAttr(b, "aria-label", n + " broadcasting"); setAttr(b, "title", n + " broadcasting"); }
      if (u) { const n = u.textContent.trim(); setAttr(u, "aria-label", n + " users online"); setAttr(u, "title", n + " users online"); }
    });
    document.querySelectorAll("img[alt='Room Broadcast']").forEach((img) => {
      const card = img.closest(".room-wrap");
      const name = card && card.querySelector(".roomname h3");
      if (name) img.alt = "Broadcast preview from " + name.textContent.trim();
    });
    const scrollup = document.getElementById("scrollup");
    if (scrollup) setAttr(scrollup, "aria-label", "Scroll to top");
  }

  function fixRoom() {
    // User list rows open a context menu on click.
    document.querySelectorAll("#userlist .bar").forEach((bar) => {
      makeKeyboardButton(bar);
      setAttr(bar, "aria-haspopup", "menu");
      const nick = bar.querySelector(".nickname");
      const role = bar.querySelector(".role");
      if (nick) {
        const label = nick.textContent.trim() + (role && role.textContent.trim() ? ", " + role.textContent.trim() : "");
        setAttr(bar, "aria-label", label + ". Open user menu");
      }
    });
    document.querySelectorAll(".privateMessages > div > span").forEach((pm) => makeKeyboardButton(pm));
    document.querySelectorAll(".closepm").forEach((x) => {
      makeKeyboardButton(x);
      setAttr(x, "aria-label", "Close private message");
    });

    // Hover-only dropdowns: make the trigger announce itself; CSS opens on
    // :focus-within so keyboard users can reach the items.
    document.querySelectorAll(".user-options-dropdown").forEach((dd) => {
      const btn = dd.querySelector(".dropbtn");
      if (btn) {
        setAttr(btn, "aria-haspopup", "true");
        setAttr(btn, "aria-expanded", dd.matches(":hover, :focus-within") ? "true" : "false");
        if (!btn.dataset.sca11yDd) {
          btn.dataset.sca11yDd = "1";
          dd.addEventListener("focusin", () => btn.setAttribute("aria-expanded", "true"));
          dd.addEventListener("focusout", () => btn.setAttribute("aria-expanded", "false"));
          dd.addEventListener("mouseenter", () => btn.setAttribute("aria-expanded", "true"));
          dd.addEventListener("mouseleave", () => btn.setAttribute("aria-expanded", "false"));
        }
      }
      dd.querySelectorAll(".dropdown-content a:not([href])").forEach((a) => makeKeyboardButton(a, "menuitem"));
      const content = dd.querySelector(".dropdown-content");
      if (content) setAttr(content, "role", "menu");
    });

    // Context menus
    document.querySelectorAll(".user-menu, .video-menu").forEach((menu) => {
      setAttr(menu, "role", "menu");
      const name = menu.querySelector(".user-menu-name, .video-menu-name");
      if (name) {
        if (!name.id) name.id = menu.id + "-name";
        setAttr(menu, "aria-labelledby", name.id);
      }
      menu.querySelectorAll(".user-menu-link:not([href]), .video-menu-link:not([href])").forEach((a) =>
        makeKeyboardButton(a, "menuitem")
      );
      menu.querySelectorAll(".user-menu-item, .video-menu-item").forEach((i) => setAttr(i, "role", "none"));
    });

    // Modal dialog semantics + focus management
    const modal = document.getElementById("modal");
    if (modal) {
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
    }

    // Icon-only buttons already carry <img alt>; make sure the button itself
    // has a name for browsers that ignore nested alt text.
    document.querySelectorAll("button > img[alt]:only-child").forEach((img) => {
      const btn = img.parentElement;
      if (!btn.hasAttribute("aria-label")) btn.setAttribute("aria-label", img.alt);
    });
    const back = document.querySelector("a.directory");
    if (back) setAttr(back, "aria-label", "Back to directory");

    // Broadcast tiles: give them a name and keyboard reach (they open a menu,
    // and Alt+Arrow moves them when rearranging is on).
    document.querySelectorAll("#regularvideos > .js-video").forEach((v) => {
      makeKeyboardButton(v);
      setAttr(v, "aria-haspopup", "menu");
      const nick = v.querySelector(".nickname");
      const hint = settings.dragCameras ? " Alt plus arrow keys moves this camera." : "";
      if (nick) setAttr(v, "aria-label", "Broadcast from " + nick.textContent.trim() + ". Open video menu." + hint);
    });
    initCameraDrag();
    applyCameraOrder();
    const openmic = document.querySelector("#media-openmic > input");
    if (openmic) setAttr(openmic, "aria-label", "Open microphone");
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

  function orderKey() {
    return "sca11y-camera-order:" + location.pathname.toLowerCase();
  }
  function tileId(tile) {
    const v = tile.querySelector("video[video-id]");
    return v ? v.getAttribute("video-id") : null;
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
      localStorage.setItem(orderKey(), JSON.stringify(gridTiles(grid).map(tileId).filter(Boolean)));
    } catch (_) {
      /* storage full or blocked */
    }
  }
  function reorder(grid, sorted) {
    const current = gridTiles(grid);
    if (sorted.every((t, i) => t === current[i])) return;
    sorted.forEach((t) => grid.appendChild(t));
  }
  function applyCameraOrder() {
    const grid = document.getElementById("regularvideos");
    if (!grid) return;
    const tiles = gridTiles(grid);
    tiles.forEach((t) => {
      const id = tileId(t);
      if (id && !seenAt.has(id)) seenAt.set(id, performance.now());
    });
    if (!settings.dragCameras) return;
    const saved = loadOrder();
    if (!saved.length) return;
    const rank = (t) => {
      const i = saved.indexOf(tileId(t));
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
    tile.focus({ preventScroll: true });
    announce("Camera moved to position " + (to + 1) + " of " + tiles.length);
  }

  let liveRegion = null;
  function announce(text) {
    if (!liveRegion) {
      liveRegion = document.createElement("div");
      liveRegion.className = "sca11y-sr-only";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      document.body.appendChild(liveRegion);
    }
    liveRegion.textContent = "";
    setTimeout(() => (liveRegion.textContent = text), 30);
  }

  function initCameraDrag() {
    const grid = document.getElementById("regularvideos");
    if (!grid || grid.dataset.sca11yDrag) return;
    grid.dataset.sca11yDrag = "1";
    let drag = null;

    grid.addEventListener("pointerdown", (e) => {
      if (!settings.enabled || !settings.dragCameras || e.button !== 0) return;
      const tile = e.target.closest(TILE_SEL);
      if (!tile) return;
      drag = { tile, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });

    document.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
        drag.moved = true;
        drag.tile.classList.add("sca11y-dragging");
        grid.classList.add("sca11y-drag-active");
      }
      e.preventDefault();
      const under = document.elementsFromPoint(e.clientX, e.clientY);
      let target = null;
      for (const el of under) {
        const t = el.closest && el.closest(TILE_SEL);
        if (t && t !== drag.tile) { target = t; break; }
      }
      if (!target) return;
      const r = target.getBoundingClientRect();
      const before = e.clientX < r.left + r.width / 2;
      if (before) {
        if (target.previousElementSibling !== drag.tile) grid.insertBefore(drag.tile, target);
      } else if (target.nextElementSibling !== drag.tile) {
        grid.insertBefore(drag.tile, target.nextElementSibling);
      }
    });

    const finish = (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      if (drag.moved) {
        drag.tile.classList.remove("sca11y-dragging");
        grid.classList.remove("sca11y-drag-active");
        saveOrder(grid);
        suppressNextClick = true;
        setTimeout(() => (suppressNextClick = false), 50);
        e.stopPropagation(); // keep the site's pointerup handler from opening a menu
      }
      drag = null;
    };
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("pointercancel", finish, true);
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

  let lastModalVisible = false;
  function watchModalFocus() {
    const back = document.getElementById("modal-back");
    const modal = document.getElementById("modal");
    if (!back || !modal) return;
    const visible = back.classList.contains("visible");
    if (visible && !lastModalVisible) {
      const target = modal.querySelector("input, select, textarea, button:not(#modal-exit)") || modal;
      setTimeout(() => target.focus({ preventScroll: true }), 0);
    }
    lastModalVisible = visible;
  }

  /* ------------------------------------------------------------------ */
  /* Orchestration                                                       */
  /* ------------------------------------------------------------------ */
  let fixQueued = false;
  function scheduleFixes() {
    if (fixQueued) return;
    fixQueued = true;
    setTimeout(() => {
      fixQueued = false;
      if (!document.body) return;
      try {
        fixViewport();
        addSkipLink();
        fixLandmarks();
        fixForms();
        fixDirectory();
        fixRoom();
        watchModalFocus();
      } catch (err) {
        console.warn("[StumbleChat Accessible]", err);
      }
      scheduleContrastPass(false);
    });
  }

  function start() {
    scheduleFixes();
    const observer = new MutationObserver((mutations) => {
      let structural = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length) structural = true;
        if (m.type === "attributes") structural = true;
      }
      if (structural) scheduleFixes();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  fixViewport();
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
  // Stylesheets can finish after the first pass; re-measure once everything is in.
  if (document.readyState === "complete") setTimeout(() => scheduleContrastPass(true), 250);
  else window.addEventListener("load", () => setTimeout(() => scheduleContrastPass(true), 250), { once: true });
})();
