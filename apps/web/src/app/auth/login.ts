/*
 * DIRECTIVE-LINK-1 Part B2 — the always-available LOGIN SCREEN. The authRequired sign-in WALL (app-shell-gated)
 * only renders in the gate() === 'wall' state, which needs BCE_AUTH_REQUIRED — and we keep that OFF, so the wall
 * never shows and a logout would otherwise drop straight back into the open app. This standalone /login view
 * renders in the 'open' state (a plain route) and offers the SAME choices as the wall — a provider button per
 * enabledProviders (LOGIN-1) + Continue as guest + recover-with-a-code — reusing AuthService's handlers.
 *
 * It is the FALLBACK entry, not the transfer path: a signed-out visitor has no guest session to migrate. The
 * lossless upgrade (Part A) happens when a STILL-signed-in guest clicks the cover's "save your account" prompt.
 * On a successful guest/recover/dev sign-in we hard-navigate to '/' so the app re-boots with the new session.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

@Component({
    selector: 'bce-login',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="lg-screen"><div class="lg-card">
            <div class="lg-logo">BATTLETECH<span>CAMPAIGN ENGINE</span></div>
            @if (allowGuest()) {
                <p class="lg-lead">Jump straight in as a guest — no account needed. You'll get a recovery code to write down.</p>
                <button type="button" class="lg-btn guest" [disabled]="busy()" (click)="doGuest()">Continue as guest →</button>
                <div class="lg-or"><span>or sign in</span></div>
            } @else {
                <p class="lg-lead">Sign in to reach your campaign space.</p>
            }
            @for (p of enabledProviders(); track p) {
                <a class="lg-btn" [class.google]="p === 'google'" [class.github]="p === 'github'" [href]="providerUrl(p)">Sign in with {{ providerLabel(p) }}</a>
            }
            @if (allowGuest()) {
                <button type="button" class="lg-link" (click)="toggleRecover()">{{ showRecover() ? 'Hide recovery' : 'Switched device? Recover with a code' }}</button>
                @if (showRecover()) {
                    <div class="lg-recover">
                        <input class="lg-input" type="text" autocomplete="off" inputmode="latin" placeholder="JBK7-Q2MX" maxlength="9"
                               [value]="recoverCode()" (input)="onRecoverCode($event)" (keydown.enter)="doRecover()" aria-label="Recovery code" />
                        <button type="button" class="lg-btn ghost" [disabled]="busy()" (click)="doRecover()">Recover access</button>
                        @if (recoverErr()) { <p class="lg-err">{{ recoverErr() }}</p> }
                    </div>
                }
            }
            <p class="lg-note">Players don't sign in — scan the GM's QR to join a session.</p>
            @if (devLoginAllowed()) {
                <div class="lg-dev">
                    <div class="lg-devhd">dev login · test seam</div>
                    <input class="lg-input" type="email" autocomplete="off" placeholder="you@example.com"
                           [value]="devEmail()" (input)="onDevEmail($event)" (keydown.enter)="doDevLogin()" />
                    <button type="button" class="lg-btn dev" [disabled]="busy()" (click)="doDevLogin()">Dev sign in</button>
                </div>
            }
        </div></div>
    `,
    styles: [`
        .lg-screen { position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
            background:radial-gradient(120% 120% at 50% 0,#16202b 0,#0c0f13 60%); color:#e7edf3;
            font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif; padding:20px; box-sizing:border-box; z-index:1; }
        .lg-card { width:min(420px,94vw); background:#141a21; border:1px solid #26303c; border-radius:16px;
            padding:30px 26px; text-align:center; box-shadow:0 24px 70px rgba(0,0,0,.5); }
        .lg-logo { font-weight:800; letter-spacing:.16em; font-size:20px; color:#fff; line-height:1.1; }
        .lg-logo span { display:block; font-size:11px; letter-spacing:.34em; color:#7fb0e6; margin-top:4px; font-weight:600; }
        .lg-lead { color:#b9c6d4; margin:18px 0; }
        .lg-btn { display:block; width:100%; box-sizing:border-box; margin:10px 0; padding:13px 16px;
            border:1px solid transparent; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer;
            text-decoration:none; letter-spacing:.02em; }
        .lg-btn.google { background:#fff; color:#222; }
        .lg-btn.github { background:#24292f; color:#fff; }
        .lg-btn.guest { background:#c79a3a; color:#1a1407; }
        .lg-btn.dev { background:#2f5a6b; color:#fff; margin-top:10px; }
        .lg-btn.ghost { background:transparent; border-color:#2a3340; color:#cdd8e3; }
        .lg-btn:disabled { opacity:.55; cursor:not-allowed; }
        .lg-or { display:flex; align-items:center; text-align:center; color:#6b7682; font-size:12px; margin:14px 0 8px; }
        .lg-or span { padding:0 10px; } .lg-or::before, .lg-or::after { content:''; flex:1; height:1px; background:#2a3340; }
        .lg-recover { margin-top:14px; padding-top:14px; border-top:1px dashed #2a3340; text-align:left; }
        .lg-err { color:#f2a4a4; font-size:12px; margin-top:8px; }
        .lg-note { color:#7f8a96; font-size:12px; margin-top:16px; }
        .lg-dev { margin-top:18px; padding-top:16px; border-top:1px dashed #2a3340; }
        .lg-devhd { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#6b7682; margin-bottom:8px; }
        .lg-input { width:100%; box-sizing:border-box; background:#0c0f13; border:1px solid #2a3340; color:#fff;
            border-radius:9px; padding:11px 12px; font-size:15px; }
        .lg-input:focus { outline:none; border-color:#3d6ea5; }
        .lg-link { background:none; border:none; color:#7f8a96; font-size:13px; cursor:pointer; margin-top:12px; text-decoration:underline; }
    `],
})
export class LoginComponent {
    private readonly auth = inject(AuthService);

    protected readonly allowGuest = this.auth.allowGuest;
    protected readonly enabledProviders = this.auth.enabledProviders; // LOGIN-1
    protected readonly devLoginAllowed = this.auth.devLoginAllowed;
    protected readonly busy = signal(false);
    protected readonly devEmail = signal('');
    protected readonly showRecover = signal(false);
    protected readonly recoverCode = signal('');
    protected readonly recoverErr = signal('');

    protected providerUrl(p: string): string { return this.auth.loginUrl(p); }
    protected providerLabel(p: string): string { return p === 'google' ? 'Google' : p === 'github' ? 'GitHub' : (p.charAt(0).toUpperCase() + p.slice(1)); }
    protected onDevEmail(e: Event): void { this.devEmail.set((e.target as HTMLInputElement).value); }
    protected onRecoverCode(e: Event): void { this.recoverCode.set((e.target as HTMLInputElement).value); }
    protected toggleRecover(): void { this.showRecover.update((v) => !v); this.recoverErr.set(''); }

    /** Into the app once a session exists — hard-navigate so the APP_INITIALIZER re-runs with the new cookie. */
    private enter(): void { location.assign('/'); }

    protected async doGuest(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true); this.recoverErr.set('');
        try { await this.auth.guestMint(); this.enter(); } finally { this.busy.set(false); }
    }
    protected async doRecover(): Promise<void> {
        const code = this.recoverCode().trim();
        if (!code || this.busy()) return;
        this.busy.set(true); this.recoverErr.set('');
        try { await this.auth.recover(code); this.enter(); }
        catch (e: unknown) {
            const status = (e as { status?: number })?.status;
            this.recoverErr.set(status === 429 ? 'Too many attempts — wait a minute and try again.' : "That code didn't match a campaign. Check it and try again.");
        } finally { this.busy.set(false); }
    }
    protected async doDevLogin(): Promise<void> {
        if (this.busy()) return;
        this.busy.set(true);
        try { await this.auth.devLogin(this.devEmail().trim() || `gm-${Date.now()}@dev.test`); this.enter(); }
        finally { this.busy.set(false); }
    }
}
