/*
 * BCE multi-tenant (DEPLOY-002 P4) — the GATED ROOT SHELL for the GM web bundle. Bootstrapped from
 * main.ts (the player bundle keeps the plain AppShell, so the wall is GM-only BY CONSTRUCTION — provable
 * by the bundle-isolation grep, not a route guard). It renders, against AuthService.gate():
 *   loading  → a brief splash while /auth/me resolves (no app/data shown);
 *   wall     → "Sign in with Google / GitHub" (+ the flag-gated dev-login affordance for testing);
 *   pending  → a waiting-for-approval screen;
 *   rejected → access-not-granted;
 *   open     → the actual app (<router-outlet>) + a small account chip (and the admin console for admins).
 * When auth is NOT required (dev/LAN) the gate is 'open' with no chip → the existing experience is BYTE-
 * UNCHANGED. Nothing below <router-outlet> renders until the gate opens → no app/data leak behind the wall.
 */
import { ChangeDetectionStrategy, Component, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { UpdateBannerComponent } from '../shared/update-banner';
import { LegalFooterComponent } from '../shared/legal-footer'; // COMPLIANCE-1 — persistent legal footer (every route + every gate state)
import { clearBootFallback } from '../shared/boot-fallback';

@Component({
    selector: 'app-root',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterOutlet, UpdateBannerComponent, LegalFooterComponent],
    template: `
        <bce-update-banner />
        @switch (gate()) {
            @case ('loading') {
                <div class="bg-screen"><div class="bg-card splash"><div class="bg-logo">BCE</div>
                    <div class="bg-sub">connecting to the engine…</div></div></div>
            }
            @case ('wall') {
                <div class="bg-screen"><div class="bg-card">
                    <div class="bg-logo">BATTLETECH<span>CAMPAIGN ENGINE</span></div>
                    @if (allowGuest()) {
                        <!-- DEPLOY-009: the "+ guest" lane — one click mints a login-free identity (OAuth still offered below). -->
                        <p class="bg-lead">Jump straight in as a guest — no account needed. You'll get a recovery code to write down.</p>
                        <button type="button" class="bg-btn guest" [disabled]="busy()" (click)="doGuest()">Continue as guest →</button>
                        <div class="bg-or"><span>or sign in</span></div>
                    } @else {
                        <p class="bg-lead">Game Masters sign in to reach their campaign space.</p>
                    }
                    <!-- LOGIN-1: a button ONLY for a provider actually configured on the server (enabledProviders);
                         GitHub stays hidden until its creds exist, then reappears with no frontend change. -->
                    @for (p of enabledProviders(); track p) {
                        <a class="bg-btn" [class.google]="p === 'google'" [class.github]="p === 'github'" [href]="providerUrl(p)">Sign in with {{ providerLabel(p) }}</a>
                    }
                    @if (!enabledProviders().length && !allowGuest() && !devLoginAllowed()) {
                        <p class="bg-note">No sign-in method is configured on this server.</p>
                    }
                    @if (allowGuest()) {
                        <button type="button" class="bg-link" (click)="toggleRecover()">{{ showRecover() ? 'Hide recovery' : 'Switched device? Recover with a code' }}</button>
                        @if (showRecover()) {
                            <div class="bg-recover">
                                <div class="bg-devhd">recover a guest campaign</div>
                                <input class="bg-input" type="text" autocomplete="off" inputmode="latin" placeholder="JBK7-Q2MX" maxlength="9"
                                       [value]="recoverCode()" (input)="onRecoverCode($event)" (keydown.enter)="doRecover()" aria-label="Recovery code" />
                                <button type="button" class="bg-btn ghost" [disabled]="busy()" (click)="doRecover()">Recover access</button>
                                @if (recoverErr()) { <p class="bg-err">{{ recoverErr() }}</p> }
                            </div>
                        }
                    }
                    <p class="bg-note">Players don't sign in — scan the GM's QR to join a session.</p>
                    @if (devLoginAllowed()) {
                        <div class="bg-dev">
                            <div class="bg-devhd">dev login · test seam</div>
                            <input class="bg-input" type="email" autocomplete="off" placeholder="you@example.com"
                                   [value]="devEmail()" (input)="onDevEmail($event)" (keydown.enter)="doDevLogin()" />
                            <button type="button" class="bg-btn dev" [disabled]="busy()" (click)="doDevLogin()">Dev sign in</button>
                        </div>
                    }
                </div></div>
            }
            @case ('pending') {
                <div class="bg-screen"><div class="bg-card">
                    <div class="bg-logo">BATTLETECH<span>CAMPAIGN ENGINE</span></div>
                    <div class="bg-glyph">◴</div>
                    <h2 class="bg-h">Awaiting approval</h2>
                    <p class="bg-lead">Your account <b>{{ who() }}</b> is registered and waiting for an
                        administrator to approve it. You'll get in the moment it's approved.</p>
                    <button type="button" class="bg-btn ghost" [disabled]="busy()" (click)="recheck()">Check again</button>
                    <button type="button" class="bg-link" (click)="doLogout()">Sign out</button>
                </div></div>
            }
            @case ('rejected') {
                <div class="bg-screen"><div class="bg-card">
                    <div class="bg-logo">BATTLETECH<span>CAMPAIGN ENGINE</span></div>
                    <h2 class="bg-h">Access not granted</h2>
                    <p class="bg-lead">This account doesn't have access. Contact the administrator if you
                        believe this is a mistake.</p>
                    <button type="button" class="bg-link" (click)="doLogout()">Sign out</button>
                </div></div>
            }
            @default {
                <router-outlet />
            }
        }
        <bce-legal-footer />
    `,
    styles: [`
        .bg-screen { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
            background:radial-gradient(120% 120% at 50% 0,#16202b 0,#0c0f13 60%); color:#e7edf3;
            font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif; padding:20px; box-sizing:border-box; z-index:1; }
        .bg-card { width:min(420px,94vw); background:#141a21; border:1px solid #26303c; border-radius:16px;
            padding:30px 26px; text-align:center; box-shadow:0 24px 70px rgba(0,0,0,.5); }
        .bg-card.splash { background:transparent; border:none; box-shadow:none; }
        .bg-logo { font-weight:800; letter-spacing:.16em; font-size:20px; color:#fff; line-height:1.1; }
        .bg-logo span { display:block; font-size:11px; letter-spacing:.34em; color:#7fb0e6; margin-top:4px; font-weight:600; }
        .bg-sub { margin-top:14px; color:#7f8a96; font-size:13px; letter-spacing:.04em; }
        .bg-lead { color:#b9c6d4; margin:18px 0; }
        .bg-h { font-size:19px; margin:14px 0 6px; }
        .bg-glyph { font-size:40px; color:#7fb0e6; margin-top:18px; animation:bgspin 3s linear infinite; }
        @keyframes bgspin { to { transform:rotate(360deg); } }
        .bg-btn { display:block; width:100%; box-sizing:border-box; margin:10px 0; padding:13px 16px;
            border:1px solid transparent; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer;
            text-decoration:none; letter-spacing:.02em; }
        .bg-btn.google { background:#fff; color:#222; }
        .bg-btn.github { background:#24292f; color:#fff; }
        .bg-btn.guest { background:#c79a3a; color:#1a1407; } /* DEPLOY-009: amber — ties to the recovery-code theme, distinct from OAuth */
        .bg-btn.dev { background:#2f5a6b; color:#fff; margin-top:10px; }
        .bg-btn.ghost { background:transparent; border-color:#2a3340; color:#cdd8e3; }
        .bg-btn:disabled { opacity:.55; cursor:not-allowed; }
        /* DEPLOY-009 — the guest lane affordances */
        .bg-or { display:flex; align-items:center; text-align:center; color:#6b7682; font-size:12px; margin:14px 0 8px; }
        .bg-or span { padding:0 10px; } .bg-or::before, .bg-or::after { content:''; flex:1; height:1px; background:#2a3340; }
        .bg-recover { margin-top:14px; padding-top:14px; border-top:1px dashed #2a3340; text-align:left; }
        .bg-err { color:#f2a4a4; font-size:12px; margin-top:8px; }
        .bg-note { color:#7f8a96; font-size:12px; margin-top:16px; }
        .bg-dev { margin-top:18px; padding-top:16px; border-top:1px dashed #2a3340; }
        .bg-devhd { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#6b7682; margin-bottom:8px; }
        .bg-input { width:100%; box-sizing:border-box; background:#0c0f13; border:1px solid #2a3340; color:#fff;
            border-radius:9px; padding:11px 12px; font-size:15px; }
        .bg-input:focus { outline:none; border-color:#3d6ea5; }
        .bg-link { background:none; border:none; color:#7f8a96; font-size:13px; cursor:pointer; margin-top:12px; text-decoration:underline; }
    `],
})
export class AppShellGated {
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    protected readonly gate = this.auth.gate;
    protected readonly gmUser = this.auth.gmUser;
    protected readonly isAdmin = this.auth.isAdmin;
    protected readonly devLoginAllowed = this.auth.devLoginAllowed;
    protected readonly allowGuest = this.auth.allowGuest; // DEPLOY-009
    protected readonly enabledProviders = this.auth.enabledProviders; // LOGIN-1
    protected readonly pendingBadge = this.auth.pendingBadge;

    protected readonly busy = signal(false);
    protected readonly devEmail = signal('');
    // DEPLOY-009 — the "Recover access" sub-surface on the wall.
    protected readonly showRecover = signal(false);
    protected readonly recoverCode = signal('');
    protected readonly recoverErr = signal('');
    protected readonly who = computed(() => this.auth.user()?.email || this.auth.user()?.displayName || 'this account');

    constructor() {
        // DEPLOY-003: keep the admin chip's pending badge fresh once an admin is in.
        effect(() => { if (this.auth.isAdmin()) void this.auth.refreshPending(); });
        afterNextRender(() => clearBootFallback());
    }

    protected goAdmin(): void { void this.router.navigate(['/admin']); }
    // LOGIN-1 — the sign-in buttons render from enabledProviders() (server-configured providers only).
    protected providerUrl(p: string): string { return this.auth.loginUrl(p); }
    protected providerLabel(p: string): string { return p === 'google' ? 'Google' : p === 'github' ? 'GitHub' : (p.charAt(0).toUpperCase() + p.slice(1)); }
    protected onDevEmail(e: Event): void { this.devEmail.set((e.target as HTMLInputElement).value); }

    /** After a login that lands 'open' (approved/admin), reload so the APP_INITIALIZER re-runs WITH the
     *  session cookie — the cover then shows this owner's campaigns (OAuth gets this free via its redirect;
     *  the dev-login XHR / a post-approval recheck need the explicit reload). */
    private reloadIfOpen(): void {
        if (this.auth.authRequired() && this.auth.gate() === 'open') location.reload();
    }
    protected async doDevLogin(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try { await this.auth.devLogin(this.devEmail().trim() || `gm-${Date.now()}@dev.test`); this.reloadIfOpen(); }
        finally { this.busy.set(false); }
    }

    // ── DEPLOY-009 guest lane ──
    protected async doGuest(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        this.recoverErr.set('');
        try { await this.auth.guestMint(); this.reloadIfOpen(); }
        finally { this.busy.set(false); }
    }
    protected toggleRecover(): void { this.showRecover.update((v) => !v); this.recoverErr.set(''); }
    protected onRecoverCode(e: Event): void { this.recoverCode.set((e.target as HTMLInputElement).value); }
    protected async doRecover(): Promise<void> {
        const code = this.recoverCode().trim();
        if (!code || this.busy()) return;
        this.busy.set(true);
        this.recoverErr.set('');
        try {
            await this.auth.recover(code);
            this.reloadIfOpen();
        } catch (e: unknown) {
            const status = (e as { status?: number })?.status;
            this.recoverErr.set(status === 429
                ? 'Too many attempts — wait a minute and try again.'
                : "That code didn't match a campaign. Check it and try again.");
        } finally { this.busy.set(false); }
    }
    protected async recheck(): Promise<void> {
        this.busy.set(true);
        try { await this.auth.refresh(); this.reloadIfOpen(); }
        finally { this.busy.set(false); }
    }
    protected async doLogout(): Promise<void> {
        // cover account line). Behaviour is identical — HF-016 guest confirm intact, then the wall returns.
        if (this.busy()) return;
        this.busy.set(true);
        try { await this.auth.signOut(); } finally { this.busy.set(false); }
    }
}
