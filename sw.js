/* Yomitaku 离线 Service Worker（放在站点根目录以获得全站 scope）
   - 页面导航：网络优先，离线回落缓存 —— 部署后能尽快拿到引用了新 ?v= 哈希的新页面
   - 其余同源资源：缓存优先。静态资源在 index.html 里带内容哈希 ?v=，更新后 URL 变化自然穿透缓存
   - 跨域请求（Google Fonts）不拦截，交给浏览器
   CACHE 缓存名由 scripts/version.mjs 按本文件内容哈希自动改写（本地/CI 部署前运行）：
   逻辑一变缓存名就变，旧缓存随 activate 自动清理，无需手动升版本 */
var CACHE = 'yomitaku-6d3aba7a';
/* 预缓存强制与服务器核对（no-cache），避免安装时拿到浏览器 HTTP 缓存里的旧页面。
   注意用 ./ 相对路径：GitHub Pages 部署在 /jlpt-n1-Yomitaku/ 子路径下 */
var PRECACHE = ['./', './index.html', './manifest.webmanifest', './public/logo.svg'].map(function (u) {
  return new Request(u, { cache: 'no-cache' });
});

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
      /* no-cache：绕过浏览器 HTTP 缓存的新鲜期，联网时每次都与服务器核对，
         否则 GitHub Pages 10 分钟的 max-age 内会当成"网络结果"返回旧页面 */
      fetch(req, { cache: 'no-cache' }).then(function (res) {
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
