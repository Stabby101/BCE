import { Component, ChangeDetectionStrategy, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TableReturnService } from '../shared/table-return.service';
import { safeTablePath } from '../shared/return-to';
import { AuthService } from '../auth/auth.service';
import { OdmCreateService } from '../campaign/odm/odm-create.service';
import { NewCampaignState } from '../campaign/new-campaign-state';
import { CampaignSaveStore, type SaveRecord } from '../campaign/campaign-save-store';
import { LoadBrowserComponent } from './load-browser';
import { odmDoorDecision } from './odm-door';
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
    private readonly tableReturn = inject(TableReturnService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly auth = inject(AuthService);
    private readonly odm = inject(OdmCreateService);

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
    protected readonly confirmCreate = signal(false);
    protected readonly saveOpen = signal(false);

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
        await this.openFromTable();
        // the force-new escape hatch's visibility (shown only when there IS something to duplicate). Entitled
        // accounts only, so a non-ODM account pays nothing; failures leave it null (the door still works).
        if (this.odmEntitled()) {
            try {
                const mine = await this.odmCampaigns();
                this.odmHasExisting.set(mine.slice().sort((x, y) => this.touchedAt(y) - this.touchedAt(x))[0] ?? null);
                // anyone else). A co-GM's door — decided by the same rule that opens it — never shows it.
                const u = this.auth.user();
                const door = odmDoorDecision(mine, { authRequired: this.auth.authRequired(), id: u?.id ?? null, role: u?.role ?? null });
                this.odmCoGm.set(door.kind === 'enter' && door.coGm);
            } catch { this.odmHasExisting.set(null); this.odmCoGm.set(false); }
        }
    }

    private async openFromTable(): Promise<void> {
        let params: URLSearchParams;
        try { params = new URLSearchParams(location.search); } catch { return; }
        const id = params.get('campaign'); if (!id) return;
        const rec = await this.store.get(id); // owner-scoped: not yours (or not found) → null → normal cover
        if (!rec) return;
        this.tableReturn.set(safeTablePath(params.get('returnTo'))); // null when absent/unsafe → no Back control (still opens the campaign)
        await this.store.loadAndSetLast(rec);
        void this.router.navigate(['/campaign']);
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

    protected async resetAppData(): Promise<void> {
        // attributes) BEFORE the ?fresh=1 reload. Otherwise a surviving cross-site cookie re-authenticates on
        // the reload (/auth/me re-mints the token) and "Reset" appears to do nothing.
        await this.auth.clearSession();
        location.href = `${location.pathname}?fresh=1`;
    }

    protected createCampaign(): void {
        if (!this.online()) return;
        this.gmNext = false;
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
        if (this.gmNext) { this.gmNext = false; this.state.setGmSession(true); }
        void this.router.navigate(['/campaign/new/setup']);
    }
    protected createSaveAs(): void { this.saveOpen.set(true); } // the confirm hides while the save dialog is open
    protected async createQuickSave(): Promise<void> { await this.store.quickSave(); this.doCreate(); }
    protected onCreateSaved(): void { this.doCreate(); } // named/quick save committed → into the fresh wizard
    protected onCreateSaveCancel(): void { this.saveOpen.set(false); } // back to the confirm (confirmCreate still set)
    protected cancelCreate(): void { this.confirmCreate.set(false); this.gmNext = false; }

    protected odmEntitled(): boolean { return this.auth.hasPack('odm'); }
    protected readonly odmBusy = signal(false);
    /** The door card's copy comes from the SERVER manifest, never the bundle — a dist grep must show zero pack
     *  data (title/company) to the non-entitled. Card renders only once the entitled fetch lands. */
    protected readonly odmCard = signal<{ title: string; blurb: string } | null>(null);
    private readonly odmCardFetch = effect(() => {
        if (!this.odmEntitled() || !this.online() || this.odmCard()) return;
        void this.odm.manifest().then((m) => { if (m) this.odmCard.set({ title: m.title, blurb: m.blurb ?? '' }); }).catch(() => undefined);
    });
    /** The account's ODM campaigns, owner-scoped by the server (store.list() is the existing REST read). */
    private async odmCampaigns(): Promise<SaveRecord[]> {
        const all = await this.store.list();
        return (all ?? []).filter((r) => (r?.snapshot as { packId?: string } | null)?.packId === 'odm');
    }
    protected async startOdm(): Promise<void> {
        if (!this.online() || this.odmBusy()) return;
        this.odmBusy.set(true);
        try {
            const mine = await this.odmCampaigns();
            // anomaly picker is never shown to it (the picker is the OWNER's). The owner's routing is unchanged.
            const u = this.auth.user();
            const door = odmDoorDecision(mine, { authRequired: this.auth.authRequired(), id: u?.id ?? null, role: u?.role ?? null });
            if (door.kind === 'create') { await this.odm.begin(); return; }     // none → create, as today
            if (door.kind === 'enter') { await this.enterOdm(door.rec); return; } // the normal path, every time
            /* 2+ is an ANOMALY under the singleton rule, not a menu. Never pick for him — auto-resuming the
               NEWEST would be exactly wrong: the newest may be the stray instance minted by accident, and
               silently entering it would CONFIRM the fork instead of catching it. The picker IS the alarm. */
            this.odmForked.set(door.recs.sort((a, b) => this.touchedAt(b) - this.touchedAt(a)));
        } catch (e) { console.error('[] entry failed', e); }
        finally { this.odmBusy.set(false); }
    }
    /** Resume an existing ODM campaign — the same load Resume-last uses; nothing ODM-specific about it. */
    protected async enterOdm(rec: SaveRecord): Promise<void> {
        this.odmForked.set(null);
        await this.store.loadAndSetLast(rec);
        void this.router.navigate(['/campaign']);
    }
    /** The anomaly list (null = no anomaly). Rendered as an alarm, not a friendly chooser. */
    protected readonly odmForked = signal<SaveRecord[] | null>(null);
    protected dismissForked(): void { this.odmForked.set(null); }

    /** LAST-TOUCHED, with a fallback chain: `updatedAt` is host-owned, `savedAt` comes off the snapshot, and
     *  a row missing both would otherwise sort as 0 and sink. Sorting on one field is what put a newer-touched
     *  campaign below an older one. */
    private touchedAt(r: SaveRecord): number { return r.updatedAt ?? r.savedAt ?? r.createdAt ?? 0; }
    private dateOf(r: SaveRecord, k: 'currentDate' | 'startDate'): { y: number; m: number; d: number } | null {
        return (r.snapshot as unknown as Record<string, { y: number; m: number; d: number } | undefined> | null)?.[k] ?? null;
    }
    /** PLAYED = the campaign clock has moved off its start date. The only field that separates a real
     *  campaign from a stillborn one, which is why it is the row's primary text. */
    protected isPlayed(r: SaveRecord): boolean {
        const cur = this.dateOf(r, 'currentDate'), start = this.dateOf(r, 'startDate');
        if (!cur) return false;
        if (!start) return true; // a clock with no recorded start — treat as real rather than hide it
        return cur.y !== start.y || cur.m !== start.m || cur.d !== start.d;
    }
    protected odmDay(r: SaveRecord): string {
        const d = this.dateOf(r, 'currentDate');
        if (!d) return 'clock not started';
        return `${String(d.d).padStart(2, '0')} ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.m] ?? '???'} ${d.y}`;
    }
    protected odmTouched(r: SaveRecord): string {
        const t = this.touchedAt(r);
        return t ? `last opened ${new Date(t).toLocaleString()}` : 'never opened';
    }
    protected readonly forkedPlayed = computed(() => (this.odmForked() ?? []).filter((r) => this.isPlayed(r)));
    protected readonly forkedUnplayed = computed(() => (this.odmForked() ?? []).filter((r) => !this.isPlayed(r)));
    protected readonly showUnplayed = signal(false);
    protected toggleUnplayed(): void { this.showUnplayed.update((v) => !v); }

    protected readonly confirmDelete = signal<SaveRecord | null>(null);
    protected readonly confirmBulk = signal(false);
    protected readonly deleteBusy = signal(false);
    protected askDelete(r: SaveRecord): void { this.confirmDelete.set(r); }
    protected cancelDelete(): void { this.confirmDelete.set(null); }
    protected askBulk(): void { this.confirmBulk.set(true); }
    protected cancelBulk(): void { this.confirmBulk.set(false); }

    /** The confirm names the CAMPAIGN DAY, not the id — the day is what he recognises, and the ids are 21
     *  near-identical autosave stamps. It also states the checkpoints go too: this is the only irreversible
     *  step in the whole flow, and remove() purges the campaign's checkpoint history with it. */
    protected deleteQuestion(r: SaveRecord): string {
        return `Delete the campaign at ${this.odmDay(r)}? Its checkpoint history is deleted with it — this cannot be undone.`;
    }
    protected async doDelete(r: SaveRecord): Promise<void> {
        if (this.deleteBusy()) return;
        this.deleteBusy.set(true);
        try { await this.store.remove(r.id); await this.reReadForked(); }
        catch (e) { console.error('[] delete failed', e); }
        finally { this.deleteBusy.set(false); this.confirmDelete.set(null); }
    }
    /** The BULK action, confined to the provable set. It re-reads `forkedUnplayed()` at call time rather than
     *  trusting a captured list, so a row that became played between render and confirm cannot be caught. */
    protected async doDeleteUnplayed(): Promise<void> {
        if (this.deleteBusy()) return;
        this.deleteBusy.set(true);
        try {
            for (const r of this.forkedUnplayed()) await this.store.remove(r.id);
            await this.reReadForked();
        } catch (e) { console.error('[] bulk delete failed', e); }
        finally { this.deleteBusy.set(false); this.confirmBulk.set(false); }
    }
    /** Re-derive from the SERVER after any delete — never splice the local array. The list on screen is then
     *  the host's truth, so a partially-failed bulk shows what actually remains instead of what we hoped. */
    private async reReadForked(): Promise<void> {
        const mine = await this.odmCampaigns();
        this.odmForked.set(mine.slice().sort((a, b) => this.touchedAt(b) - this.touchedAt(a)));
        await this.refresh();
    }
    /** The heading tells the truth about the CURRENT count — after a cleanup it is no longer an anomaly, and
     *  an alarm that keeps shouting after the problem is fixed teaches people to ignore alarms. */
    protected forkedHeading(): string {
        const n = (this.odmForked() ?? []).length;
        if (n === 0) return 'No ODM campaigns remain.';
        if (n === 1) return 'One ODM campaign remains.';
        return `You have ${n} ODM campaigns. That is not supposed to happen.`;
    }
    protected startNewFromPicker(): void {
        this.odmForked.set(null);
        if (this.odmHasExisting()) this.confirmOdmNew.set(true);
        else void this.doOdmNew();
    }
    protected odmWhen(r: SaveRecord): string {
        const d = (r.snapshot as { currentDate?: { y: number; m: number; d: number } } | null)?.currentDate;
        const clock = d ? `campaign day ${d.y}-${String(d.m + 1).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : 'clock not started';
        return `created ${new Date(r.createdAt ?? 0).toLocaleString()} · last touched ${new Date(r.updatedAt ?? 0).toLocaleString()} · ${clock}`;
    }

    /* FORCE NEW — the deliberate escape hatch from resume, shown ONLY when a campaign already exists (with
       none, the normal door already creates and this would be a second way to do the same thing — fewer
       live paths to the dangerous button). It does NOT delete, archive or hide the existing campaign: it
       mints a SECOND, which trips the anomaly alarm above on next entry. That is correct — the alarm doing
       its job. The confirm names the campaign it is about to duplicate, in plain words. */
    protected readonly odmHasExisting = signal<SaveRecord | null>(null);
    protected readonly odmCoGm = signal(false);
    protected readonly confirmOdmNew = signal(false);
    protected askOdmNew(): void { if (this.online() && this.odmHasExisting() && !this.odmCoGm()) this.confirmOdmNew.set(true); }
    protected cancelOdmNew(): void { this.confirmOdmNew.set(false); }
    protected async doOdmNew(): Promise<void> {
        this.confirmOdmNew.set(false);
        if (!this.online() || this.odmBusy()) return;
        this.odmBusy.set(true);
        this.store.armForceNew();
        try { await this.odm.begin(); }
        catch (e) { console.error('[] force-new failed', e); }
        finally { this.odmBusy.set(false); }
    }
    protected odmNewQuestion(): string {
        const r = this.odmHasExisting();
        const when = r ? new Date(r.updatedAt ?? 0).toLocaleDateString() : '';
        return `You already have an ODM campaign (last touched ${when}). This creates a SECOND one — it does not replace or delete the first.`;
    }

    protected quickMission(): void {
        if (!this.online()) return;
        this.state.reset();
        this.state.setQuickMission(true);
        void this.router.navigate(['/campaign/new/setup']);
    }

    //    full HS campaign with the additive gmSession flag; the tile rides the SAME save-aware CREATE confirm
    //    the Setup card locks the system to Hot Spots when it sees gmSession. ──
    protected gmEntitled(): boolean { return this.auth.hasPack('gm-mode'); }
    private gmNext = false;
    protected startGmSession(): void {
        if (!this.online()) return;
        this.gmNext = true;
        if (this.lastSave()) { this.confirmCreate.set(true); return; }
        this.doCreate();
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

    protected signOut(): void { void this.auth.signOut(); } // HF-016 guest confirm + return to cover (shared logic)
    protected goAdmin(): void { void this.router.navigate(['/admin']); }
}
