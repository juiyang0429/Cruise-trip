/* 郵輪網站的離線小幫手（Service Worker）
   ・網站本身（index.html、config.js、圖片）：先拿手機裡存的 → 秒開；同時背景去 GitHub 抓新版，下次打開就是新的
   ・字型、3D 程式（cdnjs）：存一次就一直用
   ・商品圖：看過（或網頁叫它預先存）就存起來，店員卡沒網路也有圖
   ・試算表資料（script.google.com）：不經過這裡，網頁自己會存一份在手機 */
const PFX = 'cruise-trip-';
const V = PFX + 'v6';
const IMG = PFX + 'img';
const MAXIMG = 160;
const CORE = ['./', 'config.js', 'family.png', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];
const ROOT = new URL('./', self.registration.scope).href;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await Promise.all(CDN.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    let upgraded = false;
    for (const k of await caches.keys()) if (k.startsWith(PFX) && k !== V && k !== IMG) { await caches.delete(k); upgraded = true; }
    await self.clients.claim();
    if (upgraded) notify();                                // 舊版小幫手換掉了 → 請網頁提示「有新版本」
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)script\.google(usercontent)?\.com$/.test(url.hostname)) return;          // 試算表：一律走網路
  if (url.origin === location.origin) {
    if (!url.href.startsWith(ROOT)) return;                                          // 同網域的其他專案不管
    e.respondWith(sameOrigin(e, req, url));
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com' || /^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, V));
    return;
  }
  if (req.destination === 'image') e.respondWith(imageSWR(e, req));
});

/* 網站檔案：先給手機裡的，背景更新；網站有新版本就通知網頁 */
async function sameOrigin(e, req, url) {
  const c = await caches.open(V);
  const nav = req.mode === 'navigate' || url.href === ROOT || /\/index\.html$/.test(url.pathname);
  const key = nav ? ROOT : url.origin + url.pathname;
  const hit = await c.match(key, { ignoreSearch: true });
  const old = hit ? hit.clone() : null;                    // 先複製一份：hit 會直接交給網頁用掉
  const net = fetch(nav ? ROOT : req, { cache: 'no-cache' }).then(async res => {
    if (res && res.ok && res.type === 'basic') {
      if (old && (nav || /config\.js$/.test(url.pathname))) {
        const [a, b] = await Promise.all([old.text(), res.clone().text()]);
        if (a !== b) await tell(e.resultingClientId || e.clientId);
      }
      await c.put(key, res.clone());
    }
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; }
  catch (err) { return (await c.match(ROOT)) || Response.error(); }
}

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
  return res;
}

/* 圖片：有存就先給，同時背景重抓（圖換了也會自己更新） */
async function imageSWR(e, req) {
  const c = await caches.open(IMG);
  const hit = await c.match(req.url);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) c.put(req.url, res.clone()).then(() => trim(c)).catch(() => {});
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

async function trim(c) {
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAXIMG; i++) await c.delete(keys[i]);
}

/* 告訴「剛打開的那一頁」有新版本（頁面可能還在載入，等它準備好再說） */
async function tell(id) {
  for (let i = 0; i < 24 && id; i++) {
    const cl = await self.clients.get(id);
    if (cl) { cl.postMessage({ type: 'updated' }); return; }
    await new Promise(r => setTimeout(r, 250));
  }
  await notify();
}
async function notify() {
  for (const cl of await self.clients.matchAll({ type: 'window' })) cl.postMessage({ type: 'updated' });
}

/* 網頁拿到購物清單後會把商品圖網址傳過來 → 沒存過的先存 */
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'warm' && Array.isArray(d.urls)) e.waitUntil(warm(d.urls.slice(0, MAXIMG)));
});
async function warm(urls) {
  const c = await caches.open(IMG);
  for (const u of urls) {
    try {
      if (!/^https:\/\//.test(u) || await c.match(u)) continue;
      const res = await fetch(u, { mode: 'no-cors', credentials: 'include' });
      if (res && (res.ok || res.type === 'opaque')) await c.put(u, res);
    } catch (_) {}
  }
  await trim(c);
}
