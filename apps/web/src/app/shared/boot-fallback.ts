export function clearBootFallback(): void {
    try { document.getElementById('bce-boot-fallback')?.remove(); } catch { /* nothing to clear */ }
}
