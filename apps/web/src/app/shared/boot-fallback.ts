/*
 * HOTFIX-028 — bridge to the index.html boot watchdog. index.html injects a plain-HTML fallback panel
 * (#bce-boot-fallback) if <app-root> is still empty after a deadline (a dead/hung bundle → what was the GM
 * "black screen"). When the Angular app DOES paint, it calls clearBootFallback() to remove that panel, so a
 * slow-but-successful boot never strands the "still loading" fallback on screen.
 */
export function clearBootFallback(): void {
    try { document.getElementById('bce-boot-fallback')?.remove(); } catch { /* nothing to clear */ }
}
