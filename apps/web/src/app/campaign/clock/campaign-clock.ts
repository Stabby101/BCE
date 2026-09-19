
/** {y, m(0-11), d} — structurally the wizard's CampaignStartDate. */
export interface CampaignDate {
    y: number;
    m: number; // 0-11
    d: number;
}

export type SpanId = 'day' | 'week' | 'month';
export interface AdvanceSpan {
    id: SpanId;
    label: string;
}

// ── TUNABLE: the GM advance controls (ODM D40 "quick-action buttons"). ──
export const CLOCK_TUNABLES = {
    spans: [
        { id: 'day', label: '+1 Day' },
        { id: 'week', label: '+1 Week' },
        { id: 'month', label: '+1 Month' },
    ] as AdvanceSpan[],
} as const;

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number): string => String(n).padStart(2, '0');

/** Display form, e.g. "15 JUN 3025". */
export function formatDate(d: CampaignDate): string {
    return `${pad(d.d)} ${MON[d.m] ?? '???'} ${d.y}`;
}

const fromJs = (j: Date): CampaignDate => ({ y: j.getFullYear(), m: j.getMonth(), d: j.getDate() });

/** Advance a date by one span. Month adds a calendar month with day clamped to the new month length. */
export function addSpan(d: CampaignDate, span: SpanId): CampaignDate {
    if (span === 'day') return fromJs(new Date(d.y, d.m, d.d + 1));
    if (span === 'week') return fromJs(new Date(d.y, d.m, d.d + 7));
    // month: clamp the day to the target month's last day (avoids JS Date's Jan31+1mo -> Mar overflow).
    const lastDay = new Date(d.y, d.m + 2, 0).getDate(); // last day of month (d.m+1)
    return fromJs(new Date(d.y, d.m + 1, Math.min(d.d, lastDay)));
}

export function addDays(d: CampaignDate, n: number): CampaignDate {
    return fromJs(new Date(d.y, d.m, d.d + Math.round(n)));
}

const key = (d: CampaignDate): number => d.y * 10000 + d.m * 100 + d.d;
/** <0 if a<b, 0 if equal, >0 if a>b. */
export function compareDate(a: CampaignDate, b: CampaignDate): number {
    return key(a) - key(b);
}

export function daysBetween(from: CampaignDate, to: CampaignDate): number {
    const ms = Date.UTC(to.y, to.m, to.d) - Date.UTC(from.y, from.m, from.d);
    return ms <= 0 ? 0 : Math.round(ms / 86_400_000);
}
export function campaignWeek(start: CampaignDate | null | undefined, current: CampaignDate | null | undefined): number {
    if (!start || !current) return 1;
    return Math.floor(daysBetween(start, current) / 7) + 1;
}

/**
 * Month-FIRST boundaries strictly after `from`, up to and including `to`, in chronological order.
 * A +3-month advance from mid-month yields the next three 1st-of-months (each fired once). `from`
 * sitting on a 1st is excluded (its boundary already fired when the clock arrived there).
 */
export function monthBoundariesBetween(from: CampaignDate, to: CampaignDate): CampaignDate[] {
    const out: CampaignDate[] = [];
    if (compareDate(to, from) <= 0) return out;
    let y = from.y;
    let m = from.m + 1; // first boundary after `from` is the 1st of the next month (from.d >= 1)
    if (m > 11) { m = 0; y += 1; }
    let b: CampaignDate = { y, m, d: 1 };
    while (compareDate(b, to) <= 0) {
        out.push(b);
        m += 1;
        if (m > 11) { m = 0; y += 1; }
        b = { y, m, d: 1 };
    }
    return out;
}

/** A month-boundary subscriber: fired once per crossed boundary, in registration order. */
export type MonthSubscriber = (boundary: CampaignDate, index: number) => void;

/**
 * Ordered subscriber registry (a prior-prototype concept). `fire` walks boundaries chronologically and,
 * per boundary, runs every subscriber in registration order — so a subscriber that mutates state
 * at boundary N (e.g. completes a contract) is seen by the next subscriber and by boundary N+1.
 */
export class ClockSubscribers {
    private readonly subs: { name: string; fn: MonthSubscriber }[] = [];
    register(name: string, fn: MonthSubscriber): void {
        this.subs.push({ name, fn });
    }
    fire(boundaries: CampaignDate[]): void {
        boundaries.forEach((b, i) => {
            for (const s of this.subs) s.fn(b, i);
        });
    }
}
