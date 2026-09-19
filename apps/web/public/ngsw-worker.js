self.addEventListener('install', function () {
    // Take over immediately rather than waiting for the old worker's controlled pages to close.
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
        // 1) purge every Cache Storage bucket (the stale app shells + data live here).
        try {
            var keys = await caches.keys();
            await Promise.all(keys.map(function (k) { return caches.delete(k); }));
        } catch (e) { /* no Cache API / already gone */ }
        // 2) unregister THIS worker so it never controls another navigation.
        try { await self.registration.unregister(); } catch (e) { /* */ }
        // 3) reload every tab this worker was controlling → they come back clean, SW-free, from the network.
        try {
            var clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) { /* */ } });
        } catch (e) { /* */ }
    })());
});

// While this worker briefly lives, NEVER serve from cache — always pass through to the network so nothing
// stale can be handed back in the window before it unregisters.
self.addEventListener('fetch', function (event) {
    event.respondWith(fetch(event.request));
});
