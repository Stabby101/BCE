/*
 * BCE multi-tenant (DEPLOY-002 P4) — the GM-bundle auth client. Reads /api/auth/me to drive the gated
 * shell (wall → pending → rejected → in), starts the OAuth login flow, runs the flag-gated dev-login test
 * seam, and exposes the admin approval console calls. Lives in the GM web bundle; the port-isolated player
 * bundle stayed account-less (ROLE-002) until GM-1 P3 gave player REST the device's credential — and GM-1c now
 * injects THIS service there too (fragment adoption + enabledProviders + the start URL) so the join page can
 * run the SAME sign-in flow, not a fork of it. The player SOCKET still withholds the token (HOTFIX-033).
 *
 * The session JWT is mirrored to localStorage ('bce.auth.token') so ClaimRealtimeService can put it on the
 * socket handshake (auth.token → the P2 ownership path); the httpOnly cookie still carries HTTP auth. When
 * auth is NOT required (dev/LAN) the gate is 'open' and nothing here changes the existing experience.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

export type GateState = 'loading' | 'wall' | 'pending' | 'rejected' | 'open';

export type GmUserStatus = 'pending' | 'approved' | 'rejected' | 'banned';
/** Mirrors the host User (auth.types) — the fields the frontend needs. */
export interface GmUser {
    id: string;
    provider: string;
    email: string | null;
    displayName: string | null;
    role: 'admin' | 'gm' | 'guest'; // DEPLOY-009: 'guest' is the login-free tier
    status: GmUserStatus;
    createdAt?: number; // DEPLOY-003: directory "joined"
    lastSeen?: number; // DEPLOY-003: directory "last seen"
}
// DEPLOY-003 (T-039) — the admin audit log row. DEPLOY-010 adds 'campaign_created'.
export type AuditAction = 'login' | 'register' | 'approve' | 'reject' | 'ban' | 'unban' | 'role_change' | 'remove' | 'recover' | 'campaign_created' | 'link';
export interface AuditEntry {
    id: string;
    ts: number;
    actorUserId: string | null;
    action: AuditAction;
    targetUserId: string | null;
    detail: string | null;
    ip: string | null;
}
// DEPLOY-010 — the admin dashboard metrics (GET /admin/stats).
export interface AdminStats {
    totalUsers: number;
    byStatus: { pending: number; approved: number; rejected: number; banned: number };
    byRole: { admin: number; gm: number; guest: number };
    activeNow: number;
    activeToday: number;
    active7d: number;
    newToday: number;
    new7d: number;
    totalCampaigns: number;
}
interface MeResponse {
    user: GmUser | null;
    authRequired: boolean;
    devLoginAllowed: boolean;
    allowGuest: boolean; // DEPLOY-009
    enabledProviders?: string[]; // LOGIN-1: OAuth providers configured on the server (drives the sign-in buttons)
    token: string | null;
    entitlements?: string[]; // ODM-1 — additive per-account feature grants (drives entitled-only surfaces; server enforces)
}

const ENGINE_URL_KEY = 'bce.engine.url';
const DEFAULT_ENGINE_URL = 'http://localhost:3000/api';
const SESSION_TOKEN_KEY = 'bce.auth.token'; // the GM JWT, mirrored for the socket handshake (P2 path)
// DEPLOY-009 — the guest recovery code lives ONLY on the client (the server stores a hash). These keys hold
// the plaintext copy for re-display + the one-time "I've saved it" banner ack. Distinct from the player keys.
export const GUEST_RECOVERY_KEY = 'bce.guest.recovery';
export const GUEST_BANNER_ACK_KEY = 'bce.guest.ack';
const ME_TIMEOUT_MS = 6000;

/** The sign-in button's human label for a provider id (shared by the login screen and the GM-1c join page). */
export function providerLabel(p: string): string {
    return p === 'google' ? 'Google' : p === 'github' ? 'GitHub' : (p.charAt(0).toUpperCase() + p.slice(1));
}

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly http = inject(HttpClient);

    private readonly userSig = signal<GmUser | null>(null);
    private readonly authRequiredSig = signal(false);
    private readonly devLoginSig = signal(false);
    private readonly allowGuestSig = signal(false); // DEPLOY-009: the host's BCE_ALLOW_GUEST flag
    private readonly enabledProvidersSig = signal<string[]>([]); // LOGIN-1: configured OAuth providers (else no button)
    private readonly resolvedSig = signal(false);
    /** DEPLOY-003: the pending-approval count for the admin chip badge. */
    readonly pendingBadge = signal(0);

    readonly user = this.userSig.asReadonly();
    readonly authRequired = this.authRequiredSig.asReadonly();
    readonly devLoginAllowed = this.devLoginSig.asReadonly();
    readonly allowGuest = this.allowGuestSig.asReadonly();
    readonly enabledProviders = this.enabledProvidersSig.asReadonly(); // LOGIN-1
    readonly resolved = this.resolvedSig.asReadonly();
    /** AUTH-1 — the last /auth/me resolution was TRANSIENTLY degraded (network/timeout/5xx — the host never
     *  actually adjudicated the session). Prior identity/entitlement state is HELD, not cleared; recovery
     *  (the cover's reconnect/retry heal) re-resolves. Cleared by any conclusive /me (success OR 401/403). */
    private readonly degradedSig = signal(false);
    readonly degraded = this.degradedSig.asReadonly();
    /** DEPLOY-009: the signed-in identity is a guest (drives the recovery banner + Settings card). */
    readonly isGuest = computed(() => this.gmUser()?.role === 'guest');

    /** The single state the gated shell renders against. */
    readonly gate = computed<GateState>(() => {
        if (!this.resolvedSig()) return 'loading';
        if (!this.authRequiredSig()) return 'open'; // dev/LAN — no wall (UNCHANGED)
        const u = this.userSig();
        if (!u) return 'wall';
        if (u.status === 'pending') return 'pending';
        if (u.status === 'rejected') return 'rejected';
        return 'open'; // approved
    });
    /** The signed-in GM (only meaningful when gated) — drives the account chip + admin console. */
    readonly gmUser = computed<GmUser | null>(() => (this.authRequiredSig() ? this.userSig() : null));
    readonly isAdmin = computed(() => this.gate() === 'open' && this.gmUser()?.role === 'admin');
    /** DIRECTIVE-ODM-1 — the account's feature grants (empty when unauthenticated). */
    private readonly entitlementsSig = signal<string[]>([]);
    readonly entitlements = this.entitlementsSig.asReadonly();
    /** Entitled-only surfaces render off this. dev/LAN (auth off, single-tenant) is permissive — consistent with
     *  the server's viewer()/pack-gate posture; when gated, the account must hold the grant. UX only — the server
     *  enforces at campaign persist + every pack fetch. */
    hasPack(id: string): boolean {
        return !this.authRequiredSig() || this.entitlementsSig().includes(id);
    }

    private base(): string {
        return localStorage.getItem(ENGINE_URL_KEY) || DEFAULT_ENGINE_URL;
    }

    /** Resolve the session from the host. On a network failure fail OPEN to dev behaviour (no wall on a
     *  blip — a gated host returns authRequired=true explicitly, and no data flows without the cookie). */
    async refresh(): Promise<void> {
        try {
            const r = await firstValueFrom(
                this.http.get<MeResponse>(`${this.base()}/auth/me`, { withCredentials: true }).pipe(timeout(ME_TIMEOUT_MS)),
            );
            this.userSig.set(r?.user ?? null);
            this.authRequiredSig.set(!!r?.authRequired);
            this.devLoginSig.set(!!r?.devLoginAllowed);
            this.allowGuestSig.set(!!r?.allowGuest);
            this.enabledProvidersSig.set(Array.isArray(r?.enabledProviders) ? r!.enabledProviders : []); // LOGIN-1
            this.entitlementsSig.set(Array.isArray(r?.entitlements) ? r!.entitlements : []); // ODM-1
            this.syncSocketToken(r?.token ?? null);
            this.degradedSig.set(false); // AUTH-1 — a conclusive resolve heals a degraded session
        } catch (e) {
            // AUTH-1 — only an AUTHORITATIVE rejection (the server examined the credentials and said 401/403)
            // may clear identity or touch the Bearer mirror. Network failure, timeout, abort and 5xx are
            // TRANSIENT: the host never adjudicated the session, so "signed out" is a claim the client has
            // not earned — HOLD the prior state and mark the resolution degraded. On a COLD boot the held
            // state IS the initial permissive posture (user null, authRequired false), so dev/LAN behaviour
            // is byte-identical to the old catch-all. THE GUEST-LOCKOUT FIX lives here: a cookie-blocked
            // guest is Bearer-only (HOTFIX-017) — the old unconditional syncSocketToken(null) deleted their
            // ONLY credential on any api blip (deploy restart included), signing them out PERMANENTLY.
            const status = e instanceof HttpErrorResponse ? e.status : 0;
            if (status === 401 || status === 403) {
                this.userSig.set(null);
                this.authRequiredSig.set(false);
                this.devLoginSig.set(false);
                this.allowGuestSig.set(false);
                this.enabledProvidersSig.set([]); // LOGIN-1
                this.entitlementsSig.set([]); // ODM-1
                this.syncSocketToken(null); // authoritative — the mirror may be wiped
                this.degradedSig.set(false); // conclusive, even though rejected
            } else {
                this.degradedSig.set(true); // transient — prior state + the Bearer mirror survive
            }
        } finally {
            this.resolvedSig.set(true);
        }
    }

    /** HOTFIX-028 — if the boot /auth/me is still in flight past the first-paint deadline (a slow/unreachable
     *  host — the old GM "black screen"), fail OPEN so the shell PAINTS (the cover) instead of staying black.
     *  authRequired stays false → gate 'open' (dev-equivalent). The in-flight refresh still completes and sets
     *  the real gate a moment later; a reachable host (Railway) responds well before this ever fires. */
    resolveOpenOnTimeout(): void {
        if (!this.resolvedSig()) this.resolvedSig.set(true);
    }

    /** Mirror the GM JWT to localStorage so the socket can send it as auth.token (the P2 ownership path).
     *  The player never reaches this code → no token → account-less socket. */
    private syncSocketToken(token: string | null): void {
        try {
            if (token) localStorage.setItem(SESSION_TOKEN_KEY, token);
            else localStorage.removeItem(SESSION_TOKEN_KEY);
        } catch { /* localStorage unavailable — the socket falls back to account-less */ }
    }

    /** HOTFIX-040 Fix A — Bearer-first for OAuth. The callback redirect carries the session JWT on the URL
     *  FRAGMENT (#bce_auth=…). Adopt it as the Bearer/socket token BEFORE the first /auth/me (so Google works
     *  when the browser blocks the cross-site cookie), then STRIP it from the URL so it's never left in the
     *  address bar / history / a shared link. Called from the APP_INITIALIZER before refresh(); no-op otherwise.
     *  GM-1c: returns whether a token was adopted — the player join page uses the verdict to re-open Bring-my-company
     *  after its sign-in round-trip (the path + query survive the strip, so the join link is intact). */
    adoptAuthFragment(): boolean {
        try {
            const hash = typeof location !== 'undefined' ? (location.hash || '') : '';
            const m = hash.match(/(?:^#|&)bce_auth=([^&]*)/);
            if (!m) return false;
            const token = decodeURIComponent(m[1] || '');
            if (token) this.syncSocketToken(token); // Bearer-first, identical to guest/recover/dev-login
            // strip ONLY bce_auth from the fragment, preserving any other hash params
            const rest = hash.replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('bce_auth='));
            history.replaceState(null, '', location.pathname + location.search + (rest.length ? '#' + rest.join('&') : ''));
            return !!token;
        } catch { return false; /* location/history unavailable — degrade to cookie-only auth */ }
    }

    /** The OAuth start URL. GM-1c: an optional `returnTo` (a same-site path such as the join page's
     *  `/player/?campaign=…&engine=…`) rides through the provider as the OAuth `state`, and the callback lands the
     *  browser back on it — the server validates it (open-redirect gate) and falls back to the root otherwise. */
    loginUrl(provider: string, returnTo?: string): string {
        return `${this.base()}/auth/${provider}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
    }

    // ── DEPLOY-009 GUEST tier ──────────────────────────────────────────────────────────────────────────
    /** The recovery code's local plaintext copy (the device's own — the server only holds a hash). */
    recoveryCode(): string | null {
        try { return localStorage.getItem(GUEST_RECOVERY_KEY); } catch { return null; }
    }
    /** Whether the "write it down" banner is still owed (minted this device, not yet acknowledged). */
    recoveryBannerOwed(): boolean {
        try { return !!localStorage.getItem(GUEST_RECOVERY_KEY) && localStorage.getItem(GUEST_BANNER_ACK_KEY) !== '1'; }
        catch { return false; }
    }
    /** Mark the banner acknowledged ("I've saved it") — it won't reappear; Settings still re-displays the code. */
    ackRecoveryBanner(): void {
        try { localStorage.setItem(GUEST_BANNER_ACK_KEY, '1'); } catch { /* */ }
    }

    /** MINT — the "+ guest" lane: create a login-free identity. The server sets the session cookie + returns
     *  the ONE-TIME recovery code; we stash the plaintext copy locally (for re-display) and arm the banner. */
    async guestMint(): Promise<void> {
        const r = await firstValueFrom(
            this.http.post<{ user: GmUser; token: string; recoveryCode: string }>(`${this.base()}/auth/guest`, {}, { withCredentials: true }),
        );
        try {
            if (r?.recoveryCode) {
                localStorage.setItem(GUEST_RECOVERY_KEY, r.recoveryCode);
                localStorage.removeItem(GUEST_BANNER_ACK_KEY); // a fresh code → show the banner once
            }
        } catch { /* localStorage blocked — the code is still in Settings via /me-less re-mint? no: surfaced in the response only */ }
        // HOTFIX-017: Bearer-FIRST — mirror the returned session token to localStorage BEFORE the first
        // /auth/me, so the interceptor attaches `Authorization: Bearer …`. Without this, hosted guest sign-in
        // rides ONLY the cross-site session cookie, which a strict/fresh browser (3rd-party cookies blocked)
        // drops → /auth/me returns user:null → the gate stays 'wall' → "Continue as guest" does nothing. The
        // cookie stays as a secondary path (withCredentials kept) for browsers that allow it.
        this.syncSocketToken(r?.token ?? null);
        await this.refresh();
    }

    /** RECOVER — re-bind a new device from a recovery code (the server rate-limits this). On success the
     *  device adopts the code as its own local copy and the banner is pre-acknowledged (the user already
     *  knows it — they just typed it). Throws on a bad code / rate-limit (the caller surfaces the message). */
    async recover(code: string): Promise<void> {
        const r = await firstValueFrom(
            this.http.post<{ user: GmUser; token: string }>(`${this.base()}/auth/recover`, { code }, { withCredentials: true }),
        );
        try {
            localStorage.setItem(GUEST_RECOVERY_KEY, code.trim());
            localStorage.setItem(GUEST_BANNER_ACK_KEY, '1');
        } catch { /* */ }
        this.syncSocketToken(r?.token ?? null); // HOTFIX-017: Bearer-first parity with guest — store the token before /auth/me
        await this.refresh();
    }

    /** TEST SEAM (server 404s unless BCE_ALLOW_DEV_LOGIN=1) — proves the gate without real OAuth. */
    async devLogin(email: string): Promise<void> {
        const r = await firstValueFrom(
            this.http.post<{ user: GmUser; token: string }>(
                `${this.base()}/auth/dev-login`,
                { provider: 'dev', providerUserId: email, email, displayName: email },
                { withCredentials: true },
            ),
        );
        this.syncSocketToken(r?.token ?? null); // HOTFIX-017: Bearer-first — store the token before the first /auth/me
        await this.refresh();
    }

    /** HOTFIX-040 — drop the local guest recovery keys (their plaintext copy lives ONLY on the client). */
    private clearGuestKeys(): void {
        try { localStorage.removeItem(GUEST_RECOVERY_KEY); localStorage.removeItem(GUEST_BANNER_ACK_KEY); } catch { /* */ }
    }
    /** HOTFIX-040 Fix B/C — drop the LOCAL session (Bearer token + guest keys) FIRST (a cookie-blocked session
     *  is Bearer-only, so this is what actually signs them out), THEN best-effort clear the server cookie (with
     *  matching attributes, server-side). No /auth/me refresh — callers either refresh() (logout) or hard-reload
     *  (reset / signOut navigate). Shared by logout() and the cover's Reset-app-data. */
    async clearSession(): Promise<void> {
        this.syncSocketToken(null);
        this.clearGuestKeys();
        try { await firstValueFrom(this.http.post(`${this.base()}/auth/logout`, {}, { withCredentials: true })); } catch { /* */ }
    }

    async logout(): Promise<void> {
        await this.clearSession(); // HOTFIX-040 — local token/keys first, then the server cookie (matching attrs) drops it
        await this.refresh();
    }

    /** HOTFIX-025 — sign out + hard-return to the cover, with the HF-016 guest confirm. Shared by the gated
     *  shell's pending/rejected screens AND the cover account line (the floating account chip was removed). The
     *  hard navigate makes the sign-out VISIBLE (the wall returns) and drops all in-memory campaign state. */
    async signOut(): Promise<void> {
        if (this.isGuest() && typeof confirm === 'function'
            && !confirm("Sign out? You'll need your recovery code to get back into this guest campaign.")) return;
        await this.logout();
        // LINK-1 Part B2 — land on the always-available login screen (providers + Continue as guest + recover),
        // not the open cover. With auth ON the gate intercepts with the wall; with auth OFF /login renders.
        location.assign('/login');
    }

    // ── admin console (admin-only; the host AdminGuard enforces — these are convenience calls) ──
    async listPending(): Promise<GmUser[]> {
        try { return (await firstValueFrom(this.http.get<GmUser[]>(`${this.base()}/admin/users?status=pending`, { withCredentials: true }))) ?? []; }
        catch { return []; }
    }
    async approve(id: string): Promise<void> {
        await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/approve`, {}, { withCredentials: true }));
    }
    async reject(id: string): Promise<void> {
        await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/reject`, {}, { withCredentials: true }));
    }

    // ── DEPLOY-003 — the dedicated /admin console (directory + ban/role + audit) ──
    async listUsers(): Promise<GmUser[]> {
        try { return (await firstValueFrom(this.http.get<GmUser[]>(`${this.base()}/admin/users`, { withCredentials: true }))) ?? []; }
        catch { return []; }
    }
    async ban(id: string): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/ban`, {}, { withCredentials: true })); }
    async unban(id: string): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/unban`, {}, { withCredentials: true })); }
    async setRole(id: string, role: 'admin' | 'gm'): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/role`, { role }, { withCredentials: true })); }
    async removeUser(id: string): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/remove`, {}, { withCredentials: true })); }
    // ── DIRECTIVE-ODM-1 Phase 1 — per-account feature grants (the hidden-pack entitlement toggle) ──
    async listGrants(): Promise<{ userId: string; feature: string }[]> {
        try { return (await firstValueFrom(this.http.get<{ grants: { userId: string; feature: string }[] }>(`${this.base()}/admin/grants`, { withCredentials: true })))?.grants ?? []; }
        catch { return []; }
    }
    async grantFeature(id: string, feature: string): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/grants/${encodeURIComponent(feature)}`, {}, { withCredentials: true })); }
    async revokeFeature(id: string, feature: string): Promise<void> { await firstValueFrom(this.http.post(`${this.base()}/admin/users/${encodeURIComponent(id)}/grants/${encodeURIComponent(feature)}/revoke`, {}, { withCredentials: true })); }
    async pendingCount(): Promise<number> {
        try { return (await firstValueFrom(this.http.get<{ count: number }>(`${this.base()}/admin/users/pending-count`, { withCredentials: true })))?.count ?? 0; }
        catch { return 0; }
    }
    async refreshPending(): Promise<void> { this.pendingBadge.set(await this.pendingCount()); }
    /** DEPLOY-010 — the admin dashboard metrics (null on a transient failure → the cards show "—"). */
    async adminStats(): Promise<AdminStats | null> {
        try { return (await firstValueFrom(this.http.get<AdminStats>(`${this.base()}/admin/stats`, { withCredentials: true }))) ?? null; }
        catch { return null; }
    }
    /** ODM-26 — the whole-DB export (HARDEN-7 A1 `/admin/export`, VACUUM INTO → a consistent single file).
     *  Fetched rather than linked ON PURPOSE: `extractToken` accepts the session cookie OR a Bearer header,
     *  and a plain `<a href>` only carries the cookie — so a bearer-only admin session would meet a 401 on a
     *  link and download nothing. HttpClient carries both (the interceptor attaches Bearer, withCredentials
     *  sends the cookie), which is the difference between a control that works and one that works for some
     *  people. Returns the blob; the caller names the file and hands it to the browser. */
    async adminExport(): Promise<Blob | null> {
        try { return (await firstValueFrom(this.http.get(`${this.base()}/admin/export`, { responseType: 'blob', withCredentials: true }))) ?? null; }
        catch { return null; }
    }
    async listAudit(f: { user?: string; action?: string } = {}): Promise<AuditEntry[]> {
        const qs = new URLSearchParams();
        if (f.user) qs.set('user', f.user);
        if (f.action) qs.set('action', f.action);
        const q = qs.toString();
        try { return (await firstValueFrom(this.http.get<AuditEntry[]>(`${this.base()}/admin/audit${q ? '?' + q : ''}`, { withCredentials: true }))) ?? []; }
        catch { return []; }
    }
}
