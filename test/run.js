#!/usr/bin/env node
/**
 * Headless browser tests over the fixture pages.
 *
 *   npm test              contrast check + these tests
 *   node test/run.js      these tests only
 *
 * Serves the repo root on a free port, opens each fixture in headless
 * Chrome (CHROME_PATH, or the usual install locations), and drives it with
 * real mouse and keyboard input. The room fixture reproduces the site's own
 * event handling (window "pointerup" keyed on event.target, "pointerdown"
 * for Talk and Start Broadcast) and counts what the "site" did in
 * window.__fx, so a regression like "clicking a camera no longer opens its
 * menu" fails here.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end("not found");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium executable.");
  return found;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let base = "";
async function open(page, fixture, query = "", viewport = { width: 1300, height: 800 }) {
  await page.setViewport(viewport);
  await page.goto(`${base}/test/site/pages/${fixture}.html${query ? "?" + query : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.harnessReady === "1" && window.SCA11Y, { timeout: 10000 });
  await sleep(400); // scheduled fix passes and a layout frame
}
const fx = (page) => page.evaluate(() => window.__fx);

/* -------------------------------------------------------------------- */
/* Room: the site's handlers must still fire                             */
/* -------------------------------------------------------------------- */
test("clicking a camera opens the site's camera menu", async (page) => {
  await open(page, "room");
  const box = await (await page.$("#regularvideos .video-wrapper")).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  eq((await fx(page)).videoMenu, 1, "camera menu opens");
  assert(await page.$eval("#video-menu", (m) => m.classList.contains("video-menu-active")), "menu visible");
  const vol = await page.evaluate(() => {
    const bar = document.querySelector(".volumebar-video").getBoundingClientRect();
    const range = document.querySelector("#video-volume").getBoundingClientRect();
    return { gap: Math.round(range.left - bar.left), width: Math.round(range.width) };
  });
  assert(vol.gap >= 24 && vol.width >= 80, "volume slider sits beside its speaker icon, not over it: " + JSON.stringify(vol));
  // The site's speaker is a white image; on the light theme it vanished. Both volume icons must stand out from their menu.
  const iconContrast = await page.evaluate(() => {
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (c) => {
      const [r, g, b] = rgb(c).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bg = (el) => {
      for (; el; el = el.parentElement) {
        const c = getComputedStyle(el).backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
      }
      return "rgb(255, 255, 255)";
    };
    return [".volumebar-video", ".volumebar"].map((sel) => {
      const bar = document.querySelector(sel);
      const dd = bar.closest(".dropdown-content");
      if (dd) dd.style.setProperty("display", "block", "important");
      const icon = getComputedStyle(bar, "::before");
      const drawn = icon.content !== "none" && getComputedStyle(bar).backgroundImage === "none"; // our icon, not the site's white image
      const a = lum(icon.backgroundColor);
      const b = lum(bg(bar));
      if (dd) dd.style.removeProperty("display");
      if (!drawn) return 0;
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
    });
  });
  assert(iconContrast.every((c) => c >= 3), "volume icons are visible against their menus (3:1): " + JSON.stringify(iconContrast));
});

test("dragging a camera moves it and does not open the menu", async (page) => {
  await open(page, "room");
  const tiles = await page.$$("#regularvideos > .js-video");
  const first = await tiles[0].boundingBox();
  const last = await tiles[tiles.length - 1].boundingBox();
  const before = await page.$$eval("#regularvideos > .js-video .nickname", (n) => n.map((x) => x.textContent));
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + 20, { steps: 5 });
  await page.mouse.move(first.x + 10, first.y + 10, { steps: 10 });
  await page.mouse.up();
  await sleep(200);
  const after = await page.$$eval("#regularvideos > .js-video .nickname", (n) => n.map((x) => x.textContent));
  eq(after[0], before[before.length - 1], "last camera moved to the front");
  eq((await fx(page)).videoMenu, 0, "no menu after a drag");
});

test("keyboard: Enter on a user row opens the menu with focus inside; Escape returns", async (page) => {
  await open(page, "room");
  await page.focus("#userlist .bar");
  await page.keyboard.press("Enter");
  eq((await fx(page)).userMenu, 1, "user menu opened");
  eq(await page.evaluate(() => document.activeElement.textContent.trim()), "Change Nickname", "focus on first item");
  await page.keyboard.press("ArrowDown");
  eq(await page.evaluate(() => document.activeElement.textContent.trim()), "Profile", "arrow moves");
  await page.keyboard.press("Escape");
  assert(await page.evaluate(() => document.activeElement.classList.contains("bar")), "focus back on the row");
});

test("keyboard: Enter on a camera opens its menu; Start Broadcast fires", async (page) => {
  await open(page, "room");
  await page.focus("#regularvideos .video-wrapper");
  await page.keyboard.press("Enter");
  eq((await fx(page)).videoMenu, 1, "camera menu from keyboard");
  await page.keyboard.press("Escape");
  await page.focus("#media-broadcast");
  await page.keyboard.press("Enter");
  eq((await fx(page)).broadcast, 1, "Start Broadcast pressed");
});

test("keyboard: hold Space on Talk to talk, release to stop", async (page) => {
  await open(page, "room", "live");
  await page.focus("#media-ptt");
  await page.keyboard.down(" ");
  eq(await page.$eval("#media-ptt", (b) => b.textContent), "TALKING...", "talking while held");
  await page.keyboard.up(" ");
  eq(await page.$eval("#media-ptt", (b) => b.textContent), "TALK", "stopped on release");
});

test("keyboard: dialog switches reach the site and stay in step", async (page) => {
  await open(page, "room", "modal=theme");
  const sw = await page.$("label.switch > input");
  await sw.focus();
  const before = await sw.evaluate((i) => i.checked);
  await page.keyboard.press("Enter");
  eq((await fx(page)).sliders, ["largeembeddedvideos"], "site handler ran");
  eq(await sw.evaluate((i) => i.checked), !before, "checkbox toggled once");
  eq(await sw.evaluate((i) => i.getAttribute("aria-label")), "Large Embedded Videos", "switch has a name");
});

test("dialogs trap focus, close on Escape, and return focus", async (page) => {
  await open(page, "room");
  await page.focus(".topic");
  await page.keyboard.press("Enter");
  eq((await fx(page)).topic, 1, "topic dialog opened");
  await sleep(100);
  assert(await page.evaluate(() => document.getElementById("modal").contains(document.activeElement)), "focus in dialog");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  assert(await page.evaluate(() => document.getElementById("modal").contains(document.activeElement)), "Tab stays in dialog");
  assert(await page.$eval("sc-videolist", (e) => e.hasAttribute("inert")), "room inert behind dialog");
  await page.keyboard.press("Escape");
  await sleep(100);
  assert(!(await page.$eval("sc-videolist", (e) => e.hasAttribute("inert"))), "inert removed");
  assert(await page.evaluate(() => document.activeElement.classList.contains("topic")), "focus returned");
});

test("the join dialog reads plainly and Enter joins", async (page) => {
  await open(page, "room", "modal=verify");
  eq(await page.$eval("#modal #title > p", (p) => p.textContent), "Join the room", "title");
  eq(await page.$eval("#interact", (b) => b.textContent), "Join room", "button");
  eq(await page.evaluate(() => document.activeElement.id), "interact", "button focused");
  await page.keyboard.press("Enter");
  eq((await fx(page)).verify, 1, "site's join handler ran");
});

test("camera order is saved by person and survives a reload", async (page) => {
  await open(page, "room");
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => localStorage.setItem("nick", "CoolCat"));
  await page.focus("#regularvideos > .js-video:first-child .video-wrapper");
  await page.keyboard.down("Alt");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Alt");
  const order = await page.$$eval("#regularvideos > .js-video .nickname", (n) => n.map((x) => x.textContent));
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith("sca11y-camera-order-v2"))[1]);
  assert(/u:|n:/.test(saved), "saved against people, not connection ids: " + saved);
  await open(page, "room");
  eq(await page.$$eval("#regularvideos > .js-video .nickname", (n) => n.map((x) => x.textContent)), order, "order restored");
});

test("the camera grid fills the space; mic-only broadcasters become chips", async (page) => {
  await open(page, "room", "cams=12&miconly=2");
  await sleep(300);
  const r = await page.evaluate(() => {
    const grid = document.getElementById("regularvideos").getBoundingClientRect();
    const tiles = [...document.querySelectorAll("#regularvideos > .js-video:not(.sca11y-audio-only)")].map((t) => t.getBoundingClientRect());
    return {
      fill: document.documentElement.classList.contains("sca11y-fill"),
      widths: [...new Set(tiles.map((t) => Math.round(t.width)))],
      inside: tiles.every((t) => t.right <= grid.right + 1 && t.bottom <= grid.bottom + 1),
      audio: document.querySelectorAll(".sca11y-audio-only").length,
    };
  });
  assert(r.fill, "fill layout on");
  eq(r.widths.length, 1, "all camera tiles one width");
  assert(r.inside, "tiles inside the video area");
  eq(r.audio, 3, "mic-only chips (2 extra + ModMaya)");
});

test("phones get the speaker stage in crowded rooms", async (page) => {
  await open(page, "room", "cams=24&miconly=3&sim", { width: 375, height: 812, isMobile: true, hasTouch: true });
  await sleep(800);
  const r = await page.evaluate(() => ({
    stage: document.documentElement.classList.contains("sca11y-stage"),
    onStage: document.querySelectorAll("#regularvideos > .js-video:not(.sca11y-offstage)").length,
    chips: document.querySelectorAll(".sca11y-chip").length,
  }));
  assert(r.stage, "stage on");
  eq(r.onStage, 6, "six on the stage");
  // 24 broadcasters (3 base + 21 extra), 6 on the stage: everyone else is a chip, mic-only included.
  eq(r.chips, 24 - 6, "everyone else as chips");
});

test("chat: mentions, one announcement per message, send button, PM tabs", async (page) => {
  await open(page, "room", "live&joins");
  eq(await page.$$eval("#chat-content .sca11y-mention", (m) => m.length), 1, "mention highlighted");
  const mentionBox = await page.$eval("#chat-content .sca11y-mention", (c) => {
    const msg = c.closest(".message").getBoundingClientRect();
    const nick = c.closest(".message").querySelector(".nickname").getBoundingClientRect();
    const box = c.getBoundingClientRect();
    return { belowNick: Math.round(box.top - nick.bottom), insideMessage: box.top >= msg.top && box.bottom <= msg.bottom + 1 };
  });
  assert(mentionBox.insideMessage && mentionBox.belowNick >= 0, "a mention stays in its own message, under the name: " + JSON.stringify(mentionBox));
  eq(await page.$$eval('[role="main"]', (m) => m.map((x) => x.id)), ["room-content"], "one main landmark; chat bubbles are not it");
  eq(await page.$$eval(".sca11y-jl-hidden", (m) => m.length), 4, "join/leave run folded");
  await page.$eval("#textarea", (t) => (t.value = "sent with the button"));
  await page.$eval(".sca11y-send", (b) => b.click()); // shown on phones only; press it directly
  await sleep(200);
  eq((await fx(page)).sent.slice(-1)[0], "sent with the button", "Send button sends");
  await page.evaluate(() => window.__say("SuperSam", "hi CoolCat"));
  await sleep(200);
  const lines = await page.$$eval('[aria-label="New chat messages"] p', (p) => p.map((x) => x.textContent));
  eq(lines, ["SuperSam: hi CoolCat"], "only the new message from someone else is announced");
  await page.click('.sca11y-pm-tab[data-key^="pm:"]');
  await sleep(200);
  eq((await fx(page)).view, "pm", "PM tab opens the conversation");
  eq(await page.$$eval('[aria-label="New chat messages"] p', (p) => p.length), 1, "switching conversations announces nothing");
});

test("header menus open above the cameras and their items are clickable", async (page) => {
  await open(page, "room", "cams=4");
  const btn = await page.$('.dropbtn[aria-label="Options"]');
  const b = await btn.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(150);
  // Move down into the menu across the gap; it must stay open.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 30, { steps: 6 });
  await sleep(150);
  const r = await page.evaluate(() => {
    const dd = [...document.querySelectorAll(".user-options-dropdown")].pop();
    const c = dd.querySelector(".dropdown-content");
    const items = [...c.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().height > 0);
    return {
      open: getComputedStyle(c).display !== "none",
      clickable: items.every((a) => {
        const q = a.getBoundingClientRect();
        const t = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return t === a || a.contains(t);
      }),
    };
  });
  assert(r.open, "menu stays open while moving into it");
  assert(r.clickable, "every item is on top of the cameras");
});

test("the camera menu closes 1 s after the pointer leaves; camera controls hide when it leaves", async (page) => {
  await open(page, "room", "cams=4");
  const w = await (await page.$("#regularvideos > .js-video .video-wrapper")).boundingBox();
  await page.mouse.move(w.x + w.width / 2, w.y + w.height / 2);
  await page.mouse.move(w.x + w.width / 2 + 5, w.y + w.height / 2 + 5);
  await page.mouse.click(w.x + w.width / 2 + 5, w.y + w.height / 2 + 5);
  assert(await page.$eval("#regularvideos > .js-video", (t) => t.classList.contains("sca11y-controls")), "controls shown");
  eq((await fx(page)).videoMenu, 1, "camera menu opened");
  // The menu opens under the pointer, so it stays while the pointer is on it.
  const m = await (await page.$("#video-menu")).boundingBox();
  await page.mouse.move(m.x + 20, m.y + 20);
  await sleep(1500);
  assert(await page.$eval("#video-menu", (m) => m.classList.contains("video-menu-active")), "menu stays while the pointer is on it");
  await page.mouse.move(5, 5); // off the camera and the menu
  assert(!(await page.$eval("#regularvideos > .js-video", (t) => t.classList.contains("sca11y-controls"))), "controls hide as soon as the pointer leaves");
  await sleep(1300);
  assert(!(await page.$eval("#video-menu", (m) => m.classList.contains("video-menu-active"))), "menu closed about 1 s later");
});

test("the Display button changes the look on the page itself", async (page) => {
  await open(page, "room", "cams=4");
  const tops = await page.$$eval("#user-options > *:not(.hidden)", (k) => k.map((x) => Math.round((x.matches("button") ? x : x.querySelector("button")).getBoundingClientRect().top)));
  eq(new Set(tops).size, 1, "toolbar buttons aligned");
  await page.click("#user-options .sca11y-qs-btn");
  await page.click('#user-options .sca11y-qs-panel input[value="dark"] + span');
  assert(await page.evaluate(() => document.documentElement.classList.contains("sca11y-dark")), "dark mode on");
  await page.keyboard.press("Escape");
  assert(await page.$eval("#user-options .sca11y-qs-panel", (p) => p.hidden), "Escape closes the panel");
  eq(await page.evaluate(() => document.activeElement.className), "sca11y-qs-btn", "focus back on the button");
  await open(page, "directory");
  assert(await page.$(".navbar .container-fluid > .sca11y-qs"), "Display button in the site's top bar");
});

test("the account settings page is not mistaken for a room", async (page) => {
  await open(page, "settings");
  await sleep(1700);
  assert(!(await page.evaluate(() => document.documentElement.classList.contains("sca11y-compat"))), "no site-change alarm");
});

test("the account menu opens under the account name, by mouse or keyboard", async (page) => {
  await open(page, "settings");
  await page.waitForSelector(".navbar .sca11y-qs");
  const bar = await page.evaluate(() => [...document.querySelector(".navbar .container-fluid").children].map((c) => c.id || c.className));
  eq(bar.slice(-2), ["sca11y-qs sca11y-qs-nav", "navbar-container"], "Display sits before the account button, which stays last");
  await page.click("#accbtn");
  const geo = await page.evaluate(() => {
    const b = document.getElementById("accbtn").getBoundingClientRect();
    const m = document.getElementById("accdrop").getBoundingClientRect();
    return { open: m.height > 0, alignedRight: Math.abs(m.right - b.right) <= 2, below: m.top >= b.bottom && m.top - b.bottom <= 12, expanded: document.getElementById("accbtn").getAttribute("aria-expanded") };
  });
  eq(geo, { open: true, alignedRight: true, below: true, expanded: "true" }, "menu under the name");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await page.focus("#accdrop a");
  await page.keyboard.press("Escape");
  eq(await page.evaluate(() => [document.getElementById("accdrop").classList.contains("show"), document.activeElement.id, document.getElementById("accbtn").getAttribute("aria-expanded")]), [false, "accbtn", "false"], "Escape closes it and returns to the name");
  await page.keyboard.press("Enter");
  await sleep(50);
  eq(await page.evaluate(() => [document.getElementById("accdrop").classList.contains("show"), document.getElementById("accbtn").getAttribute("aria-expanded")]), [true, "true"], "Enter opens it");
});

test("site change detection pauses the layout changes", async (page) => {
  await open(page, "room", "breaksite");
  await sleep(1700);
  assert(await page.evaluate(() => document.documentElement.classList.contains("sca11y-compat")), "compat mode on");
});

/* -------------------------------------------------------------------- */
/* Directory                                                            */
/* -------------------------------------------------------------------- */
const names = (page) => page.$$eval(".publicrooms .grid-item:not(.sca11y-filtered) .roomname h3", (h) => h.map((x) => x.textContent));

test("directory: sorted by people on cam; nothing loads before you scroll", async (page) => {
  await open(page, "directory");
  await page.evaluate(() => localStorage.clear());
  await open(page, "directory");
  const cams = await page.$$eval(".publicrooms .grid-item .detailbadge.broadcast", (b) => b.map((x) => Number(x.textContent)));
  eq(cams, cams.slice().sort((a, b) => b - a), "descending by cams");
  eq(await page.evaluate(() => window.__lbstatsCalls || 0), 0, "no extra requests on load");
  await page.click(".sca11y-more-btn");
  await sleep(500);
  eq(await page.evaluate(() => window.__lbstatsCalls), 1, "Load more fetched one page");
  eq((await names(page)).length, 12, "page 2 appended");
});

test("directory: search, favourites, hide", async (page) => {
  await open(page, "directory");
  await page.evaluate(() => localStorage.clear());
  await open(page, "directory");
  await page.type("#sca11y-room-search", "space");
  eq((await names(page)).sort(), ["lalaland", "meatspace"], "search by name and topic");
  await page.$eval("#sca11y-room-search", (i) => {
    i.value = "";
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const ctlOpacity = (room) => page.evaluate((room) => [...[...document.querySelectorAll(".publicrooms .grid-item")].find((c) => c.querySelector("h3").textContent === room).querySelector(".sca11y-card-ctl").children].map((b) => getComputedStyle(b).opacity), room);
  // Starring the top room does not move it, so focus stays on the star; the buttons must still fade.
  const top = (await names(page))[0];
  await page.click(".publicrooms .grid-item .sca11y-fav");
  eq((await names(page))[0], top, "top room stays put when starred");
  await page.mouse.move(2, 400);
  await sleep(300);
  eq(await ctlOpacity(top), ["0", "0"], "card buttons fade once the pointer leaves a starred room");
  await page.click(".publicrooms .grid-item .sca11y-fav");
  const card = await page.evaluateHandle(() => [...document.querySelectorAll(".publicrooms .grid-item")].find((c) => c.querySelector("h3").textContent === "clubmosthated"));
  await (await card.$(".sca11y-fav")).click();
  eq((await names(page))[0], "clubmosthated", "favourite pinned first");
  eq(await page.evaluate(() => document.activeElement.closest(".grid-item")?.querySelector("h3").textContent), "clubmosthated", "focus follows the starred card to the top");
  await page.mouse.move(2, 400);
  await sleep(300);
  eq(await ctlOpacity("clubmosthated"), ["0", "0"], "buttons fade after the card moved too");
  await page.keyboard.press("Tab");
  await sleep(300);
  eq(await ctlOpacity("clubmosthated"), ["1", "1"], "keyboard focus shows them again");
  assert(!(await page.$(".sca11y-dir-sort, [data-sort]")), "no sort buttons on the page");
  const hide = await page.evaluateHandle(() => [...document.querySelectorAll(".publicrooms .grid-item")].find((c) => c.querySelector("h3").textContent === "meatspace").querySelector(".sca11y-hide"));
  await hide.click();
  assert(!(await names(page)).includes("meatspace"), "hidden room gone");
  eq(await page.$$eval(".sca11y-hidden-row [data-unhide]", (b) => b.map((x) => x.dataset.unhide)), ["meatspace"], "hidden room shown as a chip on the page");
  eq(await page.$eval(".sca11y-hr-label", (l) => l.textContent), "Hidden (1):", "hidden count label");
  assert(await page.$eval(".sca11y-undo", (t) => !t.hidden && /meatspace/.test(t.textContent)), "undo notice shown");
  await page.click(".sca11y-undo [data-undo]");
  assert((await names(page)).includes("meatspace"), "undo brings the room back");
  assert(await page.$eval(".sca11y-hidden-row", (r) => r.classList.contains("sca11y-hr-empty")), "row empty after undo");
  await hide.click();
  await page.click('.sca11y-hidden-row [data-unhide="meatspace"]');
  assert((await names(page)).includes("meatspace"), "chip brings the room back");
  await page.click(".sca11y-hr-kw");
  await page.waitForSelector(".sca11y-kw-input");
  eq(await page.evaluate(() => document.activeElement && document.activeElement.id), "sca11y-kw-input", "keyword box focused");
  await page.type(".sca11y-kw-input", "street");
  await page.click(".sca11y-hr-add");
  assert(!(await names(page)).includes("lalaland"), "keyword hides a room by topic");
  await page.click('.sca11y-hidden-row [data-unmute="street"]');
  assert((await names(page)).includes("lalaland"), "removing the keyword brings it back");
});

test("directory: back to top is a round button above the footer, and works with the mouse and the keyboard", async (page) => {
  await open(page, "directory", "", { width: 800, height: 600 });
  const content = "body > .content";
  const scrollDown = () => page.$eval(content, (c) => (c.scrollTop = 500));
  await scrollDown();
  await page.waitForFunction(() => document.getElementById("scrollup").style.display === "block", { timeout: 3000 });
  await sleep(300);
  const look = await page.evaluate(() => {
    const b = document.getElementById("scrollup");
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      size: [Math.round(r.width), Math.round(r.height)],
      round: cs.borderRadius,
      glyphHidden: cs.color === "rgba(0, 0, 0, 0)" && cs.fontSize === "0px",
      arrow: getComputedStyle(b, "::before").content !== "none",
      aboveFooter: r.bottom <= document.querySelector(".footer").getBoundingClientRect().top - 8,
      onScreen: r.right <= innerWidth - 8,
    };
  });
  eq(look, { size: [48, 48], round: "50%", glyphHidden: true, arrow: true, aboveFooter: true, onScreen: true }, "back to top look");
  await page.click("#scrollup");
  await page.waitForFunction((sel) => document.querySelector(sel).scrollTop === 0, { timeout: 3000 }, content);
  eq(await page.evaluate(() => window.__scrollups), 1, "the site's own handler scrolled on the click");
  await scrollDown();
  await page.waitForFunction(() => document.getElementById("scrollup").style.display === "block", { timeout: 3000 });
  await page.focus("#scrollup");
  await page.keyboard.press("Enter");
  await page.waitForFunction((sel) => document.querySelector(sel).scrollTop === 0, { timeout: 3000 }, content);
  eq(await page.evaluate(() => document.activeElement.matches("body > .content")), true, "Enter scrolls to the top and puts focus there");
});

test("directory: the site's rate-limit message becomes a readable card", async (page) => {
  await open(page, "directory", "ratelimit");
  const h = await page.$eval(".publicrooms > h1", (h) => ({ text: h.textContent, role: h.getAttribute("role"), cls: h.className }));
  assert(/limiting requests/.test(h.text), "plain-language text");
  eq(h.role, "alert", "announced");
});

test("directory: a rate-limited Load more backs off", async (page) => {
  await open(page, "directory", "limitmore");
  await page.click(".sca11y-more-btn");
  await sleep(300);
  assert(/Too many requests/.test(await page.$eval(".sca11y-more-btn", (b) => b.textContent)), "button explains");
});

/* -------------------------------------------------------------------- */
(async () => {
  const server = await serve();
  base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"],
  });
  let failed = 0;
  for (const t of tests) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    try {
      await t.fn(page);
      const ours = errors.filter((m) => !/Not allowed to load local resource/.test(m));
      if (ours.length) throw new Error("page errors: " + ours.join(" | "));
      console.log("PASS  " + t.name);
    } catch (err) {
      failed++;
      console.log("FAIL  " + t.name + "\n      " + err.message);
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} of ${tests.length} tests failed` : `\nAll ${tests.length} tests passed`);
  process.exit(failed ? 1 : 0);
})();
