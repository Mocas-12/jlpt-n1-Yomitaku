/* Yomitaku 离线 Service Worker（放在站点根目录以获得全站 scope）
   - 页面导航：网络优先，离线回落缓存 —— 部署后能尽快拿到引用了新 ?v= 哈希的新页面
   - 其余同源资源：缓存优先。静态资源在 index.html 里带内容哈希 ?v=，更新后 URL 变化自然穿透缓存
   - 跨域请求（Google Fonts）不拦截，交给浏览器
   本文件逻辑有改动时，把 CACHE 版本号 +1 即可清空旧缓存 */
var CACHE = 'yomitaku-v1';
var PRECACHE = ['./', './index.html', './manifest.webmanifest', './public/logo.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
