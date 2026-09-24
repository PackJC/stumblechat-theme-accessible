/* StumbleChat Accessible — background
 *
 * Only job: show a desktop notification when the content script reports a
 * mention or a private message and the user has turned on "Desktop alerts"
 * (which grants the optional "notifications" permission from the popup).
 * Clicking the notification brings that StumbleChat tab back. The tab id is
 * carried in the notification id, so nothing has to survive the service
 * worker going to sleep.
 */
"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // "More settings" on the page's Display panel: open the toolbar popup
  // where the browser allows it (Chrome 127+); the page shows a hint if not.
  if (msg && msg.type === "openPopup") {
    try {
      const p = api.action && api.action.openPopup ? api.action.openPopup() : null;
      if (p && typeof p.then === "function") p.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      else sendResponse({ ok: !!p });
    } catch (_) {
      sendResponse({ ok: false });
    }
    return true; // answer asynchronously
  }
  if (!msg || msg.type !== "notify" || !sender.tab) return;
  if (!api.notifications) return; // permission not granted
  api.notifications.create("sca11y-" + sender.tab.id + "-" + Date.now(), {
    type: "basic",
    iconUrl: api.runtime.getURL("icons/icon128.png"),
    title: String(msg.title || "StumbleChat").slice(0, 120),
    message: String(msg.body || "").slice(0, 240),
    priority: 1,
  });
});

if (api.notifications && api.notifications.onClicked) {
  api.notifications.onClicked.addListener((id) => {
    const m = /^sca11y-(\d+)-/.exec(id);
    api.notifications.clear(id);
    if (!m) return;
    const tabId = Number(m[1]);
    api.tabs.update(tabId, { active: true }, (tab) => {
      if (tab && tab.windowId !== undefined) api.windows.update(tab.windowId, { focused: true });
    });
  });
}
