/*
 * BCE retool — cover (field-dossier splash + three doors). DIRECTIVE-003
 * (+ option 02 activated D-011; + multi-save LOAD browser & RESUME-LAST D-013).
 * New BCE component layered onto the vendored MekBay app to realise MERGE-001's
 * three splash doors. Does not touch MekBay-proper.
 */
import { Component, ChangeDetectionStrategy, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { OdmCreateService } from '../campaign/odm/odm-create.service';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore, type SaveRecord } from '../campaign/campaign-save-store';
import { LoadBrowserComponent } from './load-browser';
import { ExitConfirmComponent } from '../campaign/dashboard/exit-confirm';
import { SaveDialogComponent } from '../campaign/dashboard/save-dialog';
import { LegalFooterComponent } from '../shared/legal-footer'; // COMPLIANCE-3 — inline notice in the console chrome

@Component({
    selector: 'bce-cover',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadBrowserComponent, ExitConfirmComponent, SaveDialogComponent, LegalFooterComponent],
    templateUrl: './cover.html',
    styleUrl: './cover.scss',
})
export class CoverComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly auth = inject(AuthService);
    private readonly odm = inject(OdmCreateService); // ODM-1 — the pack create path

    // HOTFIX-025 — the gated-mode account line (replaces the removed floating chip). Null in dev/LAN (no gmUser)
    // → the cover is visually unchanged there. Sign out reuses AuthService.signOut() (HF-016 guest confirm intact).
    protected readonly gmUser = this.auth.gmUser;
    protected readonly isAdmin = this.auth.isAdmin;
    protected readonly pendingBadge = this.auth.pendingBadge;
    // LINK-1 Part B1 — the guest-upgrade prompt. Keyed on the RAW session user (not the authRequired-gated
    // gmUser, which is null with auth OFF), so it shows for a guest whether or not the wall is enabled.
    protected readonly enabledProviders = this.auth.enabledProviders; // LOGIN-1
    protected readonly guestSession = computed(() => this.auth.user()?.role === 'guest');
    protected upgradeUrl(p: string): string { return this.auth.loginUrl(p); }
    protected providerLabel(p: string): string { return p === 'google' ? 'Google' : p === 'github' ? 'GitHub' : (p.charAt(0).toUpperCase() + p.slice(1)); }

    protected readonly saveCount = signal(0);
    protected readonly lastSave = signal<SaveRecord | null>(null);
    protected readonly loadOpen = signal(false);
    // D-053: the save-aware CREATE prompt (mirrors the D-013 exit confirm).
    protected readonly confirmCreate = signal(false);
    protected readonly saveOpen = signal(false);

    // engine-offline state (D-041 / MERGE-002 / T-003) — Create + Load + Resume degrade honestly;
    // door 3 (MekBay) is engine-independent and stays open.
    protected readonly online = this.store.online;
    protected readonly offlineReason = this.store.offlineReason;

    constructor() {
        void this.refresh();
        inject(DestroyRef).onDestroy(() => { this.coverGone = true; }); // AUTH-1 — the retry dies with the cover
        void this.degradedRetry(); // AUTH-1 Part 3 (trigger b)
    }

    private async refresh(): Promise<void> {
        // count()/getLast() probe the host and set the online signal as a side effect.
        this.saveCount.set(await this.store.count());
        this.lastSave.set(await this.store.getLast());
    }

    // ── AUTH-1 Part 3 — recover on reconnect (the deploy-race window heals WITHOUT a manual reload) ──
    // Two triggers, because the failure presents two ways:
    // (a) the RULED trigger — online() flips false→true (the host was DOWN: status-0/timeout marked it
    //     offline) → re-resolve the session and the cover counts;
    // (b) the DEGRADED retry — recon showed a mid-restart edge 5xx marks the host REACHABLE
    //     (campaign-save-store call(): any HTTP response = online), so online can sit TRUE through the
    //     whole window and (a) never fires. While the session resolution is transiently degraded
    //     (auth.degraded()), retry bounded (8 × 3 s); on a clean resolve, refresh the counts once.
    //     A genuinely signed-out account resolves CLEAN (user:null is a success) → no loop.
    private prevOnline: boolean | null = null;
    private readonly reconnectHeal = effect(() => {
        const on = this.store.online();
        if (this.prevOnline === false && on) void this.auth.refresh().then(() => this.refresh());
        this.prevOnline = on;
    });
    private coverGone = false;
    private async degradedRetry(): Promise<void> {
        // AUTH-1 follow-up (PM question): the original 8 × 3 s bound was a sensible default, NOT measured
        // against Railway restarts — which can exceed 24 s cold. 20 × 3 s (60 s) closes the window; the
        // loop exits on the FIRST clean resolve, so the longer bound costs nothing on a healthy boot.
        for (let i = 0; i < 20 && !this.coverGone; i++) {
            await new Promise((r) => setTimeout(r, 3000));
            if (this.coverGone) return;
            if (!this.auth.resolved()) continue; // the boot /me is still in flight — judge next tick
            if (!this.auth.degraded()) return; // conclusive resolve (signed in, out, OR 401) — nothing to heal
            await this.auth.refresh();
            if (!this.auth.degraded()) { await this.refresh(); return; } // healed — counts once, done
        }
    }

    /** HOTFIX-028 — "Reset app data": route through the pre-bootstrap ?fresh=1 path (evict SWs + caches + IDB
     *  mirrors + bce.* localStorage EXCEPT device token / player name, then reload). One code path, so the
     *  in-app affordance and the support healing link behave identically. Campaigns live on the host. */
    protected async resetAppData(): Promise<void> {
        // HOTFIX-040 Fix C — drop the local session token + guest keys AND clear the server cookie (matching
        // attributes) BEFORE the ?fresh=1 reload. Otherwise a surviving cross-site cookie re-authenticates on
        // the reload (/auth/me re-mints the token) and "Reset" appears to do nothing.
        await this.auth.clearSession();
        location.href = `${location.pathname}?fresh=1`;
    }

    /** Door 1 — Create a campaign. D-053: when a campaign exists (Resume is live), PROMPT to save/name
     *  it first (save-aware, mirroring the D-013 exit confirm) so CREATE can never feel like — or risk —
     *  losing the active campaign. Declining still never deletes it: the host keeps every campaign as its
     *  own record, and CREATE only writes a NEW record at Begin. Requires the host — no-op when offline. */
    protected createCampaign(): void {
        if (!this.online()) return;
        if (this.lastSave()) { this.confirmCreate.set(true); return; }
        this.doCreate();
    }
    /** Proceed into the fresh wizard. Reset so CREATE always opens clean (boot rehydration may have
     *  pre-populated state); existing saves are untouched — no persistCurrent fires before Begin (the
     *  wizard steps don't persist; the prior record stands until the new campaign writes its own). */
    protected doCreate(): void {
        this.confirmCreate.set(false);
        this.saveOpen.set(false);
        this.state.reset();
        void this.router.navigate(['/campaign/new/setup']); // D-108 — Setup card is the new first step
    }
    // save-aware CREATE wiring (mirrors the dashboard D-013 exit→save flow) ──────────────────────
    protected createSaveAs(): void { this.saveOpen.set(true); } // the confirm hides while the save dialog is open
    protected async createQuickSave(): Promise<void> { await this.store.quickSave(); this.doCreate(); }
    protected onCreateSaved(): void { this.doCreate(); } // named/quick save committed → into the fresh wizard
    protected onCreateSaveCancel(): void { this.saveOpen.set(false); } // back to the confirm (confirmCreate still set)
    protected cancelCreate(): void { this.confirmCreate.set(false); }

    /** Door — Quick Mission (D-067): a one-shot from the cover. Reuses the era → faction → force setup with
     *  the quickMission flag set, then drops into the reduced dashboard (roster + market + Deploy). EPHEMERAL —
     *  it never writes a campaign record (no Begin save), so it can't lose an active save; no save-aware prompt
     *  is needed, and reset() clears only the in-memory wizard state. Requires the host (no-op offline). */
    // ── DIRECTIVE-ODM-1 — the hidden pack door (entitled-only; dev/LAN permissive; server enforces regardless) ──
    protected odmEntitled(): boolean { return this.auth.hasPack('odm'); }
    protected readonly odmBusy = signal(false);
    /** The door card's copy comes from the SERVER manifest, never the bundle — a dist grep must show zero pack
     *  data (title/company) to the non-entitled. Card renders only once the entitled fetch lands. */
    protected readonly odmCard = signal<{ title: string; blurb: string } | null>(null);
    private readonly odmCardFetch = effect(() => {
        if (!this.odmEntitled() || !this.online() || this.odmCard()) return;
        void this.odm.manifest().then((m) => { if (m) this.odmCard.set({ title: m.title, blurb: m.blurb ?? '' }); }).catch(() => undefined);
    });
    protected async startOdm(): Promise<void> {
        if (!this.online() || this.odmBusy()) return;
        this.odmBusy.set(true);
        try { await this.odm.begin(); }
        catch (e) { console.error('[ODM-1] create failed', e); }
        finally { this.odmBusy.set(false); }
    }

    protected quickMission(): void {
        if (!this.online()) return;
        this.state.reset();
        this.state.setQuickMission(true);
        void this.router.navigate(['/campaign/new/setup']); // D-108 — Setup card is the new first step (quick mission)
    }

    /** Door 2 — Load a campaign → the browser of all saves (disabled when empty or offline). */
    protected openLoad(): void {
        if (this.online() && this.saveCount() > 0) this.loadOpen.set(true);
    }
    protected async onPick(rec: SaveRecord): Promise<void> {
        this.loadOpen.set(false);
        await this.store.loadAndSetLast(rec);
        void this.router.navigate(['/campaign']);
    }

    /** Resume-last — the quick continue, distinct from the LOAD browser. */
    protected async resumeLast(): Promise<void> {
        const rec = this.lastSave();
        if (!rec) return;
        await this.store.loadAndSetLast(rec);
        void this.router.navigate(['/campaign']);
    }

    /** Door 3 — Launch MekBay local → MekBay's existing main view (campaign-context = null). */
    protected launchMekbay(): void {
        void this.router.navigate(['/app']);
    }

    // ── HOTFIX-025 — account controls relocated from the removed floating chip ──
    protected signOut(): void { void this.auth.signOut(); } // HF-016 guest confirm + return to cover (shared logic)
    protected goAdmin(): void { void this.router.navigate(['/admin']); }
}
