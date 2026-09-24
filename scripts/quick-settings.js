/* StumbleChat Accessible — Display button
 *
 * The look settings used to live only in the extension's toolbar popup,
 * which people did not find. This puts a "Display" button on the page
 * itself: in the room toolbar (beside Theatre, Games, Media, Options) and
 * in the site's top bar on every other page. Its panel changes appearance
 * (light / dark / follow system), text size, high contrast, reduce motion
 * and the glass look instantly; "More settings" opens the full popup.
 */
(() => {
  "use strict";
  const S = globalThis.SCA11Y;
  if (!S) return;

  const SIZES = [
    [100, "100%"],
    [115, "115%"],
    [130, "130%"],
    [150, "150%"],
  ];
  const THEMES = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["auto", "Auto"],
  ];
  const SWITCHES = [
    ["highContrast", "High contrast"],
    ["reduceMotion", "Reduce motion"],
    ["glass", "Frosted glass look"],
  ];
  let seq = 0;

  function build() {
    const id = "sca11y-qs-" + ++seq;
    const wrap = document.createElement("div");
    wrap.className = "sca11y-qs";
    wrap.dataset.sca11yUi = "";
    wrap.innerHTML = `
      <button type="button" class="sca11y-qs-btn" aria-expanded="false" aria-controls="${id}" aria-haspopup="dialog">
        <span class="sca11y-qs-label">Display</span>
      </button>
      <div class="sca11y-qs-panel" id="${id}" role="dialog" aria-label="Display settings" hidden>
        <h2 class="sca11y-qs-title">Display</h2>
        <fieldset class="sca11y-qs-group">
          <legend>Appearance</legend>
          <div class="sca11y-qs-seg">
            ${THEMES.map(([v, l]) => `<label><input type="radio" name="${id}-theme" value="${v}"><span>${l}</span></label>`).join("")}
          </div>
        </fieldset>
        <fieldset class="sca11y-qs-group">
          <legend>Text size</legend>
          <div class="sca11y-qs-seg">
            ${SIZES.map(([v, l]) => `<label><input type="radio" name="${id}-size" value="${v}"><span>${l}</span></label>`).join("")}
          </div>
        </fieldset>
        ${SWITCHES.map(([k, l]) => `<label class="sca11y-qs-switch"><input type="checkbox" role="switch" data-key="${k}"><span>${l}</span></label>`).join("")}
        <button type="button" class="sca11y-qs-more">More settings</button>
        <p class="sca11y-qs-hint" hidden>For chat, room and directory settings, click the StumbleChat Accessible icon in your browser's toolbar (it may be under the puzzle-piece menu).</p>
      </div>`;
    const btn = wrap.querySelector(".sca11y-qs-btn");
    const panel = wrap.querySelector(".sca11y-qs-panel");
    btn.addEventListener("click", () => setOpen(wrap, panel.hidden));
    wrap.addEventListener("change", (e) => {
      const t = e.target;
      if (t.name === id + "-theme") S.setSetting("theme", t.value);
      else if (t.name === id + "-size") S.setSetting("fontScale", Number(t.value));
      else if (t.dataset.key) S.setSetting(t.dataset.key, t.checked);
    });
    wrap.querySelector(".sca11y-qs-more").addEventListener("click", () => {
      const hint = wrap.querySelector(".sca11y-qs-hint");
      const show = () => {
        hint.hidden = false;
        S.announce(hint.textContent);
      };
      try {
        chrome.runtime.sendMessage({ type: "openPopup" }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) show();
          else setOpen(wrap, false);
        });
      } catch (_) {
        show();
      }
    });
    render(wrap);
    return wrap;
  }

  function setOpen(wrap, open, returnFocus) {
    const btn = wrap.querySelector(".sca11y-qs-btn");
    const panel = wrap.querySelector(".sca11y-qs-panel");
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("sca11y-qs-open", open);
    if (open) {
      const first = panel.querySelector("input:checked") || panel.querySelector("input");
      if (first) first.focus();
    } else {
      wrap.querySelector(".sca11y-qs-hint").hidden = true;
      if (returnFocus) btn.focus();
    }
  }

  function render(wrap) {
    const s = S.settings;
    wrap.querySelectorAll("input[type=radio]").forEach((r) => {
      if (r.name.endsWith("-theme")) r.checked = r.value === (s.theme || "light");
      else r.checked = Number(r.value) === Number(s.fontScale || 100);
    });
    wrap.querySelectorAll("input[data-key]").forEach((c) => {
      const k = c.dataset.key;
      c.checked = k === "glass" ? s.glass !== false : !!s[k];
    });
  }

  // Close on Escape, on a click outside, and when focus leaves the panel.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".sca11y-qs.sca11y-qs-open");
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(open, false, true);
    }
  }, true);
  document.addEventListener("pointerdown", (e) => {
    document.querySelectorAll(".sca11y-qs.sca11y-qs-open").forEach((w) => {
      if (!w.contains(e.target)) setOpen(w, false);
    });
  }, true);
  document.addEventListener("focusout", (e) => {
    const w = e.target instanceof Element && e.target.closest(".sca11y-qs.sca11y-qs-open");
    if (w && !(e.relatedTarget instanceof Element && w.contains(e.relatedTarget))) setOpen(w, false);
  });

  /** Room toolbar, after the site's option buttons; or the site's top bar. */
  function place() {
    if (!S.settings.enabled) return;
    const roomOptions = document.getElementById("user-options");
    if (roomOptions) {
      if (!roomOptions.querySelector(":scope > .sca11y-qs")) roomOptions.appendChild(build());
      return;
    }
    // The inner row first: a combined selector returns the outer <nav>.
    const nav = document.querySelector(".navbar .container-fluid") || document.querySelector(".navbar");
    if (!nav) return;
    let w = nav.querySelector(".sca11y-qs");
    if (!w) {
      w = build();
      w.classList.add("sca11y-qs-nav");
    }
    // Signed in, the site's account button (name, avatar, and its menu) is
    // the last thing in the bar and its menu opens at the right edge. Sit
    // just before it so the name stays at the edge, above its menu.
    const account = nav.querySelector(":scope > .navbar-container");
    if (account) {
      if (w.nextElementSibling !== account) nav.insertBefore(w, account);
    } else if (w.parentElement !== nav) {
      nav.appendChild(w);
    }
  }

  S.on("header", place);
  S.on("page", place);
  S.onSettings(() => {
    document.querySelectorAll(".sca11y-qs").forEach(render);
    place();
  });
})();
