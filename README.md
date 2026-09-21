# StumbleChat Accessible

A Chrome extension (Manifest V3) that restyles [stumblechat.com](https://stumblechat.com) as a clean, Bootstrap-style light theme and fixes the site's biggest WCAG 2.1 AA accessibility problems.

No tracking, no network requests, no permissions beyond `storage` (for your settings).

## Install (unpacked)

1. Open `chrome://extensions` in Chrome (or Edge / Brave / Arc).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. Open stumblechat.com. The toolbar icon opens the settings popup.

To update after editing files, click the reload icon on the extension card.

## Settings (toolbar popup)

| Setting | What it does |
| --- | --- |
| Enable light theme | Turns the whole restyle on or off. |
| Text size | Scales chat, cards, forms, and nav text from 100% to 150%. |
| High contrast | Switches to a 7:1 palette and re-fits user-chosen chat colours to 7:1. |
| Reduce motion | Stops floating hearts, fades, and pulsing badges. Also follows your OS setting automatically. |

## What it changes

### Visual (Bootstrap look)
- White page background, `#212529` text, system font stack, 0.375rem radii, subtle borders and shadows.
- Navbar, cards (room tiles), pagination, forms, alerts, modals, dropdowns, context menus, toggle switches, and buttons all follow Bootstrap 5 conventions (`.btn-primary`, `.btn-danger`, `.form-control`, `.card`, `.alert`, etc.).
- The site's black text-shadow outlines, translucent black panels, neon valid/invalid form glows, and hidden scrollbars are removed.
- Video tiles stay dark (they hold video); everything around them is light.

### Accessibility (WCAG 2.1 AA)
| Criterion | Fix |
| --- | --- |
| 1.4.3 Contrast (Minimum) | Every theme colour pair is ≥ 4.5:1 text / ≥ 3:1 UI (verified by `tools/contrast-check.js`). |
| 1.4.3 for user colours | Users pick their own chat text colour and nickname background. The content script measures each one against its real background and darkens/lightens it just enough to reach 4.5:1 (7:1 in high contrast) while keeping the hue. |
| 1.4.1 Use of Colour | Role badges (super/mod/op) keep their colour **and** their text label; the colour-only valid/invalid input glow is removed. |
| 1.4.4 Resize Text / 1.4.10 Reflow | The site's `user-scalable=0` viewport is rewritten so pinch-zoom works; the popup adds a text-size control. |
| 1.4.11 Non-text Contrast | Focus rings, borders, toggles, and scrollbars are ≥ 3:1. White SVG icons are inverted so they show on white. |
| 2.1.1 Keyboard | Clickable `<div>`/`<span>`/`<a>`-without-href controls (pagination, carousel arrows, user rows, context-menu items, option dropdown items) get `tabindex`, a role, and Enter/Space activation. Hover-only dropdowns open on keyboard focus. Escape closes menus. |
| 2.4.1 Bypass Blocks | A "Skip to main content" link is injected. |
| 2.4.3 Focus Order | When a modal opens, focus moves into it. |
| 2.4.7 Focus Visible | A 3px ring replaces the site's `outline: none`. |
| 1.3.1 Info & Relationships / 4.1.2 Name, Role, Value | Landmarks (`navigation`, `main`, `contentinfo`, `region`, `log`, `toolbar`), `dialog` + `aria-modal` on the modal, `menu`/`menuitem` on context menus, `aria-expanded` on dropdown triggers, `aria-current` on the active page, labels for placeholder-only inputs, orphan `<label>`s associated with their inputs, descriptive `alt` on previews, and readable names for the broadcast/user count badges. |
| 4.1.3 Status Messages | The login error banner is `role="alert"`; the unread-messages pill is `role="status"`; the chat log is a polite live region. |
| 2.3.3 Animation from Interactions | Honors `prefers-reduced-motion` and the popup toggle. |

## Files

```
manifest.json          MV3 manifest (content script + popup + storage)
styles/theme.css       The theme. Every rule scoped to html.sca11y and uses !important
                       because the site's own CSS and inline user themes would otherwise win.
scripts/content.js     Settings, contrast fixer, keyboard/ARIA fixes (MutationObserver-driven).
popup/                 Settings UI.
tools/contrast-check.js  `node tools/contrast-check.js` — fails if any palette pair drops below AA.
icons/make-icons.py    Regenerates the PNG icons (needs Pillow).
```

## Known limits

- The room's header/topic bar keeps the site's fixed 19px height (the site's JavaScript positions the video area beneath it), so the topic text is 12px there.
- Custom room backgrounds and chat-panel colours set in the site's Theme Settings are intentionally flattened to white; the user's message colour survives as a left accent bar on each message and as the (contrast-corrected) text colour.
- The extension cannot change the site's HTML nesting (for example, `<a>` elements placed directly inside `<ul>`), only add attributes to it.
- Tested against the site as of September 2026 (`home.css?v=3.1`, `style.css?v=3.0`, `room.js?v=3.1.6`). If the site ships a redesign, selectors may need updating.

## Local preview without installing

`test/site/pages/` holds copies of the site's real markup and stylesheets (directory, login, register, and a chat room seeded with sample users and messages). Serve the repo root and open a page; `test/harness.js` loads `theme.css` and `content.js` exactly as Chrome would:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/test/site/pages/room.html`. Query flags: `?off` (site as shipped), `?hc` (high contrast), `?scale=130` (text size), `?modal`, `?menu`.
