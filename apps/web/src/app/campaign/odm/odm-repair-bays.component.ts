import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { ForgePackService } from '../mission/forge-pack.service';
import { OdmRepairBaysService, type QueueKind, type BayView } from './odm-repair-bays.service';
import { OdmContactsService } from './odm-contacts.service';
import { remainingHours, jobSummary, type BayHistoryEntry } from '../repair/repair-bays';
import { formatDate } from '../clock/campaign-clock';

@Component({
    selector: 'bce-odm-repair-bays',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-repair-bays.component.html',
    styleUrls: ['../repair/repair-bays.component.scss' /* SHARED */, './odm-repair-bays.component.scss'],
})
export class OdmRepairBaysComponent {
    private readonly svc = inject(OdmRepairBaysService);
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pack = inject(ForgePackService);
    private readonly contacts = inject(OdmContactsService);

    protected readonly queue = this.svc.queue;
    protected readonly bays = this.svc.bayViews;
    protected readonly history = this.svc.history;
    protected readonly freeBays = this.svc.freeBays;
    protected readonly perDayHours = this.svc.perDayHours;
    protected readonly donors = this.svc.donors;
    // rolled pool: the tier never keyed anything honest in this fork).
    protected readonly shop = this.svc.shopFile;
    protected poolHours(id: string): number { return this.svc.poolHoursOf(id); }
    protected readonly committed = this.svc.committedHours;
    protected heldLine(bay: BayView): string { return this.svc.heldLineFor(bay); }
    protected readonly maintDue = this.svc.maintenanceDue;
    protected readonly salvageBayOk = this.svc.salvageBayOperational;
    protected jobPri(bay: BayView): number { return this.svc.jobPriorityOf(bay); }
    protected setPriority(bayId: string, p: number): void { this.svc.setJobPriority(bayId, p as 1 | 2 | 3 | 4); }
    protected convertBay(bayId: string, type: 'GENERAL' | 'SALVAGE'): void { this.svc.setBayType(bayId, type); }
    protected assignableBays(it: { kind: string }) { return this.freeBays().filter((b) => it.kind !== 'prize' || b.type === 'SALVAGE'); } // D36 — prize refits route through SALVAGE

    private readonly ready = signal(this.pack.isLoaded() ? 1 : 0);
    constructor() {
        if (this.svc.ensureTechPool()) void this.store.persistCurrent();
        if (!this.pack.isLoaded()) void this.pack.ensureLoaded().then(() => this.ready.update((v) => v + 1));
        void this.contacts.ensureLoaded().then(() => this.ready.update((v) => v + 1));
        this.svc.settleAttempt(this.svc.bays());
    }

    protected readonly armorer = computed(() => {
        this.ready();
        return this.contacts.bySlot('engineering')?.name ?? null;
    });
    protected summary(label: string, bill: BayView['bill'], hours: number): string {
        return jobSummary(label, bill, hours, 0).replace(/, 0 C-bills against the books/g, '').replace(/,\s*0 C-bills[^.]*\./g, '.');
    }
    protected histSummary(h: BayHistoryEntry): string {
        return h.outcome === 'written-off'
            ? `${h.label} — struck from the rolls; the wreck went to scrap.`
            : this.summary(h.label, h.bill, h.laborHours);
    }

    // ── local UI state ──
    protected readonly exploded = signal<Set<string>>(new Set());
    protected readonly assigning = signal<string | null>(null);
    protected readonly confirmWO = signal<string | null>(null);
    protected readonly confirmDonor = signal<string | null>(null);
    protected readonly showHistory = signal(false);

    protected readonly KIND_LABEL: Record<QueueKind, string> = { repair: 'Recovered', prize: 'Hulk', skirmish: 'Skirmish' };

    protected toggleExplode(id: string): void {
        this.exploded.update((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }
    protected isExploded(id: string): boolean { return this.exploded().has(id); }

    protected startAssign(instanceId: string): void { this.assigning.set(instanceId); }
    protected cancelAssign(): void { this.assigning.set(null); }
    protected doAssign(instanceId: string, bayId: string): void {
        this.svc.assign(instanceId, bayId);
        this.assigning.set(null);
    }

    protected askWriteOff(instanceId: string): void { this.confirmWO.set(instanceId); }
    protected cancelWriteOff(): void { this.confirmWO.set(null); }
    protected doWriteOff(instanceId: string): void { this.svc.writeOff(instanceId); this.confirmWO.set(null); }

    protected askDonor(instanceId: string): void { this.confirmDonor.set(instanceId); }
    protected cancelDonor(): void { this.confirmDonor.set(null); }
    protected doDonor(instanceId: string): void { this.svc.donorStrip(instanceId); this.confirmDonor.set(null); }
    protected donorYield(instanceId: string): string {
        const d = this.donors().find((x) => x.inst.instanceId === instanceId);
        if (!d) return '';
        const ammo = d.yield.ammo.reduce((s, a) => s + a.tons, 0);
        const parts = d.yield.parts.reduce((s, p) => s + p.count, 0);
        if (!ammo && !parts) return 'nothing recoverable';
        return `≈ ${ammo ? `${Math.round(ammo * 10) / 10} t ammo` : ''}${ammo && parts ? ' · ' : ''}${parts ? `${parts} part${parts === 1 ? '' : 's'}` : ''}`;
    }

    protected unassign(bayId: string): void { this.svc.unassign(bayId); }
    protected remaining(bay: BayView): number { return remainingHours(bay); }
    protected progressPct(bay: BayView): number {
        return bay.laborHours > 0 ? Math.min(100, Math.round((bay.hoursSpent / bay.laborHours) * 100)) : 0;
    }
    protected etaDays(bay: BayView): number | null { return this.svc.etaDays(bay); }

    protected fmtDate(d: { y: number; m: number; d: number }): string { return formatDate(d); }
}
