const ID_KEY = 'bce.gm.device';
const LABEL_KEY = 'bce.gm.device.label';
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
let memoryId: string | null = null; // the fallback when localStorage is blocked: one id per page load

function mint(): string {
    try { return crypto.randomUUID().replace(/-/g, ''); } catch { /* no crypto.randomUUID — fall through */ }
    let out = '';
    for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
}

/** This browser profile's GM-app device id — minted once, durable; the same for every tab of the profile (they ARE one device). */
export function gmDeviceId(): string {
    try {
        const stored = localStorage.getItem(ID_KEY);
        if (stored && ID_RE.test(stored)) return stored;
        const fresh = mint();
        localStorage.setItem(ID_KEY, fresh);
        return fresh;
    } catch {
        return (memoryId ??= mint());
    }
}

/** The self-declared device label: the stored one, else a heuristic off the browser (touch + width). Pure helper below. */
export function gmDeviceLabel(): string {
    try {
        const stored = localStorage.getItem(LABEL_KEY);
        if (stored && stored.trim()) return stored.trim().slice(0, 24);
    } catch { /* */ }
    let coarse = false;
    try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { /* */ }
    return deviceLabelHeuristic(typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0, typeof window !== 'undefined' ? window.innerWidth : 1200, coarse);
}

/** phone (touch, narrow) · tablet (touch, wide) · desktop. A desktop with a TOUCH SCREEN still has a fine primary pointer (the
 *  mouse), so touch counts only when the primary pointer is coarse — else a touch-monitor PC (and a headless box on one) would
 *  read "tablet". Pure — spec-pinned. */
export function deviceLabelHeuristic(maxTouchPoints: number, innerWidth: number, coarsePointer = false): 'phone' | 'tablet' | 'desktop' {
    if (maxTouchPoints > 0 && coarsePointer) return innerWidth < 900 ? 'phone' : 'tablet';
    return 'desktop';
}

/** Ruling 6 — editable later: store a label (empty = back to the heuristic). */
export function setGmDeviceLabel(label: string): void {
    try { if (label.trim()) localStorage.setItem(LABEL_KEY, label.trim().slice(0, 24)); else localStorage.removeItem(LABEL_KEY); } catch { /* */ }
}
