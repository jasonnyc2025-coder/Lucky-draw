/* จับรางวัล · 抽奖 — service worker
   改动这个文件时把 VERSION 加一,用户下次打开会收到更新提示。 */
const VERSION = 'v10';
const CORE = 'draw-core-' + VERSION;
const RUNTIME = 'draw-runtime-' + VERSION;

/* 本体文件:安装时全部抓下来,之后完全离线可用 */
const CORE_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-64.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CORE)
      .then((c) => c.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CORE && k !== RUNTIME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  /* 页面问「你缓存的是哪个版本」。页面版本和这个对不上 = 用户看到的是旧缓存。 */
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'sw-version', version: VERSION });
});

/* 外部资源:泰文/中文字体、Excel 解析库。
   第一次联网打开时缓存下来,之后断网照样可用。 */
const RUNTIME_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* 外部资源:缓存优先,后台顺便更新 */
  if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(
      caches.open(RUNTIME).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  /* 同源:网络优先(拿到新版就换),断网回落缓存 */
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CORE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
  }
});
