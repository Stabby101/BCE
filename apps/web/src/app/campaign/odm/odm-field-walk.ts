import { Component, ChangeDetectionStrategy, computed, inject, signal, output } from '@angular/core';
import { OdmFieldWalkService, type OdmWalkRow, type OdmDisposition } from './odm-field-walk.service';
import { weightClassOf } from '../walk/field-walk-core'; // S66 — the class beside the tonnage

@Component({
    selector: 'bce-odm-field-walk',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './odm-field-walk.html',
    styleUrl: '../walk/field-walk.scss' /* SHARED */,
    host: { '(document:keydown.escape)': 'later()' },
})
export class OdmFieldWalkComponent {
    readonly close = output<void>();
    private readonly svc = inject(OdmFieldWalkService);

    protected readonly rows = this.svc.rows;
    protected readonly blu = computed(() => this.rows().filter((r) => r.side === 'blufor'));
    protected readonly opf = computed(() => this.rows().filter((r) => r.side === 'opfor'));
    protected readonly prizeSlots = this.svc.prizeSlots;
    protected readonly branchName = computed(() => this.svc.pendingBranch()?.name ?? 'Engagement');
    protected readonly liftBays = this.svc.liftBays;
    protected readonly cargoCap = this.svc.cargoCap;
    protected readonly hoursWindow = this.svc.fieldHoursWindow;
    protected readonly fleetReady = this.svc.fleetReady;

    // the R2 trio, both sides — verbs only a survival company uses (no sell exists)
    protected readonly bluOptions: { v: OdmDisposition; l: string }[] = [{ v: 'RECOVER', l: 'Recover → repair' }, { v: 'STRIP', l: 'Strip for materiel' }, { v: 'LEAVE', l: 'Leave' }];
    protected readonly opfOptions: { v: OdmDisposition; l: string }[] = [{ v: 'RECOVER', l: 'Recover → cold storage' }, { v: 'STRIP', l: 'Strip for materiel' }, { v: 'LEAVE', l: 'Leave' }];

    protected readonly disp = signal<Record<string, OdmDisposition>>({});
    protected readonly q1ov = signal<Record<string, boolean>>({});
    protected readonly q3ov = signal<Record<string, boolean>>({});
    protected readonly forceReason = signal('');
    protected readonly refusal = signal<string | null>(null);      // apply()'s refusal, shown in the footer

    protected effDisp(r: OdmWalkRow): OdmDisposition { return this.disp()[r.instanceId] ?? r.def; }
    protected effQ1(r: OdmWalkRow): boolean { const o = this.q1ov()[r.instanceId]; return o === undefined ? r.q1 : o; }
    protected effQ3(r: OdmWalkRow): boolean { const o = this.q3ov()[r.instanceId]; return o === undefined ? r.q3 : o; }
    protected setDisp(r: OdmWalkRow, d: string): void { this.disp.update((m) => ({ ...m, [r.instanceId]: d as OdmDisposition })); this.refusal.set(null); }
    protected toggleQ1(r: OdmWalkRow): void { this.q1ov.update((m) => ({ ...m, [r.instanceId]: !this.effQ1(r) })); }
    protected toggleQ3(r: OdmWalkRow): void { this.q3ov.update((m) => ({ ...m, [r.instanceId]: !this.effQ3(r) })); }

    protected readonly capturesSelected = computed(() => this.opf().filter((r) => this.effDisp(r) === 'RECOVER').length);
    protected readonly recoversSelected = computed(() => this.blu().filter((r) => this.effDisp(r) === 'RECOVER').length);

    protected readonly manifest = computed(() => this.svc.manifestFor(this.disp()));
    protected readonly overBays = computed(() => { const m = this.manifest(); return !!m && m.baysUsed > m.liftBays; });
    protected readonly overCargo = computed(() => { const m = this.manifest(); return !!m && m.cargoUsed > m.cargoTons; });
    protected readonly overHours = computed(() => { const m = this.manifest(); return !!m && m.fieldHours > m.fieldHoursWindow; });
    protected readonly needsForce = computed(() => this.overBays() || this.overCargo());

    /** Q2 — is there room? Answered for the row's CURRENT disposition against the live manifest. */
    protected q2(r: OdmWalkRow): boolean {
        const m = this.manifest();
        if (!m) return true; // unknowable until the fleet loads; confirm is gated on fleetReady anyway
        const d = this.effDisp(r);
        if (d === 'RECOVER') return m.baysUsed <= m.liftBays;
        if (d === 'STRIP') return m.cargoUsed <= m.cargoTons && m.fieldHours <= m.fieldHoursWindow;
        return true; // LEAVE needs no room
    }
    protected q2Title(r: OdmWalkRow): string {
        const m = this.manifest();
        if (!m) return 'Q2 — is there room? (fleet manifest loading)';
        const d = this.effDisp(r);
        if (d === 'RECOVER') return `Q2 — is there room? bays ${m.baysUsed}/${m.liftBays}`;
        if (d === 'STRIP') return `Q2 — is there room? holds ${m.cargoUsed}/${m.cargoTons} t · field crew ${m.fieldHours}/${m.fieldHoursWindow} h`;
        return 'Q2 — is there room? (leaving it — no room needed)';
    }
    protected captureDisabled(r: OdmWalkRow): boolean {
        if (!this.effQ1(r)) return true;
        const others = this.opf().filter((x) => x.instanceId !== r.instanceId && this.effDisp(x) === 'RECOVER').length;
        return others >= this.prizeSlots();
    }
    protected readonly salvageBayOperational = this.svc.salvageBayOperational;
    protected captureGate(r: OdmWalkRow): string | null {
        if (this.effDisp(r) !== 'RECOVER' || r.side !== 'opfor') return null;
        if (!this.effQ1(r)) return 'Q1 NO — can\'t reach the ship (override Q1 to force)';
        if (this.capturesSelected() > this.prizeSlots()) return 'no cold-storage slot — will strip instead';
        if (this.overBays()) return 'Q2 NO — no bay free (a logged GM reason forces it)';
        if (!this.salvageBayOperational()) return 'Q2 warning — no SALVAGE bay operational: the hulk can be lifted but nowhere processes it (convert a bay)';
        return null;
    }

    /** The strip-yield preview — what this wreck becomes if stripped: cargo tons + the field-crew clock. */
    protected yieldLabel(r: OdmWalkRow): string {
        const parts = r.yield.parts.reduce((s, p) => s + p.count, 0);
        if (!r.stripTons && !parts) return 'nothing recoverable';
        return `≈ ${r.stripTons} t · ${parts} part${parts === 1 ? '' : 's'} · ${r.fieldHours} h field`;
    }
    protected mac7Note(r: OdmWalkRow): string | null {
        if (!r.mac7Denied.length || this.effDisp(r) !== 'STRIP') return null;
        return `stays with the wreck (MAC-7-only work): ${[...new Set(r.mac7Denied)].join(', ')}`;
    }
    protected unpricedNote(r: OdmWalkRow): string | null {
        if (!r.unpriced.length || this.effDisp(r) !== 'STRIP') return null;
        return `not catalog-priced, counted 0 t: ${[...new Set(r.unpriced)].join(', ')}`; // reported, never guessed
    }
    /** S66 — the badge is the DAMAGE severity, and now says so ("DMG LIGHT"); the weight class rides beside the tonnage. */
    protected sevLabel(s: string): string { return ({ G: 'DMG LIGHT', Y: 'DMG MODERATE', R: 'DMG HEAVY', B: 'DESTROYED' } as Record<string, string>)[s] ?? s; }
    protected weightClass(tons: number): string | null { return weightClassOf(tons); }
    /** P8 — the manifest load state for the footer (+ Retry). */
    protected readonly manifestLoad = this.svc.manifestLoad;
    protected retryManifest(): void { this.svc.retryManifest(); }
    protected pct(n: number): number { return Math.round(n * 100); }

    protected confirm(): void {
        if (!this.fleetReady()) return; // the walk waits for the fleet manifest
        const dispositions: Record<string, OdmDisposition> = {};
        const overrides: Record<string, string[]> = {};
        for (const r of this.rows()) {
            const d = this.effDisp(r);
            dispositions[r.instanceId] = d;
            const ov: string[] = [];
            if (d !== r.def) ov.push(`disposition ${r.def}→${d}`);
            if (this.effQ1(r) !== r.q1) ov.push(`Q1 ${r.q1 ? 'YES' : 'NO'}→${this.effQ1(r) ? 'YES' : 'NO'}`);
            if (this.effQ3(r) !== r.q3) ov.push(`Q3 ${r.q3 ? 'YES' : 'NO'}→${this.effQ3(r) ? 'YES' : 'NO'} (call was: ${r.q3Reason})`);
            if (!this.q2(r) && this.needsForce()) ov.push('Q2 NO — room forced past the lift (GM reason logged)');
            if (ov.length) overrides[r.instanceId] = ov;
        }
        const res = this.svc.apply(dispositions, overrides, this.forceReason() || undefined);
        if (!res.ok) { this.refusal.set(res.reason); return; } // refused with the manifest shown — nothing written
        this.close.emit();
    }
    protected later(): void { this.svc.skip(); this.close.emit(); }
}
