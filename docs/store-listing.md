# Store listing (Chrome Web Store and Firefox Add-ons)

Text and answers ready to paste. Upload the zip from `npm run package` (`dist/…-chrome.zip` for Chrome and Edge, `dist/…-firefox.zip` for Firefox).

## Name

StumbleChat Accessible

## Summary (132 characters max)

A clean light or dark theme for StumbleChat, with accessibility fixes and layouts that work on phones and in crowded rooms.

## Description

StumbleChat Accessible restyles stumblechat.com so it is easier to read and use, on any screen.

**Look**
- A clean light theme, a full dark mode, or follow your system.
- High contrast, larger text, and reduced motion options.
- Everyone's custom chat colours are kept but adjusted until they are readable.

**Rooms**
- Cameras fill the space. In crowded rooms on phones, the people talking most recently are shown large and everyone else as name chips.
- Per-camera buttons: mute for me, pin, full screen.
- Theatre mode, rearrangeable cameras, a clear open-mic switch, and an "Exit room" button.
- Mentions of your name are highlighted, with optional desktop alerts.
- Private-message tabs, a Send button on phones, and tidy join/leave lines.

**Directory**
- Search rooms, star favourites, hide rooms, and sort by people on cam, people in the room, or name.
- More rooms load as you scroll.

**Accessibility (WCAG 2.2 AA)**
- Every button and menu works from the keyboard, including the camera and user menus, dialogs, and push-to-talk (hold Space).
- Visible focus, screen-reader names, and chat announcements you control.
- Pinch-zoom works again on phones.

No tracking, no data collection. Runs only on stumblechat.com.

## Category

Accessibility

## Single purpose (Chrome)

Improves the appearance, accessibility, and usability of stumblechat.com.

## Permission justifications (Chrome)

- **storage:** saves the user's settings, favourite and hidden rooms, and recently visited rooms.
- **notifications (optional):** shows a desktop notification for mentions and private messages, only after the user turns on "Desktop alerts" and grants it.
- **Host access (content scripts on stumblechat.com):** restyles the site and adds keyboard and screen-reader support.
- **Remote code:** none. All code ships in the package.

## Data use disclosures (Chrome)

- Collects: nothing.
- Sells or transfers data: no.
- Privacy policy: link to `PRIVACY.md` in the repository.

## Firefox notes

- Add-on id: `stumblechat-accessible@packjc` (set in the Firefox package's manifest by `tools/package.js`).
- Minimum version: Firefox 121 on desktop and Android.
- Source code: this repository; there is no build step, so the uploaded files are the source.

## Screenshots to upload

From `docs/screenshots/`, rendered from the fixture pages (made-up users): `room-light.png`, `room-dark.png`, `directory-after.png`, `modal-theme.png`, `settings.png`. Chrome wants 1280×800 or 640×400; render with `--window-size=1280,800`.
