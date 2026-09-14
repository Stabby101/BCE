/*
 * BCE multi-tenant (DEPLOY-002 P1) — the auth surface (all @Public: the login flow + status checks must
 * be reachable by anonymous/pending users; the OAuth routes are protected by passport's own guard).
 *   GET  /api/auth/google | /github            → start OAuth (redirect to the provider); GM-1c: `?returnTo=` rides as `state`
 *   GET  /api/auth/google/callback | /github/… → provider returns → upsert user → set session → redirect (GM-1c: to the
 *                                                validated returnTo — the join page with its query string — else the root)
 *   GET  /api/auth/me                          → the current user + status (or null)
 *   POST /api/auth/logout                      → clear the session cookie
 *   POST /api/auth/dev-login                   → TEST SEAM, flag-gated (BCE_ALLOW_DEV_LOGIN=1), prod-off
 */
import { Body, Controller, Get, HttpException, HttpStatus, Logger, NotFoundException, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { EntitlementsService } from './entitlements.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { Public, type AuthedRequest, type OAuthProfile, type User } from './auth.types';
import { extractToken } from './auth.guards';
import { RecoverThrottleService } from './recover-throttle.service';
import { setSessionCookie, clearSessionCookie } from './session-cookie';
import { GitHubReturnGuard, GoogleReturnGuard } from './oauth-return.guard'; // GM-1c: the start guards carry returnTo as state
import { frontendOrigins, oauthLanding } from './return-to'; // GM-1c: the open-redirect-gated landing

@Public()
@Controller('auth')
export class AuthController {
    private readonly log = new Logger('AuthController');
    constructor(
        private readonly auth: AuthService,
        private readonly throttle: RecoverThrottleService,
        private readonly users: UsersService, // LINK-1: retire (link) the upgraded guest + audit
        private readonly campaigns: CampaignsService, // LINK-1: re-own the guest's campaigns to the account
        private readonly grants: EntitlementsService, // ODM-1: /me entitlements[]
    ) {}

    private setSession(res: Response, token: string): void {
        setSessionCookie(res, token); // HARDEN-7 B5 — shared cookie definition (same as the refresh path)
    }

    @Get('google')
    @UseGuards(GoogleReturnGuard)
    google(): void {
        /* passport redirects to Google */
    }
    @Get('google/callback')
    @UseGuards(AuthGuard('google'))
    googleCallback(@Req() req: Request, @Res() res: Response): void {
        this.completeOAuth(req, res);
    }

    @Get('github')
    @UseGuards(GitHubReturnGuard)
    github(): void {
        /* passport redirects to GitHub */
    }
    @Get('github/callback')
    @UseGuards(AuthGuard('github'))
    githubCallback(@Req() req: Request, @Res() res: Response): void {
        this.completeOAuth(req, res);
    }

    private completeOAuth(req: Request, res: Response): void {
        const profile = req.user as OAuthProfile; // set by the passport strategy's validate()
        const user = this.auth.resolveUser(profile, req.ip); // DEPLOY-003: audits login/register
        const token = this.establishSession(req, res, user); // LINK-1: carry a guest's data across (in place); sets the cookie + returns the JWT
        // HOTFIX-040 Fix A — Bearer-first for OAuth: hand the SPA the token on the redirect FRAGMENT (never a
        // query param — a fragment isn't sent to the server, logs, or Referer). The SPA adopts + strips it before
        // the first /auth/me, so Google works even when the browser blocks the cross-site (3rd-party) cookie. The
        // cookie stays as the secondary path for browsers that allow it.
        // GM-1c — land where the sign-in began: the `state` the provider echoed is the start route's `returnTo` (the
        // join page with its campaign + engine query string). It is re-validated HERE (state is attacker-writable —
        // same-site path or an allow-listed origin only); anything else lands on the root exactly as before.
        const state = (req.query as Record<string, unknown> | undefined)?.state;
        res.redirect(oauthLanding(frontendOrigins(process.env.BCE_WEB_ORIGIN), state, token));
    }

    /** LINK-1 — the shared post-resolve step. If a GUEST session is present on THIS request (its same-origin
     *  cookie at the OAuth callback, or a Bearer on the dev-login seam), carry that guest's campaigns to the
     *  just-resolved account IN PLACE (lossless upgrade — no logout), THEN set the account's session cookie.
     *  Used by both completeOAuth and the dev-login test seam so the migration path is exercised identically. */
    private establishSession(req: Request, res: Response, user: User): string {
        const guestId = this.priorGuestId(req);
        if (guestId && guestId !== user.id) this.upgradeGuest(guestId, user, req.ip);
        const token = this.auth.issueToken(user);
        this.setSession(res, token);
        return token;
    }
    /** The id of a GUEST whose still-live (un-retired) session rode in on this request, else null. */
    private priorGuestId(req: Request): string | null {
        const prev = this.auth.userFromToken(extractToken(req as AuthedRequest));
        return prev && prev.role === 'guest' && !prev.linkedTo ? prev.id : null;
    }
    /** LINK-1 — additive re-own of the guest's campaigns to the account + retire the guest dormant (never
     *  deleted) + audit. FAIL-SAFE: any error leaves the campaigns under the guest id (recoverable), never
     *  half-migrated — we log and still sign the user in, since the data is safe under the guest. */
    private upgradeGuest(guestId: string, user: User, ip?: string | null): void {
        try {
            const moved = this.campaigns.reassignOwner(guestId, user.id); // single atomic UPDATE + "last" transfer
            this.users.linkGuest(guestId, user.id); // retire dormant (no hard delete)
            this.users.recordAudit({ actorUserId: user.id, action: 'link', targetUserId: guestId, detail: `guest→${user.provider} (${moved} campaign${moved === 1 ? '' : 's'})`, ip: ip ?? null });
        } catch (e) {
            this.log.error(`LINK-1 upgrade failed for guest ${guestId} → ${user.id}; data left under the guest (recoverable)`, e as Error);
        }
    }

    /** The gated frontend (P4) reads this to decide its state:
     *   - `authRequired` false → dev/LAN, no wall (the app is open, UNCHANGED).
     *   - `authRequired` true + `user` null → the login wall; pending/rejected → those screens; approved → in.
     *   - `devLoginAllowed` → show the flag-gated dev-login affordance (test only; James never sets it in prod).
     *   - `token` → the caller's OWN session JWT, so the SPA can hand it to the socket handshake (auth.token →
     *     the P2 ownership path). Null when unauthenticated. The httpOnly cookie still carries HTTP auth. */
    @Get('me')
    me(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response): { user: User | null; authRequired: boolean; devLoginAllowed: boolean; allowGuest: boolean; enabledProviders: string[]; token: string | null; entitlements: string[] } {
        const token = extractToken(req);
        const user = this.auth.userFromToken(token);
        // HARDEN-7 B5 — /me is the session-status poll (a @Public route the guard's refresh doesn't reach); slide
        // a valid, near-expiry session here too so a client that only polls /me still never hits the 7-day cliff.
        if (user && user.status === 'approved') {
            const exp = this.auth.tokenExpiryMs(token);
            if (exp != null && exp - Date.now() < 2 * 24 * 60 * 60 * 1000) this.setSession(res, this.auth.issueToken(user));
        }
        return {
            user,
            authRequired: AuthService.authRequired(),
            devLoginAllowed: AuthService.devLoginAllowed(),
            allowGuest: AuthService.allowGuest(), // DEPLOY-009: the wall shows the "+ guest" lane only when enabled
            enabledProviders: AuthService.enabledOAuthProviders(), // LOGIN-1: the UI renders a button ONLY per configured provider
            token: user ? (token ?? null) : null,
            entitlements: user ? this.grants.featuresFor(user.id) : [], // ODM-1 — additive; drives entitled-only surfaces (server still enforces)
        };
    }

    /** DEPLOY-009 MINT (§2) — the "+ guest" lane: create a login-free guest identity, set the session cookie,
     *  and return the ONE-TIME plaintext recovery code (the client stores it for re-display; the server keeps
     *  only the hash). The minted JWT flows through the SAME guard + handshake as OAuth. 404 unless enabled. */
    @Post('guest')
    guest(@Req() req: Request, @Res({ passthrough: true }) res: Response): { user: User; token: string; recoveryCode: string } {
        if (!AuthService.allowGuest()) throw new NotFoundException();
        const { user, recoveryCode } = this.auth.createGuest(req.ip);
        const token = this.auth.issueToken(user);
        this.setSession(res, token);
        return { user, token, recoveryCode };
    }

    /** DEPLOY-009 RECOVER (§2) — re-bind a new device from a recovery code. RATE-LIMITED per IP (≤5/min +
     *  escalating lockout — the enumeration defense). A match issues a NEW session token to this device; a
     *  miss is 401 (and still counts against the limit). 404 unless the guest tier is enabled. */
    @Post('recover')
    recover(@Body() body: { code?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response): { user: User; token: string } {
        if (!AuthService.allowGuest()) throw new NotFoundException();
        const ip = req.ip ?? 'unknown';
        const verdict = this.throttle.check(ip);
        if (!verdict.ok) {
            res.setHeader('Retry-After', String(verdict.retryAfterSec ?? 60));
            throw new HttpException('too many attempts — try again later', HttpStatus.TOO_MANY_REQUESTS);
        }
        const user = this.auth.recoverGuest(body?.code ?? '', ip);
        if (!user) throw new UnauthorizedException('invalid recovery code');
        this.throttle.reset(ip); // a legitimate recovery clears the IP's counters
        // HOTFIX-017: return the token too (parity with guest/dev-login) so the client can store it and
        // authenticate Bearer-first — recovery must work on a strict browser that blocks the cross-site cookie.
        const token = this.auth.issueToken(user);
        this.setSession(res, token);
        return { user, token };
    }

    /** HARDEN-7 B2 REGENERATE — a logged-in GUEST who lost (or never saved) its one-time recovery code mints a
     *  fresh one. AUTHENTICATED + GUEST-ONLY (resolved from the session token, since this controller is @Public):
     *  a non-guest / no session is rejected. Rate-limited per IP + audited like /recover. The old code is
     *  invalidated the instant the new hash is stored; the plaintext is returned ONCE. Row-scoped (ownerId intact). */
    @Post('recovery/regenerate')
    regenerate(@Req() req: Request, @Res({ passthrough: true }) res: Response): { recoveryCode: string } {
        if (!AuthService.allowGuest()) throw new NotFoundException();
        const ip = req.ip ?? 'unknown';
        const verdict = this.throttle.check(ip); // reuse the recover limiter — cheap abuse defense on a mutating mint
        if (!verdict.ok) {
            res.setHeader('Retry-After', String(verdict.retryAfterSec ?? 60));
            throw new HttpException('too many attempts — try again later', HttpStatus.TOO_MANY_REQUESTS);
        }
        const user = this.auth.userFromToken(extractToken(req as unknown as AuthedRequest));
        if (!user) throw new UnauthorizedException('sign in required');
        if (user.status !== 'approved') throw new UnauthorizedException('account not approved');
        const minted = this.auth.regenerateRecovery(user, ip);
        if (!minted) throw new HttpException('only guest accounts have a recovery code', HttpStatus.BAD_REQUEST); // a real OAuth GM recovers via its provider
        this.throttle.reset(ip); // a successful authenticated regenerate clears the IP's counters
        return { recoveryCode: minted.recoveryCode };
    }

    @Post('logout')
    logout(@Res({ passthrough: true }) res: Response): { ok: true } {
        clearSessionCookie(res); // HOTFIX-040 Fix B — clear with the SAME attributes it was set with, so the cross-site cookie actually drops
        return { ok: true };
    }

    /** TEST SEAM — proves the approval gate without real OAuth secrets. 404 unless BCE_ALLOW_DEV_LOGIN=1. */
    @Post('dev-login')
    devLogin(@Body() body: Partial<OAuthProfile>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        if (!AuthService.devLoginAllowed()) throw new NotFoundException();
        const profile: OAuthProfile = {
            provider: body.provider ?? 'dev',
            providerUserId: body.providerUserId ?? body.email ?? `dev-${Date.now()}`,
            email: body.email ?? null,
            displayName: body.displayName ?? null,
        };
        const user = this.auth.resolveUser(profile, req.ip);
        const token = this.establishSession(req, res, user); // LINK-1: same guest-upgrade path as the real OAuth callback
        return { user, token };
    }
}
