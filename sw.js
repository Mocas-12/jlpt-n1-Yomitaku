/* Yomitaku 离线 Service Worker（放在站点根目录以获得全站 scope）
   - 页面导航：网络优先，离线回落缓存 —— 部署后能尽快拿到引用了新 ?v= 哈希的新页面
   - 其余同源资源：缓存优先。静态资源在 index.html 里带内容哈希 ?v=，更新后 URL 变化自然穿透缓存
   - 跨域请求（Google Fonts）不拦截，交给浏览器
   CACHE 缓存名由 scripts/version.mjs 改写：该脚本同时把「index.html 资产指纹」写入本文件
   的 ASSETS 行并参与缓存名哈希——任何分片/样式/脚本更新都会换缓存名，旧缓存随 activate
   全量清理（否则旧 ?v= 条目会在同一缓存里永久累积） */
var CACHE = 'yomitaku-259ae069';
var ASSETS = '0075329c'; // scripts/version.mjs 写入 index.html 的资产指纹（参与 CACHE 哈希）
/* 预缓存强制与服务器核对（no-cache），避免安装时拿到浏览器 HTTP 缓存里的旧页面。
   注意用 ./ 相对路径：GitHub Pages 部署在 /jlpt-n1-Yomitaku/ 子路径下 */
var PRECACHE = ['./', './index.html', './manifest.webmanifest', './public/logo.svg'].map(function (u) {
  return new Request(u, { cache: 'no-cache' });
});

self.addEventListener('install', function (e) {
  /* 首装即离线：页面样式与脚本（带 ?v= 的 css/js 分片）在 SW 接管前已被浏览器加载过，
     不会进运行时缓存——install 时解析 index.html 把本轮资产一并预缓存，
     否则"首次访问 → 安装 → 立即离线"会得到无样式无脚本的空壳 */
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return c.addAll(PRECACHE).then(function () {
          return fetch('./index.html', { cache: 'no-cache' })
            .then(function (res) { return res.text(); })
            .then(function (html) {
              var urls = [];
              html.replace(/(?:src|href)="([^"?]+)\?v=[^"]*"/g, function (m, u) {
                if (!/^https?:/.test(u)) urls.push('./' + u);
                return m;
              });
              return c.addAll(urls.map(function (u) { return new Request(u, { cache: 'no-cache' }); }));
            })
            .catch(function () { /* index.html 拉取失败不阻塞安装，走运行时缓存兜底 */ });
        });
      })
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
