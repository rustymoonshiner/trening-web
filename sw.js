/* Tryb bez internetu dla wersji z Safari: pliki aplikacji w pamięci telefonu.
   Zmiana wersji (CACHE) = telefon pobierze nowe pliki przy najbliższym otwarciu z internetem. */
const CACHE = "trening-1.1";
const FILES = ["./", "index.html", "style.css", "app.js", "vendor/zxing.min.js", "manifest.webmanifest",
               "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // komputer i Open Food Facts – bez cache
  // od razu z pamięci (działa bez zasięgu), w tle pobierz nowszą wersję na następne otwarcie
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || net.then((r) => r || c.match("index.html"));
  })));
});
