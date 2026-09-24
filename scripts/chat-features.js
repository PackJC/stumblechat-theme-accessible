/* StumbleChat Accessible — chat features
 *
 *  - mentions of your name (and extra words) highlighted, with a jump pill
 *  - "New messages" divider and a floating "Jump to latest"; the chat follows
 *    your own message after you send
 *  - unread count in the tab title; opt-in desktop alerts for mentions/PMs
 *  - screen-reader announcements: all / mentions and PMs / off, one clean
 *    line per message, silent when the site re-renders history
 *  - private-message tabs above the chat, PM badge on the phone Users button
 *  - phone composer: Send button, "send" key, box kept above the keyboard
 *  - runs of join/leave lines folded into one line
 *  - chat text size, density, always-visible times; the site's Large Font
 *
 * Reads the chat the site renders; sends nothing the site would not send.
 */
(() => {
  "use strict";
  const S = globalThis.SCA11Y;
  if (!S) return;
  const ROOT = S.ROOT;

  const seen = new WeakSet(); // .content / .message.system elements already handled
  let primed = false; // first pass marks history as seen without announcing
  let selfNick = "";
  let pendingSend = ""; // text we just sent, to learn our nick from the echo
  let lastView = ""; // which conversation the chat shows (room or a PM)
  let unreadHidden = 0; // messages that arrived while the tab was hidden
  let mentionsHidden = 0;
  const baseTitle = { value: document.title };

  /* ---------------------------------------------------------------- */
  /* Who am I, and what counts as a mention                            */
  /* ---------------------------------------------------------------- */
  function readSelfNick() {
    try {
      const stored = localStorage.getItem("nick");
      if (stored) selfNick = stored;
    } catch (_) {}
    return selfNick;
  }
  function mentionPattern() {
    const words = [readSelfNick()]
      .concat(String(S.settings.mentionWords || "").split(","))
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);
    if (!words.length) return null;
    const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp("(^|[^A-Za-z0-9_])@?(" + esc.join("|") + ")(?![A-Za-z0-9_])", "i");
  }

  /* ---------------------------------------------------------------- */
  /* Reading messages                                                  */
  /* ---------------------------------------------------------------- */
  function chatContent() {
    return document.getElementById("chat-content");
  }
  function currentView() {
    const back = document.getElementById("back");
    const inPm = back && (back.classList.contains("show") || getComputedStyle(back).display !== "none") && back.textContent.trim();
    return inPm ? "pm:" + back.textContent.trim() : "room";
  }
  function textOf(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".hidden-selectable, .timestamp, [data-sca11y-ui]").forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }
  /** New units since last pass: {el, kind: "msg"|"system", nick, text, message} */
  function collectNew() {
    const root = chatContent();
    if (!root) return [];
    const out = [];
    root.querySelectorAll(":scope > .message").forEach((message) => {
      if (message.classList.contains("system")) {
        if (!seen.has(message)) {
          seen.add(message);
          out.push({ el: message, message, kind: "system", nick: "", text: textOf(message) });
        }
        return;
      }
      const nickEl = message.querySelector(":scope > .nickname");
      const nick = nickEl ? nickEl.textContent.trim() : "";
      message.querySelectorAll(":scope > .content").forEach((content) => {
        if (seen.has(content)) return;
        seen.add(content);
        const body = content.querySelector(".message") || content;
        out.push({ el: content, message, kind: "msg", nick, text: textOf(body) });
      });
    });
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Live region for screen readers                                   */
  /* ---------------------------------------------------------------- */
  let live = null;
  function liveRegion() {
    if (live && live.isConnected) return live;
    live = document.createElement("div");
    live.className = "sca11y-sr-only";
    live.dataset.sca11yUi = "";
    live.setAttribute("role", "log");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-relevant", "additions");
    live.setAttribute("aria-label", "New chat messages");
    document.body.appendChild(live);
    return live;
  }
  function speak(line) {
    const region = liveRegion();
    const p = document.createElement("p");
    p.textContent = line;
    region.appendChild(p);
    while (region.children.length > 20) region.firstChild.remove();
  }
  const JOIN_LEAVE = /\bhas (joined|left)\.$/;

  /* ---------------------------------------------------------------- */
  /* Scrolling: divider, jump to latest, follow after send             */
  /* ---------------------------------------------------------------- */
  function chatScroller() {
    return document.getElementById("chat");
  }
  function atBottom() {
    const c = chatScroller();
    return !c || c.scrollTop + c.clientHeight >= c.scrollHeight - 60;
  }
  function scrollToBottom() {
    const c = chatScroller();
    if (c) c.scrollTop = c.scrollHeight;
  }
  function removeDivider() {
    const d = document.querySelector(".sca11y-new-divider");
    if (d) d.remove();
  }
  function placeDivider(beforeEl) {
    if (document.querySelector(".sca11y-new-divider")) return;
    const root = chatContent();
    const msg = beforeEl && beforeEl.closest(".message");
    if (!root || !msg || msg.parentElement !== root) return;
    const d = document.createElement("div");
    d.className = "sca11y-new-divider";
    d.dataset.sca11yUi = "";
    d.setAttribute("role", "separator");
    d.innerHTML = "<span>New messages</span>";
    root.insertBefore(d, msg);
  }

  /* ---------------------------------------------------------------- */
  /* Mentions pill                                                     */
  /* ---------------------------------------------------------------- */
  function mentionsBelow() {
    const c = chatScroller();
    if (!c) return [];
    const top = c.getBoundingClientRect().bottom;
    return Array.from(document.querySelectorAll("#chat-content .sca11y-mention:not(.sca11y-mention-read)")).filter((m) => m.getBoundingClientRect().top > top - 10);
  }
  function updateMentionPill() {
    const pos = document.getElementById("chat-position");
    if (!pos) return;
    let pill = pos.querySelector(":scope > .sca11y-mention-pill");
    const below = mentionsBelow();
    if (!below.length) {
      if (pill) pill.hidden = true;
      return;
    }
    if (!pill) {
      pill = document.createElement("button");
      pill.type = "button";
      pill.className = "sca11y-mention-pill";
      pill.dataset.sca11yUi = "";
      pill.addEventListener("click", () => {
        const next = mentionsBelow()[0];
        if (next) {
          next.scrollIntoView({ block: "center" });
          next.classList.add("sca11y-mention-read");
          next.setAttribute("tabindex", "-1");
          next.focus({ preventScroll: true });
        }
        updateMentionPill();
      });
      pos.appendChild(pill);
    }
    pill.hidden = false;
    const label = below.length === 1 ? "1 mention below" : below.length + " mentions below";
    pill.textContent = "@ " + label;
    pill.setAttribute("aria-label", "Jump to " + label);
  }

  /* ---------------------------------------------------------------- */
  /* Tab title and desktop alerts                                      */
  /* ---------------------------------------------------------------- */
  function updateTitle() {
    const n = unreadHidden;
    const prefix = n ? "(" + (mentionsHidden ? "@" : "") + n + ") " : "";
    const want = prefix + baseTitle.value;
    if (document.title !== want) document.title = want;
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unreadHidden = 0;
      mentionsHidden = 0;
      updateTitle();
    }
  });
  // Keep our base title in step if the site changes it.
  new MutationObserver(() => {
    const t = document.title.replace(/^\(@?\d+\) /, "");
    if (t !== baseTitle.value) baseTitle.value = t;
  }).observe(document.querySelector("title") || document.head || document.documentElement, { childList: true, characterData: true, subtree: true });

  /* ---------------------------------------------------------------- */
  /* Join/leave folding                                                */
  /* ---------------------------------------------------------------- */
  function foldJoins() {
    const root = chatContent();
    if (!root) return;
    const on = S.settings.collapseJoins !== false;
    const messages = Array.from(root.querySelectorAll(":scope > .message"));
    // Clear previous marks, then rebuild runs.
    messages.forEach((m) => {
      if (m.classList.contains("system") && JOIN_LEAVE.test(textOf(m))) m.classList.add("sca11y-joinleave");
    });
    let run = [];
    const flush = () => {
      if (run.length >= 3 && on) {
        const head = run[0];
        const expanded = head.classList.contains("sca11y-jl-open");
        run.forEach((m, i) => {
          m.classList.toggle("sca11y-jl-head", i === 0);
          m.classList.toggle("sca11y-jl-hidden", i > 0 && !expanded);
        });
        const joins = run.filter((m) => /has joined\.$/.test(textOf(m))).length;
        const lefts = run.length - joins;
        const bits = [];
        if (joins) bits.push(joins + (joins === 1 ? " person joined" : " people joined"));
        if (lefts) bits.push(lefts + " left");
        let toggle = head.querySelector(":scope > .sca11y-jl-toggle");
        if (!toggle) {
          toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "sca11y-jl-toggle";
          toggle.dataset.sca11yUi = "";
          toggle.addEventListener("click", () => {
            head.classList.toggle("sca11y-jl-open");
            foldJoins();
          });
          head.appendChild(toggle);
        }
        const label = (expanded ? "Hide" : "Show") + " " + bits.join(", ");
        if (toggle.textContent !== label) toggle.textContent = label;
        toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      } else {
        run.forEach((m) => {
          m.classList.remove("sca11y-jl-head", "sca11y-jl-hidden");
          const t = m.querySelector(":scope > .sca11y-jl-toggle");
          if (t) t.remove();
        });
      }
      run = [];
    };
    messages.forEach((m) => {
      if (m.classList.contains("sca11y-joinleave")) run.push(m);
      else flush();
    });
    flush();
  }

  /* ---------------------------------------------------------------- */
  /* The main pass                                                    */
  /* ---------------------------------------------------------------- */
  function onChat() {
    if (!S.settings.enabled || !chatContent()) return;
    const view = currentView();
    const rerender = view !== lastView;
    lastView = view;
    const fresh = collectNew();
    const pattern = mentionPattern();
    const wasAtBottom = atBottom();
    let firstNew = null;
    let mentionsNow = 0;

    for (const unit of fresh) {
      if (unit.kind === "msg") {
        // Learn our own nick from the echo of what we just sent.
        if (pendingSend && unit.text === pendingSend) {
          selfNick = unit.nick;
          pendingSend = "";
          unit.el.classList.add("sca11y-own");
          if (primed && !rerender) setTimeout(scrollToBottom, 0);
        }
        const own = unit.nick && selfNick && unit.nick.toLowerCase() === selfNick.toLowerCase();
        if (own) unit.el.classList.add("sca11y-own");
        const isMention = !own && pattern && pattern.test(unit.text);
        if (isMention) {
          unit.el.classList.add("sca11y-mention");
          mentionsNow++;
        }
        if (!primed || rerender || fresh.length > 8) continue; // history, not news
        if (!own) {
          if (!firstNew) firstNew = unit.el;
          const inPm = view.startsWith("pm:");
          const mode = S.settings.chatAnnounce || "all";
          if (mode === "all" || (mode === "mentions" && (isMention || inPm))) {
            speak((inPm ? "Private message from " : "") + unit.nick + ": " + unit.text);
          }
          if (document.hidden) {
            unreadHidden++;
            if (isMention || inPm) mentionsHidden++;
          }
          if ((isMention || inPm) && S.settings.desktopAlerts && (document.hidden || !document.hasFocus())) {
            S.notify(inPm ? "Private message from " + unit.nick : unit.nick + " mentioned you", unit.text.slice(0, 180));
          }
        }
      } else if (primed && !rerender && fresh.length <= 8) {
        const mode = S.settings.chatAnnounce || "all";
        if (mode === "all" && !JOIN_LEAVE.test(unit.text)) speak(unit.text);
      }
    }
    if (primed && !rerender && firstNew && !wasAtBottom) placeDivider(firstNew);
    if (wasAtBottom) removeDivider();
    primed = true;
    foldJoins();
    updateTitle();
    updateMentionPill();
    if (mentionsNow && !wasAtBottom) updateMentionPill();
  }

  // Divider and pill follow the scroll position.
  document.addEventListener(
    "scroll",
    (e) => {
      if (e.target && e.target.id === "chat") {
        if (atBottom()) removeDivider();
        updateMentionPill();
      }
    },
    true
  );

  /* ---------------------------------------------------------------- */
  /* Sending: remember the text, follow it, and a Send button          */
  /* ---------------------------------------------------------------- */
  function captureSend() {
    const ta = document.getElementById("textarea");
    if (!ta) return;
    // The site escapes < > and collapses spaces before sending; match that.
    pendingSend = ta.value.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ +/g, " ").trim();
    pendingSend = pendingSend.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  document.addEventListener(
    "keypress",
    (e) => {
      if (e.target && e.target.id === "textarea" && e.key === "Enter" && !e.shiftKey) captureSend();
    },
    true
  );
  function sendFromButton() {
    const ta = document.getElementById("textarea");
    if (!ta || ta.disabled || !ta.value.trim()) return;
    captureSend();
    // The site sends on a keypress Enter in the message box.
    ta.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    ta.focus();
  }
  function ensureComposer() {
    const form = document.getElementById("input");
    const ta = document.getElementById("textarea");
    if (!form || !ta) return;
    S.setAttr(ta, "enterkeyhint", "send");
    if (!form.querySelector(".sca11y-send")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sca11y-send";
      btn.dataset.sca11yUi = "";
      btn.setAttribute("aria-label", "Send message");
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 20.5 21 12 3 3.5v6.6l12 1.9-12 1.9z"/></svg>';
      btn.addEventListener("click", sendFromButton);
      form.appendChild(btn);
    }
    const send = form.querySelector(".sca11y-send");
    send.disabled = ta.disabled;
  }
  // iOS Safari ignores interactive-widget; follow the visual viewport there.
  if (window.visualViewport) {
    const onViewport = () => {
      const vv = window.visualViewport;
      const keyboard = window.innerHeight - vv.height > 120;
      ROOT.classList.toggle("sca11y-kb", keyboard);
      ROOT.style.setProperty("--sca11y-vvh", Math.round(vv.height) + "px");
      if (keyboard && document.activeElement && document.activeElement.id === "textarea") scrollToBottom();
    };
    window.visualViewport.addEventListener("resize", onViewport);
  }

  /* ---------------------------------------------------------------- */
  /* Private-message tabs and the PM badge                             */
  /* ---------------------------------------------------------------- */
  function pmList() {
    return Array.from(document.querySelectorAll(".privateMessages > div > span.private, .privateMessages > div > span[user-id]")).map((span) => {
      const nick = span.querySelector(".nickname");
      const unread = span.querySelector(".unreadpm");
      const n = unread ? parseInt(unread.textContent, 10) || 0 : 0;
      return { span, handle: span.getAttribute("user-id"), nick: nick ? nick.textContent.trim() : "", unread: n };
    });
  }
  function ensureTabs() {
    const pos = document.getElementById("chat-position");
    const chat = document.getElementById("chat");
    if (!pos || !chat) return;
    const pms = pmList();
    let tabs = pos.querySelector(":scope > .sca11y-pm-tabs");
    ROOT.classList.toggle("sca11y-has-pms", pms.length > 0);
    if (!pms.length) {
      if (tabs) tabs.remove();
      badge(0);
      return;
    }
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.className = "sca11y-pm-tabs";
      tabs.dataset.sca11yUi = "";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Conversations");
      pos.insertBefore(tabs, pos.firstChild);
    }
    const view = currentView();
    const back = document.getElementById("back");
    const pmNick = view.startsWith("pm:") ? view.slice(3).replace(/^<\s*/, "").replace(/\s*\(.*$/, "").trim() : "";
    const want = [{ key: "room", label: "Room", selected: view === "room", unread: 0 }].concat(
      pms.map((p) => ({ key: "pm:" + p.handle, label: p.nick, selected: !!pmNick && pmNick === p.nick, unread: p.unread, handle: p.handle }))
    );
    const sig = JSON.stringify(want.map((w) => [w.key, w.label, w.selected, w.unread]));
    if (tabs.dataset.sig === sig) return;
    tabs.dataset.sig = sig;
    tabs.textContent = "";
    for (const w of want) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sca11y-pm-tab";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", w.selected ? "true" : "false");
      b.tabIndex = w.selected ? 0 : -1;
      b.dataset.key = w.key;
      b.textContent = w.label;
      if (w.unread) {
        const u = document.createElement("span");
        u.className = "sca11y-pm-unread";
        u.textContent = String(w.unread);
        b.appendChild(u);
        b.setAttribute("aria-label", w.label + ", " + w.unread + " unread");
      }
      tabs.appendChild(b);
    }
    badge(pms.reduce((n, p) => n + p.unread, 0));
    void back;
  }
  function badge(n) {
    const btn = document.querySelector(".sca11y-users-btn");
    if (!btn) return;
    if (n) btn.dataset.pm = String(n);
    else delete btn.dataset.pm;
    const base = (btn.getAttribute("aria-label") || "Users in room").replace(/, \d+ unread private messages?$/, "");
    S.setAttr(btn, "aria-label", n ? base + ", " + n + " unread private message" + (n === 1 ? "" : "s") : base);
  }
  document.addEventListener("click", (e) => {
    const tab = e.target instanceof Element && e.target.closest(".sca11y-pm-tab");
    if (!tab) return;
    const key = tab.dataset.key;
    if (key === "room") {
      const back = document.getElementById("back");
      if (back && currentView() !== "room") S.activate(back);
    } else {
      const handle = key.slice(3);
      const span = document.querySelector(`.privateMessages span[user-id="${CSS.escape(handle)}"]`);
      if (span) S.activate(span);
    }
    setTimeout(() => {
      const again = document.querySelector(`.sca11y-pm-tab[data-key="${CSS.escape(key)}"]`);
      if (again) again.focus();
    }, 50);
  });
  // Arrow keys move between tabs.
  document.addEventListener("keydown", (e) => {
    const tab = e.target instanceof Element && e.target.closest(".sca11y-pm-tab");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const all = Array.from(tab.parentElement.children);
    let i = all.indexOf(tab);
    if (e.key === "ArrowLeft") i = (i - 1 + all.length) % all.length;
    else if (e.key === "ArrowRight") i = (i + 1) % all.length;
    else if (e.key === "Home") i = 0;
    else i = all.length - 1;
    e.preventDefault();
    all[i].focus();
  });

  /* ---------------------------------------------------------------- */
  /* Display settings                                                 */
  /* ---------------------------------------------------------------- */
  function applyDisplay() {
    const scale = Math.max(80, Math.min(200, Number(S.settings.chatScale) || 100)) / 100;
    ROOT.style.setProperty("--sc-chat-scale", String(scale));
    ROOT.classList.toggle("sca11y-chat-compact", S.settings.chatDensity === "compact");
    ROOT.classList.toggle("sca11y-chat-times", !!S.settings.chatTimestamps);
    foldJoins();
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */
  S.on("chat", () => {
    onChat();
    ensureComposer();
    ensureTabs();
  });
  S.on("users", ensureTabs);
  S.on("taskbar", ensureTabs);
  S.on("page", () => {
    ensureComposer();
    ensureTabs();
  });
  S.onSettings(() => {
    applyDisplay();
    updateTitle();
  });
})();
