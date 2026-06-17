var CACHE_NAME = 'aichi-quiz-v3';
// service-worker.js 自体はリストに含めない
var ASSETS = [
  './index.html',
  './manifest.json',
  './aichi.topojson',
  './icon-192.png',
  './icon-512.png'
];

// ─── インストール：個別キャッシュ（1ファイル失敗で全滅しない） ───
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        ASSETS.map(function(url) {
          return fetch(url).then(function(res) {
            if (!res.ok) throw new Error('fetch failed: ' + url);
            return cache.put(url, res);
          }).catch(function(err) {
            console.warn('[SW] キャッシュ失敗:', url, err);
          });
        })
      );
    }).then(function() {
      // キャッシュ完了をページに通知
      self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'CACHE_READY' });
        });
      });
    })
  );
  self.skipWaiting();
});

// ─── アクティベート：古いキャッシュを削除 ───
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ─── フェッチ：GETのみ処理、それ以外はスルー ───
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // オフライン時にキャッシュがあれば返す
        return cached;
      });
    })
  );
});
