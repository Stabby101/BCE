import { formatDate, type CampaignDate } from '../clock/campaign-clock';

/** A stable key for a campaign date (null when the date is absent or malformed — a malformed date never notifies). */
export function dateKey(d: CampaignDate | null | undefined): string | null {
    if (!d || typeof d.y !== 'number' || typeof d.m !== 'number' || typeof d.d !== 'number') return null;
    return `${d.y}-${d.m}-${d.d}`;
}

export interface SessionClockNotice {
    /** The date key the notice is about — the ack writes this as the seen key. */
    key: string;
    /** The display date, e.g. "01 MAY 3151". */
    date: string;
    /** The player-facing sentence. */
    text: string;
}

/** The joined device's words. */
export const sessionClockPlayerText = (date: string): string => `Session date → ${date}. Your base pay lands with each track's results slip.`;
/** The GM device's words (the same fact, from the referee's side of the table). */
export const sessionClockGmText = (date: string): string => `Session date → ${date}. Every joined device is told — their base pay lands with each track's results slip.`;

export interface SessionClockSnapshot { gmSession?: boolean | null; currentDate?: CampaignDate | null }

/** The device-side decision over a fanned snapshot + the device's persisted seen key. Returns the notice to show (or null)
 *  and the key to acknowledge silently (or null) — never both. */
export function sessionClockNotice(snap: SessionClockSnapshot | null | undefined, seenKey: string | null): { notice: SessionClockNotice | null; ack: string | null } {
    if (!snap || snap.gmSession !== true) return { notice: null, ack: null };
    const key = dateKey(snap.currentDate);
    if (!key) return { notice: null, ack: null };
    if (seenKey === null) return { notice: null, ack: key };
    if (seenKey === key) return { notice: null, ack: null };
    const date = formatDate(snap.currentDate as CampaignDate);
    return { notice: { key, date, text: sessionClockPlayerText(date) }, ack: null };
}
