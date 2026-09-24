# Privacy

StumbleChat Accessible changes how stumblechat.com looks and works in your own browser. It does not collect, send, or sell anything about you or anyone else.

## What it stores, and where

Everything stays in your browser's extension storage:

| What | Where | Why |
| --- | --- | --- |
| Your settings (theme, text size, layout and chat options) | `chrome.storage.sync` | So your choices follow you if you use browser sync. |
| Favourite rooms, hidden rooms, the last 12 rooms you opened | `chrome.storage.local` | Directory favourites, hiding, and "Recently visited". |
| People you muted for yourself, and theatre mode | `chrome.storage.local` | So "Mute for me" and theatre mode last between visits. |
| Your camera order in each room | the page's own `localStorage` on stumblechat.com | So a room's cameras stay in the order you chose. |
| Whether StumbleChat's page looked different than expected | `chrome.storage.local` | So the popup can tell you why layout changes paused. |

Uninstalling the extension deletes its storage. Clearing stumblechat.com's site data deletes the camera orders.

## Network

The extension talks only to stumblechat.com, and only in ways the site itself does:

- **Loading more rooms.** When you scroll to the end of the directory or press "Load more rooms", it asks the site's own room-list address for the next page, as the site's page buttons would.
- **Room previews for those extra rooms.** It loads the same preview image the site shows on its own room cards.

It never looks up other people's profiles, never sends messages, and never contacts any other server. The page's Display button only asks the extension to open its own settings popup. No analytics, no tracking, no remote code.

## Permissions

- **storage** (required): saving the settings and lists above.
- **notifications** (optional, off by default): only if you turn on "Desktop alerts" in the popup, and only after your browser asks you. It shows a desktop notification when someone mentions you or sends you a private message while the room is in the background. The notification text stays on your computer.

The extension runs only on stumblechat.com.

## Contact

Open an issue on the project's GitHub repository.
