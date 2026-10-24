// 離線快取：自己的檔案「先抓網路、抓不到才用快取」，這樣更新遊戲後大家馬上拿到新版；
// PeerJS 這種固定版本的外部套件「先用快取」。連線本身（房間、玩家資料）不會被快取。
const CACHE = 'nongshop-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'sim.js', 'render.js', 'main.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([...SHELL, PEERJS])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url === PEERJS) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
