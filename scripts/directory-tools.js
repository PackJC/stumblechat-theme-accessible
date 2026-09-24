/* StumbleChat Accessible — directory tools
 *
 *  - a toolbar above the rooms: search and a count of what is shown
 *    (the order comes from the popup's "Order rooms by" setting)
 *  - star rooms as favourites; favourites sit at the top
 *  - hide a room, or mute rooms whose name or topic has a keyword
 *  - recently visited rooms as chips (remembered on this device only)
 *  - readable cards for the site's error and rate-limit messages
 *
 * Works on the cards the site (and content.js "Load more") render; all
 * lists are stored locally with chrome.storage.local.
 */
(() => {
  "use strict";
  const S = globalThis.SCA11Y;
  if (!S) return;
  const ROOT = S.ROOT;

  let favourites = new Set();
  let hidden = new Set();
  let recent = []; // [{name, at}]
  let query = "";
  let arrival = 0; // order in which cards first appeared ("site order")
  let showHidden = false;
  const loaded = { fav: false, hid: false, rec: false };

  /* ---------------------------------------------------------------- */
  function grid() {
    return document.querySelector(".publicrooms > .centered");
  }
  function cards() {
    const g = grid();
    return g ? Array.from(g.children).filter((c) => c.classList.contains("grid-item") && c.querySelector(".room-wrap")) : [];
  }
  function roomName(item) {
    const h = item.querySelector(".roomname h3");
    return h ? h.textContent.trim() : "";
  }
  function topicOf(item) {
    const h = item.querySelector(".description h4");
    return h ? h.textContent.trim() : "";
  }
  function count(item, sel) {
    const el = item.querySelector(sel);
    const n = el ? parseInt(el.textContent, 10) : NaN;
    return Number.isFinite(n) ? n : -1;
  }
  function muteWords() {
    return String(S.settings.muteKeywords || "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);
  }

  /* ---------------------------------------------------------------- */
  /* Toolbar                                                          */
  /* ---------------------------------------------------------------- */
  function ensureToolbar() {
    const wrap = document.querySelector(".publicrooms");
    if (!wrap || !grid()) return null;
    let bar = document.querySelector(".sca11y-dirbar");
    if (bar && bar.isConnected) return bar;
    bar = document.createElement("div");
    bar.className = "sca11y-dirbar";
    bar.dataset.sca11yUi = "";
    bar.setAttribute("role", "search");
    bar.innerHTML = `
      <div class="sca11y-dir-search">
        <label class="sca11y-sr-only" for="sca11y-room-search">Search room names and topics</label>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>
        <input id="sca11y-room-search" type="search" placeholder="Search rooms or topics" autocomplete="off" spellcheck="false">
      </div>
      <p class="sca11y-dir-count" aria-live="polite"></p>
      <div class="sca11y-recent" hidden>
        <h2 class="sca11y-recent-title">Recently visited</h2>
        <ul class="sca11y-recent-list"></ul>
      </div>`;
    const heading = document.querySelector(".content > .wrapper:not(.publicrooms):not(.sca11y-empty-promoted) > h1");
    const host = heading ? heading.parentElement : null;
    if (host && host.nextElementSibling === wrap) host.appendChild(bar);
    else wrap.parentElement.insertBefore(bar, wrap);
    const input = bar.querySelector("input");
    input.value = query;
    input.addEventListener("input", () => {
      query = input.value;
      applyFilter();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && input.value) {
        e.preventDefault();
        input.value = "";
        query = "";
        applyFilter();
      }
    });
    return bar;
  }
  function renderRecent(bar) {
    const box = bar.querySelector(".sca11y-recent");
    const list = bar.querySelector(".sca11y-recent-list");
    const items = recent.slice(0, 8);
    box.hidden = !items.length;
    const sig = items.map((r) => r.name).join("|");
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.textContent = "";
    for (const r of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "sca11y-recent-chip";
      a.href = "/room/" + encodeURIComponent(r.name);
      a.textContent = r.name;
      li.appendChild(a);
      list.appendChild(li);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Card controls: favourite and hide                                 */
  /* ---------------------------------------------------------------- */
  function ensureCardControls(item) {
    // On the preview (outside its link), so a press never joins the room.
    const head = item.querySelector(".thumbnail");
    if (!head) return;
    let ctl = head.querySelector(":scope > .sca11y-card-ctl");
    if (!ctl) {
      ctl = document.createElement("div");
      ctl.className = "sca11y-card-ctl";
      ctl.dataset.sca11yUi = "";
      const fav = document.createElement("button");
      fav.type = "button";
      fav.className = "sca11y-fav";
      fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8 14.9 9l6.7.6-5.1 4.4 1.5 6.6L12 17.1l-6 3.5 1.5-6.6-5.1-4.4L9.1 9z"/></svg>';
      const hide = document.createElement("button");
      hide.type = "button";
      hide.className = "sca11y-hide";
      hide.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 3l18 18-1.4 1.4L1.6 4.4z"/></svg>';
      ctl.append(fav, hide);
      head.appendChild(ctl);
    }
    const name = roomName(item);
    const key = name.toLowerCase();
    const fav = ctl.querySelector(".sca11y-fav");
    const isFav = favourites.has(key);
    S.setAttr(fav, "aria-pressed", isFav ? "true" : "false");
    S.setAttr(fav, "aria-label", (isFav ? "Remove " : "Add ") + name + (isFav ? " from favourites" : " to favourites"));
    S.setAttr(fav, "title", isFav ? "Favourite" : "Add to favourites");
    item.classList.toggle("sca11y-fav-room", isFav);
    const hide = ctl.querySelector(".sca11y-hide");
    const isHidden = hidden.has(key);
    S.setAttr(hide, "aria-label", (isHidden ? "Show " : "Hide ") + name);
    S.setAttr(hide, "title", isHidden ? "Show this room again" : "Hide this room");
    S.setAttr(hide, "aria-pressed", isHidden ? "true" : "false");
  }
  document.addEventListener("click", (e) => {
    const btn = e.target instanceof Element && e.target.closest(".sca11y-card-ctl button");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation(); // not a join
    const item = btn.closest(".grid-item");
    const name = roomName(item);
    const key = name.toLowerCase();
    if (btn.classList.contains("sca11y-fav")) {
      if (favourites.has(key)) favourites.delete(key);
      else favourites.add(key);
      S.save("favouriteRooms", Array.from(favourites));
      S.announce(favourites.has(key) ? name + " added to favourites" : name + " removed from favourites");
    } else {
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      S.save("hiddenRooms", Array.from(hidden));
      S.announce(hidden.has(key) ? name + " hidden. It is listed under Hidden, above the rooms." : name + " shown");
      if (hidden.has(key)) showUndo(name, key);
      // Keep focus somewhere sensible when the card disappears.
      if (hidden.has(key) && !showHidden) {
        const next = item.nextElementSibling || item.previousElementSibling;
        const target = next && next.querySelector(".thumbnail a[href]");
        setTimeout(() => (target || document.getElementById("sca11y-room-search") || document.body).focus(), 0);
      }
    }
    refresh();
  });

  /* ---------------------------------------------------------------- */
  /* Order and filter                                                  */
  /* ---------------------------------------------------------------- */
  function applyOrder() {
    const g = grid();
    const items = cards();
    items.forEach((c) => {
      if (!c.dataset.sca11yArrival) c.dataset.sca11yArrival = String(arrival++);
    });
    if (items.length < 2) return;
    const mode = S.settings.roomSort || "cams";
    const keyed = items.map((el) => ({
      el,
      fav: favourites.has(roomName(el).toLowerCase()) ? 1 : 0,
      cams: count(el, ".detailbadge.broadcast"),
      people: count(el, ".detailbadge.users"),
      name: roomName(el).toLowerCase(),
      at: Number(el.dataset.sca11yArrival),
    }));
    keyed.sort((a, b) => {
      if (a.fav !== b.fav) return b.fav - a.fav;
      if (mode === "site") return a.at - b.at;
      if (mode === "name") return a.name.localeCompare(b.name) || a.at - b.at;
      if (mode === "people") return b.people - a.people || b.cams - a.cams || a.at - b.at;
      return b.cams - a.cams || b.people - a.people || a.name.localeCompare(b.name) || a.at - b.at;
    });
    if (keyed.every((k, i) => k.el === items[i])) return;
    // Moving a card drops focus from anything inside it (the star just
    // pressed, a card link). Put it back; scroll to it only for keyboard
    // users, so a mouse click on a star does not jump the page.
    const active = document.activeElement;
    const keep = active && active !== g && g.contains(active) ? active : null;
    const keyboard = !!keep && keep.matches(":focus-visible");
    keyed.forEach((k) => g.appendChild(k.el));
    if (keep && keep.isConnected && document.activeElement !== keep) keep.focus({ preventScroll: !keyboard });
  }
  function applyFilter() {
    const q = query.trim().toLowerCase();
    const words = muteWords();
    let shown = 0;
    let hiddenCount = 0;
    let muted = 0;
    for (const item of cards()) {
      const name = roomName(item).toLowerCase();
      const topic = topicOf(item).toLowerCase();
      const isHidden = hidden.has(name);
      const isMuted = !isHidden && words.some((w) => name.includes(w) || topic.includes(w));
      const matches = !q || name.includes(q) || topic.includes(q);
      const out = !matches || ((isHidden || isMuted) && !showHidden);
      item.classList.toggle("sca11y-filtered", out);
      item.classList.toggle("sca11y-hidden-room", isHidden || isMuted);
      if (isHidden) hiddenCount++;
      if (isMuted) muted++;
      if (!out) shown++;
    }
    const bar = document.querySelector(".sca11y-dirbar");
    if (!bar) return;
    const countEl = bar.querySelector(".sca11y-dir-count");
    const total = cards().length;
    let text = q ? shown + " of " + total + " loaded rooms match" : shown + " rooms";
    if (countEl.textContent !== text) countEl.textContent = text;
    renderHiddenRow(bar);
    ROOT.classList.toggle("sca11y-dir-empty", total > 0 && shown === 0);
    let empty = document.querySelector(".sca11y-dir-none");
    if (total > 0 && shown === 0) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "sca11y-dir-none";
        empty.dataset.sca11yUi = "";
        grid().parentElement.insertBefore(empty, grid());
      }
      empty.textContent = q
        ? "No loaded rooms match “" + query.trim() + "”. Search looks at room names and topics; StumbleChat's room list does not say who is in each room. More rooms load as you scroll."
        : "Every loaded room is hidden.";
    } else if (empty) empty.remove();
  }

  /* ---------------------------------------------------------------- */
  /* Hidden rooms, in plain sight: a row under the toolbar lists every  */
  /* hidden room and keyword as a chip (click to bring it back), with   */
  /* "Unhide all" and "Hide by keyword". Hiding a room also shows an     */
  /* Undo notice for a few seconds.                                     */
  /* ---------------------------------------------------------------- */
  let keywordFormOpen = false;
  function setKeywords(list) {
    S.setSetting("muteKeywords", list.join(", "));
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>';

  function renderHiddenRow(bar) {
    let row = bar.querySelector(".sca11y-hidden-row");
    if (!row) {
      row = document.createElement("div");
      row.className = "sca11y-hidden-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Hidden rooms");
      bar.appendChild(row);
      row.addEventListener("click", onRowClick);
      row.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = row.querySelector(".sca11y-kw-input");
        const words = input.value.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
        if (!words.length) return;
        const all = muteWords();
        for (const w of words) if (!all.includes(w)) all.push(w);
        setKeywords(all);
        keywordFormOpen = false;
        S.announce("Rooms mentioning " + words.join(", ") + " are hidden");
      });
    }
    const rooms = Array.from(hidden).sort();
    const words = muteWords();
    const n = rooms.length + words.length;
    const sig = JSON.stringify([rooms, words, keywordFormOpen]);
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    const chips = rooms
      .map((r) => `<li><button type="button" class="sca11y-hr-chip" data-unhide="${esc(r)}" aria-label="Unhide ${esc(r)}" title="Unhide ${esc(r)}"><span>${esc(r)}</span>${X_ICON}</button></li>`)
      .concat(words.map((w) => `<li><button type="button" class="sca11y-hr-chip sca11y-hr-word" data-unmute="${esc(w)}" aria-label="Stop hiding rooms that mention ${esc(w)}" title="Stop hiding rooms that mention ${esc(w)}"><span>“${esc(w)}”</span>${X_ICON}</button></li>`))
      .join("");
    row.innerHTML = `
      ${n ? `<span class="sca11y-hr-label">Hidden (${n}):</span><ul class="sca11y-hr-list">${chips}</ul><button type="button" class="sca11y-hr-link sca11y-hr-all">Unhide all</button>` : ""}
      ${keywordFormOpen
        ? `<form class="sca11y-kw-form"><label for="sca11y-kw-input">Hide rooms that mention</label><input id="sca11y-kw-input" class="sca11y-kw-input" type="text" autocomplete="off" placeholder="word, another word"><button type="submit" class="sca11y-hr-add">Hide</button><button type="button" class="sca11y-hr-link sca11y-hr-cancel">Cancel</button></form>`
        : `<button type="button" class="sca11y-hr-link sca11y-hr-kw">Hide rooms by keyword</button>`}`;
    row.classList.toggle("sca11y-hr-empty", n === 0);
  }

  /** The clicked chip is gone after a re-render; put focus somewhere
   *  sensible, but only if it was lost (never pull it from where the
   *  person has already moved on to). */
  function focusRowAfterChange() {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return;
      const bar = document.querySelector(".sca11y-dirbar");
      if (!bar) return;
      const target = bar.querySelector(".sca11y-hr-chip") || bar.querySelector(".sca11y-hr-kw") || bar.querySelector("#sca11y-room-search");
      if (target) target.focus();
    }, 60);
  }
  function onRowClick(e) {
    const b = e.target instanceof Element && e.target.closest("button");
    if (!b || b.type === "submit") return;
    if (b.dataset.unhide) {
      hidden.delete(b.dataset.unhide);
      S.save("hiddenRooms", Array.from(hidden));
      S.announce(b.dataset.unhide + " is back in the list");
      refresh();
      focusRowAfterChange();
    } else if (b.dataset.unmute) {
      setKeywords(muteWords().filter((w) => w !== b.dataset.unmute));
      S.announce("Rooms mentioning " + b.dataset.unmute + " are shown again");
      focusRowAfterChange();
    } else if (b.classList.contains("sca11y-hr-all")) {
      hidden.clear();
      S.save("hiddenRooms", []);
      setKeywords([]);
      S.announce("All rooms are shown again");
      refresh();
      focusRowAfterChange();
    } else if (b.classList.contains("sca11y-hr-kw")) {
      keywordFormOpen = true;
      refresh(); // renders the row synchronously
      const input = document.querySelector(".sca11y-hidden-row .sca11y-kw-input");
      if (input) input.focus();
    } else if (b.classList.contains("sca11y-hr-cancel")) {
      keywordFormOpen = false;
      refresh();
      focusRowAfterChange();
    }
  }

  /* Undo notice after hiding a room */
  let toastTimer = 0;
  function showUndo(name, key) {
    let toast = document.querySelector(".sca11y-undo");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "sca11y-undo";
      toast.dataset.sca11yUi = "";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
      toast.addEventListener("click", (e) => {
        const b = e.target instanceof Element && e.target.closest("button[data-undo]");
        if (!b) return;
        hidden.delete(b.dataset.undo);
        S.save("hiddenRooms", Array.from(hidden));
        S.announce(b.dataset.undo + " is back in the list");
        toast.hidden = true;
        refresh();
      });
    }
    toast.innerHTML = `<span><strong>${esc(name)}</strong> hidden</span><button type="button" data-undo="${esc(key)}">Undo</button>`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 7000);
  }

  /* ---------------------------------------------------------------- */
  /* The site's own messages in the room list                          */
  /* ---------------------------------------------------------------- */
  function fixStatusMessages() {
    const wrap = document.querySelector(".publicrooms");
    if (!wrap) return;
    wrap.querySelectorAll(":scope > h1").forEach((h) => {
      if (h.dataset.sca11yStatus) return; // already rewritten
      const t = h.textContent.trim();
      let kind = "info";
      let text = t;
      if (/RATELIMIT/i.test(t)) {
        kind = "warn";
        text = "StumbleChat is limiting requests right now. Wait a minute, then refresh the page.";
      } else if (/went wrong|LOCKED/i.test(t)) {
        kind = "error";
        text = /LOCKED/i.test(t) ? "The room list is locked for a moment. Refresh the page to try again." : "Something went wrong loading rooms. Refresh the page to try again.";
      } else if (/carve their path/i.test(t)) {
        kind = "info";
        text = "No public rooms are listed right now. Check back soon.";
      }
      h.dataset.sca11yStatus = kind;
      h.classList.add("sca11y-dir-status", "sca11y-dir-" + kind);
      if (h.textContent !== text) h.textContent = text;
      S.setAttr(h, "role", kind === "info" ? "status" : "alert");
    });
  }

  function refresh() {
    if (!S.settings.enabled || S.compat) return;
    fixStatusMessages();
    const g = grid();
    if (!g) return;
    const bar = ensureToolbar();
    cards().forEach(ensureCardControls);
    applyOrder();
    applyFilter();
    if (bar && loaded.rec) renderRecent(bar);
  }

  S.on("directory", refresh);
  S.on("page", refresh);
  S.onSettings(refresh);

  // Saved lists last: in the fixture harness these answer synchronously.
  S.load("favouriteRooms", [], (v) => {
    favourites = new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase()));
    loaded.fav = true;
    refresh();
  });
  S.load("hiddenRooms", [], (v) => {
    hidden = new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase()));
    loaded.hid = true;
    refresh();
  });
  S.load("recentRooms", [], (v) => {
    recent = Array.isArray(v) ? v.filter((r) => r && r.name) : [];
    loaded.rec = true;
    // Record this visit when on a room page.
    const m = /^\/room\/([^/?#]+)/i.exec(location.pathname);
    if (m) {
      let name = m[1];
      try {
        name = decodeURIComponent(name);
      } catch (_) {}
      name = name.toLowerCase();
      recent = [{ name, at: Date.now() }].concat(recent.filter((r) => r.name !== name)).slice(0, 12);
      S.save("recentRooms", recent);
    }
    refresh();
  });
})();
