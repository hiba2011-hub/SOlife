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

## Troubleshooting

### The OS window buttons sit on top of the app header (desktop)

**Fixed.** An earlier build listed `window-controls-overlay` in the manifest's
`display_override`. That mode asks the OS to draw its own title bar over the web
page, which covered the profile/theme buttons in the header. The manifest now
requests plain `standalone`, and `life.css` additionally reserves the title-bar
strip in case an older cached manifest is still in use.

**Already installed?** The manifest is cached per installed app, so you have to
pick up the new one:

1. Close the installed app.
2. Uninstall it (right-click the taskbar/dock icon → Uninstall, or
   `chrome://apps` → right-click → Remove).
3. Open the GitHub Pages URL again and install it fresh.

A push alone will not change an already-installed window's chrome.

### The app looks stale after you push changes

The service worker caches assets on purpose so the app works offline. Bump
`CACHE_VERSION` in `sw.js` (`"v3"` right now) with every release, then reload
twice. If a version is waiting, the in-app **Update** bar appears — click it.

### Install prompt never shows

Check, in order:

1. The URL is `https://` or `http://localhost` — never `file://`.
2. GitHub Pages is actually enabled: repo → **Settings → Pages** → *Deploy from
   a branch* → `main` / `/ (root)`. Pushing files alone does not publish a site.
3. The manifest is reachable at `<your-url>/manifest.json` and returns JSON.
4. On a free GitHub plan, **Pages only works on public repositories.**

### Data does not appear in the installed app

Each origin has its own storage. `http://localhost:8080` and
`https://you.github.io/…` are different origins with separate data, and an
installed app does not share storage with a tab open in another browser. Export
from Settings before switching, then import on the new origin.

### Android: the Install button shows instructions instead of installing

This is **not** a failure — it is Chrome declining to offer its one-tap install
*on that page load*. Chrome only fires `beforeinstallprompt` when it has already
cached the app, and it deliberately stays silent when LifeOS is **already
installed** on the phone.

The reliable path on Android is Chrome's own menu, which always works:

> **⋮** (top-right of Chrome) → **Install app** or **Add to Home screen**

The in-app dialog says exactly this, and the button now reads **"How to"** rather
than **"Install"** when no one-tap prompt has been captured — so it never
promises an install it cannot perform.

If Chrome's menu has no *Install app* entry:

1. Reload the page once and look again (first load caches the app).
2. Check the app drawer — LifeOS may already be installed from an earlier try.
3. Open the URL in a normal tab, not an in-app browser (opening from WhatsApp,
   Instagram, Facebook, etc. runs a WebView where installation is blocked).

### A PWA banner covered an in-app dialog

**Fixed.** The install banner used `z-index: 65` while the app's own modal
backdrop uses `z-index: 50`, so the banner floated above every dialog in LifeOS.
The banner and update bar are now `45` / `46`, and the banner is taken down while
the instructions dialog is open (restored when it closes).
