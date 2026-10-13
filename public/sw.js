/* Public game assets only. Customer, OAuth and reward responses never enter CacheStorage. */
const BUILD = /* PFUSCH_OFFLINE_BUILD */ null;
const PREFIX = 'pfusch-offline-v1-';
const CACHE = PREFIX + (BUILD?.version ?? 'unbuilt');
const READY = '/__pfusch_offline_ready__';
const assets = new Map([...(BUILD?.core ?? []), ...(BUILD?.optional ?? [])].map((asset) => [asset.url, asset]));
const keyFor = (asset) => `${asset.url}?__pfusch_asset=${asset.revision}`;
let earlierCaches;

async function oldCaches() {
  return earlierCaches ??= (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE).reverse().slice(0, 2);
}
async function cacheAsset(cache, asset) {
  const key = keyFor(asset);
  if (await cache.match(key)) return;
  for (const oldName of await oldCaches()) {
    const old = await (await caches.open(oldName)).match(key);
    if (old) { await cache.put(key, old); return; }
  }
  const response = await fetch(asset.url, { credentials: 'omit', cache: 'reload' });
  if (!response.ok || response.redirected || response.type === 'opaque'
    || (asset.url !== '/offline.html' && response.headers.get('content-type')?.includes('text/html')))
    throw new Error('Public offline asset unavailable');
  await cache.put(key, response);
}
async function cacheBatch(cache, list) {
  let index = 0;
  await Promise.all([0, 1].map(async () => {
    while (index < list.length) await cacheAsset(cache, list[index++]);
  }));
}
self.addEventListener('install', (event) => {
  if (!BUILD) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cacheBatch(cache, BUILD.core);
    await cache.put(READY, new Response(JSON.stringify({ ready: true, version: BUILD.version, bytes: BUILD.coreBytes })));
    // An update waits for open game tabs to close, preserving the current ride.
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const older = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE).reverse();
    await Promise.all(older.slice(2).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function offlineShell() {
  const asset = assets.get('/offline.html');
  const shell = asset && await (await caches.open(CACHE)).match(keyFor(asset));
  return shell ?? new Response('Öffne das Spiel einmal mit Internet, um es offline zu speichern.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
async function navigation(request) {
  let timer;
  try {
    // Cache only the build-generated public offline shell, never a live HTML response.
    return await Promise.race([
      fetch(request).then((response) => { if (!response.ok) throw new Error('Offline'); return response; }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Offline')), 3500); }),
    ]);
  } catch { return offlineShell(); }
  finally { clearTimeout(timer); }
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!BUILD || request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Explicit path allowlist excludes /api, /auth, checkout and arbitrary pages.
  if (request.mode === 'navigate' && ['/', '/index.html', '/offline.html'].includes(url.pathname)) {
    event.respondWith(navigation(request));
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) return;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(keyFor(asset));
      if (cached) return cached;
      await cacheAsset(cache, asset);
      return (await cache.match(keyFor(asset))) ?? Response.error();
    } catch { return fetch(request); }
  })());
});
self.addEventListener('message', (event) => {
  if (!BUILD || !event.ports[0] || !event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  if (!['PFUSCH_OFFLINE_STATUS', 'PFUSCH_OFFLINE_WARM'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (event.data.type === 'PFUSCH_OFFLINE_WARM' && Array.isArray(event.data.urls)) {
      const urls = [...new Set(event.data.urls.filter((url) => typeof url === 'string'))].slice(0, 48);
      const selected = urls.map((url) => {
        try { const parsed = new URL(url, self.location.origin); return parsed.origin === self.location.origin ? assets.get(parsed.pathname) : null; }
        catch { return null; }
      }).filter(Boolean);
      // A missing optional garment image cannot invalidate the playable core.
      for (const asset of selected) await cacheAsset(cache, asset).catch(() => {});
    }
    const marker = await cache.match(READY);
    event.ports[0].postMessage(marker ? await marker.json() : { ready: false });
  })());
});
