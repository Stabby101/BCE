export function sessionCodeOf(campaignId: string | null | undefined): string {
    const alnum = (campaignId || '').replace(/[^a-zA-Z0-9]/g, '');
    return (alnum.slice(-6) || '------').toUpperCase();
}
