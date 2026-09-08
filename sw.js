/* 花未了：版本化离线缓存。只清理本项目缓存，不覆盖其他站点的数据。 */
const CACHE = 'hwl-v3';
const ROOT = new URL('./', self.registration.scope);
const local = path => new URL(path, ROOT).href;
const HOME_PATHS = new Set([ROOT.pathname, new URL('index.html', ROOT).pathname]);
const CORE = [
  './', './index.html', './404.html', './manifest.webmanifest',
  './assets/css/site.css', './assets/js/config.js', './assets/js/app.js',
  './assets/icons/favicon.ico', './assets/icons/apple-touch-icon.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/image/图标.png', './assets/image/主背景.png', './assets/image/404页面.png',
  './assets/image/青辉石.png', './assets/image/mika1.png', './assets/image/mika2.png',
  './assets/Audio/遥遥领先.wav', './assets/Audio/这么好的车.wav', './assets/Audio/啊这个这个.wav'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(local))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE && /^(hwl-|zzl-)/.test(key)).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if(event.request.mode === 'navigate'){
    event.respondWith((async () => {
      try{
        const response = await fetch(event.request);
        // 仅成功的首页写入首页缓存，避免 404 或其他路由污染离线首页。
        if(response.ok && HOME_PATHS.has(url.pathname)){
          const cache = await caches.open(CACHE);
          await cache.put(local('./index.html'), response.clone());
          await cache.put(local('./'), response.clone());
        }
        return response;
      }catch(_){
        if(HOME_PATHS.has(url.pathname)){
          return await caches.match(local('./index.html')) || Response.error();
        }
        const notFound = await caches.match(local('./404.html'));
        return new Response(notFound ? await notFound.text() : '页面不存在 · 花未了', {
          status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    })());
    return;
  }
  // 静态文件先出完整缓存；Range 请求也可回完整 200 响应，避免缓存不完整音频。
  const refresh = fetch(event.request).then(async response => {
    if(response.status === 200){
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(() => null);
  event.waitUntil(refresh.then(() => {}));
  event.respondWith(caches.match(event.request).then(async hit => hit || await refresh || Response.error()));
});
