// Service worker: делает Freefield устанавливаемым и открывает его без интернета.
// Файлы приложения — «сначала сеть» (обновления приходят сразу), шрифты — из кэша.
// Запросы к сервисам генерации и к компьютеру (/api/, /mcp) не кэшируются и идут напрямую:
// там секретный ключ, свежие статусы и видео по сотне МБ (v3 их кэшировал — смена версии кэш чистит).
const CACHE = 'freefield-v6';   // v5: страница разбита на css/ и js/; v6: голос персонажа в серии
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './css/app.css', './js/core.js', './js/services.js', './js/gallery.js', './js/m3d.js', './js/montage.js', './js/echo.js', './js/controls.js', './js/hub.js', './js/scn.js', './js/assets.js', './js/chars.js', './js/write.js', './js/init.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('.apk')) return;   // установщик Android не кэшируем
  if (url.pathname.startsWith('/api/') || url.pathname === '/mcp') return;   // связь с компьютером — всегда напрямую
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => res.ok ? put(req, res) : res)
      .catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => put(req, res))));
  }
});
