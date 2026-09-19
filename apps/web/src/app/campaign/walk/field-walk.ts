import { Component, ChangeDetectionStrategy, computed, inject, signal, output } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { FieldWalkService, type WalkRow } from './field-walk.service';
import { stripCredit, salvageCredit, type Disposition } from './field-walk-core';

@Component({
    selector: 'bce-field-walk',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './field-walk.html',
    styleUrl: './field-walk.scss',
    host: { '(document:keydown.escape)': 'later()' },
})
export class FieldWalkComponent {
    readonly close = output<void>();
    private readonly svc = inject(FieldWalkService);
    private readonly state = inject(NewCampaignState);

    protected readonly rows = this.svc.rows;
    protected readonly blu = computed(() => this.rows().filter((r) => r.side === 'blufor'));
    protected readonly opf = computed(() => this.rows().filter((r) => r.side === 'opfor'));
    protected readonly prizeSlots = this.svc.prizeSlots;
    protected readonly recoverCap = this.svc.recoverCap;
    protected readonly branchName = computed(() => this.svc.pendingBranch()?.name ?? 'Engagement');

    protected readonly bluOptions: { v: Disposition; l: string }[] = [{ v: 'RECOVER', l: 'Recover → repair' }, { v: 'FIELD_STRIP', l: 'Field strip' }, { v: 'ABANDON', l: 'Abandon' }];
    protected readonly opfOptions: { v: Disposition; l: string }[] = [{ v: 'CLAIM_PRIZE', l: 'Claim as prize' }, { v: 'SALVAGE', l: 'Salvage' }, { v: 'LEAVE', l: 'Leave' }];

    private readonly salvage = computed(() => this.state.acceptedContract()?.salvage ?? { pct: 0, exchange: false });
    protected readonly clauseLabel = computed(() => { const s = this.salvage(); return s.exchange ? 'salvage exchange' : `${s.pct}% salvage clause`; });

    protected readonly disp = signal<Record<string, Disposition>>({});
    protected readonly q1ov = signal<Record<string, boolean>>({});

    protected effDisp(r: WalkRow): Disposition { return this.disp()[r.instanceId] ?? r.def; }
    protected effQ1(r: WalkRow): boolean { const o = this.q1ov()[r.instanceId]; return o === undefined ? r.q1 : o; }
    protected setDisp(r: WalkRow, d: string): void { this.disp.update((m) => ({ ...m, [r.instanceId]: d as Disposition })); }
    protected toggleQ1(r: WalkRow): void { this.q1ov.update((m) => ({ ...m, [r.instanceId]: !this.effQ1(r) })); }

    protected readonly claimsSelected = computed(() => this.opf().filter((r) => this.effDisp(r) === 'CLAIM_PRIZE').length);
    protected readonly recoversSelected = computed(() => this.blu().filter((r) => this.effDisp(r) === 'RECOVER').length);
    /** CLAIM is gated: Q1 (or override) yes AND a cold-storage slot remains for THIS row. */
    protected claimDisabled(r: WalkRow): boolean {
        if (!this.effQ1(r)) return true;
        const others = this.opf().filter((x) => x.instanceId !== r.instanceId && this.effDisp(x) === 'CLAIM_PRIZE').length;
        return others >= this.prizeSlots();
    }
    protected claimGate(r: WalkRow): string | null {
        if (this.effDisp(r) !== 'CLAIM_PRIZE') return null;
        if (!this.effQ1(r)) return 'Q1 NO — can\'t reach the ship (override Q1 to force)';
        if (this.claimsSelected() > this.prizeSlots()) return 'no cold-storage slot — will salvage instead';
        return null;
    }

    protected rowCredit(r: WalkRow): number {
        const d = this.effDisp(r); const s = this.salvage();
        if (d === 'FIELD_STRIP') return stripCredit(r.unit?.cost ?? 0, r.readout.severity);
        if (d === 'SALVAGE') return salvageCredit(r.value, s.pct, s.exchange);
        if (d === 'CLAIM_PRIZE' && this.claimDisabled(r)) return salvageCredit(r.value, s.pct, s.exchange); // falls to salvage
        return 0;
    }
    protected readonly totalCredit = computed(() => this.rows().reduce((sum, r) => sum + this.rowCredit(r), 0));

    protected sevLabel(s: string): string { return ({ G: 'LIGHT', Y: 'MODERATE', R: 'HEAVY', B: 'DESTROYED' } as Record<string, string>)[s] ?? s; }
    protected fmt(n: number): string { return n.toLocaleString('en-US'); }
    protected pct(n: number): number { return Math.round(n * 100); }

    protected confirm(): void {
        const dispositions: Record<string, Disposition> = {};
        const overrides: Record<string, string[]> = {};
        for (const r of this.rows()) {
            const d = this.effDisp(r);
            dispositions[r.instanceId] = d;
            const ov: string[] = [];
            if (d !== r.def) ov.push(`disposition ${r.def}→${d}`);
            if (this.effQ1(r) !== r.q1) ov.push(`Q1 ${r.q1 ? 'YES' : 'NO'}→${this.effQ1(r) ? 'YES' : 'NO'}`);
            if (ov.length) overrides[r.instanceId] = ov;
        }
        this.svc.apply(dispositions, overrides);
        this.close.emit();
    }
    protected later(): void { this.svc.skip(); this.close.emit(); }
}
