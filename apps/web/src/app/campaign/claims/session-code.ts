/*
 * HOTFIX-029 — the human-eyeballable SESSION CODE, derived IDENTICALLY on both ends from the campaignId (the
 * last 6 alphanumerics, uppercased). The GM lobby header and the player side-pick window both show it, so a
 * player can confirm at a glance they are in the right session — mismatched codes = a stale/wrong QR (a
 * different campaign). Pure; the full campaignId stays available on hover/title.
 */
export function sessionCodeOf(campaignId: string | null | undefined): string {
    const alnum = (campaignId || '').replace(/[^a-zA-Z0-9]/g, '');
    return (alnum.slice(-6) || '------').toUpperCase();
}
