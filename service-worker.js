// ============================================================
// service-worker.js
// 方針: 完全オフライン優先 (Cache Only) + 手動更新のみ
// ============================================================

var CACHE_NAME = 'aichi-quiz-v4';

// service-worker.js 自体はキャッシュ対象に含めない
// './' と './index.html' の重複も入れない（index.html に一本化）
var ASSETS = [
  './index.html',
  './manifest.json',
  './aichi.topojson',
  './icon-192.png',
  './icon-512.png'
];

// キャッシュキーは完全URL化する
var ASSET_URLS = ASSETS.map(function(path) {
  return new URL(path, self.location).href;
});
var NAV_URL = new URL('./index.html', self.location).href;

var EXPECTED_COUNT = ASSET_URLS.length;

// ─── リトライ付きfetch（最大3回） ───
function fetchWithRetry(url, maxRetry) {
  var attempt = 0;
  function tryFetch() {
    attempt++;
    return fetch(url, { cache: 'no-store' }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    }).catch(function(err) {
      if (attempt < maxRetry) {
        return tryFetch();
      }
      throw err;
    });
  }
  return tryFetch();
}

// ─── 全クライアントへ通知 ───
function notifyClients(payload) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(function(list) {
    list.forEach(function(client) {
      client.postMessage(payload);
    });
  });
}

// ============================================================
// install
// ============================================================
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var successList = [];
      var failList = [];

      return Promise.allSettled(
        ASSET_URLS.map(function(url) {
          return fetchWithRetry(url, 3).then(function(res) {
            return cache.put(url, res).then(function() {
              successList.push(url);
            });
          }).catch(function(err) {
            failList.push(url);
            console.warn('[SW] キャッシュ失敗(リトライ後):', url, err);
          });
        })
      ).then(function() {
        return notifyClients({
          type: 'INSTALL_RESULT',
          cacheName: CACHE_NAME,
          expected: EXPECTED_COUNT,
          successCount: successList.length,
          failCount: failList.length,
          failedUrls: failList
        });
      });
      // ★ skipWaiting() はここで呼ばない（手動更新方式のため）
    })
  );
});

// ============================================================
// activate
// ============================================================
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k)   { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return notifyClients({
        type: 'ACTIVATE_DONE',
        cacheName: CACHE_NAME
      });
    })
  );
});

// ============================================================
// fetch（Cache Only 方式）
// ============================================================
self.addEventListener('fetch', function(event) {
  var req = event.request;

  // GET以外・http(s)以外はスルー
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  // ナビゲーションリクエスト → index.htmlのキャッシュを最優先
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(NAV_URL).then(function(cached) {
        if (cached) return cached;
        // キャッシュに無い場合のみネットワークへフォールバック
        return fetch(req).catch(function(err) {
          console.warn('[SW] navigate fallback失敗:', err);
        });
      })
    );
    return;
  }

  // その他のリソース：キャッシュ優先。無ければネットワークを試すのみ。
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).catch(function(err) {
        console.warn('[SW] キャッシュ無し・ネットワーク失敗:', req.url, err);
        // 何も返さない（積極的なフォールバック動作はしない）
      });
    })
  );
});

// ============================================================
// message（診断 / 手動更新）
// ============================================================
self.addEventListener('message', function(event) {
  var data = event.data || {};

  if (data.type === 'GET_DIAGNOSTIC') {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.keys();
      }).then(function(requests) {
        var urls = requests.map(function(r) { return r.url; });
        var replyPort = event.source;
        if (replyPort) {
          replyPort.postMessage({
            type: 'DIAGNOSTIC_RESULT',
            cacheName: CACHE_NAME,
            expected: EXPECTED_COUNT,
            cachedCount: urls.length,
            urls: urls
          });
        }
      })
    );
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});
