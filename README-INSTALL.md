# LifeOS — installing it as an app

LifeOS is now a **PWA (Progressive Web App)**. That means it installs from the
browser onto a phone, tablet or desktop, gets its own icon, opens full-screen
without browser chrome, and keeps working with no internet connection.

## The one rule: it must be served over HTTPS

Browsers only allow installation and offline support on:

- `https://…`
- `http://localhost` (and `127.0.0.1`) — for testing on your own machine
- **not** `file://` — opening `index.html` by double-clicking will never
  install, and the service worker stays disabled. This is a browser security
  rule, not a bug in the app.

## Deploying (pick one — all are fine with these files)

The whole app is static files, so anything that serves a folder works.

**Netlify Drop** — fastest, no account needed to start
1. Go to <https://app.netlify.com/drop>
2. Drag this folder onto the page.
3. You get an HTTPS URL like `https://lifeos-xyz.netlify.app`.

**Vercel**
```
npx vercel deploy --prod
```

**GitHub Pages**
1. Push these files to a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Your app is at `https://<user>.github.io/<repo>/`.

**Local test**
```
cd lifeos
python3 -m http.server 8080
```
Then open <http://localhost:8080>.

## How a user installs it

| Device / browser | What happens |
|---|---|
| **Android** (Chrome, Edge, Samsung) | An **Install** banner appears in-app, plus an *Install app* button in the sidebar and in Settings. One tap installs it. |
| **iPhone / iPad** (Safari) | iOS has no install API, so the app shows **How to** → Share → **Add to Home Screen**. |
| **iPhone via Chrome/Firefox** | The app tells the user to reopen the link in Safari (iOS only allows installation from Safari). |
| **Desktop** (Chrome, Edge) | *Install app* appears in the sidebar and Settings, and Chrome's address-bar install icon appears. |
| **Desktop Firefox** | Firefox cannot install PWAs; the app shows instructions to use Chrome/Edge/Safari. |
| **Already installed** | Every install prompt disappears automatically. |

## What was added

| File | Change |
|---|---|
| `manifest.json` | Rewritten — stable `id`, relative `start_url`/`scope` so it works from any subpath, proper `any` + `maskable` icons, launch shortcuts, display overrides. |
| `pwa-install.js` | **New.** Service-worker registration, the install button/banner, per-platform instructions, update handling, `?page=` deep links. |
| `sw.js` | Rewritten — proper app-shell precache, offline navigation fallback, font caching, old-cache cleanup, update handshake. |
| `index.html` | Added description/application-name meta tags, favicon links, loads `pwa-install.js`; removed the duplicate inline SW registration. |
| `life.css` | Appended styles for the install banner, update bar and instruction steps. |
| `icon-*.png`, `apple-touch-icon.png`, `favicon-*.png` | Regenerated **full-bleed** (no white corners) so Android's round/squircle launcher masks don't clip or letterbox the logo. |

`life.js` was **not modified** — all the install logic lives in its own file.

## Things worth knowing

- **Shortcuts** (long-press the installed icon): My Day, Dashboard, Habits, Money.
- **Updates:** the service worker is network-first, so a new deployment is picked
  up on the next load. If a version is waiting while the app is open, an
  *Update* bar appears instead of leaving stale code running.
- **After changing any file**, bump `CACHE_VERSION` in `sw.js` (currently `"v2"`)
  so returning visitors get the new assets.
- **Data** lives in `localStorage` on each device. Installing does not move data
  between devices, and clearing browser data clears the app data — use
  Settings → Export for backups.
