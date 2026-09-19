import { Component, ChangeDetectionStrategy, computed, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NewCampaignState, type CampaignStartDate } from '../new-campaign-state';
import { CHAOS_CAMPAIGNS } from '../setup/chaos-campaigns';

interface Archetype {
    code: string;
    name: string;
    desc: string;
    from: number;
    to: number; // 9999 = present
}

const ARCH: Archetype[] = [
    { code: 'MERC', name: 'Mercenary', desc: 'Independent command, contracts for coin.', from: 2005, to: 9999 },
    { code: 'HOUSE', name: 'House Regular', desc: "A Great House's standing army.", from: 2005, to: 9999 },
    { code: 'H-AFF', name: 'House-Affiliated', desc: 'Sworn to a House, semi-independent.', from: 2005, to: 9999 },
    { code: 'PIR', name: 'Pirate', desc: 'Outlaw raiders, no flag but their own.', from: 2005, to: 9999 },
    { code: 'PERIPH', name: 'Periphery', desc: 'A rim realm — Taurian, Canopian, Outworlds…', from: 2005, to: 9999 },
    { code: 'SOL', name: 'Solaris VII', desc: 'Arena stable — duels for fame and C-bills.', from: 2571, to: 9999 },
    { code: 'COM', name: 'ComStar', desc: "The technocratic order's hidden army.", from: 2788, to: 9999 },
    { code: 'CLAN', name: 'Clan', desc: 'A Clan touman — honor and superior tech.', from: 3050, to: 9999 },
    { code: 'WOB', name: 'Word of Blake', desc: 'Blakist zealots of the Jihad.', from: 3052, to: 3081 },
    { code: 'ROTS', name: 'Republic of the Sphere', desc: "Stone's Republic forces.", from: 3081, to: 9999 },
];

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface DayCell { day: number; blank: boolean; }

@Component({
    selector: 'bce-date-force',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './date-force.html',
    styleUrl: './date-force.scss',
})
export class DateForceComponent {
    private readonly router = inject(Router);
    private readonly state = inject(NewCampaignState);

    protected readonly era = this.state.era;

    protected readonly viewYear = signal(0);
    protected readonly viewMonth = signal(0); // 0-11
    protected readonly selectedDate = signal<CampaignStartDate | null>(null);
    protected readonly selectedArch = signal<string | null>(null);

    constructor() {
        const era = this.state.era();
        if (!era) {
            // No era => the wizard hasn't done step 1; send back to it.
            void this.router.navigate(['/campaign/new/era']);
            return;
        }
        // Restore a prior date/force if still valid for this era (Back from step 3).
        const d = this.state.startDate();
        if (d && d.y >= era.from && d.y <= era.to) {
            this.selectedDate.set(d);
            this.viewYear.set(d.y);
            this.viewMonth.set(d.m);
        } else {
            this.viewYear.set(era.from);
        }
        const f = this.state.force();
        if (f && ARCH.some((a) => a.code === f && this.overlaps(a, era))) {
            this.selectedArch.set(f);
        }
    }

    private overlaps(a: Archetype, era: { from: number; to: number }): boolean {
        return a.from <= era.to && a.to >= era.from;
    }

    protected disp(b: number): string | number {
        return b >= 9999 ? 'present' : b;
    }

    protected readonly eraRange = computed(() => {
        const e = this.era();
        return e ? `${e.from}–${this.disp(e.to)}` : '';
    });

    protected readonly archetypes = computed(() => {
        const e = this.era();
        return ARCH.map((a) => {
            const ok = e ? this.overlaps(a, e) : false;
            const tag = ok ? '' : e && a.from > e.to ? `${a.from}+` : `≤${this.disp(a.to)}`;
            return { code: a.code, name: a.name, desc: a.desc, ok, tag };
        });
    });

    protected readonly monthLabel = computed(() => `${MONL[this.viewMonth()]} ${this.viewYear()}`);

    protected readonly stampText = computed(() => {
        const d = this.selectedDate();
        return d ? `${String(d.d).padStart(2, '0')} ${MON[d.m]} ${d.y}` : 'select a date';
    });

    protected readonly dayCells = computed<DayCell[]>(() => {
        const y = this.viewYear();
        const m = this.viewMonth();
        const firstDow = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const cells: DayCell[] = [];
        for (let i = 0; i < firstDow; i++) cells.push({ day: 0, blank: true });
        for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, blank: false });
        return cells;
    });

    protected isSelectedDay(d: number): boolean {
        const s = this.selectedDate();
        return !!s && s.y === this.viewYear() && s.m === this.viewMonth() && s.d === d;
    }

    protected readonly prevYearDisabled = computed(() => { const e = this.era(); return !e || this.viewYear() <= e.from; });
    protected readonly nextYearDisabled = computed(() => { const e = this.era(); return !e || this.viewYear() >= e.to; });
    protected readonly prevMonthDisabled = computed(() => { const e = this.era(); return !e || (this.viewYear() <= e.from && this.viewMonth() <= 0); });
    protected readonly nextMonthDisabled = computed(() => { const e = this.era(); return !e || (this.viewYear() >= e.to && this.viewMonth() >= 11); });

    protected prevYear(): void { const e = this.era(); if (e && this.viewYear() > e.from) this.viewYear.update((y) => y - 1); }
    protected nextYear(): void { const e = this.era(); if (e && this.viewYear() < e.to) this.viewYear.update((y) => y + 1); }
    protected prevMonth(): void {
        const e = this.era(); if (!e) return;
        if (this.viewMonth() > 0) this.viewMonth.update((m) => m - 1);
        else if (this.viewYear() > e.from) { this.viewYear.update((y) => y - 1); this.viewMonth.set(11); }
    }
    protected nextMonth(): void {
        const e = this.era(); if (!e) return;
        if (this.viewMonth() < 11) this.viewMonth.update((m) => m + 1);
        else if (this.viewYear() < e.to) { this.viewYear.update((y) => y + 1); this.viewMonth.set(0); }
    }

    protected selectDay(d: number): void {
        this.selectedDate.set({ y: this.viewYear(), m: this.viewMonth(), d });
    }
    protected selectArch(code: string): void {
        this.selectedArch.set(code);
    }

    protected readonly canProceed = computed(() => !!this.selectedDate() && !!this.selectedArch());

    protected back(): void {
        // Back must return to Setup, NOT the Era step (which the user never saw and where they could override
        // the lock, persisting a hotSpotCampaign/era mismatch). Traditional / generic Hot Spots retrace to Era.
        const c = this.state.campaignSystem() === 'hotspots'
            ? CHAOS_CAMPAIGNS.find((x) => x.id === this.state.hotSpotCampaign())
            : null;
        void this.router.navigate([c?.eraLocked ? '/campaign/new/setup' : '/campaign/new/era']);
    }

    protected proceed(): void {
        if (!this.canProceed()) return;
        this.state.setStartDate(this.selectedDate()!);
        this.state.setForce(this.selectedArch()!);
        void this.router.navigate(['/campaign/new/faction']);
    }
}
