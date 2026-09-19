import type { RepairLine } from './repair-times';
import type { CampaignStartDate } from '../new-campaign-state';
import type { CBTSerializedState } from '../../models/force-serialization';

export type BayType = 'GENERAL' | 'ENGINE' | 'SALVAGE';

/** One repair bay. Empty = no occupantId. Job fields snapshot the estimate at assignment. */
export interface Bay {
    id: string;        // 'alpha' | 'bravo' | 'charlie' | 'delta'
    name: string;      // 'Alpha'
    type: BayType;     // flavor tag this slice (assignment validation is a later rules pass)
    priority: number;  // 1..4 — lower = higher priority; drives the capacity split
    occupantId?: string;          // instanceId of the unit under repair
    laborHours: number;           // total estimated labor tech-hours for the job (0 when empty)
    hoursSpent: number;           // accumulated tech-hours burned by the clock
    estimateCost: number;         // C-bill estimate quoted at assignment = the debit at completion
    bill?: RepairLine[];          // itemized cited estimate (snapshot at assignment)
    notes?: string[];             // estimate gap-notes carried (no invented numbers)
    assignedDate?: CampaignStartDate;
    isPrize?: boolean;            // captured cold-storage refit (display badge; RESERVE is driven by !lanceId)
    heldFor?: string[];           // R3 HOLD: the missing replace-components the job awaits (fork-only)
    lastNote?: string;            // the freed bay's last-completion note (e.g. a REARMED SHORT line; fork-only)
    //    defaulted from triage at assignment). Classic's per-BAY `priority` weighting is untouched — the
    //    fork's ladder burn ignores it entirely ("bay weights die; the ladder allocates"). ──
    jobPriority?: 1 | 2 | 3 | 4;
}

export interface BayHistoryEntry {
    date: CampaignStartDate;
    bayId: string;
    bayName: string;
    instanceId: string;
    label: string;
    laborHours: number;
    cost: number;
    outcome: 'completed' | 'written-off';
    bill?: RepairLine[];
    notes?: string[];
    partsUsed?: string[];         // the inventory component lines DEBITED at completion
    rearmShort?: string[];        // per-bin rearm shortfalls ("LRM 0.4 t short, rack dry")
}

//    register-flavored name, generated ONCE per campaign and STORED (stored-not-rerolled). ──
export interface TechPool {
    name: string;       // e.g. "MAC-7 Workshop" / "Vasek's Tent Crew"
    headcount: number;
    character: string;  // one line of shop character, tier-true
}

const POOL_NAMES: Record<string, string[]> = {
    lean: ['{S}\'s Tent Crew', 'The {S} Field Detail', '{S} Forward Wrenches', 'Camp {S} Repair Line'],
    normal: ['{S}-{N} Workshop', 'The {S} Bay Gang', '{S} Maintenance Section', 'Workshop {S}-{N}'],
    established: ['{S} Depot Works', 'The {S} Yards', '{S} Heavy Refit Hall', '{S}-{N} Engineering Group'],
};
const POOL_SYLLABLES = ['MAC', 'KESTREL', 'VASEK', 'HALVORSEN', 'OKUMA', 'BRENNER', 'TALAVERA', 'GRU', 'IRONLINE', 'CALDER', 'MERIDIAN', 'STACKPOLE'];
const POOL_CHARACTER: Record<string, string[]> = {
    lean: [
        'tarps, torque bars, and triage by lantern — nothing waits for parts that are not coming',
        'two trucks, one gantry frame, and a strict rule about what gets promised',
        'field expedience as doctrine: if it walks by morning, it was a repair',
    ],
    normal: [
        'a proper floor, a parts cage with a padlock, and a foreman who reads every estimate twice',
        'three shifts on the board and a standing argument about bay priority',
        'the work is logged, the log is honest, and the coffee is a war crime',
    ],
    established: [
        'gantries that take an Atlas, a calibration room, and a waiting list other commands envy',
        'depot tooling, deep spares racks, and apprentices who polish what they have not earned',
        'the floor runs to depot standard: every job photographed, every torque value filed',
    ],
};

/** Generate the campaign's tech-pool identity ONCE (the caller stores it). Tier keys character +
 *  headcount; the register flavors nothing structural (names are BCE-original). */
export function generateTechPool(tier: string, rng: () => number = Math.random): TechPool {
    const t = tier === 'lean' || tier === 'established' ? tier : 'normal';
    const pick = <X>(arr: readonly X[]): X => arr[Math.floor(rng() * arr.length)];
    const name = pick(POOL_NAMES[t])
        .replace('{S}', pick(POOL_SYLLABLES))
        .replace('{N}', String(Math.floor(rng() * 9) + 1));
    const headcount = t === 'lean' ? 4 + Math.floor(rng() * 3) : t === 'normal' ? 8 + Math.floor(rng() * 5) : 14 + Math.floor(rng() * 7);
    return { name, headcount, character: pick(POOL_CHARACTER[t]) };
}

export function jobSummary(label: string, bill: RepairLine[] | undefined, laborHours: number, cost: number): string {
    if (!bill?.length) return `${label} — ${laborHours} hours of bench time, ${cost.toLocaleString('en-US')} C-bills against the books (itemized bill not on record — completed pre-).`;
    const top = [...bill].sort((a, b) => b.hours - a.hours).slice(0, 3)
        .map((l) => `${l.action === 'replace' ? 'new ' : ''}${l.component.toLowerCase()} (${l.hours} h)`);
    const more = bill.length > 3 ? ` and ${bill.length - 3} smaller line${bill.length - 3 === 1 ? '' : 's'}` : '';
    return `${label} — ${top.join(', ')}${more}; ${laborHours} hours of bench time, ${cost.toLocaleString('en-US')} C-bills against the books.`;
}

/** The parts line from the bill's REPLACE-class items. Honest flag: no parts economy exists yet. */
export function partsNeeded(bill: RepairLine[] | undefined): string | null {
    const repl = (bill ?? []).filter((l) => l.action === 'replace');
    if (!repl.length) return null;
    return `Parts needed: ${repl.map((l) => l.component).join(' · ')} — requisition tracking arrives with Inventory.`;
}

// ── TUNABLES (interim, flagged) ──
export const BAY_TUNABLES = {
    /** Tech labor capacity per elapsed campaign DAY by resource tier (split across occupied bays by
     *  priority). INTERIM — the real tech-personnel pool is a later slice (T-025). */
    techHoursPerDay: { lean: 40, standard: 80, established: 160 } as Record<string, number>,
    /** C-bills per tech-hour billed at completion. ODM's rate — INTERIM until T-025 prices parts. */
    cbillsPerTechHour: 40,
} as const;

const EPS = 1e-6;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function hasMechDamage(d?: CBTSerializedState | null): boolean {
    if (!d) return false;
    if ((d.crits?.length ?? 0) > 0) return true;
    const locs = d.locations ?? {};
    for (const k of Object.keys(locs)) {
        const l = locs[k];
        if ((l.armor || 0) + (l.internal || 0) + (l.pendingArmor || 0) + (l.pendingInternal || 0) > 0) return true;
    }
    return false;
}

/** The 4 bays a fresh campaign starts with: Alpha/Bravo GENERAL, Charlie ENGINE, Delta SALVAGE. */
export function makeDefaultBays(): Bay[] {
    return [
        { id: 'alpha', name: 'Alpha', type: 'GENERAL', priority: 1, laborHours: 0, hoursSpent: 0, estimateCost: 0 },
        { id: 'bravo', name: 'Bravo', type: 'GENERAL', priority: 2, laborHours: 0, hoursSpent: 0, estimateCost: 0 },
        { id: 'charlie', name: 'Charlie', type: 'ENGINE', priority: 3, laborHours: 0, hoursSpent: 0, estimateCost: 0 },
        { id: 'delta', name: 'Delta', type: 'SALVAGE', priority: 4, laborHours: 0, hoursSpent: 0, estimateCost: 0 },
    ];
}

/** Reset a bay to empty, preserving its identity (id/name/type/priority). */
export function freeBay(b: Bay): Bay {
    return { id: b.id, name: b.name, type: b.type, priority: b.priority, laborHours: 0, hoursSpent: 0, estimateCost: 0 };
}

/** Labor hours still owed on a bay's job (0 when empty or done). */
export function remainingHours(b: Bay): number {
    return b.occupantId ? Math.max(0, round2(b.laborHours - b.hoursSpent)) : 0;
}

/**
 * Steady-state daily tech-hour allocation per OCCUPIED bay: the elapsed-day pool split by priority
 * rank (highest priority = largest share), so a higher-priority job finishes first while all bays
 * progress in parallel. Used for the ETA estimate; the actual burn (burnPool) also spills leftover.
 */
export function dailyAllocation(bays: Bay[], perDay: number): Record<string, number> {
    const active = bays.filter((b) => b.occupantId && remainingHours(b) > EPS).sort((a, b) => a.priority - b.priority);
    const wsum = active.reduce((s, _b, i) => s + (active.length - i), 0) || 1;
    const out: Record<string, number> = {};
    active.forEach((b, i) => { out[b.id] = round2((perDay * (active.length - i)) / wsum); });
    return out;
}

/**
 * Burn `pool` tech-hours across occupied bays, weighted by priority (highest first) and SPILLING the
 * leftover from any bay that finishes onto the rest (no capacity wasted). Returns fresh bays + the ids
 * of bays whose jobs reached completion. Pure — the caller settles the completed bays.
 */
export function burnPool(bays: Bay[], pool: number): { bays: Bay[]; completedIds: string[] } {
    const next = bays.map((b) => ({ ...b }));
    const occupied = next.filter((b) => b.occupantId && remainingHours(b) > EPS).sort((a, b) => a.priority - b.priority);
    let remaining = pool;
    // up to one spill round per occupied bay (each round, at least one bay finishes or all take their share)
    for (let round = 0; round < occupied.length && remaining > EPS; round++) {
        const active = occupied.filter((b) => remainingHours(b) > EPS);
        if (!active.length) break;
        const wsum = active.reduce((s, _b, i) => s + (active.length - i), 0);
        let used = 0;
        active.forEach((b, i) => {
            const take = Math.min((remaining * (active.length - i)) / wsum, remainingHours(b));
            b.hoursSpent = round2(b.hoursSpent + take);
            used += take;
        });
        remaining -= used;
        if (used <= EPS) break;
    }
    const completedIds = next.filter((b) => b.occupantId && remainingHours(b) <= EPS).map((b) => b.id);
    return { bays: next, completedIds };
}
