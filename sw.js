// Spinoza Lab service worker: keeps the site usable with the Wi-Fi off.
const CACHE = "spinoza-v1";
const CORE = ["./", "index.html", "lab.html", "style.css", "fonts.css", "lab.js", "assets/lens.svg"];
const CACHEABLE = [location.origin, "https://esm.run", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://fonts.gstatic.com"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (e.request.method !== "GET" || !CACHEABLE.some(p => url.startsWith(p))) return; // model weights are cached by WebLLM itself
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
