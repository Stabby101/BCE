/*
 * BCE — PILOT DETAIL view (DIRECTIVE-036). The person behind the G/P numbers: bio (generated,
 * GM-editable) + GM notes, the service record (missionCount, records-begin, kin, assignment),
 * status (ready / infirmary hits+ETA / the memorial), and PERKS — the 55 cited SPAs granted and
 * revoked under SPA_GOVERNANCE enforced AS DATA (perks.ts): ineligible grants render disabled
 * WITH THE GATE NAMED (the house pattern). Display + print only — the table adjudicates effects.
 * Opened from a Barracks card or the roster pilot block; all mutations persist in place.
 */
import { Component, ChangeDetectionStrategy, computed, inject, input, output, signal } from '@angular/core';
import { NewCampaignState } from '../new-campaign-state';
import { CampaignSaveStore } from '../campaign-save-store';
import { PilotService } from './pilot.service';
import { PILOT_ABILITIES, type PilotAbility } from './pilot-abilities';
import { PERK_TUNABLES, forceWideCap, grantGate, pointCapFor, pointsOf, ratingOf, slotsFor, type CapVariant } from './perks';
import { formatDate } from '../clock/campaign-clock';
import { CampaignPilotCardComponent } from '../chaos/campaign-pilot-card'; // D-125 — the HS Campaign Pilot Card

interface GrantRow {
    ability: PilotAbility;
    ok: boolean;
    gate: string | null;
}

@Component({
    selector: 'bce-pilot-detail',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CampaignPilotCardComponent], // D-125
    templateUrl: './pilot-detail.html',
    styleUrl: './pilot-detail.scss',
    host: { '(document:keydown.escape)': 'onClose()' },
})
export class PilotDetailComponent {
    readonly pilotId = input.required<string>();
    readonly close = output<void>();
    private readonly state = inject(NewCampaignState);
    private readonly store = inject(CampaignSaveStore);
    private readonly pilots = inject(PilotService);

    protected readonly pilot = computed(() => (this.state.pilots() ?? []).find((p) => p.pilotId === this.pilotId()) ?? null);
    // D-125 — the Campaign Pilot Card renders for a NAMED pilot in Hot Spots (Traditional / non-named → no card).
    protected readonly showCampaignCard = computed(() => this.state.campaignSystem() === 'hotspots' && !!this.pilot()?.named && this.pilot()?.status !== 'KIA');

    /** Fielded = the operational force (everything not mothballed in cold storage). */
    private readonly fielded = computed(() => (this.state.startingForce() ?? []).filter((i) => i.condition !== 'Cold storage').length);
    private readonly spaPilotCount = computed(() => (this.state.pilots() ?? []).filter((p) => (p.perks ?? []).length > 0).length);
    /** The force-wide cap variant — localStorage knob until the D-038 Settings surface adopts it. */
    private readonly variant = computed<CapVariant>(() => {
        try {
            const v = localStorage.getItem(PERK_TUNABLES.capStorageKey);
            if (v === 'standard' || v === 'formation' || v === 'off') return v;
        } catch { /* no storage */ }
        return PERK_TUNABLES.capVariant;
    });

    protected readonly vm = computed(() => {
        const p = this.pilot();
        if (!p) return null;
        const rating = ratingOf(p.gunnery, p.piloting);
        const held = (p.perks ?? []).map((id) => PILOT_ABILITIES.find((a) => a.id === id)).filter((a): a is PilotAbility => !!a);
        const fw = forceWideCap(this.fielded(), this.variant());
        const inst = p.assignedInstanceId ? (this.state.startingForce() ?? []).find((i) => i.instanceId === p.assignedInstanceId) : undefined;
        return {
            p,
            rating,
            slots: slotsFor(rating),
            pointCap: pointCapFor(rating),
            pointsUsed: pointsOf(p.perks ?? []),
            held,
            assignment: inst ? `${inst.chassis} ${inst.model}`.trim() : 'SPARE — unassigned',
            recordsBegin: p.recordsBegin ? formatDate(p.recordsBegin) : null,
            kiaDateText: p.kiaDate ? formatDate(p.kiaDate) : null,
            fwLine: fw === null
                ? `force-wide cap OFF (table call; variant '${this.variant()}')`
                : `force-wide: ${this.spaPilotCount()}/${fw} SPA pilot${fw === 1 ? '' : 's'} across ${this.fielded()} fielded (${this.variant()})`,
        };
    });

    protected readonly grantRows = computed<GrantRow[]>(() => {
        const p = this.pilot();
        if (!p || p.status === 'KIA') return [];
        return PILOT_ABILITIES.map((ability) => {
            const g = grantGate(p, ability.id, this.fielded(), this.spaPilotCount(), this.variant());
            return { ability, ok: g.ok, gate: g.gate };
        });
    });

    // ── grant / revoke (confirm-gated) ──
    protected readonly confirmGrant = signal<PilotAbility | null>(null);
    protected readonly confirmRevoke = signal<PilotAbility | null>(null);
    protected askGrant(a: PilotAbility): void { this.confirmGrant.set(a); }
    protected askRevoke(a: PilotAbility): void { this.confirmRevoke.set(a); }
    protected doGrant(): void {
        const a = this.confirmGrant();
        if (!a) return;
        this.pilots.grantPerk(this.pilotId(), a.id);
        this.confirmGrant.set(null);
        void this.store.persistCurrent();
    }
    protected doRevoke(): void {
        const a = this.confirmRevoke();
        if (!a) return;
        this.pilots.revokePerk(this.pilotId(), a.id);
        this.confirmRevoke.set(null);
        void this.store.persistCurrent();
    }
    protected cancelConfirms(): void {
        this.confirmGrant.set(null);
        this.confirmRevoke.set(null);
    }

    // ── D-070: identity editing — name + Gunnery/Piloting, fully editable (nothing greyed). Drives the
    //    skill-adjusted BV on the roster cell + the record sheet (BVCalculatorUtil). KIA names are fixed. ──
    protected readonly editingId = signal(false);
    protected readonly nameDraft = signal('');
    protected readonly gunDraft = signal(4);
    protected readonly pilDraft = signal(5);
    protected startEditId(): void {
        const p = this.pilot();
        if (!p || p.status === 'KIA') return;
        this.nameDraft.set(p.name);
        this.gunDraft.set(p.gunnery);
        this.pilDraft.set(p.piloting);
        this.editingId.set(true);
    }
    protected saveId(): void {
        const p = this.pilot();
        if (!p) return;
        this.pilots.rename(this.pilotId(), this.nameDraft());
        this.pilots.setSkills(this.pilotId(), this.gunDraft(), this.pilDraft());
        this.editingId.set(false);
        void this.store.persistCurrent();
    }
    protected cancelId(): void { this.editingId.set(false); }

    // ── bio + notes editing (GM-editable; the generated text only seeds the record) ──
    protected readonly editingBio = signal(false);
    protected readonly bioDraft = signal('');
    protected startBio(): void { this.bioDraft.set(this.pilot()?.bio ?? ''); this.editingBio.set(true); }
    protected saveBio(): void {
        this.pilots.setBio(this.pilotId(), this.bioDraft().trim());
        this.editingBio.set(false);
        void this.store.persistCurrent();
    }
    protected readonly notesDraft = signal<string | null>(null);
    protected notesValue(): string { return this.notesDraft() ?? this.pilot()?.gmNotes ?? ''; }
    protected saveNotes(): void {
        const d = this.notesDraft();
        if (d === null) return;
        this.pilots.setGmNotes(this.pilotId(), d.trim());
        this.notesDraft.set(null);
        void this.store.persistCurrent();
    }

    protected onClose(): void {
        this.cancelConfirms();
        this.close.emit();
    }
}
