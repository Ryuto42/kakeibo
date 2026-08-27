const CACHE_NAME = 'kakeibo-pwa-v7';

const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './icon.png',
    './icon-512.png',
    './manifest.json'
];

const CDN_ASSETS = [
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Cloudflare Access のログイン画面やエラーページを、アプリ本体として
// キャッシュしてしまわないよう保存できるレスポンスを絞り込む
function isCacheable(res) {
    return !!res && res.ok && !res.redirected && (res.type === 'basic' || res.type === 'cors');
}

// addAll は1つでも失敗すると全体が失敗するため、1件ずつ入れる
async function precache(cache, urls) {
    await Promise.all(urls.map(async (url) => {
        try {
            const res = await fetch(url, { cache: 'reload' });
            if (isCacheable(res)) await cache.put(url, res);
        } catch (e) {
            // 取得できなかったものは諦めて次回の fetch 時に取り込む
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await precache(cache, CORE_ASSETS);
        await precache(cache, CDN_ASSETS);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (e) { return; }

    // GAS の API と Cloudflare Access の認証まわりは必ずネットワークへ通す
    if (url.hostname.includes('script.google.com') || url.pathname.startsWith('/cdn-cgi/')) return;

    // 画面遷移は常に最新を取得し、オフラインのときだけキャッシュにフォールバックする
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const res = await fetch(req);
                if (isCacheable(res)) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put('./index.html', res.clone()).catch(() => {});
                }
                return res;
            } catch (e) {
                const cached = await caches.match('./index.html', { ignoreSearch: true });
                return cached || Response.error();
            }
        })());
        return;
    }

    // 静的ファイルはキャッシュ優先で返しつつ、裏側で更新する
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreVary: true });
        const fromNetwork = fetch(req).then((res) => {
            if (isCacheable(res)) cache.put(req, res.clone()).catch(() => {});
            return res;
        }).catch(() => cached);
        return cached || fromNetwork;
    })());
});
