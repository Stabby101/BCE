/*
 * BCE multi-tenant (DEPLOY-002 P1) — auth orchestration: env-config helpers, OAuth→user resolution
 * (with admin-bootstrap), and JWT issue/verify via the vetted @nestjs/jwt (NOT hand-rolled crypto).
 * SECRETS: every value comes from process.env (Railway), never a literal here. Nothing is logged.
 */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import { UsersService } from './users.service';
import type { JwtPayload, OAuthProfile, User } from './auth.types';
import { generateRecoveryCode, isWellFormedRecoveryCode, normalizeRecoveryCode } from './recovery-code';

/** Insecure placeholder — used ONLY when auth is NOT required (local dev, no real sessions). When
 *  BCE_AUTH_REQUIRED=1, bootstrap fails fast unless BCE_SESSION_SECRET is set (see main.ts). */
export const DEV_FALLBACK_SECRET = 'bce-dev-insecure-session-secret-not-for-production';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwt: JwtService,
        private readonly users: UsersService,
    ) {}

    // ── env-driven config (all Railway-set; no values ever hard-coded) ──
    static authRequired(): boolean {
        return process.env.BCE_AUTH_REQUIRED === '1';
    }
    static devLoginAllowed(): boolean {
        return process.env.BCE_ALLOW_DEV_LOGIN === '1';
    }
    /** LOGIN-1 — whether an OAuth provider's credentials are present (the SAME env signal AuthModule's
     *  strategy `useFactory` uses to register/skip a strategy). One source of truth for "is this provider live". */
    static hasOAuthProvider(id: 'google' | 'github'): boolean {
        const up = id.toUpperCase();
        return !!(process.env[`BCE_${up}_CLIENT_ID`] && process.env[`BCE_${up}_CLIENT_SECRET`]);
    }
    /** LOGIN-1 — the OAuth providers actually configured on this server (creds present). Drives both the
     *  module's strategy registration and the /api/auth/me `enabledProviders` (so the UI shows a button ONLY
     *  for a provider whose strategy exists — no dead "Sign in with GitHub" that 500s when unconfigured). */
    static enabledOAuthProviders(): ('google' | 'github')[] {
        return (['google', 'github'] as const).filter((p) => AuthService.hasOAuthProvider(p));
    }
    static adminEmails(): string[] {
        return (process.env.BCE_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    }
    static isAdminEmail(email: string | null): boolean {
        return !!email && AuthService.adminEmails().includes(email.toLowerCase());
    }
    static sessionSecret(): string {
        return process.env.BCE_SESSION_SECRET || DEV_FALLBACK_SECRET;
    }
    /** HARDEN-7 — a public/hosted deployment (Railway/prod), distinct from local dev/LAN. Mirrors the cookie
     *  `secure`/`sameSite` decision in auth.controller; used by the durability guard's secret-stability alarm. */
    static isHosted(): boolean {
        return process.env.BCE_HOST === '0.0.0.0' || process.env.NODE_ENV === 'production';
    }
    // DEPLOY-009 — the login-free guest tier.
    static allowGuest(): boolean {
        return process.env.BCE_ALLOW_GUEST === '1';
    }
    /** When set, a fresh guest lands in the SAME pending-approval queue as a new OAuth GM (default: auto-approved). */
    static guestRequiresApproval(): boolean {
        return process.env.BCE_GUEST_REQUIRES_APPROVAL === '1';
    }
    /** LINK-1 policy — when set, a NEW OAuth GM lands in the pending-approval queue (the entry gate). DEFAULT
     *  OFF: moderation is REACTIVE (admin ban), not an entry gate — a new account is approved on first sign-in.
     *  Mirrors BCE_GUEST_REQUIRES_APPROVAL. Admin conferral stays email-only; the ban path + Awaiting-approval
     *  screen stay intact for when this flag is on. Folds in the LINK-1 fix (an upgrading guest lands approved). */
    static gmRequiresApproval(): boolean {
        return process.env.BCE_GM_REQUIRES_APPROVAL === '1';
    }

    /** Resolve an OAuth/dev profile into a stored user (admin-bootstrap applied). DEPLOY-003: writes a
     *  'register' audit entry on first sight + a 'login' entry every time (the append-only governance log). */
    resolveUser(profile: OAuthProfile, ip?: string | null): User {
        const before = this.users.getByProvider(profile.provider, profile.providerUserId);
        const user = this.users.upsert(profile, AuthService.isAdminEmail(profile.email), AuthService.gmRequiresApproval());
        if (!before) this.users.recordAudit({ actorUserId: user.id, action: 'register', targetUserId: user.id, detail: profile.provider, ip: ip ?? null });
        this.users.recordAudit({ actorUserId: user.id, action: 'login', targetUserId: user.id, detail: profile.provider, ip: ip ?? null });
        return user;
    }
    /** DEPLOY-003: refresh lastSeen for an authenticated user (the ApprovedGmGuard calls this; the store
     *  throttles the write). Kept here so the guard depends only on AuthService. */
    touchSeen(id: string): void {
        this.users.touchLastSeen(id);
    }

    issueToken(user: User): string {
        return this.jwt.sign({ sub: user.id } as JwtPayload);
    }

    // ── DEPLOY-009 GUEST recovery code ──────────────────────────────────────────────────────────────────
    /** Keyed hash of a recovery code (HMAC-SHA256 under the SESSION SECRET). Deterministic → usable as a
     *  lookup key; secret-keyed → a DB-only leak (without the secret) can't brute-force the 32^8 space. Returns
     *  null for a malformed code (so an empty/garbage input can never collide with a stored hash). */
    private hashRecovery(code: string): string | null {
        if (!isWellFormedRecoveryCode(code)) return null;
        return createHmac('sha256', AuthService.sessionSecret()).update(normalizeRecoveryCode(code)).digest('hex');
    }

    /** MINT (§2): create a guest user + return the ONE-TIME plaintext recovery code (the client stores it;
     *  the server keeps only the hash). Audits a 'register' (provider 'guest') for the governance log. */
    createGuest(ip?: string | null): { user: User; recoveryCode: string } {
        // Generate until the (astronomically rare) hash collision is avoided — keeps recoveryHash unique-by-use.
        let recoveryCode = generateRecoveryCode();
        let recoveryHash = this.hashRecovery(recoveryCode)!;
        for (let i = 0; i < 5 && this.users.getByRecoveryHash(recoveryHash); i++) {
            recoveryCode = generateRecoveryCode();
            recoveryHash = this.hashRecovery(recoveryCode)!;
        }
        const user = this.users.createGuest(recoveryHash, AuthService.guestRequiresApproval());
        this.users.recordAudit({ actorUserId: user.id, action: 'register', targetUserId: user.id, detail: 'guest', ip: ip ?? null });
        return { user, recoveryCode };
    }

    /** RECOVER (§2): map a recovery code → its guest, re-binding a new device. Null on no-match or a
     *  malformed code; a banned/rejected guest is NOT recoverable (recovery never re-admits a blocked user).
     *  Audits a 'recover'. The caller (controller) issues the new session token + applies the IP rate limit. */
    recoverGuest(code: string, ip?: string | null): User | null {
        const hash = this.hashRecovery(code);
        if (!hash) return null;
        const user = this.users.getByRecoveryHash(hash);
        if (!user || user.role !== 'guest') return null;
        if (user.status === 'banned' || user.status === 'rejected') return null;
        if (user.linkedTo) return null; // LINK-1: this guest upgraded to a durable account — its code is retired (its data lives under the account now)
        this.users.recordAudit({ actorUserId: user.id, action: 'recover', targetUserId: user.id, detail: 'guest', ip: ip ?? null });
        return user;
    }
    /** Verify + load the user, or null on any failure (expired/tampered/unknown). */
    userFromToken(token: string | undefined | null): User | null {
        if (!token) return null;
        try {
            const payload = this.jwt.verify<JwtPayload>(token);
            return payload?.sub ? this.users.getById(payload.sub) : null;
        } catch {
            return null;
        }
    }
    /** HARDEN-7 B5 — the token's expiry (epoch ms), or null if it can't be verified. Used by the sliding-refresh
     *  guard to decide whether a still-valid session is near its 7-day cliff. Same verify as userFromToken. */
    tokenExpiryMs(token: string | undefined | null): number | null {
        if (!token) return null;
        try {
            const payload = this.jwt.verify<JwtPayload & { exp?: number }>(token);
            return typeof payload?.exp === 'number' ? payload.exp * 1000 : null;
        } catch {
            return null;
        }
    }

    /** HARDEN-7 B2 — regenerate a GUEST's recovery code while logged in: mint a fresh code, replace the stored
     *  recoveryHash (row-scoped UPDATE — additive, preserves the account + its ownerId), return the plaintext
     *  ONCE. Guest-only + rate-limit + audit are enforced by the controller. Null if the user isn't a guest. */
    regenerateRecovery(user: User, ip?: string | null): { recoveryCode: string } | null {
        if (user.role !== 'guest') return null;
        let recoveryCode = generateRecoveryCode();
        let recoveryHash = this.hashRecovery(recoveryCode)!;
        for (let i = 0; i < 5 && this.users.getByRecoveryHash(recoveryHash); i++) {
            recoveryCode = generateRecoveryCode();
            recoveryHash = this.hashRecovery(recoveryCode)!;
        }
        this.users.setRecoveryHash(user.id, recoveryHash);
        this.users.recordAudit({ actorUserId: user.id, action: 'recover', targetUserId: user.id, detail: 'regenerate', ip: ip ?? null });
        return { recoveryCode };
    }
}
