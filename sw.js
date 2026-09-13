/* LifeOS service worker — makes the app installable and work offline.
 *
 * Strategy
 *  - App shell (HTML/CSS/JS/icons): network-first, cache fallback, so a new
 *    deploy is picked up on the next load but the app still opens offline.
 *  - Web fonts (Google Fonts): stale-while-revalidate, so the app keeps its
 *    typography with no connection.
 *  - Navigations: always resolve to index.html (single-page app).
 *
 * When you ship a change, bump CACHE_VERSION so old caches are cleaned up.
 */
const CACHE_VERSION = "v2";
const CACHE = `lifeos-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./life.css",
  "./life.js",
  "./pwa-install.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // one bad URL must not abort the whole install
      .then((cache) =>
        Promise.all(
          APP_SHELL.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("lifeos-") && key !== CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Let the page trigger an immediate update:  reg.waiting.postMessage("skip-waiting")
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // SPA navigations -> app shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() =>
          caches
            .match("./index.html")
            .then((cached) => cached || caches.match("./"))
        )
    );
    return;
  }

  // Web fonts: serve from cache, refresh in the background.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response && response.status === 200) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Ignore everything else cross-origin (e.g. the Supabase CDN).
  if (url.origin !== self.location.origin) return;

  // Same-origin assets: network-first with cache fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.destination === "document") return caches.match("./index.html");
          return new Response("", { status: 504, statusText: "Offline" });
        })
      )
  );
});
