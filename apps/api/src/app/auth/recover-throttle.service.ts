/*
 * BCE (DEPLOY-009) — per-IP rate limiter for POST /api/auth/recover. The recovery code is the ONE place a
 * shown, lower-entropy (32^8) secret is matched server-side, so it MUST be enumeration-resistant: ≤5 attempts
 * per 60s window per IP, then an ESCALATING lockout (60s × strike count). A successful recovery clears the IP.
 *
 * In-memory + sliding window — no new dependency, deterministic, and unit/smoke-testable. A single host
 * process is the authoritative store (the app is one Railway service), so a shared map is correct here.
 * NOTE (prod): req.ip is only meaningful when Express trusts the proxy; behind Railway, set `trust proxy`
 * (or key on a forwarded header) so this limits per-client, not per-edge — flagged, not wired this slice.
 */
import { Injectable } from '@nestjs/common';

interface Bucket {
    hits: number[]; // attempt timestamps within the current window
    lockedUntil: number; // 0 = not locked
    strikes: number; // consecutive lockouts — drives the escalation
}

export interface ThrottleVerdict {
    ok: boolean;
    retryAfterSec?: number; // seconds the caller must wait (set when !ok)
}

@Injectable()
export class RecoverThrottleService {
    /** Tunables (kept as instance fields so a test can shrink the window if ever needed). */
    private readonly MAX_PER_WINDOW = 5;
    private readonly WINDOW_MS = 60_000;
    private readonly BASE_LOCKOUT_MS = 60_000;
    private readonly buckets = new Map<string, Bucket>();

    /** Record-and-check one attempt for an IP. Returns {ok:false, retryAfterSec} when the IP is rate-limited
     *  (either already locked, or this attempt is the one that trips the 6th-in-window lockout). */
    check(ip: string, now: number = Date.now()): ThrottleVerdict {
        const key = ip || 'unknown';
        const b = this.buckets.get(key) ?? { hits: [], lockedUntil: 0, strikes: 0 };

        // Already serving a lockout → reject without consuming a new attempt slot.
        if (now < b.lockedUntil) {
            this.buckets.set(key, b);
            return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
        }

        // Prune attempts older than the window.
        b.hits = b.hits.filter((t) => now - t < this.WINDOW_MS);

        // Window already full → this attempt trips an escalating lockout.
        if (b.hits.length >= this.MAX_PER_WINDOW) {
            b.strikes += 1;
            b.lockedUntil = now + this.BASE_LOCKOUT_MS * b.strikes;
            b.hits = [];
            this.buckets.set(key, b);
            return { ok: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
        }

        // Under the cap → consume a slot, allow.
        b.hits.push(now);
        this.buckets.set(key, b);
        return { ok: true };
    }

    /** Clear an IP's counters after a SUCCESSFUL recovery (a legitimate user shouldn't be penalized). */
    reset(ip: string): void {
        this.buckets.delete(ip || 'unknown');
    }
}
