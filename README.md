# StumbleChat Accessible

A Chrome extension that gives [stumblechat.com](https://stumblechat.com) a clean, Bootstrap-style light theme and fixes its biggest accessibility problems so it meets WCAG 2.1 AA.

StumbleChat ships as white text on black with translucent panels, neon form glows, hidden scrollbars, `outline: none` on every control, a viewport that blocks pinch-zoom, and user-picked chat colours that are often unreadable. This extension rewrites all of that on the fly: white pages, dark text, proper buttons and forms, a visible focus ring, keyboard access to every control, screen-reader landmarks, and a contrast fixer that keeps everyone's custom chat colours but nudges them until they pass 4.5:1.

No tracking, no network requests, no build step. The only permission is `storage`, for your settings.

## Screenshots

All screenshots are rendered from the repo's fixture pages, which use the site's real markup and stylesheets with made-up users, so nobody's face or handle appears.

### Chat room, before and after

Same room, same users, same custom chat colours. Note the yellow-on-orange and white-on-white messages on the left become readable on the right while keeping their hue, the user list gains role badges you can read, and the speaking indicator becomes a green ring plus a sound-bars badge.

| Site as shipped | With the extension |
| --- | --- |
| ![Chat room as the site ships it: black panels, neon message backgrounds, unreadable text](docs/screenshots/room-before.png) | ![Chat room with the extension: white panels, readable chat bubbles, green speaking rings](docs/screenshots/room-light.png) |

### Dark mode

Same room with **Appearance: Dark**. Every colour pair is re-verified for the dark palette.

![Chat room in dark mode](docs/screenshots/room-dark.png)

### Directory, before and after

The carousel arrows on each card (they did nothing) are gone, counts have readable icons, and descriptions are left-aligned dark text.

| Site as shipped | With the extension |
| --- | --- |
| ![Directory as the site ships it](docs/screenshots/directory-before.png) | ![Directory with the extension: white cards, dark text](docs/screenshots/directory-after.png) |

### Dialogs

Theme Settings in light mode and Client Settings in dark mode.

| Light | Dark |
| --- | --- |
| ![Theme settings dialog with colour pickers and toggle rows](docs/screenshots/modal-theme.png) | ![Client settings dialog in dark mode](docs/screenshots/modal-client-dark.png) |

### Settings page and login

| Settings (chat colour preview) | Login |
| --- | --- |
| ![Settings page chat tab with live preview and colour pickers](docs/screenshots/settings.png) | ![Login form as a centred card](docs/screenshots/login.png) |

## Install

The extension is not on the Chrome Web Store, so it loads as an unpacked extension. This works in Chrome, Edge, Brave, Arc, and Opera.

1. Download this repository: click the green **Code** button, then **Download ZIP**, and unzip it. Or clone it:
   ```bash
   git clone https://github.com/YOUR-USERNAME/stumblechat-accessible.git
   ```
2. Open a new tab and go to `chrome://extensions` (on Edge use `edge://extensions`, on Brave `brave://extensions`).
3. Turn on **Developer mode** with the toggle in the top-right corner.
4. Click **Load unpacked** and select the unzipped `stumblechat-accessible` folder (the one containing `manifest.json`).
5. Open stumblechat.com. It is already restyled.
6. Optional: click the puzzle-piece icon in the toolbar and pin **StumbleChat Accessible** so its settings popup is one click away.

**Updating:** pull or re-download the folder, go back to `chrome://extensions`, click the circular reload arrow on the extension's card, and refresh any open StumbleChat tabs.

**Turning it off:** click the toolbar icon and switch off **Enable light theme**, or disable the extension on `chrome://extensions`.

## Settings

Click the toolbar icon to open the popup. Changes apply instantly to any open StumbleChat tab.

| Setting | What it does |
| --- | --- |
| Enable light theme | Turns the whole restyle on or off. |
| Appearance | Light, Dark, or Follow system (switches with your OS dark-mode setting). |
| Text size | Scales chat, cards, forms, and nav text from 100% to 150%. |
| High contrast | Switches to a 7:1 palette and re-fits user-chosen chat colours to 7:1. Works in light and dark. |
| Reduce motion | Stops floating hearts, fades, pulsing badges, and the speaking-badge animation. Also follows your OS setting automatically. |
| Rearrange cameras | Drag any broadcast tile to move it, or focus one and press Alt + arrow keys (Home/End jump to the ends). The order is remembered per room and re-applied when people join or leave. |
| Reset camera layout | Puts the tiles back in the site's own order (newest broadcaster first). |

## What it changes

### Look
- White page background, `#212529` text, system font stack, 0.375rem radii, subtle borders and shadows.
- Navbar, room cards, pagination, forms, alerts, modals, dropdowns, context menus, toggle switches, and buttons all follow Bootstrap 5 conventions.
- Start Broadcast, Talk, and open-mic are green; Stop and destructive actions are red; everything else is blue or grey.
- A full dark mode using Bootstrap's dark palette, with every colour pair re-verified.
- Broadcast tiles take the video's own aspect ratio instead of being letterboxed into a 4:3 box, so the name pill sits on the picture. Embedded players keep their box.
- Broadcast tiles can be dragged into any order (or moved with Alt + arrow keys). A grip appears on hover.
- The speaking indicator follows the convention Zoom, Meet, and Discord share: a steady green ring around the tile plus a small sound-bars badge in the corner whose bars rise with volume. Colour and icon together, and it never flashes.
- The carousel arrows on directory cards, which did nothing, are removed.
- Every dialog is restyled: media options, theme settings, client settings, room settings, YouTube queue, ban list, profile card, password prompts, media searches.
- The logged-in settings page (all five tabs), the account dropdown, the chat-colour preview, and colour pickers are covered.
- The site's black text-shadow outlines, translucent black panels, neon valid/invalid glows, hidden scrollbars, and 1-second background fades are removed.

### Accessibility (WCAG 2.1 AA)

| Criterion | Fix |
| --- | --- |
| 1.4.3 Contrast (Minimum) | Every theme colour pair is at least 4.5:1 for text and 3:1 for UI, verified by `tools/contrast-check.js`. |
| 1.4.3 for user colours | Users pick their own message colour and nickname background. The content script measures each against its real background and shifts lightness just enough to reach 4.5:1 (7:1 in high contrast) while keeping the hue. Nicknames on custom backgrounds get black or white, whichever reads better. |
| 1.4.1 Use of Colour | Role badges keep their colour and their text label; the colour-only valid/invalid input glow is removed. |
| 1.4.4 Resize Text / 1.4.10 Reflow | The site's `user-scalable=0` viewport is rewritten so pinch-zoom works, and the popup adds a text-size control. |
| 1.4.11 Non-text Contrast | Focus rings, input borders, toggles, and scrollbars are at least 3:1. White SVG icons are inverted so they show on white. |
| 2.1.1 Keyboard | Clickable divs, spans, and links without `href` (pagination, carousel arrows, user rows, broadcast tiles, context-menu and dropdown items) get `tabindex`, a role, and Enter/Space activation. Hover-only dropdowns open on keyboard focus. Escape closes menus. |
| 2.4.1 Bypass Blocks | A "Skip to main content" link is injected. |
| 2.4.3 Focus Order | When a dialog opens, focus moves into it. |
| 2.4.7 Focus Visible | A 3px ring replaces the site's `outline: none`. |
| 1.3.1 / 4.1.2 Name, Role, Value | Landmarks (`navigation`, `main`, `contentinfo`, `region`, `log`, `toolbar`), `dialog` + `aria-modal` on the modal, `menu`/`menuitem` on context menus, `aria-expanded` on dropdown triggers, `aria-current` on the active page, labels for placeholder-only inputs, orphan `<label>`s associated with their inputs, descriptive `alt` on previews, and spoken names for the broadcast/user count badges. |
| 4.1.3 Status Messages | The login error banner is `role="alert"`, the unread-messages pill is `role="status"`, and the chat log is a polite live region. |
| 2.3.3 Animation from Interactions | Honours `prefers-reduced-motion` and the popup toggle. |

## How it works

- `styles/theme.css` is injected at `document_start`, before the page paints, so there is no flash of the dark site. Every rule is scoped to `html.sca11y` (so the popup can switch it off) and uses `!important`, because the site's own stylesheets and the inline styles it writes for user themes would otherwise win.
- `scripts/content.js` applies your settings, rewrites the viewport meta, adds the ARIA and keyboard fixes, runs the contrast fixer, and handles camera dragging. A `MutationObserver` re-applies everything (including your camera order) as the chat, user list, and video grid change.
- `popup/` is the settings UI, stored with `chrome.storage.sync`.

## Local preview without installing

`test/site/pages/` holds copies of the site's real markup and stylesheets (directory, login, register, the logged-in settings page with all five tabs, and a chat room seeded with sample users and messages). Serve the repo root and open a page; `test/harness.js` loads `theme.css` and `content.js` exactly as Chrome would:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/test/site/pages/room.html`.

Query flags: `?off` (site as shipped), `?dark`, `?hc` (high contrast), `?scale=130` (text size). Room page: `?modal=media|theme|client|youtube|profile|twitch|password|nick|roomsettings`, `?menu` (user context menu), `?live` (broadcasting taskbar and PM list), `?speaking` (two tiles with the speaking indicator). Settings page: `?tab=user|chat|avatar|room|privacy`, `?menu` (account dropdown).

The screenshots above were rendered from these pages with headless Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --window-size=1440,900 --timeout=4000 --screenshot=room.png "http://127.0.0.1:8765/test/site/pages/room.html?live&speaking"
```

To check the palette after editing colours:

```bash
node tools/contrast-check.js
```

It fails if any text or UI pair drops below WCAG AA.

## Files

```
manifest.json            MV3 manifest (content script + popup + storage)
styles/theme.css         The theme
scripts/content.js       Settings, contrast fixer, keyboard/ARIA fixes
popup/                   Settings popup
tools/contrast-check.js  Palette verifier
icons/make-icons.py      Regenerates the PNG icons (needs Pillow)
test/                    Fixture pages and harness for previewing without installing
docs/screenshots/        Screenshots used above (rendered from the fixtures)
```

## Known limits

- The room's header and topic bar keep the site's fixed 19px height because the site's JavaScript positions the video area beneath them, so the topic text stays at 12px there.
- Custom room backgrounds and chat-panel colours from the site's Theme Settings are flattened to white. The user's message colour survives as a left accent bar on each message and as the contrast-corrected text colour.
- The extension can add attributes to the site's HTML but cannot change its nesting (for example, `<a>` elements placed directly inside `<ul>`).
- Built against the site as of September 2026 (`home.css?v=3.1`, `style.css?v=3.0`, `room.js?v=3.1.6`). If the site ships a redesign, selectors may need updating.

## Contributing

Open an issue with a screenshot of anything that still looks wrong or is hard to use. Pull requests are welcome; run `node tools/contrast-check.js` before submitting palette changes.
