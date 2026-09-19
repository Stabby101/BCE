export const DENIED_CLAIM_NOTICE_MS = 5000;

/** The host's `denied` reason → a plain line for the player. Unknown reasons are shown as they came (the host is honest). */
export function deniedClaimText(reason: string | null | undefined): string {
    switch ((reason ?? '').trim()) {
        case 'another player holds that seat': return 'Not taken — another player holds that seat.';
        case 'already claimed': return 'Not taken — someone claimed it first.';
        case 'not your side': return 'Not taken — that unit fights for the other side.';
        case 'no active engagement': return 'Not taken — no engagement is live; between missions the GM seats the players.';
        case 'not the live engagement': return 'Not taken — that claim was not for the live engagement.';
        case 'reserved key': return 'Not taken — that seat is the GM\u2019s to give.';
        case 'not your token': return 'Not taken — this device is not the one that joined.';
        case '': return 'Not taken.';
        default: return `Not taken — ${reason}.`;
    }
}
