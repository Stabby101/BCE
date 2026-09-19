const TOKEN_KEY = 'bce.device.token';
const NAME_KEY = 'bce.player.name';
const KEEP_KEYS = [TOKEN_KEY, NAME_KEY];
const IDB_MIRRORS = ['bce-campaigns', 'mekbay'];

async function unregisterServiceWorkers(): Promise<void> {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        }
    } catch { /* no SW API — nothing to evict */ }
}

async function deleteCaches(): Promise<void> {
    try {
        if (typeof caches === 'undefined') return; // no Cache API (older / insecure context)
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    } catch { /* Cache API unavailable */ }
}

/** LIGHT eviction — SWs + CacheStorage only, then reload. Keeps all campaign/local data. */
export async function evictAndReload(): Promise<void> {
    await unregisterServiceWorkers();
    await deleteCaches();
    try { location.reload(); } catch { /* */ }
}

/** NUCLEAR reset — SWs + caches + IDB mirrors + bce.* localStorage (device token + player name survive).
 *  Does NOT reload — the caller decides (?fresh=1 strips the param and reloads; the cover affordance reloads). */
export async function freshReset(): Promise<void> {
    await unregisterServiceWorkers();
    await deleteCaches();
    for (const db of IDB_MIRRORS) {
        try { indexedDB.deleteDatabase(db); } catch { /* */ }
    }
    try {
        const doomed: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('bce.') && !KEEP_KEYS.includes(k)) doomed.push(k);
        }
        doomed.forEach((k) => localStorage.removeItem(k));
    } catch { /* localStorage unavailable */ }
}

/** Pre-bootstrap ?fresh=1 handler for BOTH entries: NUCLEAR reset, strip the param, reload. Returns true when
 *  it handled the reset (the caller must NOT continue bootstrapping — a reload is in flight). Accepts extra
 *  params (?fresh=1&campaign=…&engine=…) — they survive the strip so a healing link lands back in-session. */
export async function handleFreshParam(): Promise<boolean> {
    let params: URLSearchParams;
    try { params = new URLSearchParams(location.search); } catch { return false; }
    if (params.get('fresh') !== '1') return false;
    await freshReset();
    params.delete('fresh');
    const qs = params.toString();
    try { location.replace(location.pathname + (qs ? `?${qs}` : '') + location.hash); } catch { location.reload(); }
    return true;
}
