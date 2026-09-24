/* StumbleChat Accessible — room features
 *
 * Built on the shared API from content.js (globalThis.SCA11Y):
 *  - who is talking (from the site's soundmeter `volume` attribute)
 *  - a camera grid that fills the video area
 *  - quick actions on each camera: mute for me, pin, full screen
 *  - a speaker stage for crowded rooms: the most recent speakers large,
 *    everyone else as name chips
 *  - mic-only broadcasters as compact chips instead of black tiles
 *  - theatre mode: cameras get the whole window
 *
 * Everything works on the DOM the site renders; the site's own code and
 * data are never touched.
 */
(() => {
  "use strict";
  const S = globalThis.SCA11Y;
  if (!S) return;
  const ROOT = S.ROOT;

  const GRID = "#regularvideos";
  const TILE = "#regularvideos > .js-video";
  const HOLD_MS = 5000; // a stage speaker keeps their slot for 5 s of silence
  const TALK_TAIL_MS = 900; // still "talking" this long after the level drops

  const lastSpoke = new Map(); // handle -> time the level was last above 0
  const talkTimers = new Map(); // handle -> timeout that ends "talking"
  let pinned = new Set(); // person keys pinned by the viewer (this visit)
  let muted = new Set(); // person keys muted for me (remembered)
  let stageSlots = []; // handles on the stage, in slot order
  let stageActive = false;


  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */
  function tiles() {
    return Array.from(document.querySelectorAll(TILE));
  }
  function handleOf(tile) {
    return S.tileId(tile);
  }
  function keyOf(tile) {
    return S.personKey(handleOf(tile), tile);
  }
  function nickOf(tile) {
    const n = tile.querySelector(".nickname");
    return n ? n.textContent.trim() : "";
  }
  function barOf(handle) {
    return handle ? document.querySelector(`#userlist .bar[user-id="${CSS.escape(handle)}"]`) : null;
  }
  /** True when this broadcaster sends sound but no picture. */
  function isAudioOnly(tile) {
    const bar = barOf(handleOf(tile));
    if (bar) {
      const v = bar.querySelector(".status .video_badge, .status .video_badge_hide");
      const a = bar.querySelector(".status .audio_badge, .status .audio_badge_hide");
      const vOn = v && !v.classList.contains("hidden");
      const aOn = a && !a.classList.contains("hidden");
      if (aOn && !vOn) return true;
      if (vOn) return false;
    }
    const video = tile.querySelector("video");
    const stream = video && video.srcObject;
    if (stream && typeof stream.getVideoTracks === "function") return stream.getVideoTracks().length === 0 && stream.getAudioTracks().length > 0;
    return false;
  }
  function enabled() {
    return S.settings.enabled && !S.compat;
  }
  function isPhone() {
    return window.matchMedia("(max-width: 652px)").matches;
  }

  /* ---------------------------------------------------------------- */
  /* Talking                                                          */
  /* ---------------------------------------------------------------- */
  function readLevels() {
    const now = Date.now();
    let changed = false;
    document.querySelectorAll(`${GRID} .video-wrapper[volume]`).forEach((w) => {
      const v = w.querySelector("video[video-id]");
      const handle = v && v.getAttribute("video-id");
      if (!handle) return;
      const level = parseInt(w.getAttribute("volume"), 10) || 0;
      if (level <= 0) return;
      lastSpoke.set(handle, now);
      if (!S.talking.has(handle)) {
        S.talking.add(handle);
        changed = true;
      }
      clearTimeout(talkTimers.get(handle));
      talkTimers.set(
        handle,
        setTimeout(() => {
          S.talking.delete(handle);
          markTalking();
          S.refresh(["users", "videos"]);
        }, TALK_TAIL_MS)
      );
    });
    if (changed) {
      markTalking();
      S.refresh(["users", "videos"]);
    }
    if (stageActive) updateStage();
  }
  function markTalking() {
    document.querySelectorAll("#userlist .bar").forEach((bar) => {
      bar.classList.toggle("sca11y-talking", S.talking.has(bar.getAttribute("user-id")));
    });
    document.querySelectorAll(".sca11y-chip").forEach((chip) => {
      chip.classList.toggle("sca11y-talking", S.talking.has(chip.dataset.handle));
    });
  }

  /* ---------------------------------------------------------------- */
  /* Tiles: semantics, quick actions, mute for me                      */
  /* ---------------------------------------------------------------- */
  const ICONS = {
    pin: "M16 3l5 5-3 1-3 3 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 3-3z",
    unpin: "M16 3l5 5-3 1-3 3 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 3-3zM3 3l18 18-1.4 1.4L1.6 4.4z",
    mute: "M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z",
    unmute: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z",
    full: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
  };
  function icon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
  }
  function actionButton(action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sca11y-qa-btn";
    b.dataset.action = action;
    return b;
  }
  function ensureActions(tile) {
    const video = tile.querySelector(".video");
    if (!video) return null;
    let bar = video.querySelector(":scope > .sca11y-qa");
    if (!bar) {
      // A <span>: the site styles every "div" inside .video as a camera box.
      bar = document.createElement("span");
      bar.className = "sca11y-qa";
      bar.dataset.sca11yUi = "";
      bar.setAttribute("role", "toolbar");
      bar.append(actionButton("pin"), actionButton("mute"), actionButton("full"));
      video.appendChild(bar);
    }
    return bar;
  }
  function updateActions(tile) {
    const bar = ensureActions(tile);
    if (!bar) return;
    const nick = nickOf(tile) || "this camera";
    const key = keyOf(tile);
    const isPinned = pinned.has(key);
    const isMuted = muted.has(key);
    const audioOnly = tile.classList.contains("sca11y-audio-only");
    S.setAttr(bar, "aria-label", "Camera controls for " + nick);
    const pin = bar.querySelector("[data-action='pin']");
    const mute = bar.querySelector("[data-action='mute']");
    const full = bar.querySelector("[data-action='full']");
    const setBtn = (b, label, path, pressed) => {
      if (b.dataset.icon !== path) {
        b.innerHTML = icon(path);
        b.dataset.icon = path;
      }
      S.setAttr(b, "aria-label", label);
      S.setAttr(b, "title", label);
      if (pressed !== undefined) S.setAttr(b, "aria-pressed", pressed ? "true" : "false");
    };
    setBtn(pin, isPinned ? "Unpin " + nick : "Pin " + nick, isPinned ? ICONS.unpin : ICONS.pin, isPinned);
    pin.hidden = audioOnly;
    setBtn(mute, isMuted ? "Unmute " + nick + " for me" : "Mute " + nick + " for me", isMuted ? ICONS.mute : ICONS.unmute, isMuted);
    setBtn(full, "Show " + nick + " full screen", ICONS.full);
    full.hidden = audioOnly;
  }
  function applyMute(tile) {
    const key = keyOf(tile);
    const video = tile.querySelector("video");
    const want = muted.has(key);
    if (video && video.muted !== want) video.muted = want;
    tile.classList.toggle("sca11y-muted", want);
  }

  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element && e.target.closest(".sca11y-qa-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const tile = btn.closest(TILE);
    if (!tile) return;
    const key = keyOf(tile);
    const nick = nickOf(tile);
    const action = btn.dataset.action;
    if (action === "mute") {
      if (muted.has(key)) muted.delete(key);
      else muted.add(key);
      S.save("mutedPeople", Array.from(muted));
      applyMute(tile);
      S.announce(muted.has(key) ? nick + " muted for you" : nick + " unmuted");
    } else if (action === "pin") {
      if (pinned.has(key)) pinned.delete(key);
      else pinned.add(key);
      S.announce(pinned.has(key) ? nick + " pinned" : nick + " unpinned");
      if (stageActive) updateStage(true);
    } else if (action === "full") {
      const target = tile.querySelector(".video-wrapper") || tile;
      const req = target.requestFullscreen || target.webkitRequestFullscreen;
      if (req) req.call(target).catch(() => {});
    }
    updateActions(tile);
    tile.classList.toggle("sca11y-pinned", pinned.has(key));
    S.refresh(["videos"]);
    layout();
  });
  // Pointer presses on the quick actions must not start a camera drag or
  // reach the site's tile handler.
  ["pointerdown", "pointerup"].forEach((t) =>
    document.addEventListener(
      t,
      (e) => {
        if (e.target instanceof Element && e.target.closest(".sca11y-qa, .sca11y-chips")) e.stopPropagation();
      },
      true
    )
  );

  /* ---------------------------------------------------------------- */
  /* Camera controls come and go like a video player's: they show while */
  /* the pointer moves over a camera (or a touch lands on it) and fade  */
  /* 5 s after the last movement. Keyboard focus shows them via CSS.    */
  /* ---------------------------------------------------------------- */
  const CONTROLS_MS = 5000;
  const controlTimers = new WeakMap();
  function showControls(tile) {
    tile.classList.add("sca11y-controls");
    clearTimeout(controlTimers.get(tile));
    controlTimers.set(
      tile,
      setTimeout(() => tile.classList.remove("sca11y-controls"), CONTROLS_MS)
    );
  }
  function hideControls(tile) {
    clearTimeout(controlTimers.get(tile));
    tile.classList.remove("sca11y-controls");
  }
  let lastMove = 0;
  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      const now = Date.now();
      if (now - lastMove < 120) return; // plenty often for a 5 s timer
      lastMove = now;
      const tile = e.target instanceof Element && e.target.closest(TILE);
      if (tile) showControls(tile);
    },
    { passive: true }
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      const tile = e.target instanceof Element && e.target.closest(TILE);
      if (tile) showControls(tile);
    },
    { passive: true, capture: true }
  );
  document.addEventListener(
    "pointerout",
    (e) => {
      if (e.pointerType === "touch") return;
      const tile = e.target instanceof Element && e.target.closest(TILE);
      if (tile && !(e.relatedTarget instanceof Element && tile.contains(e.relatedTarget))) hideControls(tile);
    },
    { passive: true }
  );

  function refreshTiles() {
    if (!enabled()) return;
    for (const tile of tiles()) {
      tile.classList.toggle("sca11y-audio-only", isAudioOnly(tile));
      tile.classList.toggle("sca11y-pinned", pinned.has(keyOf(tile)));
      applyMute(tile);
      updateActions(tile);
      const video = tile.querySelector("video");
      if (video && !video.dataset.sca11yMeta) {
        video.dataset.sca11yMeta = "1";
        video.addEventListener("loadedmetadata", () => layout());
        video.addEventListener("resize", () => layout());
      }
    }
    updateStage();
    layout();
  }

  /* ---------------------------------------------------------------- */
  /* Speaker stage                                                    */
  /* ---------------------------------------------------------------- */
  function stageWanted() {
    const mode = S.settings.stageMode;
    if (!enabled() || mode === "off") return false;
    const size = Math.max(1, Number(S.settings.stageSize) || 6);
    const withVideo = tiles().filter((t) => !t.classList.contains("sca11y-audio-only")).length;
    const crowded = withVideo > size || tiles().length > size;
    return (mode === "always" || (mode === "auto" && isPhone())) && crowded;
  }

  function updateStage(force) {
    const want = stageWanted();
    if (want !== stageActive) {
      stageActive = want;
      ROOT.classList.toggle("sca11y-stage", want);
      if (!want) {
        stageSlots = [];
        tiles().forEach((t) => t.classList.remove("sca11y-offstage"));
        removeChips();
      }
    }
    if (!stageActive) return;
    const size = stageCapacity(Math.max(1, Number(S.settings.stageSize) || 6));
    const all = tiles();
    const byHandle = new Map(all.map((t) => [handleOf(t), t]));
    const eligible = all.filter((t) => !t.classList.contains("sca11y-audio-only"));
    const eligibleHandles = new Set(eligible.map(handleOf));
    const now = Date.now();

    // Drop slots for people who left or went mic-only.
    stageSlots = stageSlots.map((h) => (eligibleHandles.has(h) ? h : null));
    const onStage = () => new Set(stageSlots.filter(Boolean));
    const isPinnedHandle = (h) => pinned.has(S.personKey(h, byHandle.get(h)));
    const placeInFreeSlot = (h) => {
      let i = stageSlots.indexOf(null);
      if (i < 0 && stageSlots.length < size) i = stageSlots.length;
      if (i < 0) return false;
      stageSlots[i] = h;
      return true;
    };
    while (stageSlots.length > size) {
      // Stage size shrank: drop from the end, never a pinned person.
      const i = stageSlots.map((h, idx) => (h && isPinnedHandle(h) ? -1 : idx)).filter((x) => x >= 0).pop();
      if (i === undefined) break;
      stageSlots.splice(i, 1);
    }

    // Candidates, best first: pinned, then most recent speakers, then camera order.
    const order = eligible.map(handleOf);
    const ranked = order.slice().sort((a, b) => {
      const pa = isPinnedHandle(a) ? 1 : 0;
      const pb = isPinnedHandle(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (lastSpoke.get(b) || 0) - (lastSpoke.get(a) || 0) || order.indexOf(a) - order.indexOf(b);
    });
    // Fill empty slots.
    for (const h of ranked) {
      if (onStage().has(h)) continue;
      if (!placeInFreeSlot(h)) break;
    }
    // Swap in off-stage people who are pinned or talking now, replacing the
    // stage member who has been quiet longest (5 s at least, never pinned).
    for (const h of ranked) {
      if (onStage().has(h)) continue;
      const wants = isPinnedHandle(h) || S.talking.has(h);
      if (!wants) continue;
      let victim = -1;
      let oldest = Infinity;
      stageSlots.forEach((s, i) => {
        if (!s || isPinnedHandle(s) || S.talking.has(s)) return;
        const t = lastSpoke.get(s) || 0;
        if ((force || isPinnedHandle(h) || now - t >= HOLD_MS) && t < oldest) {
          oldest = t;
          victim = i;
        }
      });
      if (victim >= 0) stageSlots[victim] = h;
    }

    const stage = onStage();
    all.forEach((t) => {
      const h = handleOf(t);
      const on = stage.has(h);
      t.classList.toggle("sca11y-offstage", !on);
      const slot = stageSlots.indexOf(h);
      const want = on ? String(slot) : "";
      if (t.style.order !== want) t.style.order = want;
    });
    renderChips(all.filter((t) => !stage.has(handleOf(t))));
  }

  /** As many stage tiles as fit at a usable size (110px wide), up to `size`. */
  function stageCapacity(size) {
    const host = document.getElementById("videos-content");
    if (!host) return size;
    const r = host.getBoundingClientRect();
    const W = r.width - 16;
    const H = r.height - 60 - 16; // the chip strip
    if (W < 40 || H < 40) return size;
    const a = medianAspect(tiles().filter((t) => !t.classList.contains("sca11y-audio-only")));
    for (let n = size; n > 1; n--) if (bestFit(n, W, H, a, 8).w >= 110) return n;
    return 1;
  }

  function removeChips() {
    const strip = document.querySelector(".sca11y-chips");
    if (strip) strip.remove();
  }
  function renderChips(offstage) {
    const host = document.getElementById("videos-content");
    if (!host) return;
    let strip = host.querySelector(":scope > .sca11y-chips");
    if (!strip) {
      strip = document.createElement("div");
      strip.className = "sca11y-chips";
      strip.dataset.sca11yUi = "";
      strip.setAttribute("role", "list");
      strip.setAttribute("aria-label", "More broadcasters");
      host.appendChild(strip);
    }
    const want = offstage.map(handleOf).filter(Boolean);
    const have = Array.from(strip.children).map((c) => c.dataset.handle);
    if (want.join("|") !== have.join("|")) {
      strip.textContent = "";
      for (const tile of offstage) {
        const handle = handleOf(tile);
        if (!handle) continue;
        const item = document.createElement("div");
        item.setAttribute("role", "listitem");
        item.dataset.handle = handle;
        item.className = "sca11y-chip-item";
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "sca11y-chip";
        chip.dataset.handle = handle;
        const bar = barOf(handle);
        const img = bar && bar.querySelector("img.bar-item");
        const av = document.createElement("span");
        av.className = "sca11y-chip-av";
        av.setAttribute("aria-hidden", "true");
        if (img && img.src) av.style.backgroundImage = `url("${img.src}")`;
        else av.textContent = (nickOf(tile)[0] || "?").toUpperCase();
        const name = document.createElement("span");
        name.className = "sca11y-chip-name";
        name.textContent = nickOf(tile);
        chip.append(av, name);
        item.appendChild(chip);
        strip.appendChild(item);
      }
    }
    // Labels and state
    Array.from(strip.querySelectorAll(".sca11y-chip")).forEach((chip) => {
      const tile = tiles().find((t) => handleOf(t) === chip.dataset.handle);
      if (!tile) return;
      const audioOnly = tile.classList.contains("sca11y-audio-only");
      chip.classList.toggle("sca11y-audio-only", audioOnly);
      chip.classList.toggle("sca11y-talking", S.talking.has(chip.dataset.handle));
      const nick = nickOf(tile);
      const label = audioOnly ? nick + ", on mic" + (S.talking.has(chip.dataset.handle) ? ", talking" : "") : "Show " + nick + " on the stage";
      S.setAttr(chip, "aria-label", label);
      chip.disabled = false;
    });
    ROOT.classList.toggle("sca11y-has-chips", strip.children.length > 0);
  }
  document.addEventListener("click", (e) => {
    const chip = e.target instanceof Element && e.target.closest(".sca11y-chip");
    if (!chip) return;
    const tile = tiles().find((t) => handleOf(t) === chip.dataset.handle);
    if (!tile) return;
    if (tile.classList.contains("sca11y-audio-only")) {
      // Mic-only: open the site's camera menu for them (volume, profile, PM…).
      const w = tile.querySelector(".video-wrapper");
      if (w) S.activate(w);
      return;
    }
    const key = keyOf(tile);
    pinned.add(key);
    tile.classList.add("sca11y-pinned");
    S.announce(nickOf(tile) + " pinned to the stage");
    updateStage(true);
    updateActions(tile);
    layout();
  });

  /* ---------------------------------------------------------------- */
  /* Camera grid that fills the video area                             */
  /* ---------------------------------------------------------------- */
  let layoutQueued = false;
  function layout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      doLayout();
    });
  }
  function medianAspect(list) {
    const ratios = list
      .map((t) => t.querySelector("video"))
      .filter((v) => v && v.videoWidth > 0 && v.videoHeight > 0)
      .map((v) => v.videoWidth / v.videoHeight)
      .sort((a, b) => a - b);
    if (!ratios.length) return 4 / 3;
    return Math.min(2, Math.max(0.56, ratios[Math.floor(ratios.length / 2)]));
  }
  /** Largest tile width that fits n tiles of aspect a in a W x H box. */
  function bestFit(n, W, H, a, gap) {
    let best = { w: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * a);
      if (w > best.w) best = { w, cols };
    }
    return best;
  }
  function doLayout() {
    const grid = document.querySelector(GRID);
    const on = enabled() && S.settings.fillGrid !== false && !!grid;
    ROOT.classList.toggle("sca11y-fill", on);
    if (!on) return;
    const box = grid.getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    const gap = 8;
    const visible = tiles().filter((t) => !t.classList.contains("sca11y-offstage"));
    const audio = visible.filter((t) => t.classList.contains("sca11y-audio-only"));
    const video = visible.filter((t) => !t.classList.contains("sca11y-audio-only"));
    const chipRow = audio.length ? 52 : 0;
    const W = box.width - 16;
    const H = box.height - 16 - chipRow;
    const a = medianAspect(video);
    grid.style.setProperty("--sca11y-aspect", String(a));
    const pin = stageActive ? [] : video.filter((t) => t.classList.contains("sca11y-pinned"));
    const rest = video.filter((t) => !pin.includes(t));
    let wPin = 0;
    let wRest = 0;
    if (pin.length && rest.length) {
      // Spotlight: pinned cameras take most of the height, the rest a strip.
      const pinH = H * 0.7;
      wPin = bestFit(pin.length, W, pinH - gap, a, gap).w;
      const pinRows = Math.ceil(pin.length / Math.max(1, Math.floor((W + gap) / (wPin + gap))));
      const used = pinRows * (wPin / a) + (pinRows - 1) * gap + gap;
      wRest = bestFit(rest.length, W, Math.max(60, H - used), a, gap).w;
    } else if (pin.length) {
      wPin = bestFit(pin.length, W, H, a, gap).w;
    } else {
      wRest = bestFit(rest.length, W, H, a, gap).w;
    }
    const px = (n) => Math.max(80, Math.floor(n)) + "px";
    pin.forEach((t) => {
      if (t.style.getPropertyValue("--sca11y-tile-w") !== px(wPin)) t.style.setProperty("--sca11y-tile-w", px(wPin));
      if (!stageActive && t.style.order !== "-1") t.style.order = "-1";
    });
    rest.forEach((t) => {
      if (t.style.getPropertyValue("--sca11y-tile-w") !== px(wRest)) t.style.setProperty("--sca11y-tile-w", px(wRest));
      if (!stageActive && t.style.order) t.style.order = "";
    });
    audio.forEach((t) => {
      if (!stageActive && t.style.order !== "1000") t.style.order = "1000";
    });
    // Mic-only chips get their own row under the cameras.
    let brk = grid.querySelector(":scope > .sca11y-row-break");
    if (audio.length && video.length && !stageActive) {
      if (!brk) {
        brk = document.createElement("div");
        brk.className = "sca11y-row-break";
        brk.dataset.sca11yUi = "";
        brk.setAttribute("aria-hidden", "true");
        grid.appendChild(brk);
      }
    } else if (brk) brk.remove();
  }
  window.addEventListener("resize", () => {
    updateStage();
    layout();
  });
  let observedBox = null;
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(() => layout()) : null;
  function watchBox() {
    const grid = document.querySelector(GRID);
    if (resizeObserver && grid && grid !== observedBox) {
      if (observedBox) resizeObserver.unobserve(observedBox);
      resizeObserver.observe(grid);
      observedBox = grid;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Theatre mode                                                     */
  /* ---------------------------------------------------------------- */
  function setTheatre(on, silent) {
    ROOT.classList.toggle("sca11y-theatre", on && enabled());
    const btn = document.querySelector(".sca11y-theatre-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = on ? "Exit theatre mode" : "Theatre mode: cameras only";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }
    if (!silent) {
      S.save("theatre", on);
      S.announce(on ? "Theatre mode on. Chat and the user list are hidden." : "Theatre mode off.");
    }
    // The site sizes the camera grid on window resize; let it re-measure.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
  }
  function ensureTheatreButton() {
    const options = document.getElementById("user-options");
    if (!options || options.querySelector(".sca11y-theatre-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropbtn sca11y-theatre-btn";
    btn.dataset.sca11yUi = "";
    btn.addEventListener("click", () => setTheatre(!ROOT.classList.contains("sca11y-theatre")));
    options.insertBefore(btn, options.firstChild);
    setTheatre(ROOT.classList.contains("sca11y-theatre"), true);
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */
  S.on("speaking", readLevels);
  S.on("videos", () => {
    watchBox();
    refreshTiles();
  });
  S.on("users", () => {
    // Badges in the user list decide mic-only; names feed the chips.
    refreshTiles();
    markTalking();
  });
  S.on("header", ensureTheatreButton);
  S.onSettings(() => {
    if (!S.settings.enabled) {
      ROOT.classList.remove("sca11y-stage", "sca11y-fill", "sca11y-theatre", "sca11y-has-chips");
      tiles().forEach((t) => {
        t.classList.remove("sca11y-offstage");
        t.style.order = "";
      });
      removeChips();
      stageActive = false;
      return;
    }
    refreshTiles();
  });
  // Saved state last: in the fixture harness these answer synchronously.
  S.load("mutedPeople", [], (list) => {
    muted = new Set(Array.isArray(list) ? list : []);
    refreshTiles();
  });
  S.load("theatre", false, (on) => setTheatre(!!on, true));
})();
