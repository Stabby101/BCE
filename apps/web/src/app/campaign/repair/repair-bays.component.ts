import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ForgePackService } from '../mission/forge-pack.service';
import { RepairBaysService, type QueueItem, type QueueKind, type BayView } from './repair-bays.service';
import { remainingHours, jobSummary, partsNeeded, type BayHistoryEntry } from './repair-bays';
import { formatDate } from '../clock/campaign-clock';

@Component({
    selector: 'bce-repair-bays',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './repair-bays.component.html',
    styleUrl: './repair-bays.component.scss',
})
export class RepairBaysComponent {
    private readonly svc = inject(RepairBaysService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pack = inject(ForgePackService);

    protected readonly queue = this.svc.queue;
    protected readonly bays = this.svc.bayViews;
    protected readonly history = this.svc.history;
    protected readonly freeBays = this.svc.freeBays;
    protected readonly perDayHours = this.svc.perDayHours;
    protected readonly treasury = computed(() => this.state.treasury() ?? 0);
    protected readonly tierLabel = computed(() => {
        const t = this.state.resources() || 'standard';
        return t.charAt(0).toUpperCase() + t.slice(1);
    });

    /** Bumped when the lazy pack lands (the armorer attribution needs the voice record). */
    private readonly ready = signal(this.pack.isLoaded() ? 1 : 0);
    constructor() {
        if (this.svc.ensureTechPool()) void this.store.persistCurrent();
        if (!this.pack.isLoaded()) void this.pack.ensureLoaded().then(() => this.ready.update((v) => v + 1));
    }

    protected readonly pool = this.svc.techPool;
    /** The chief armorer's attribution line (the engineering staff voice; absent = unsigned shop). */
    protected readonly armorer = computed(() => {
        this.ready();
        const v = this.pack.voiceById(this.state.staffVoices()['engineering']);
        return v ? v.name : null;
    });
    protected summary(label: string, bill: BayView['bill'], hours: number, cost: number): string {
        return jobSummary(label, bill, hours, cost);
    }
    protected parts(bill: BayView['bill']): string | null {
        return partsNeeded(bill);
    }
    protected histSummary(h: BayHistoryEntry): string {
        return h.outcome === 'written-off'
            ? `${h.label} — struck from the rolls; the wreck went to scrap.`
            : jobSummary(h.label, h.bill, h.laborHours, h.cost);
    }
    protected histParts(h: BayHistoryEntry): string | null {
        return h.outcome === 'completed' ? partsNeeded(h.bill) : null;
    }

    // ── local UI state ──
    protected readonly exploded = signal<Set<string>>(new Set());
    protected readonly assigning = signal<string | null>(null);     // instanceId picking a bay
    protected readonly confirmWO = signal<string | null>(null);     // instanceId pending write-off confirm
    protected readonly showHistory = signal(false);

    protected readonly KIND_LABEL: Record<QueueKind, string> = { repair: 'Recovered', prize: 'Prize', skirmish: 'Skirmish' };

    protected toggleExplode(id: string): void {
        this.exploded.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
    protected isExploded(id: string): boolean { return this.exploded().has(id); }

    // ── queue helpers ──
    protected itemCost(it: QueueItem): number { return this.svc.cost(it.bill.totalHours); }
    protected itemWarn(it: QueueItem): boolean { return this.svc.wouldExceedTreasury(this.itemCost(it)); }

    protected startAssign(instanceId: string): void { this.assigning.set(instanceId); }
    protected cancelAssign(): void { this.assigning.set(null); }
    protected doAssign(instanceId: string, bayId: string): void {
        this.svc.assign(instanceId, bayId);
        this.assigning.set(null);
    }

    protected askWriteOff(instanceId: string): void { this.confirmWO.set(instanceId); }
    protected cancelWriteOff(): void { this.confirmWO.set(null); }
    protected doWriteOff(instanceId: string): void { this.svc.writeOff(instanceId); this.confirmWO.set(null); }

    // ── bay helpers ──
    protected unassign(bayId: string): void { this.svc.unassign(bayId); }
    protected remaining(bay: BayView): number { return remainingHours(bay); }
    protected progressPct(bay: BayView): number {
        return bay.laborHours > 0 ? Math.min(100, Math.round((bay.hoursSpent / bay.laborHours) * 100)) : 0;
    }
    protected etaDays(bay: BayView): number | null { return this.svc.etaDays(bay); }

    protected fmtDate(d: { y: number; m: number; d: number }): string { return formatDate(d); }
    protected money(n: number): string { return n.toLocaleString('en-US'); }
}
