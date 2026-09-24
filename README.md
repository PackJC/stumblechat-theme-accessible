# StumbleChat Accessible

A browser extension (Chrome, Edge, Brave, Firefox) that gives [stumblechat.com](https://stumblechat.com) a clean light or dark theme, fixes its biggest accessibility problems so it meets WCAG 2.2 AA, and makes rooms work on phones and with twenty-five cameras at once.

StumbleChat ships as white text on black with translucent panels, neon form glows, hidden scrollbars, `outline: none` on every control, a viewport that blocks pinch-zoom, and user-picked chat colours that are often unreadable. This extension rewrites all of that on the fly: white pages, dark text, proper buttons and forms, a visible focus ring, keyboard access to every control, screen-reader landmarks, and a contrast fixer that keeps everyone's custom chat colours but nudges them until they pass 4.5:1.

No tracking, no build step. The only required permission is `storage`, for your settings; desktop notifications are optional. See [PRIVACY.md](PRIVACY.md).

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

**Turning it off:** click the toolbar icon and switch off **Turn on StumbleChat Accessible**, or disable the extension on `chrome://extensions`.

**Firefox:** run `npm run package` and load `dist/stumblechat-accessible-<version>-firefox.zip` from `about:debugging` > This Firefox > Load Temporary Add-on (Firefox 121 or newer, desktop or Android).

## Settings

**On the page:** the **Display** button (in the room toolbar, and at the right of the site's top bar on other pages) changes Light / Dark / Auto, text size, high contrast, reduce motion and the glass look instantly. "More settings" opens the full popup.

**Everything else:** click the extension's toolbar icon to open the popup. Changes apply instantly to any open StumbleChat tab.

| Setting | What it does |
| --- | --- |
| Turn on StumbleChat Accessible | Turns everything on or off. |
| **Look** | |
| Appearance | Light, Dark, or Follow system. |
| Text size | Scales chat, cards, forms, and navigation text from 100% to 150%. |
| High contrast | A 7:1 palette, and user chat colours re-fitted to 7:1. Works in light and dark. |
| Reduce motion | Stops fades, pulses, and the speaking-badge animation. Also follows your system setting. |
| Frosted glass look | Translucent panels over a soft gradient on every page. Off, with High contrast, or when your system asks for reduced transparency, panels are solid. |
| **Directory** | |
| Load more rooms as you scroll | The next page of rooms loads below the last card once you scroll, with a "Load more rooms" button and a page counter. |
| Order rooms by | People on cam (the default), people in the room, name, or the site's own order. Favourites always come first. |
| Hide rooms that mention | Rooms whose name or topic contains one of these words are hidden (and counted, with a "Show hidden" link). |
| **Room** | |
| Speaker stage | On phones (default), Always, or Off. In crowded rooms the people talking most recently are shown large and everyone else as name chips. |
| Cameras on the stage | 1, 4, 6 (default), or 9. |
| Cameras fill the space | Sizes camera tiles to use the whole video area instead of the site's 4:3 boxes. |
| Rearrange cameras | Drag a camera (on a touchscreen, press and hold), or focus one and press Alt with the arrow keys. The order is remembered per room, by person. |
| Reset camera layout | Puts cameras back in the site's own order. |
| **Chat** | |
| Screen reader announcements | Every new message, mentions and private messages only, or off. |
| Also count as a mention | Extra words (your nickname always counts). |
| Desktop alerts | Optional. A desktop notification for mentions and private messages while the room is in the background. Your browser asks for permission the first time. |
| Chat text size, Chat spacing, Always show message times, Fold join and leave messages | Chat display. |

## What it changes

### Everywhere
- A clean light theme, a full dark mode, or follow your system; high contrast, larger text, and reduced motion.
- The site's black text outlines, see-through black panels, neon form glows, hidden scrollbars, and slow fades are gone.
- Buttons are colour-coded: green to go, red to stop or delete, grey for everything else.
- A frosted-glass look: translucent, blurred panels over a soft gradient. Text only ever sits on a panel, and `tools/contrast-check.js` blends every panel colour over white, black, and the logo's colours to prove text still passes 4.5:1.
- Headings, room names and the brand use Outfit, an open-licence display face bundled in `fonts/`; body text stays on the system font.
- Pinch-zoom works on phones again, and the page shrinks above the on-screen keyboard instead of hiding the message box.
- Signed in, your name stays at the right edge of the top bar with the **Display** button beside it, and the account menu opens right under it. The name is a keyboard button that says whether the menu is open; Escape closes it.

### Directory
- Each room is its own glass card with the counts as labelled pills ("20 on cam", "38 in room"), a centred topic, and a whole-card click target (Ctrl or middle click opens a new tab).
- A toolbar above the rooms: search by name or topic, a count, and recently visited rooms. Rooms are ordered by people on cam; the popup can change that.
- Star a room to keep it at the top, or hide it; both buttons appear when you hover over (or tab into) a card. Hidden rooms and keywords stay in view as chips in a **Hidden** row under the search box; click a chip to bring it back, or use **Unhide all**. **Hide rooms by keyword** opens a small box beside it. Hiding a room also shows an **Undo** notice for a few seconds.
- More rooms load as you scroll, using the site's own room list, only after you start scrolling. A rate-limited answer from the site pauses loading for a minute and says so.
- The site's "exceeded rate limits" and error headings become readable message cards.
- **Back to top** is a round frosted button above the footer. It scrolls smoothly (instantly with reduce motion) and works with Enter and Space, which the site's own button ignored.
- The grid is a CSS grid, so it keeps its order and even gaps at any width; one full-width column on phones.
- The empty "Promoted rooms" section is hidden (the site ships it empty); the Promote button moves under "Public rooms" as a clear pill.

### Joining a room
- The site's "VERIFY..." dialog with a "VERIFY" button (which unlocks room sound and starts the connection) becomes a "Join <room>" card with one "Join room" button and a line saying your camera and microphone stay off until you start broadcasting.
- "Gathering permissions", "Connecting..." and error dialogs get plain titles and the same card look.

### Chat room
- **Header:** an "Exit room" button and labelled Theatre, Games, Media, Options and Display buttons in one aligned row of pills (icon-only when the room is narrow), whose menus sit above the cameras; and a topic line that opens the full topic (the old arrow is gone).
- **User list:** each row takes its role's colour: a soft tint, a coloured left edge, and the role name in a deep matching colour where the badge was (Owner gold, Super blue, Moderator green, Operator red, Muted grey). Every pair is at least 6:1 in light and dark.
- **Cameras:** tiles fill the space at a shared aspect ratio. Each camera has quick buttons for pin, mute for me (remembered), and full screen; they appear while the pointer moves over the camera (or while you are on it with the keyboard) and fade 5 seconds after it stops. The camera and user menus close by themselves 1 second after the pointer leaves them (or 1 second after opening if you never move into them). Pinned cameras are shown large on wide screens. The speaking indicator is a green ring plus a sound-bars badge.
- **Crowded rooms:** on phones (or always, if you choose) a speaker stage shows the six most recent speakers large; everyone else is a name chip you can tap to pin. A speaker keeps their place until they have been quiet for 5 seconds, so tiles do not jump.
- **Mic-only broadcasters** are compact chips instead of black boxes.
- **Theatre mode** hides chat and the user list so cameras get the whole window.
- **Talking:** Talk is green when idle and becomes a white bar with a green frame and moving level bars while you talk. Open mic is a neutral outlined switch that turns amber ("Mic open") when on, and the Talk bar then reads "Mic open · everyone can hear you", so the two never blend.
- **Chat:** messages are clean bubbles; each person's chosen colour is kept as an accent bar and unreadable colours are adjusted. Mentions of your name are marked, with an "@ mentions below" pill. A "New messages" divider and a floating "jump to latest" pill appear when you are scrolled up, and the chat follows your own message after you send. Runs of join and leave lines fold into one.
- **Private messages:** tabs above the chat, with unread counts, and a badge on the phone Users button.
- **Tab title:** "(3) MEATSPACE" while the tab is in the background; "(@3)" when one of them mentions you.
- **Menus:** Kick, Ban and Close Broadcast are marked in red. The volume sliders in the camera menu and Options sit beside their speaker icon, drawn in the text colour so it shows in light and dark mode. Every dialog and menu is restyled.
- **Phones:** video on top with a full-width chat underneath, the user list as a drawer, Talk on its own row, and a Send button. In landscape the chat sits beside the video.

### Accessibility (WCAG 2.2 AA)

| Criterion | Fix |
| --- | --- |
| 1.4.3 Contrast (Minimum) | Every theme colour pair is at least 4.5:1 for text and 3:1 for UI, verified by `tools/contrast-check.js`, including text on glass over the worst-case backgrounds. |
| 1.4.3 for user colours | Each user's message colour and nickname background is measured against its real background and shifted just enough to reach 4.5:1 (7:1 in high contrast), keeping the hue. |
| 1.4.1 Use of Colour | Role badges keep their label; speaking has a ring and an icon; open mic changes colour and wording; the colour-only form glows are gone. |
| 1.4.4 / 1.4.10 Resize and Reflow | Pinch-zoom restored; text size setting; every layout works from 320px wide. |
| 1.4.11 Non-text Contrast | Focus rings, input borders, toggles, and scrollbars are at least 3:1. |
| 1.3.5 Identify Input Purpose | Login, register and password fields carry the right `autocomplete` values so browsers and password managers can fill them. |
| 2.1.1 Keyboard | The site acts on pointer presses, not clicks, so Enter and Space used to do nothing on most room controls. They now send the press a mouse would: user rows, cameras, VERIFY/Join, dialog buttons and the close X, settings switches, private-message tabs, the topic, Start Broadcast, and Talk (hold Space or Enter to talk). |
| 2.1.1 Menus | User and camera menus open with focus on the first item; arrow keys, Home and End move; Escape closes and returns focus. Header dropdowns are disclosure buttons. |
| 2.4.3 Focus Order | Dialogs and the phone user drawer keep Tab inside while open, make the rest of the room inert, close on Escape, and return focus where it was. |
| 2.4.7 Focus Visible | A 3px ring everywhere, including on camera tiles and quick buttons. |
| 2.5.7 Dragging Movements | Cameras move with Alt and the arrow keys as well as by dragging. |
| 2.5.8 Target Size | Header buttons, taskbar controls, chips and quick buttons are at least 24px (most 32 to 48px). |
| 1.3.1 / 4.1.2 Name, Role, Value | Landmarks, dialog semantics, menus and menu items, named switches, spoken status on user rows and cameras ("on cam, on mic, guest, talking"), and labels for every injected control. |
| 4.1.3 Status Messages | One clean announcement per new chat message (or mentions only, or none); history re-renders are silent. Load more, camera moves, favourites and hiding are announced. |
| 2.3.3 Animation from Interactions | Honours `prefers-reduced-motion` and the popup setting. |

## How it works

- `styles/theme.css` and the three feature stylesheets are injected at `document_start`, before the page paints. Every rule is scoped to `html.sca11y` and uses `!important`, because the site's stylesheets and inline user themes would otherwise win.
- `scripts/content.js` is the core: settings, the contrast fixer, keyboard and ARIA fixes, camera dragging, directory load-more, the phone drawer, dialogs, and one `MutationObserver` that routes each change to the part of the page it touched (chat, users, cameras, taskbar, dialogs, directory), so a new chat message does not re-check the whole room. It exposes a small API (`globalThis.SCA11Y`) to the feature scripts.
- `scripts/room-features.js` (stage, fill grid, quick actions, theatre, mic-only chips), `scripts/chat-features.js` (mentions, announcements, PM tabs, composer, folding, display settings), and `scripts/directory-tools.js` (search, sort, favourites, hiding, recent rooms, status cards) build on that API.
- **Site-change detection.** If a StumbleChat update removes a piece of the page the layout relies on, the extension adds `html.sca11y-compat`: layout changes and feature scripts stand down, colours and accessibility fixes stay, and the popup explains.
- `background.js` only shows optional desktop notifications. `popup/` is the settings UI (`chrome.storage.sync`).

## Local preview and tests

`test/site/pages/` holds copies of the site's markup and stylesheets. `test/harness.js` reads `manifest.json` and loads every stylesheet and script in order, as the browser would. The room page reproduces the site's event handling (a window `pointerup` keyed on the event target, `pointerdown` for Talk and Start Broadcast) and counts what the "site" did in `window.__fx`.

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/test/site/pages/room.html`.

Flags on every page: `?off` (site as shipped), `?dark`, `?hc`, `?noglass`, `?scale=130`, and `?set=key:value,...` for any setting (for example `?set=stageMode:always,chatAnnounce:mentions`).

Room page: `?live` (broadcasting taskbar and a private message), `?speaking`, `?cams=24` (that many broadcasters with real test video), `?miconly=3`, `?sim` (people take turns talking), `?joins` (join/leave lines and a mention), `?modal=verify|permissions|connecting|media|theme|client|youtube|profile|twitch|password|nick|roomsettings`, `?menu`, `?breaksite` (triggers site-change detection).

Directory page: mocks the site's room list so "Load more" works; `?ratelimit` (the site's rate-limit message), `?limitmore` (a rate-limited Load more).

Settings page: `?tab=user|chat|avatar|room|privacy`, `?menu`.

Automated checks:

```bash
npm install
npm test
```

`npm test` runs the contrast check and 21 headless-browser tests with real mouse and keyboard input (camera click and drag, keyboard menus, push-to-talk, dialog focus, the join card, camera order across reloads, fill grid, phone stage, chat, header menus above the cameras, the control and menu fades, the Display button, the settings page not tripping site-change detection, site-change detection, and the directory tools). It uses your installed Chrome, or `CHROME_PATH`. The GitHub Actions workflow in `.github/workflows/test.yml` runs the same on every push and builds the store packages.

## Packaging

```bash
npm run package
```

Builds `dist/stumblechat-accessible-<version>-chrome.zip` and `-firefox.zip` from an allowlist of shipping files (the Firefox one carries an add-on id and a background script instead of a service worker). Store text and permission justifications are in `docs/store-listing.md`; the privacy statement is `PRIVACY.md`.

## Files

```
manifest.json                MV3 manifest
background.js                Optional desktop notifications
scripts/content.js           Core: settings, contrast fixer, keyboard/ARIA, layout, change routing
scripts/room-features.js     Stage, fill grid, quick actions, theatre, mic-only chips
scripts/chat-features.js     Mentions, announcements, PM tabs, composer, folding
scripts/directory-tools.js   Search, sort, favourites, hiding, recent rooms, status cards
styles/theme.css             The theme
styles/*-features.css,
styles/directory-tools.css   Styles for the feature scripts
popup/                       Settings popup
fonts/                       Outfit display face (SIL OFL, licence included)
tools/contrast-check.js      Palette verifier
tools/package.js             Builds the Chrome and Firefox zips
test/                        Fixture pages, harness, and headless tests
docs/                        Screenshots and store listing
PRIVACY.md                   What is stored, where, and why
```

## Known limits

- Custom room backgrounds and chat-panel colours from the site's Theme Settings are replaced by the theme. Each user's message colour survives as an accent bar and as the contrast-corrected text colour.
- The extension can change attributes and add its own elements, but it cannot read the site's JavaScript state or WebSocket data. Everything it shows (who is talking, who is on cam) comes from what the page renders.
- The site opens menus and runs almost every room action on a `pointerup` whose target is the control itself. The extension never captures the pointer until a camera drag has really started, and keyboard activation sends the same pointer sequence; anything that retargets those events would break the site's menus.
- The shop and rewards pages need a login, so they are styled from the site's stylesheet rules without a fixture copy.
- Built against the site as of September 2026 (`home.css?v=3.1`, `style.css?v=3.0`, `room.js?v=3.1.6`). If the site changes its page structure, site-change detection pauses the layout changes until the extension is updated.

## Contributing

Open an issue with a screenshot of anything that still looks wrong or is hard to use. Pull requests are welcome; run `npm test` first.
