// Offline-Cache für die App-Dateien. Bei Änderungen VERSION erhöhen.
const VERSION = "v1";
const CACHE = `rezepte-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "parse.js",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Eigene Dateien: erst Netz (für Updates), sonst Cache
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("index.html"))),
    );
    return;
  }

  // Bibliotheken vom CDN: Cache zuerst (Versionen sind fest)
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })),
    );
  }
});
