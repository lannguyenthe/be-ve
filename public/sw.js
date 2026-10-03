/*
 * Service worker: cho app chạy offline.
 *
 * Chiến lược: "network first, cache fallback" — có mạng thì luôn lấy bản mới
 * (bạn deploy là bé có bản mới ngay), mất mạng thì dùng bản đã lưu.
 *
 * Khi đổi cách cache, tăng VERSION để xoá cache cũ.
 */
const VERSION = 'be-ve-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html')),
      ),
  );
});
