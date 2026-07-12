# BackScam

Open-source browser extension (Chrome, Manifest V3) that uses DOM-based
heuristics to detect made-for-advertising (MFA) style websites, and
quietly redirects the user away from them — instead of blocking the
site outright.

## Why silent redirection instead of blocking?

Blocking is easy for site operators to detect and work around. Silent
redirection directly hurts the site's conversion rate (fewer ad
impressions, fewer accidental clicks), which makes running this kind
of site less economically viable over time.

## How it works

1. `content.js` evaluates several DOM-based signals on every loaded page:
   - ad density
   - number of known ad-network scripts
   - aggressive, full-screen popup overlays
   - content-to-clickable-element ratio
   - redirect chain length (measured by `background.js`)
2. If the combined score crosses a threshold, the extension waits
   briefly and re-checks (to filter out false positives).
3. If the suspicion is confirmed, a brief toast notification appears
   ("BackScam: suspicious site avoided"), then the user is taken back
   to the previous page (or a new tab, if there's no browsing history).

## File structure

- `manifest.json` — Manifest V3 configuration
- `background.js` — redirect chain tracking, navigation logic
- `content.js` — heuristic scoring, toast notification
- `popup.html` / `popup.js` — on/off toggle UI
- `lists/domains.json` — currently unused, reserved for future use

## Installing in developer mode (Chrome)

1. Download/clone this repo
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select the project folder

## Status

🚧 Actively in development and testing. Not yet published to the
Chrome Web Store.

## License

To be determined before public release.
